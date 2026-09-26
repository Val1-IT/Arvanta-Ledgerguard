import {
  DEFAULT_ADAPTER_CAPABILITIES,
  type ConstrainedAction,
  type ConstrainedActionAdapter,
  type StaleReservationClassification
} from '@ledgerguard/core';
import { INVENTORY_MODE_CONTEXT, ODOO_JSON2_METHODS, ODOO_JSON2_MODEL, QUANT_READ_FIELDS } from './allowlist';
import { odooQuantFingerprint, parseQuantRecord, quantitiesEqual } from './fingerprint';
import { createJson2Transport, guardedTransport } from './json2-client';
import type {
  OdooConnectionConfig,
  OdooInventoryAdjustmentAction,
  OdooJson2Transport,
  OdooQuantSnapshot
} from './types';

export const ODOO_ADAPTER_VERSION = '0.3.0';

const ODOO_CAPABILITIES = {
  ...DEFAULT_ADAPTER_CAPABILITIES,
  supportsStateVersioning: true
} as const;

function asInventoryAction(action: ConstrainedAction): OdooInventoryAdjustmentAction {
  if (action.type !== 'ODOO_INVENTORY_ADJUSTMENT') {
    throw new Error(`Odoo adapter rejected action type ${action.type}`);
  }
  return action as OdooInventoryAdjustmentAction;
}

export class OdooInventoryAdapter implements ConstrainedActionAdapter {
  readonly meta: {
    systemId: string;
    systemType: 'odoo';
    adapterVersion: string;
    capabilities: typeof ODOO_CAPABILITIES;
  };
  private readonly transport: OdooJson2Transport;

  constructor(options: { config?: OdooConnectionConfig; transport?: OdooJson2Transport; systemId?: string }) {
    if (!options.transport && !options.config) {
      throw new Error('OdooInventoryAdapter requires config or transport');
    }
    this.transport = guardedTransport(
      options.transport ?? createJson2Transport(options.config as OdooConnectionConfig)
    );
    this.meta = {
      systemId: options.systemId ?? 'odoo-19',
      systemType: 'odoo',
      adapterVersion: ODOO_ADAPTER_VERSION,
      capabilities: ODOO_CAPABILITIES
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
    const inventory = asInventoryAction(action);
    const quant = await this.readQuant(inventory.quantId);
    return odooQuantFingerprint(quant);
  }

  async validate(action: ConstrainedAction): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (action.type !== 'ODOO_INVENTORY_ADJUSTMENT') {
      return { ok: false, reason: `unsupported action ${action.type}` };
    }
    const inventory = asInventoryAction(action);
    if (inventory.target.systemType !== 'odoo' || inventory.target.resourceType !== 'stock.quant') {
      return { ok: false, reason: 'action target is not odoo stock.quant' };
    }
    if (inventory.target.resourceId !== String(inventory.quantId)) {
      return { ok: false, reason: 'action target resourceId does not match quantId' };
    }
    if (!Number.isInteger(inventory.quantId) || inventory.quantId <= 0) {
      return { ok: false, reason: 'quantId must be a positive integer' };
    }
    return { ok: true };
  }

  async execute(action: ConstrainedAction): Promise<{ httpSucceeded: boolean; stale?: boolean; detail: string }> {
    const inventory = asInventoryAction(action);
    const current = await this.readQuant(inventory.quantId);
    const stale = this.preconditionFailure(inventory, current);
    if (stale) {
      return { httpSucceeded: false, stale: true, detail: stale };
    }

    await this.transport(ODOO_JSON2_MODEL, ODOO_JSON2_METHODS.write, {
      ids: [inventory.quantId],
      vals: { inventory_quantity: inventory.targetQuantity },
      context: INVENTORY_MODE_CONTEXT
    });

    const applied = await this.transport(ODOO_JSON2_MODEL, ODOO_JSON2_METHODS.applyInventory, {
      ids: [inventory.quantId],
      context: INVENTORY_MODE_CONTEXT
    });

    if (this.isConflictWizard(applied)) {
      return { httpSucceeded: false, stale: true, detail: 'Odoo returned an inventory conflict wizard; treating as stale' };
    }

    return { httpSucceeded: true, detail: 'Odoo inventory adjustment RPC returned success' };
  }

  async verify(action: ConstrainedAction): Promise<{ pass: boolean; detail: string }> {
    const inventory = asInventoryAction(action);
    const quant = await this.readQuant(inventory.quantId);
    if (quant.productId !== inventory.productId) {
      return { pass: false, detail: 'product mismatch after mutation' };
    }
    if (quant.locationId !== inventory.locationId) {
      return { pass: false, detail: 'location mismatch after mutation' };
    }
    if (inventory.companyId !== null && quant.companyId !== inventory.companyId) {
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
    const inventory = asInventoryAction(action);
    const quant = await this.readQuant(inventory.quantId);
    if (
      quant.productId === inventory.productId &&
      quant.locationId === inventory.locationId &&
      quantitiesEqual(quant.quantity, inventory.targetQuantity)
    ) {
      return 'applied';
    }
    if (
      quant.productId === inventory.productId &&
      quant.locationId === inventory.locationId &&
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
    if (action.companyId !== null && quant.companyId !== action.companyId) {
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

export function inventoryAdjustmentAction(input: {
  quantId: number;
  productId: number;
  locationId: number;
  companyId?: number | null;
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
    companyId: input.companyId ?? null,
    expectedQuantity: input.expectedQuantity,
    targetQuantity: input.targetQuantity,
    expectedWriteDate: input.expectedWriteDate
  };
}
