import type { ConstrainedAction } from '@ledgerguard/core';

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
