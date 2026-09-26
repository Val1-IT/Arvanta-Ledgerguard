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
