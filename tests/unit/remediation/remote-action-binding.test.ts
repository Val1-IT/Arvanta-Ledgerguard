import { describe, expect, it } from 'vitest';
import { adapterFromTransport } from '../../../packages/odoo/src/adapter';
import { DEMO_QUANT, FakeOdoo } from '../../../packages/odoo/test/fake-odoo';
import { inventoryAdjustmentAction, odooQuantFingerprint } from '@ledgerguard/odoo';
import { prepareRemoteActionBinding } from '../../../src/remediation/remote-action-binding';

describe('prepareRemoteActionBinding', () => {
  it('captures the entire validated action and source fingerprint for approval', async () => {
    const odoo = new FakeOdoo(DEMO_QUANT);
    const action = inventoryAdjustmentAction({ quantId: 42, productId: 7, locationId: 8, companyId: 1,
      expectedQuantity: 20, targetQuantity: 10, expectedWriteDate: DEMO_QUANT.writeDate });
    const result = await prepareRemoteActionBinding(adapterFromTransport(odoo.transport, 'sandbox'), action);
    expect(JSON.parse(result.actionJson)).toEqual(action);
    expect(result.expectedFingerprint).toBe(odooQuantFingerprint(DEMO_QUANT));
    expect(result.systemId).toBe('sandbox');
    expect(odoo.calls.every((call) => call.method === 'search_read')).toBe(true);
  });
  it('rejects invalid actions without contacting the remote system', async () => {
    const odoo = new FakeOdoo(DEMO_QUANT);
    await expect(prepareRemoteActionBinding(adapterFromTransport(odoo.transport), {
      type: 'ARBITRARY_RPC', target: { systemType: 'odoo', resourceType: 'users', resourceId: '1' }
    })).rejects.toThrow();
    expect(odoo.calls).toHaveLength(0);
  });
});
