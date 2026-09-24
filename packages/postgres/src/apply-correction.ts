import {
  CONVERSION_MISMATCH_EXAMPLE,
  formatMoney,
  summarizeJournalCogs,
  type CorrectionStepResult,
  type ProposedCorrection
} from '@ledgerguard/core';
import { isWritableColumn, TOUCH_TIMESTAMP_COLUMN } from './allowlist';
import type { Queryable } from './queryable';
import { fetchJournalEntries } from './repositories/journals';

export class UnallowlistedMutationError extends Error {
  constructor(table: string, field: string, action: string) {
    super(`no writable column mapping for ${table}.${field} (action ${action})`);
    this.name = 'UnallowlistedMutationError';
  }
}

export async function applyAllowlistedCorrection(
  client: Queryable,
  correction: ProposedCorrection,
  now: Date,
  options: { cogsAccountCode?: string } = {}
): Promise<CorrectionStepResult> {
  const base = {
    sequence: correction.sequence,
    action: correction.action,
    table: correction.table,
    recordId: correction.recordId
  };

  if (correction.action === 'RECONCILE_JOURNAL_ENTRIES') {
    const entries = await fetchJournalEntries(client);
    const cogsAccountCode = options.cogsAccountCode ?? CONVERSION_MISMATCH_EXAMPLE.cogsAccountCode;
    const liveCogs = formatMoney(summarizeJournalCogs(entries, cogsAccountCode).postedCogs);
    if (liveCogs !== correction.beforeValue) {
      throw new Error(
        `journal-posted COGS changed since the plan was generated (was ${correction.beforeValue}, now ${liveCogs}) — refusing to proceed`
      );
    }
    return { ...base, status: 'APPLIED', detail: `confirmed ledger-posted COGS still matches: ${liveCogs}` };
  }

  if (!isWritableColumn(correction.table, correction.field)) {
    throw new UnallowlistedMutationError(correction.table, correction.field, correction.action);
  }

  const touchColumn = TOUCH_TIMESTAMP_COLUMN[correction.table];
  const setClauses = [`${correction.field} = $1::numeric`];
  const params: unknown[] = [correction.afterValue];
  if (touchColumn) {
    params.push(now);
    setClauses.push(`${touchColumn} = $${params.length}`);
  }
  params.push(correction.recordId);
  const idParamIndex = params.length;
  params.push(correction.beforeValue);
  const guardParamIndex = params.length;

  const { rowCount } = await client.query(
    `update ${correction.table} set ${setClauses.join(', ')}
     where id = $${idParamIndex} and ${correction.field} = $${guardParamIndex}::numeric`,
    params
  );

  if (rowCount !== 1) {
    throw new Error(
      `expected to update exactly one row in ${correction.table} (id=${correction.recordId}, ${correction.field}=${correction.beforeValue}) but affected ${rowCount} — data may have drifted since the plan was approved`
    );
  }

  return {
    ...base,
    status: 'APPLIED',
    detail: `${correction.field}: ${correction.beforeValue} -> ${correction.afterValue}`
  };
}
