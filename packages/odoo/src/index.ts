export { OdooInventoryAdapter, ODOO_ADAPTER_VERSION, inventoryAdjustmentAction } from './adapter';
export { createJson2Transport, guardedTransport } from './json2-client';
export { odooQuantFingerprint, parseQuantRecord, quantitiesEqual } from './fingerprint';
export { assertAllowlistedCall, ODOO_JSON2_MODEL, ODOO_JSON2_METHODS, INVENTORY_MODE_CONTEXT } from './allowlist';
export type {
  OdooConnectionConfig,
  OdooInventoryAdjustmentAction,
  OdooQuantSnapshot,
  OdooJson2Transport
} from './types';
