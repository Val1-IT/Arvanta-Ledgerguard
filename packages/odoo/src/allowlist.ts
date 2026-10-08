import type { OdooExecutionMode } from './types';

export const ODOO_JSON2_MODEL = 'stock.quant' as const;

export const ODOO_JSON2_METHODS = {
  searchRead: 'search_read',
  write: 'write',
  applyInventory: 'action_apply_inventory'
} as const;

export const ODOO_ATOMIC_METHODS = {
  apply: 'ledgerguard_apply_inventory',
  status: 'ledgerguard_inventory_status'
} as const;
const ATOMIC_METHODS = new Set<string>([ODOO_JSON2_METHODS.searchRead, ...Object.values(ODOO_ATOMIC_METHODS)]);

const ALLOWED_METHODS = new Set<string>(Object.values(ODOO_JSON2_METHODS));

export function assertAllowlistedCall(model: string, method: string, mode: OdooExecutionMode = 'experimental-json2'): void {
  if (model !== ODOO_JSON2_MODEL) {
    throw new Error(`Odoo adapter rejected model ${model}`);
  }
  if (!(mode === 'atomic-addon' ? ATOMIC_METHODS : ALLOWED_METHODS).has(method)) {
    throw new Error(`Odoo adapter rejected method ${model}.${method}`);
  }
}

export const INVENTORY_MODE_CONTEXT = { inventory_mode: true } as const;

export const QUANT_READ_FIELDS = [
  'id',
  'product_id',
  'location_id',
  'company_id',
  'quantity',
  'write_date'
] as const;
