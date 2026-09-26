import { describe, expect, it } from 'vitest';
import * as odoo from '@ledgerguard/odoo';

describe('@ledgerguard/odoo public API', () => {
  it('does not export raw JSON-2 transport or generic execute helpers', () => {
    expect(Object.keys(odoo).sort()).toEqual(
      [
        'ODOO_ADAPTER_VERSION',
        'OdooInventoryAdapter',
        'inventoryAdjustmentAction',
        'odooQuantFingerprint'
      ].sort()
    );
    expect(odoo).not.toHaveProperty('createJson2Transport');
    expect(odoo).not.toHaveProperty('guardedTransport');
    expect(odoo).not.toHaveProperty('assertAllowlistedCall');
    expect(odoo).not.toHaveProperty('adapterFromTransport');
    expect(odoo).not.toHaveProperty('execute');
    expect(odoo).not.toHaveProperty('executeKw');
    expect(typeof odoo.OdooInventoryAdapter.prototype.execute).toBe('function');
  });
});
