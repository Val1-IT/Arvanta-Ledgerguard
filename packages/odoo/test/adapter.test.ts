import { describe, expect, it } from 'vitest';
import { executeConstrainedAction } from '@ledgerguard/core';
import {
  guardedTransport,
  inventoryAdjustmentAction,
  OdooInventoryAdapter,
  odooQuantFingerprint
} from '@ledgerguard/odoo';
import { DEMO_QUANT, FakeOdoo } from './fake-odoo';

function approvedAction() {
  return inventoryAdjustmentAction({
    quantId: DEMO_QUANT.id,
    productId: DEMO_QUANT.productId,
    locationId: DEMO_QUANT.locationId,
    companyId: DEMO_QUANT.companyId,
    expectedQuantity: 20,
    targetQuantity: 10,
    expectedWriteDate: DEMO_QUANT.writeDate
  });
}

describe('OdooInventoryAdapter', () => {
  it('reads the approved quant and hashes a deterministic fingerprint', async () => {
    const odoo = new FakeOdoo(DEMO_QUANT);
    const adapter = new OdooInventoryAdapter({ transport: odoo.transport });
    const action = approvedAction();
    const first = await adapter.fingerprint(action);
    const second = await adapter.fingerprint(action);
    expect(first).toBe(second);
    expect(first).toBe(odooQuantFingerprint(DEMO_QUANT));
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects another model, method, or action type before calling Odoo', async () => {
    const odoo = new FakeOdoo(DEMO_QUANT);
    const adapter = new OdooInventoryAdapter({ transport: odoo.transport });
    await expect(
      adapter.validate({
        type: 'ODOO_UNLINK_PARTNER',
        target: { systemType: 'odoo', resourceType: 'res.partner', resourceId: '1' }
      })
    ).resolves.toEqual({ ok: false, reason: 'unsupported action ODOO_UNLINK_PARTNER' });

    const transport = guardedTransport(odoo.transport);
    await expect(transport('res.partner', 'unlink', { ids: [1] })).rejects.toThrow('rejected model');
    await expect(transport('stock.quant', 'unlink', { ids: [42] })).rejects.toThrow('rejected method');
    expect(odoo.calls).toHaveLength(0);
  });

  it('does not mutate when write_date or quantity changed after approval', async () => {
    const odoo = new FakeOdoo({ ...DEMO_QUANT, writeDate: '2026-09-26 11:00:00' });
    const adapter = new OdooInventoryAdapter({ transport: odoo.transport });
    const result = await executeConstrainedAction(adapter, approvedAction(), odooQuantFingerprint(DEMO_QUANT));
    expect(result.outcome).toBe('STALE');
    expect(result.mutated).toBe(false);
    expect(odoo.calls.some((call) => call.method === 'write')).toBe(false);
  });

  it('treats execute-time write_date drift as a failed RPC, not verified success', async () => {
    const odoo = new FakeOdoo({ ...DEMO_QUANT, quantity: 21 });
    const adapter = new OdooInventoryAdapter({ transport: odoo.transport });
    const result = await executeConstrainedAction(adapter, approvedAction());
    expect(result.outcome).toBe('STALE');
    expect(result.httpSucceeded).toBe(false);
    expect(odoo.calls.some((call) => call.method === 'write')).toBe(false);
  });

  it('verifies independently after Odoo RPC success', async () => {
    const odoo = new FakeOdoo(DEMO_QUANT);
    const adapter = new OdooInventoryAdapter({ transport: odoo.transport });
    const result = await executeConstrainedAction(adapter, approvedAction());
    expect(result.outcome).toBe('VERIFIED');
    expect(result.verified).toBe(true);
    expect(odoo.quant.quantity).toBe(10);
    expect(odoo.calls.filter((call) => call.method === 'write')).toHaveLength(1);
    expect(odoo.calls.filter((call) => call.method === 'action_apply_inventory')).toHaveLength(1);
  });

  it('does not treat HTTP success as verified if quantity is still wrong', async () => {
    const odoo = new FakeOdoo(DEMO_QUANT);
    odoo.lieOnApply = true;
    const adapter = new OdooInventoryAdapter({ transport: odoo.transport });
    const result = await executeConstrainedAction(adapter, approvedAction());
    expect(result.httpSucceeded).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.outcome).toBe('VERIFICATION_FAILED');
    expect(odoo.quant.quantity).toBe(20);
  });

  it('classifies applied, not_applied, and ambiguous recovery without a second adjustment', async () => {
    const applied = new FakeOdoo({ ...DEMO_QUANT, quantity: 10, writeDate: '2026-09-26 12:00:00' });
    const notApplied = new FakeOdoo(DEMO_QUANT);
    const ambiguous = new FakeOdoo({ ...DEMO_QUANT, quantity: 15, writeDate: '2026-09-26 11:30:00' });
    const action = approvedAction();

    expect(await new OdooInventoryAdapter({ transport: applied.transport }).classifyRecovery(action)).toBe('applied');
    expect(await new OdooInventoryAdapter({ transport: notApplied.transport }).classifyRecovery(action)).toBe(
      'not_applied'
    );
    expect(await new OdooInventoryAdapter({ transport: ambiguous.transport }).classifyRecovery(action)).toBe(
      'ambiguous'
    );
    expect(applied.calls.some((call) => call.method === 'write')).toBe(false);
    expect(notApplied.calls.some((call) => call.method === 'write')).toBe(false);
  });

  it('does not apply a second adjustment when recovery already proves the postcondition', async () => {
    const odoo = new FakeOdoo({ ...DEMO_QUANT, quantity: 10, writeDate: '2026-09-26 12:00:00' });
    const adapter = new OdooInventoryAdapter({ transport: odoo.transport });
    expect(await adapter.classifyRecovery(approvedAction())).toBe('applied');
    expect(odoo.calls.filter((call) => call.method === 'action_apply_inventory')).toHaveLength(0);
  });

  it('declares non-transactional Odoo capabilities', () => {
    const adapter = new OdooInventoryAdapter({ transport: new FakeOdoo(DEMO_QUANT).transport });
    expect(adapter.meta.capabilities).toEqual({
      nativeTransactions: false,
      idempotencyInNativeTransaction: false,
      supportsStateVersioning: true,
      supportsSimulation: false,
      supportsCompensation: false
    });
  });
});
