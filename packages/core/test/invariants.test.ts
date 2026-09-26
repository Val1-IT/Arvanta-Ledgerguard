import { describe, expect, it } from 'vitest';
import { ALL_QUALITY_CHECKS, DETERMINISTIC_INVARIANTS, FinanceInvariants, InventoryInvariants } from '@ledgerguard/core';

describe('deterministic invariant primitives', () => {
  it('exposes the same evaluators used by verify-before-commit', () => {
    expect(DETERMINISTIC_INVARIANTS).toEqual(ALL_QUALITY_CHECKS);
    expect(new InventoryInvariants.valuationConsistency().checkId).toBe('INVENTORY_VALUATION_CONSISTENCY');
    expect(new FinanceInvariants.journalBalance().checkId).toBe('JOURNAL_BALANCE');
  });
});
