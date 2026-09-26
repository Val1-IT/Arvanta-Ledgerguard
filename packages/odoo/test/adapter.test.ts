import { describe, expect, it } from 'vitest';
import { executeConstrainedAction } from '@ledgerguard/core';
import { inventoryAdjustmentAction, odooQuantFingerprint } from '@ledgerguard/odoo';
import { adapterFromTransport } from '../src/adapter';
import { assertAllowlistedCall } from '../src/allowlist';
import { DEMO_QUANT, FakeOdoo } from './fake-odoo';

function approvedAction(overrides: Partial<ReturnType<typeof inventoryAdjustmentAction>> = {}) {
  return {
    ...inventoryAdjustmentAction({
      quantId: DEMO_QUANT.id,
      productId: DEMO_QUANT.productId,
      locationId: DEMO_QUANT.locationId,
      companyId: DEMO_QUANT.companyId,
      expectedQuantity: 20,
      targetQuantity: 10,
      expectedWriteDate: DEMO_QUANT.writeDate
    }),
    ...overrides
  };
}

describe('OdooInventoryAdapter', () => {
  it('reads the approved quant and hashes a deterministic fingerprint', async () => {
    const odoo = new FakeOdoo(DEMO_QUANT);
    const adapter = adapterFromTransport(odoo.transport);
    const first = await adapter.fingerprint(approvedAction());
    const second = await adapter.fingerprint(approvedAction());
    expect(first).toBe(second);
    expect(first).toBe(odooQuantFingerprint(DEMO_QUANT));
  });

  it('rejects invalid numeric and identity fields before any Odoo call', async () => {
    const odoo = new FakeOdoo(DEMO_QUANT);
    const adapter = adapterFromTransport(odoo.transport);
    await expect(adapter.validate(approvedAction({ quantId: 0 }))).resolves.toMatchObject({ ok: false });
    await expect(adapter.validate(approvedAction({ quantId: -1 }))).resolves.toMatchObject({ ok: false });
    await expect(adapter.validate(approvedAction({ productId: Number.NaN }))).resolves.toMatchObject({ ok: false });
    await expect(adapter.validate(approvedAction({ targetQuantity: Number.POSITIVE_INFINITY }))).resolves.toMatchObject({
      ok: false
    });
    await expect(adapter.validate(approvedAction({ expectedWriteDate: 'not-a-date' }))).resolves.toMatchObject({
      ok: false
    });
    await expect(
      adapter.validate(approvedAction({ target: { systemType: 'odoo', resourceType: 'stock.quant', resourceId: '99' } }))
    ).resolves.toMatchObject({ ok: false });
    await expect(adapter.validate(approvedAction({ companyId: 0 }))).resolves.toMatchObject({ ok: false });
    expect(odoo.calls).toHaveLength(0);
  });

  it('rejects another model or method internally before fetch', () => {
    expect(() => assertAllowlistedCall('res.partner', 'unlink')).toThrow('rejected model');
    expect(() => assertAllowlistedCall('stock.quant', 'unlink')).toThrow('rejected method');
  });

  it('does not mutate when write_date changed after approval', async () => {
    const odoo = new FakeOdoo({ ...DEMO_QUANT, writeDate: '2026-09-26 11:00:00' });
    const adapter = adapterFromTransport(odoo.transport);
    const result = await executeConstrainedAction(adapter, approvedAction(), odooQuantFingerprint(DEMO_QUANT));
    expect(result.outcome).toBe('STALE');
    expect(result.mutated).toBe(false);
    expect(result.remoteWriteAttempted).toBe(false);
    expect(odoo.calls.some((call) => call.method === 'write')).toBe(false);
  });

  it('treats company mismatch as stale, not a wildcard', async () => {
    const odoo = new FakeOdoo({ ...DEMO_QUANT, companyId: 9 });
    const adapter = adapterFromTransport(odoo.transport);
    const result = await executeConstrainedAction(adapter, approvedAction());
    expect(result.outcome).toBe('STALE');
    expect(odoo.calls.some((call) => call.method === 'write')).toBe(false);
  });

  it('verifies independently after Odoo RPC success', async () => {
    const odoo = new FakeOdoo(DEMO_QUANT);
    const adapter = adapterFromTransport(odoo.transport);
    const result = await executeConstrainedAction(adapter, approvedAction());
    expect(result.outcome).toBe('VERIFIED');
    expect(odoo.quant.quantity).toBe(10);
  });

  it('does not treat HTTP success as verified if quantity is still wrong', async () => {
    const odoo = new FakeOdoo(DEMO_QUANT);
    odoo.lieOnApply = true;
    const adapter = adapterFromTransport(odoo.transport);
    const result = await executeConstrainedAction(adapter, approvedAction());
    expect(result.outcome).toBe('VERIFICATION_FAILED');
    expect(result.httpSucceeded).toBe(true);
    expect(result.remoteWriteAttempted).toBe(true);
  });

  it('returns RECOVERY_REQUIRED when write happened but apply returns a conflict wizard', async () => {
    const odoo = new FakeOdoo(DEMO_QUANT);
    odoo.returnConflictWizard = true;
    const adapter = adapterFromTransport(odoo.transport);
    const result = await executeConstrainedAction(adapter, approvedAction());
    expect(result.outcome).toBe('RECOVERY_REQUIRED');
    expect(result.remoteWriteAttempted).toBe(true);
    expect(result.mutated).toBe(true);
    expect(odoo.calls.some((call) => call.method === 'write')).toBe(true);
  });

  it('classifies applied only when company and quantity match the postcondition', async () => {
    const applied = new FakeOdoo({ ...DEMO_QUANT, quantity: 10, writeDate: '2026-09-26 12:00:00' });
    const wrongCompany = new FakeOdoo({ ...DEMO_QUANT, quantity: 10, companyId: 9 });
    const action = approvedAction();
    expect(await adapterFromTransport(applied.transport).classifyRecovery(action)).toBe('applied');
    expect(await adapterFromTransport(wrongCompany.transport).classifyRecovery(action)).toBe('ambiguous');
    expect(applied.calls.some((call) => call.method === 'write')).toBe(false);
  });

  it('classifies not_applied and ambiguous without a second adjustment', async () => {
    const notApplied = new FakeOdoo(DEMO_QUANT);
    const ambiguous = new FakeOdoo({ ...DEMO_QUANT, quantity: 15 });
    const action = approvedAction();
    expect(await adapterFromTransport(notApplied.transport).classifyRecovery(action)).toBe('not_applied');
    expect(await adapterFromTransport(ambiguous.transport).classifyRecovery(action)).toBe('ambiguous');
  });
});
