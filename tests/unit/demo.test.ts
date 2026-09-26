import { afterEach, describe, expect, it, vi } from 'vitest';
import * as core from '@ledgerguard/core';
import * as policy from '@ledgerguard/policy';
import { MemoryAdapter, runInventoryDemo } from '../../examples/inventory-ledger/src/demo';

afterEach(() => vi.restoreAllMocks());

describe('early-tester inventory demo', () => {
  it('verifies the repair, protects the original movement, and rejects replay on every run', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    for (let run = 0; run < 2; run++) {
      const result = await runInventoryDemo();
      expect(result.executed.committed).toBe(true);
      expect(result.executed.verification?.overallStatus).toBe('PASS');
      expect(result.snapshot.valuations[0]).toMatchObject({ quantityOnHand: '10.000', inventoryValue: '850000.00' });
      expect(result.snapshot.movements.find(row => row.id === 'MOV-001')?.reversedAt).toBeNull();
      expect(result.snapshot.movements.find(row => row.id === 'MOV-002')?.reversedAt).toBeInstanceOf(Date);
      expect(result.replay.failureReason).toBe('DRIFT_DETECTED');
      expect(result.completedKeyPolicy.outcome).toBe('DENY');
    }
  });

  it('stops before execution if policy denies the simulated approved plan', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const evaluate = policy.evaluateExecutionPolicy;
    vi.spyOn(policy, 'evaluateExecutionPolicy').mockImplementation(ctx => {
      const decision = evaluate(ctx);
      return ctx.plan.state === 'APPROVED' ? { ...decision, outcome: 'DENY' } : decision;
    });
    const execute = vi.spyOn(core, 'executeConstrainedRemediation');
    await expect(runInventoryDemo()).rejects.toThrow(/approved demo plan/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails instead of reporting success when execution does not commit', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(core, 'executeConstrainedRemediation').mockResolvedValue({
      committed: false, steps: [], verification: null,
      failureReason: 'VERIFICATION_FAILED', failureDetail: 'Injected verification failure'
    });
    await expect(runInventoryDemo()).rejects.toThrow(/repair must commit/);
  });

  it.each<Partial<core.ProposedCorrection>>([
    { action: 'RESTORE_CONVERSION_FACTOR' },
    { table: 'unknown_table' },
    { field: 'unknown_field' },
    { recordId: 'missing-valuation' },
    { action: 'REVERSE_INVENTORY_MOVEMENT', table: 'inventory_movements', field: 'reversed_at', recordId: 'missing-movement' },
    { action: 'REVERSE_INVENTORY_MOVEMENT', table: 'inventory_movements', field: 'quantity', recordId: 'MOV-001' }
  ])('rejects unsupported corrections and rolls back earlier writes: %j', async invalid => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { snapshot } = await runInventoryDemo();
    const adapter = new MemoryAdapter(structuredClone(snapshot));
    const correction: core.ProposedCorrection = {
      sequence: 1, action: 'REGENERATE_INVENTORY_VALUATION', table: 'inventory_valuation',
      field: 'quantity_on_hand', recordId: 'val-item-001', beforeValue: '10.000', afterValue: '9.000',
      financialDelta: null, rollbackAssumption: 'In-memory transaction rollback'
    };
    await expect(adapter.runInTransaction(async session => {
      await session.applyCorrection(correction, new Date());
      await session.applyCorrection({ ...correction, ...invalid }, new Date());
    })).rejects.toThrow(/Unsupported|not found/);
    expect(adapter.snapshot).toEqual(snapshot);
  });
});
