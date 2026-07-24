import type { Pool, PoolClient } from 'pg';
import { investigate } from '../engine/investigate';
import { verifyState } from '../engine/verify';
import { formatMoney } from '../engine/decimal';
import { summarizeJournalCogs } from '../engine/journal-impact';
import type { ProposedCorrection } from '../engine/types';
import { loadInvestigationInput } from '../db/repositories/investigation';
import { fetchJournalEntries } from '../db/repositories/journals';
import { applyRemediationPlanTransition, loadRemediationPlan } from '../db/repositories/remediation-plans';
import {
  InvalidTransitionError,
  RemediationPlanNotFoundError,
  isTransitionAllowed,
  type ExecutionFailureReason,
  type ExecutionStepResult,
  type RemediationExecutionResult,
  type RemediationPlanRecord
} from './types';

// ---------------------------------------------------------------------------
// FASE 6 — transactional remediation execution. Every write this module ever
// issues comes verbatim from a plan's `proposedCorrections` (produced once,
// at plan-generation time, by the deterministic engine's remediation preview
// — see src/remediation/generate-plan.ts). Nothing here ever composes SQL
// from an LLM output or from a hand-typed value; the only strings that reach
// a query are (a) table/column names checked against WRITABLE_COLUMNS below,
// and (b) the plan's own beforeValue/afterValue decimal strings, always bound
// as parameters.
//
// Sequencing, matching the governing FASE 6 spec:
//   restore conversion factor -> regenerate inventory valuation ->
//   conditional adjusting/reversal journal check (read-only) ->
//   regenerate gross-margin report -> re-run verification -> commit only if
//   all of the above succeeded.
// This ordering already comes for free from proposedCorrections' `sequence`
// field (see src/engine/remediation-preview.ts's sequencing rationale) — this
// module just applies them in that order, it does not re-derive the order.
//
// journal_entries is deliberately absent from WRITABLE_COLUMNS: a posted
// journal entry is never edited by this engine. The one action that concerns
// journal_entries (RECONCILE_JOURNAL_ENTRIES) only re-reads it as a
// read-only cross-check.
//
// Two kinds of Postgres work happen here, on purpose, over two different
// connections:
//   1. remediation_plans bookkeeping (APPROVED->EXECUTING, ->VERIFYING,
//      ->RESOLVED/VERIFICATION_FAILED/EXECUTION_FAILED) — each its own
//      immediately-committed statement against `pool`, via
//      applyRemediationPlanTransition. This is durable audit trail: it must
//      survive even when the ERP data transaction below is rolled back.
//   2. The actual ERP data mutation — one single transaction on a dedicated
//      client, re-checked for drift, written, verified, and only then
//      committed. A verification FAILure or a write error rolls this whole
//      transaction back, so VERIFICATION_FAILED and EXECUTION_FAILED always
//      mean "nothing was persisted to the ERP tables", never "persisted but
//      wrong".
// ---------------------------------------------------------------------------

const WRITABLE_COLUMNS: Readonly<Record<string, ReadonlySet<string>>> = {
  product_units: new Set(['conversion_factor']),
  inventory_movements: new Set(['base_quantity']),
  inventory_valuation: new Set(['quantity_on_hand', 'average_cost', 'inventory_value']),
  gross_margin_report: new Set(['cost_of_goods_sold', 'gross_profit', 'gross_margin_percentage'])
};

const TOUCH_TIMESTAMP_COLUMN: Readonly<Record<string, string>> = {
  product_units: 'updated_at',
  inventory_valuation: 'calculated_at',
  gross_margin_report: 'generated_at'
};

function correctionKey(c: ProposedCorrection): string {
  return `${c.sequence}|${c.action}|${c.table}|${c.recordId}|${c.field}|${c.beforeValue}|${c.afterValue}`;
}

// Fresh investigate() output must describe the exact same corrections the
// plan was approved with. Any difference means the underlying data changed
// (or the incident was already remediated by some other path) since
// generation/approval — abort before writing anything rather than apply a
// stale plan to live data it no longer matches.
function correctionsMatch(fresh: ProposedCorrection[], approved: ProposedCorrection[]): boolean {
  if (fresh.length !== approved.length) return false;
  const freshKeys = fresh.map(correctionKey).sort();
  const approvedKeys = approved.map(correctionKey).sort();
  return freshKeys.every((key, i) => key === approvedKeys[i]);
}

async function applyCorrectionWrite(
  client: PoolClient,
  correction: ProposedCorrection,
  now: Date
): Promise<ExecutionStepResult> {
  const base = {
    sequence: correction.sequence,
    action: correction.action,
    table: correction.table,
    recordId: correction.recordId
  };

  if (correction.action === 'RECONCILE_JOURNAL_ENTRIES') {
    // Read-only cross-check: journal_entries is never written by this
    // engine. Confirm the ledger-posted COGS the plan was built against
    // still holds; if the ledger itself moved underneath us, that is a
    // genuine abort condition, not something to paper over.
    const entries = await fetchJournalEntries(client);
    const liveCogs = formatMoney(summarizeJournalCogs(entries).postedCogs);
    if (liveCogs !== correction.beforeValue) {
      throw new Error(
        `journal-posted COGS changed since the plan was generated (was ${correction.beforeValue}, now ${liveCogs}) — refusing to proceed`
      );
    }
    return { ...base, status: 'APPLIED', detail: `confirmed ledger-posted COGS still matches: ${liveCogs}` };
  }

  const writableFields = WRITABLE_COLUMNS[correction.table];
  if (!writableFields || !writableFields.has(correction.field)) {
    throw new Error(`no writable column mapping for ${correction.table}.${correction.field} (action ${correction.action})`);
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

  return { ...base, status: 'APPLIED', detail: `${correction.field}: ${correction.beforeValue} -> ${correction.afterValue}` };
}

export interface ExecuteRemediationPlanInput {
  planId: string;
  expectedVersion: number;
}

export interface ExecuteRemediationPlanDeps {
  pool: Pool;
  now?: () => Date;
}

export async function executeRemediationPlan(
  input: ExecuteRemediationPlanInput,
  deps: ExecuteRemediationPlanDeps
): Promise<RemediationPlanRecord> {
  const { pool } = deps;
  const now = deps.now ?? (() => new Date());

  const plan = await loadRemediationPlan(pool, input.planId);
  if (!plan) throw new RemediationPlanNotFoundError(input.planId);
  if (!isTransitionAllowed(plan.state, 'EXECUTING')) {
    throw new InvalidTransitionError(input.planId, plan.state, 'EXECUTING');
  }

  let currentRecord = await applyRemediationPlanTransition(pool, input.planId, input.expectedVersion, {
    state: 'EXECUTING',
    updatedAt: now().toISOString()
  });

  const startedAt = now().toISOString();
  const steps: ExecutionStepResult[] = [];
  let failureReason: ExecutionFailureReason | null = null;
  let failureDetail: string | null = null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const freshReport = investigate(await loadInvestigationInput(client));
    if (!correctionsMatch(freshReport.proposedCorrections, plan.proposedCorrections)) {
      failureReason = 'DRIFT_DETECTED';
      failureDetail =
        'live data no longer matches the state this plan was generated and approved against — the incident data changed or was already remediated since approval; re-investigate and generate a new plan';
      await client.query('ROLLBACK');
    } else {
      const ordered = [...plan.proposedCorrections].sort((a, b) => a.sequence - b.sequence);
      for (const correction of ordered) {
        try {
          steps.push(await applyCorrectionWrite(client, correction, now()));
        } catch (error) {
          failureReason = 'SQL_ERROR';
          failureDetail = error instanceof Error ? error.message : String(error);
          break;
        }
      }

      if (failureReason) {
        await client.query('ROLLBACK');
      } else {
        currentRecord = await applyRemediationPlanTransition(pool, input.planId, currentRecord.version, {
          state: 'VERIFYING',
          updatedAt: now().toISOString()
        });

        const verification = verifyState(await loadInvestigationInput(client));
        const finishedAt = now().toISOString();
        const executionResult: RemediationExecutionResult = { startedAt, finishedAt, steps, failureReason: null, failureDetail: null };

        if (verification.overallStatus === 'PASS') {
          await client.query('COMMIT');
          return applyRemediationPlanTransition(pool, input.planId, currentRecord.version, {
            state: 'RESOLVED',
            updatedAt: finishedAt,
            executionResultJson: JSON.stringify(executionResult),
            executedAt: finishedAt,
            verificationJson: JSON.stringify({ verifiedAt: finishedAt, result: verification })
          });
        }

        await client.query('ROLLBACK');
        return applyRemediationPlanTransition(pool, input.planId, currentRecord.version, {
          state: 'VERIFICATION_FAILED',
          updatedAt: finishedAt,
          executionResultJson: JSON.stringify(executionResult),
          executedAt: finishedAt,
          verificationJson: JSON.stringify({ verifiedAt: finishedAt, result: verification })
        });
      }
    }
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // connection may already be unusable after the original error; the
      // ERP data transaction was never committed either way.
    }
    if (!failureReason) {
      failureReason = 'SQL_ERROR';
      failureDetail = error instanceof Error ? error.message : String(error);
    }
  } finally {
    client.release();
  }

  // currentRecord reflects the last transition that actually committed. If
  // that was EXECUTING->VERIFYING, the only legal exits from VERIFYING are
  // VERIFICATION_FAILED/RESOLVED (see ALLOWED_TRANSITIONS) — an unexpected
  // error surfacing after that point (e.g. the verification re-read itself
  // threw) must still land on VERIFICATION_FAILED, never EXECUTION_FAILED,
  // or this call would attempt an illegal state-machine edge.
  const finishedAt = now().toISOString();
  const executionResult: RemediationExecutionResult = { startedAt, finishedAt, steps, failureReason, failureDetail };
  const terminalState = currentRecord.state === 'VERIFYING' ? 'VERIFICATION_FAILED' : 'EXECUTION_FAILED';
  return applyRemediationPlanTransition(pool, input.planId, currentRecord.version, {
    state: terminalState,
    updatedAt: finishedAt,
    executionResultJson: JSON.stringify(executionResult),
    executedAt: finishedAt
  });
}
