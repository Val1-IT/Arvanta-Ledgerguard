import {
  DEFAULT_ADAPTER_CAPABILITIES,
  type ConstrainedAction,
  type ConstrainedActionAdapter,
  type StaleReservationClassification
} from '@ledgerguard/core';
import { INVENTORY_MODE_CONTEXT, ODOO_ATOMIC_METHODS, ODOO_JSON2_METHODS, ODOO_JSON2_MODEL, QUANT_READ_FIELDS } from './allowlist';
import { atomicRequest, isBoundAtomicResponse, isCanonicalOdooDatetime, isVerifiedAtomicReceipt } from './atomic-protocol';
import { odooQuantFingerprint, parseQuantRecord, quantitiesEqual } from './fingerprint';
import { createJson2Transport, guardedTransport } from './json2-client';
import type {
  OdooAdapterCapabilities,
  OdooAdapterOptions,
  OdooExecutionMode,
  OdooConnectionConfig,
  OdooInventoryAdjustmentAction,
  OdooJson2Transport,
  OdooQuantSnapshot
} from './types';
import { companiesMatch, validateInventoryAdjustmentAction } from './validate-action';

export const ODOO_ADAPTER_VERSION = '0.3.0';

const ODOO_CAPABILITIES = {
  ...DEFAULT_ADAPTER_CAPABILITIES,
  supportsStateVersioning: true
} as const;

export class OdooInventoryAdapter implements ConstrainedActionAdapter {
  readonly meta: {
    systemId: string;
    systemType: 'odoo';
    adapterVersion: string;
    capabilities: OdooAdapterCapabilities;
  };
  private readonly executionMode: OdooExecutionMode;
  private readonly transport: OdooJson2Transport;

  constructor(config: OdooConnectionConfig, options: OdooAdapterOptions = {}) {
    this.executionMode = options.executionMode ?? 'experimental-json2';
    if (!['experimental-json2', 'atomic-addon'].includes(this.executionMode)) throw new Error('Invalid Odoo execution mode');
    this.transport = guardedTransport(createJson2Transport(config, this.executionMode), this.executionMode);
    this.meta = {
      systemId: options.systemId ?? 'odoo-19',
      systemType: 'odoo',
      adapterVersion: ODOO_ADAPTER_VERSION,
      capabilities: {
        ...ODOO_CAPABILITIES,
        atomicInventoryAction: this.executionMode === 'atomic-addon',
        durableActionReceipts: this.executionMode === 'atomic-addon'
      }
    };
  }

  async readQuant(quantId: number): Promise<OdooQuantSnapshot> {
    const rows = (await this.transport(ODOO_JSON2_MODEL, ODOO_JSON2_METHODS.searchRead, {
      domain: [['id', '=', quantId]],
      fields: [...QUANT_READ_FIELDS]
    })) as unknown[];
    if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0] !== 'object' || rows[0] === null) {
      throw new Error(`Odoo stock.quant ${quantId} was not found`);
    }
    return parseQuantRecord(rows[0] as Record<string, unknown>);
  }

  async fingerprint(action: ConstrainedAction): Promise<string> {
    const validated = validateInventoryAdjustmentAction(action);
    if (!validated.ok) {
      throw new Error(validated.reason);
    }
    const quant = await this.readQuant(validated.action.quantId);
    return odooQuantFingerprint(quant);
  }

  async validate(action: ConstrainedAction): Promise<{ ok: true } | { ok: false; reason: string }> {
    const validated = validateInventoryAdjustmentAction(action);
    if (validated.ok && this.executionMode === 'atomic-addon') {
      const inventory = validated.action;
      if (!isCanonicalOdooDatetime(inventory.expectedWriteDate)) {
        return { ok: false, reason: 'atomic mode requires a canonical Odoo UTC datetime' };
      }
      if (![inventory.quantId, inventory.productId, inventory.locationId, inventory.companyId ?? 1].every(Number.isSafeInteger) ||
          [inventory.expectedQuantity, inventory.targetQuantity].some((value) => Math.abs(value) > Number.MAX_SAFE_INTEGER)) {
        return { ok: false, reason: 'atomic mode requires safely representable inventory numbers' };
      }
    }
    return validated.ok ? { ok: true } : { ok: false, reason: validated.reason };
  }

  async execute(action: ConstrainedAction): Promise<{
    httpSucceeded: boolean;
    stale?: boolean;
    recoveryRequired?: boolean;
    remoteWriteAttempted?: boolean;
    detail: string;
  }> {
    const validated = validateInventoryAdjustmentAction(action);
    if (!validated.ok) {
      return { httpSucceeded: false, detail: validated.reason };
    }
    const inventory = validated.action;
    if (this.executionMode === 'atomic-addon') {
      const valid = await this.validate(action);
      if (!valid.ok) return { httpSucceeded: false, remoteWriteAttempted: false, detail: valid.reason };
      const result = await this.transport(ODOO_JSON2_MODEL, ODOO_ATOMIC_METHODS.apply, { request: atomicRequest(inventory) });
      if (isBoundAtomicResponse(result, inventory) && result.status === 'stale') {
        return { httpSucceeded: false, stale: true, remoteWriteAttempted: false, detail: 'Odoo rejected a stale inventory precondition' };
      }
      if (!isVerifiedAtomicReceipt(result, inventory)) {
        return { httpSucceeded: false, recoveryRequired: true, remoteWriteAttempted: true, detail: 'Atomic Odoo response did not prove the approved action and postcondition' };
      }
      return { httpSucceeded: true, remoteWriteAttempted: !result.replayed, detail: result.replayed ? 'Odoo replayed a durable inventory receipt' : 'Odoo atomically applied and verified inventory' };
    }
    const current = await this.readQuant(inventory.quantId);
    const stale = this.preconditionFailure(inventory, current);
    if (stale) {
      return { httpSucceeded: false, stale: true, remoteWriteAttempted: false, detail: stale };
    }

    await this.transport(ODOO_JSON2_MODEL, ODOO_JSON2_METHODS.write, {
      ids: [inventory.quantId],
      vals: { inventory_quantity: inventory.targetQuantity },
      context: { ...INVENTORY_MODE_CONTEXT }
    });

    const applied = await this.transport(ODOO_JSON2_MODEL, ODOO_JSON2_METHODS.applyInventory, {
      ids: [inventory.quantId],
      context: { ...INVENTORY_MODE_CONTEXT }
    });

    if (this.isConflictWizard(applied)) {
      return {
        httpSucceeded: false,
        recoveryRequired: true,
        remoteWriteAttempted: true,
        detail: 'Odoo returned an inventory conflict wizard after write; remote state is uncertain'
      };
    }

    return { httpSucceeded: true, remoteWriteAttempted: true, detail: 'Odoo inventory adjustment RPC returned success' };
  }

  async verify(action: ConstrainedAction): Promise<{ pass: boolean; detail: string }> {
    const validated = validateInventoryAdjustmentAction(action);
    if (!validated.ok) {
      return { pass: false, detail: validated.reason };
    }
    const inventory = validated.action;
    const quant = await this.readQuant(inventory.quantId);
    if (quant.productId !== inventory.productId) {
      return { pass: false, detail: 'product mismatch after mutation' };
    }
    if (quant.locationId !== inventory.locationId) {
      return { pass: false, detail: 'location mismatch after mutation' };
    }
    if (!companiesMatch(quant.companyId, inventory.companyId)) {
      return { pass: false, detail: 'company mismatch after mutation' };
    }
    if (!quantitiesEqual(quant.quantity, inventory.targetQuantity)) {
      return {
        pass: false,
        detail: `quantity ${quant.quantity} does not equal approved target ${inventory.targetQuantity}`
      };
    }
    return { pass: true, detail: `quantity verified at ${inventory.targetQuantity}` };
  }

  async classifyRecovery(action: ConstrainedAction): Promise<StaleReservationClassification> {
    const validated = validateInventoryAdjustmentAction(action);
    if (!validated.ok) {
      return 'ambiguous';
    }
    const inventory = validated.action;
    if (this.executionMode === 'atomic-addon') {
      if (!(await this.validate(action)).ok) return 'ambiguous';
      const result = await this.transport(ODOO_JSON2_MODEL, ODOO_ATOMIC_METHODS.status, { request: atomicRequest(inventory) });
      if (isVerifiedAtomicReceipt(result, inventory)) return 'applied';
      if (isBoundAtomicResponse(result, inventory) && result.status === 'not_applied') return 'not_applied';
      return 'ambiguous';
    }
    const quant = await this.readQuant(inventory.quantId);
    const identityMatches =
      quant.productId === inventory.productId &&
      quant.locationId === inventory.locationId &&
      companiesMatch(quant.companyId, inventory.companyId);
    if (identityMatches && quantitiesEqual(quant.quantity, inventory.targetQuantity)) {
      return 'applied';
    }
    if (
      identityMatches &&
      quantitiesEqual(quant.quantity, inventory.expectedQuantity) &&
      quant.writeDate === inventory.expectedWriteDate
    ) {
      return 'not_applied';
    }
    return 'ambiguous';
  }

  private preconditionFailure(action: OdooInventoryAdjustmentAction, quant: OdooQuantSnapshot): string | null {
    if (quant.productId !== action.productId) {
      return 'product changed after approval';
    }
    if (quant.locationId !== action.locationId) {
      return 'location changed after approval';
    }
    if (!companiesMatch(quant.companyId, action.companyId)) {
      return 'company changed after approval';
    }
    if (!quantitiesEqual(quant.quantity, action.expectedQuantity)) {
      return 'on-hand quantity changed after approval';
    }
    if (quant.writeDate !== action.expectedWriteDate) {
      return 'write_date changed after approval';
    }
    return null;
  }

  private isConflictWizard(result: unknown): boolean {
    return Boolean(
      result &&
        typeof result === 'object' &&
        'res_model' in result &&
        (result as { res_model?: unknown }).res_model === 'stock.inventory.conflict'
    );
  }
}

/** Package-internal test helper. Not exported from `@ledgerguard/odoo`. */
export function adapterFromTransport(transport: OdooJson2Transport, systemId = 'odoo-19', options: Omit<OdooAdapterOptions, 'systemId'> = {}): OdooInventoryAdapter {
  const adapter = new OdooInventoryAdapter({ baseUrl: 'http://127.0.0.1', apiKey: 'test' }, { ...options, systemId });
  (adapter as unknown as { transport: OdooJson2Transport }).transport = guardedTransport(transport, options.executionMode);
  return adapter;
}

export function inventoryAdjustmentAction(input: {
  quantId: number;
  productId: number;
  locationId: number;
  companyId: number | null;
  expectedQuantity: number;
  targetQuantity: number;
  expectedWriteDate: string;
}): OdooInventoryAdjustmentAction {
  return {
    type: 'ODOO_INVENTORY_ADJUSTMENT',
    target: {
      systemType: 'odoo',
      resourceType: 'stock.quant',
      resourceId: String(input.quantId)
    },
    quantId: input.quantId,
    productId: input.productId,
    locationId: input.locationId,
    companyId: input.companyId,
    expectedQuantity: input.expectedQuantity,
    targetQuantity: input.targetQuantity,
    expectedWriteDate: input.expectedWriteDate
  };
}
