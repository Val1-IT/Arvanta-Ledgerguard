import { describe, expect, it } from 'vitest';
import { checkJournalBalance, summarizeJournalCogs, type JournalEntryRecord } from '@ledgerguard/core';

let seq = 0;
function entry(sourceId: string, accountCode: string, debit: string, credit: string, sourceType = 'sale'): JournalEntryRecord {
  seq += 1;
  return { id: `je-${seq}`, sourceType, sourceId, accountCode, debit, credit, postedAt: '2026-10-01T00:00:00.000Z' };
}

describe('checkJournalBalance', () => {
  it('reports balanced entries with no unbalanced sources', () => {
    const result = checkJournalBalance([
      entry('s1', '1100', '100.00', '0'),
      entry('s1', '4000', '0', '100.00'),
      entry('s2', '5000', '40.50', '0', 'purchase'),
      entry('s2', '2000', '0', '40.50', 'purchase')
    ]);
    expect(result.balanced).toBe(true);
    expect(result.totalDebit.toFixed(2)).toBe('140.50');
    expect(result.totalCredit.toFixed(2)).toBe('140.50');
    expect(result.difference.isZero()).toBe(true);
    expect(result.unbalancedSources).toEqual([]);
  });

  it('flags both sources when they are off in opposite directions but the total balances', () => {
    const result = checkJournalBalance([
      entry('s1', '1100', '110.00', '0'),
      entry('s1', '4000', '0', '100.00'),
      entry('s2', '1100', '90.00', '0'),
      entry('s2', '4000', '0', '100.00')
    ]);
    expect(result.balanced).toBe(true);
    expect(result.difference.isZero()).toBe(true);
    expect(result.unbalancedSources).toHaveLength(2);
    expect(result.unbalancedSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: 'sale', sourceId: 's1', difference: '10.00' }),
      expect.objectContaining({ sourceType: 'sale', sourceId: 's2', difference: '-10.00' })
    ]));
  });

  it('keys sources by type and id together', () => {
    const result = checkJournalBalance([
      entry('x', '1100', '5', '0', 'sale'),
      entry('x', '4000', '0', '5', 'purchase')
    ]);
    expect(result.balanced).toBe(true);
    expect(result.unbalancedSources.map((s) => s.sourceType).sort()).toEqual(['purchase', 'sale']);
  });

  it('treats a difference of exactly 0.001 as balanced and anything above as unbalanced', () => {
    const atTolerance = checkJournalBalance([entry('s1', '1100', '100.001', '0'), entry('s1', '4000', '0', '100')]);
    expect(atTolerance.balanced).toBe(true);
    expect(atTolerance.unbalancedSources).toEqual([]);

    const above = checkJournalBalance([entry('s1', '1100', '100.0011', '0'), entry('s1', '4000', '0', '100')]);
    expect(above.balanced).toBe(false);
    expect(above.unbalancedSources).toHaveLength(1);
    expect(above.unbalancedSources[0]?.sourceId).toBe('s1');
  });

  it('handles empty input', () => {
    const result = checkJournalBalance([]);
    expect(result.balanced).toBe(true);
    expect(result.totalDebit.isZero()).toBe(true);
    expect(result.totalCredit.isZero()).toBe(true);
    expect(result.unbalancedSources).toEqual([]);
  });
});

describe('summarizeJournalCogs', () => {
  it('nets debit minus credit only for the given account code', () => {
    const entries = [
      entry('s1', '5000', '60.00', '0'),
      entry('s1', '1200', '0', '60.00'),
      entry('r1', '5000', '0', '15.25', 'return'),
      entry('s2', '5000', '20.00', '0'),
      entry('s2', '5001', '999.00', '0')
    ];
    const summary = summarizeJournalCogs(entries, '5000');
    expect(summary.postedCogs.toFixed(2)).toBe('64.75');
    expect(summary.entryIds).toEqual([entries[0]!.id, entries[2]!.id, entries[3]!.id]);
  });

  it('returns zero and no ids when nothing matches', () => {
    const summary = summarizeJournalCogs([entry('s1', '1100', '1', '0')], '5000');
    expect(summary.postedCogs.isZero()).toBe(true);
    expect(summary.entryIds).toEqual([]);
  });
});
