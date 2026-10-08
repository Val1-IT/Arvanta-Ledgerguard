import type { AdapterCapabilities, ConstrainedAction } from '@ledgerguard/core';

export interface OdooConnectionConfig {
  baseUrl: string;
  database?: string;
  apiKey: string;
}

export interface OdooInventoryAdjustmentAction extends ConstrainedAction {
  type: 'ODOO_INVENTORY_ADJUSTMENT';
  target: {
    systemType: 'odoo';
    resourceType: 'stock.quant';
    resourceId: string;
  };
  productId: number;
  quantId: number;
  locationId: number;
  companyId: number | null;
  expectedQuantity: number;
  targetQuantity: number;
  expectedWriteDate: string;
}

export interface OdooQuantSnapshot {
  id: number;
  productId: number;
  locationId: number;
  companyId: number | null;
  quantity: number;
  writeDate: string;
}

export type OdooJson2Transport = (
  model: string,
  method: string,
  body: Record<string, unknown>
) => Promise<unknown>;

/** Atomic mode requires the separately installed ledgerguard_inventory Odoo 19 addon. */
export type OdooExecutionMode = 'experimental-json2' | 'atomic-addon';
export interface OdooAdapterOptions {
  systemId?: string;
  executionMode?: OdooExecutionMode;
}
export interface OdooAdapterCapabilities extends AdapterCapabilities {
  /** Only the inventory operation is atomic inside Odoo, not the control-plane transaction. */
  atomicInventoryAction: boolean;
  /** Identical normalized approved actions are deduplicated per authenticated Odoo user. */
  durableActionReceipts: boolean;
}
