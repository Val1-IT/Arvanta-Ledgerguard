import { afterEach, describe, expect, it, vi } from 'vitest';
import * as core from '@ledgerguard/core';
import * as policy from '@ledgerguard/policy';
import {
  MemoryInvoiceAdapter,
  detectDuplicateInvoiceLine,
  runCustomActionDemo,
  scenario
} from '../../examples/custom-action/src/demo';

afterEach(() => vi.restoreAllMocks());

describe('custom-action example (duplicate invoice line)', () => {
  it('verifies the repair, protects the original line, and rejects replay on every run', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    for (let run = 0; run < 2; run++) {
      const result = await runCustomActionDemo();
      expect(result.executed.outcome).toBe('VERIFIED');
      expect(result.executed.verified).toBe(true);
      expect(result.ledger.invoices[0]).toMatchObject({ total: '500000.00' });
      expect(result.ledger.lines.find((row) => row.id === 'LINE-001')?.reversedAt).toBeNull();
      expect(result.ledger.lines.find((row) => row.id === 'LINE-002')?.reversedAt).toBeInstanceOf(Date);
      expect(result.replay.outcome).toBe('STALE');
      expect(result.alreadyExecuted.outcome).toBe('STALE');
      expect(result.completedKeyPolicy.outcome).toBe('DENY');
      expect(result.completedKeyPolicy.reasons.some((reason) => reason.code === 'DUPLICATE_EXECUTION')).toBe(true);
    }
  });

  it('does not flag a single legitimate line', () => {
    const ledger = scenario();
    ledger.lines = ledger.lines.filter((row) => row.id === 'LINE-001');
    ledger.invoices[0]!.total = '500000.00';
    expect(detectDuplicateInvoiceLine(ledger)).toBeNull();
  });

  it('stops before execution if policy denies the simulated approved plan', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const evaluate = policy.evaluateExecutionPolicy;
    vi.spyOn(policy, 'evaluateExecutionPolicy').mockImplementation((ctx) => {
      const decision = evaluate(ctx);
      return ctx.plan.state === 'APPROVED' ? { ...decision, outcome: 'DENY' } : decision;
    });
    const execute = vi.spyOn(core, 'executeConstrainedAction');
    await expect(runCustomActionDemo()).rejects.toThrow(/approved custom plan/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails instead of reporting success when execution does not verify', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(core, 'executeConstrainedAction').mockResolvedValue({
      outcome: 'VERIFICATION_FAILED',
      httpSucceeded: true,
      verified: false,
      fingerprintBefore: '0'.repeat(64),
      fingerprintAfter: '1'.repeat(64),
      detail: 'Injected verification failure',
      mutated: true,
      remoteWriteAttempted: true
    });
    await expect(runCustomActionDemo()).rejects.toThrow(/custom repair must verify/);
  });

  it('rejects unsupported actions without mutating the ledger', async () => {
    const ledger = scenario();
    const adapter = new MemoryInvoiceAdapter(structuredClone(ledger));
    const result = await core.executeConstrainedAction(adapter, {
      type: 'UNKNOWN_ACTION',
      target: { systemType: 'memory', resourceType: 'invoice_lines', resourceId: 'LINE-002' }
    });
    expect(result.outcome).toBe('REJECTED');
    expect(adapter.ledger).toEqual(ledger);
  });
});
