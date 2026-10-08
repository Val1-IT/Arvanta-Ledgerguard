import { describe, expect, it } from 'vitest';
import { executeConstrainedAction, type ConstrainedActionAdapter } from '@ledgerguard/core';

function adapter(overrides: Partial<ConstrainedActionAdapter> = {}): ConstrainedActionAdapter {
  return {
    meta: { systemId: 'test', systemType: 'test' },
    fingerprint: async () => 'abc',
    validate: async () => ({ ok: true }),
    execute: async () => ({ httpSucceeded: true, detail: 'rpc' }),
    verify: async () => ({ pass: true, detail: 'ok' }),
    classifyRecovery: async () => 'applied',
    ...overrides
  };
}

describe('executeConstrainedAction', () => {
  it('snapshots caller-owned action before awaited validation', async () => {
    const requested = {
      type: 'TEST', target: { systemType: 'test', resourceType: 'row', resourceId: '1' },
      adjustment: { quantity: 10 }
    };
    const observed: string[] = [];
    const result = await executeConstrainedAction(adapter({
      validate: async (validated) => {
        observed.push(validated.target.resourceId);
        requested.target.resourceId = 'other-row';
        requested.adjustment.quantity = 0;
        await Promise.resolve();
        return { ok: true };
      },
      execute: async (executed) => {
        observed.push(executed.target.resourceId);
        expect(executed).toMatchObject({ adjustment: { quantity: 10 } });
        return { httpSucceeded: true, detail: 'applied' };
      },
      verify: async (verified) => {
        observed.push(verified.target.resourceId);
        return { pass: true, detail: 'verified' };
      }
    }), requested, 'abc');
    expect(result.outcome).toBe('VERIFIED');
    expect(observed).toEqual(['1', '1', '1']);
  });

  it('keeps a stale result recoverable if the adapter attempted a remote write', async () => {
    const result = await executeConstrainedAction(adapter({
      execute: async () => ({ httpSucceeded: false, stale: true, remoteWriteAttempted: true,
        detail: 'stale after sending request' })
    }), { type: 'TEST', target: { systemType: 'test', resourceType: 'row', resourceId: '1' } });
    expect(result.outcome).toBe('RECOVERY_REQUIRED');
    expect(result.remoteWriteAttempted).toBe(true);
    expect(result.verified).toBe(false);
  });

  it('allows a known no-write stale result to remain stale', async () => {
    const result = await executeConstrainedAction(adapter({
      execute: async () => ({ httpSucceeded: false, stale: true, remoteWriteAttempted: false,
        detail: 'precondition rejected before request' })
    }), { type: 'TEST', target: { systemType: 'test', resourceType: 'row', resourceId: '1' } });
    expect(result.outcome).toBe('STALE');
    expect(result.remoteWriteAttempted).toBe(false);
  });

  it('returns STALE without executing when the fingerprint moved', async () => {
    let executed = false;
    const result = await executeConstrainedAction(
      adapter({
        fingerprint: async () => 'live',
        execute: async () => {
          executed = true;
          return { httpSucceeded: true, detail: 'rpc' };
        }
      }),
      { type: 'TEST', target: { systemType: 'test', resourceType: 'row', resourceId: '1' } },
      'approved'
    );
    expect(result.outcome).toBe('STALE');
    expect(executed).toBe(false);
  });

  it('does not mark verified success when HTTP succeeds but verify fails', async () => {
    const result = await executeConstrainedAction(
      adapter({
        verify: async () => ({ pass: false, detail: 'qty still 20' })
      }),
      { type: 'TEST', target: { systemType: 'test', resourceType: 'row', resourceId: '1' } }
    );
    expect(result.outcome).toBe('VERIFICATION_FAILED');
    expect(result.httpSucceeded).toBe(true);
    expect(result.verified).toBe(false);
  });
});
