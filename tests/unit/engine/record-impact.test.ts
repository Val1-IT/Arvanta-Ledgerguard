import { describe, expect, it } from 'vitest';
import { buildRecordImpact } from '../../../src/engine/record-impact';
import type { ProposedCorrection } from '../../../src/engine/types';

// ---------------------------------------------------------------------------
// FASE 4.1 requirement 2 — evidence records (proof, never mutated) must never
// be conflated with correction targets (records that WILL be mutated), and
// the deduplicated unique count must not double-count a record that could in
// principle appear in more than one bucket.
// ---------------------------------------------------------------------------

function correction(overrides: Partial<ProposedCorrection>): ProposedCorrection {
  return {
    sequence: 1,
    action: 'REGENERATE_INVENTORY_VALUATION',
    table: 'inventory_valuation',
    recordId: 'val-cement-40',
    field: 'inventory_value',
    beforeValue: '0.00',
    afterValue: '0.00',
    financialDelta: null,
    rollbackAssumption: 'test',
    ...overrides
  };
}

describe('buildRecordImpact — evidence records never become correction targets', () => {
  it('keeps evidenceRecords and correctionTargets disjoint even when both reference the same table family', () => {
    const impact = buildRecordImpact({
      affectedMovementIds: ['mov-1', 'mov-2'],
      affectedJournalEntryIds: ['je-1'],
      proposedCorrections: [
        correction({ action: 'RESTORE_CONVERSION_FACTOR', table: 'product_units', recordId: 'pu-carton' }),
        correction({ table: 'inventory_valuation', recordId: 'val-cement-40' }),
        correction({
          action: 'RECONCILE_JOURNAL_ENTRIES',
          table: 'journal_entries',
          recordId: '2026-01',
          rollbackAssumption: 'journal entries are not modified by this step'
        })
      ]
    });

    const evidenceKeys = new Set(impact.evidenceRecords.map((r) => `${r.table}:${r.recordId}`));
    const targetKeys = new Set(impact.correctionTargets.map((r) => `${r.table}:${r.recordId}`));
    for (const key of targetKeys) {
      expect(evidenceKeys.has(key)).toBe(false);
    }

    // RECONCILE_JOURNAL_ENTRIES is documented (via its own rollbackAssumption
    // convention) as non-mutating — it must not become a correction target,
    // and journal_entries only appear via the evidence list.
    expect(impact.correctionTargets.some((r) => r.table === 'journal_entries')).toBe(false);
    expect(impact.correctionTargetCount).toBe(2); // product_units + inventory_valuation only
    expect(impact.evidenceRecordCount).toBe(3); // 2 movements + 1 journal entry
  });
});

describe('buildRecordImpact — unique record count does not double count', () => {
  it('deduplicates a record referenced by multiple proposedCorrections rows into one correctionTarget', () => {
    const impact = buildRecordImpact({
      affectedMovementIds: Array.from({ length: 24 }, (_, i) => `mov-${i}`),
      affectedJournalEntryIds: Array.from({ length: 36 }, (_, i) => `je-${i}`),
      proposedCorrections: [
        correction({ action: 'RESTORE_CONVERSION_FACTOR', table: 'product_units', recordId: 'pu-carton' }),
        // Three separate field-level corrections on the SAME inventory_valuation record.
        correction({ table: 'inventory_valuation', recordId: 'val-cement-40', field: 'quantity_on_hand' }),
        correction({ table: 'inventory_valuation', recordId: 'val-cement-40', field: 'average_cost' }),
        correction({ table: 'inventory_valuation', recordId: 'val-cement-40', field: 'inventory_value' }),
        correction({
          action: 'RECONCILE_JOURNAL_ENTRIES',
          table: 'journal_entries',
          recordId: '2026-01',
          rollbackAssumption: 'journal entries are not modified by this step'
        }),
        correction({ action: 'REGENERATE_GROSS_MARGIN_REPORT', table: 'gross_margin_report', recordId: 'gmr-2026-01', field: 'cost_of_goods_sold' }),
        correction({ action: 'REGENERATE_GROSS_MARGIN_REPORT', table: 'gross_margin_report', recordId: 'gmr-2026-01', field: 'gross_profit' }),
        correction({ action: 'REGENERATE_GROSS_MARGIN_REPORT', table: 'gross_margin_report', recordId: 'gmr-2026-01', field: 'gross_margin_percentage' })
      ]
    });

    // Cross-validated against the real seed scenario's own hinted numbers.
    expect(impact.evidenceRecordCount).toBe(60); // 24 movements + 36 journal entries
    expect(impact.correctionTargetCount).toBe(3); // product_units, inventory_valuation, gross_margin_report — deduped
    expect(impact.downstreamAffectedRecordCount).toBe(0);
    expect(impact.uniqueRecordCount).toBe(63); // 60 + 3 + 0, matches blastRadius.affectedRecordCount for this scenario
  });
});
