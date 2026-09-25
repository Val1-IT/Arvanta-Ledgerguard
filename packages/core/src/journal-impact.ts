import { Decimal, formatMoney, toDecimal, ZERO } from './decimal';
import type { JournalEntryRecord } from './types';

// ---------------------------------------------------------------------------
// Journal entries are intentionally left untouched by the conversion-error
// scenario (see demo-data/scenarios/conversion-error.ts) — they remain
// individually balanced and correct. This module therefore keeps two
// concerns strictly separate:
//
//   1. Structural balance (JournalBalanceCheck territory): does debit equal
//      credit, globally and per source? This can fail on its own, entirely
//      independent of any conversion-factor incident — a pre-existing data
//      problem, not something this incident causes.
//
//   2. Incident reconciliation evidence: the journal's own COGS postings are
//      real, untouched money. Comparing that trustworthy total against the
//      (possibly corrupted) gross_margin_report.cost_of_goods_sold is what
//      surfaces the incident's financial impact — this is evidence, not a
//      correction target, because the journal entries are not what's wrong.
// ---------------------------------------------------------------------------

export interface JournalBalanceResult {
  totalDebit: Decimal;
  totalCredit: Decimal;
  difference: Decimal;
  balanced: boolean;
  unbalancedSources: Array<{ sourceType: string; sourceId: string; debit: string; credit: string; difference: string }>;
}

export function checkJournalBalance(entries: JournalEntryRecord[]): JournalBalanceResult {
  let totalDebit = ZERO;
  let totalCredit = ZERO;

  const bySource = new Map<string, { sourceType: string; sourceId: string; debit: Decimal; credit: Decimal }>();
  for (const entry of entries) {
    const debit = toDecimal(entry.debit);
    const credit = toDecimal(entry.credit);
    totalDebit = totalDebit.plus(debit);
    totalCredit = totalCredit.plus(credit);

    const key = `${entry.sourceType}:${entry.sourceId}`;
    const existing = bySource.get(key) ?? { sourceType: entry.sourceType, sourceId: entry.sourceId, debit: ZERO, credit: ZERO };
    existing.debit = existing.debit.plus(debit);
    existing.credit = existing.credit.plus(credit);
    bySource.set(key, existing);
  }

  const unbalancedSources = Array.from(bySource.values())
    .filter((s) => s.debit.minus(s.credit).abs().greaterThan('0.001'))
    .map((s) => ({
      sourceType: s.sourceType,
      sourceId: s.sourceId,
      debit: formatMoney(s.debit),
      credit: formatMoney(s.credit),
      difference: formatMoney(s.debit.minus(s.credit))
    }));

  const difference = totalDebit.minus(totalCredit);

  return {
    totalDebit,
    totalCredit,
    difference,
    balanced: difference.abs().lessThanOrEqualTo('0.001'),
    unbalancedSources
  };
}

export interface JournalCogsSummary {
  /** Net COGS as actually posted to the ledger (debit - credit on the COGS account) — real, untouched money. */
  postedCogs: Decimal;
  /** IDs of the journal entries that make up the COGS posting — reconciliation evidence, not correction targets. */
  entryIds: string[];
}

export function summarizeJournalCogs(entries: JournalEntryRecord[], cogsAccountCode: string): JournalCogsSummary {
  let postedCogs = ZERO;
  const entryIds: string[] = [];

  for (const entry of entries) {
    if (entry.accountCode !== cogsAccountCode) continue;
    postedCogs = postedCogs.plus(toDecimal(entry.debit)).minus(toDecimal(entry.credit));
    entryIds.push(entry.id);
  }

  return { postedCogs, entryIds };
}
