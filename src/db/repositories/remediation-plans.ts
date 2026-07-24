import type { Queryable } from '../queryable';
import {
  OptimisticConcurrencyError,
  RemediationPlanNotFoundError,
  RemediationPlanRecordSchema,
  SCHEMA_VERSION,
  type RemediationPlanRecord,
  type RemediationPlanState
} from '../../remediation/types';

// ---------------------------------------------------------------------------
// Persistence for FASE 6 remediation plans. This module is deliberately dumb:
// it knows how to insert a plan and how to apply a version-guarded field
// patch, but it never decides WHETHER a transition is legal — that is
// src/remediation/types.ts's ALLOWED_TRANSITIONS, enforced by the workflow
// modules (approve.ts / execute.ts / writeback.ts) before they call
// applyRemediationPlanTransition here.
//
// Every mutating call is a single `update ... where id = $1 and version = $2`
// — the classic optimistic-concurrency pattern. A patch field left undefined
// keeps the column's current value (via `coalesce`): fields on a
// RemediationPlanRecord are only ever filled in as the workflow progresses,
// never retracted, so "keep existing value unless a new one is supplied" is
// exactly the semantics every caller wants, including the one case (DataHub
// write-back) that patches a plan already in a terminal state without
// changing that state.
//
// Accepts a `Pick<Pool, 'query'>` rather than `Pool` itself so a `PoolClient`
// obtained from `pool.connect()` inside a transaction also satisfies it.
// ---------------------------------------------------------------------------

const SELECT_COLUMNS = `
  id, investigation_id as "investigationId", incident_id as "incidentId",
  product_id as "productId", trigger_asset as "triggerAsset", requested_by as "requestedBy",
  state, version,
  proposed_corrections_json as "proposedCorrectionsJson",
  verification_expectations_json as "verificationExpectationsJson",
  approval_action as "approvalAction", approved_by as "approvedBy", approval_note as "approvalNote",
  approved_at as "approvedAt",
  execution_result_json as "executionResultJson", executed_at as "executedAt",
  verification_json as "verificationJson",
  datahub_writeback_json as "datahubWritebackJson",
  created_at as "createdAt", updated_at as "updatedAt"
`;

function toIso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}

interface RemediationPlanRow {
  id: string;
  investigationId: string;
  incidentId: string;
  productId: string;
  triggerAsset: string;
  requestedBy: string;
  state: string;
  version: number;
  proposedCorrectionsJson: string;
  verificationExpectationsJson: string;
  approvalAction: string | null;
  approvedBy: string | null;
  approvalNote: string | null;
  approvedAt: Date | string | null;
  executionResultJson: string | null;
  executedAt: Date | string | null;
  verificationJson: string | null;
  datahubWritebackJson: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function rowToRecord(row: RemediationPlanRow): RemediationPlanRecord {
  return RemediationPlanRecordSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: row.id,
    investigationId: row.investigationId,
    incidentId: row.incidentId,
    productId: row.productId,
    triggerAsset: row.triggerAsset,
    requestedBy: row.requestedBy,
    state: row.state,
    version: row.version,
    proposedCorrections: JSON.parse(row.proposedCorrectionsJson),
    verificationExpectations: JSON.parse(row.verificationExpectationsJson),
    approvalAction: row.approvalAction,
    approvedBy: row.approvedBy,
    approvalNote: row.approvalNote,
    approvedAt: toIso(row.approvedAt),
    executionResult: row.executionResultJson ? JSON.parse(row.executionResultJson) : null,
    executedAt: toIso(row.executedAt),
    verification: row.verificationJson ? JSON.parse(row.verificationJson) : null,
    datahubWriteback: row.datahubWritebackJson ? JSON.parse(row.datahubWritebackJson) : null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  });
}

export async function createRemediationPlan(pool: Queryable, plan: RemediationPlanRecord): Promise<void> {
  await pool.query(
    `insert into remediation_plans
       (id, investigation_id, incident_id, product_id, trigger_asset, requested_by,
        state, version, proposed_corrections_json, verification_expectations_json,
        approval_action, approved_by, approval_note, approved_at,
        execution_result_json, executed_at, verification_json, datahub_writeback_json,
        created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [
      plan.id,
      plan.investigationId,
      plan.incidentId,
      plan.productId,
      plan.triggerAsset,
      plan.requestedBy,
      plan.state,
      plan.version,
      JSON.stringify(plan.proposedCorrections),
      JSON.stringify(plan.verificationExpectations),
      plan.approvalAction,
      plan.approvedBy,
      plan.approvalNote,
      plan.approvedAt,
      plan.executionResult ? JSON.stringify(plan.executionResult) : null,
      plan.executedAt,
      plan.verification ? JSON.stringify(plan.verification) : null,
      plan.datahubWriteback ? JSON.stringify(plan.datahubWriteback) : null,
      plan.createdAt,
      plan.updatedAt
    ]
  );
}

export async function loadRemediationPlan(pool: Queryable, planId: string): Promise<RemediationPlanRecord | null> {
  const { rows } = await pool.query(`select ${SELECT_COLUMNS} from remediation_plans where id = $1`, [planId]);
  if (rows.length === 0) return null;
  return rowToRecord(rows[0]);
}

export interface RemediationPlanTransitionPatch {
  state: RemediationPlanState;
  updatedAt: string;
  approvalAction?: string | null;
  approvedBy?: string | null;
  approvalNote?: string | null;
  approvedAt?: string | null;
  executionResultJson?: string | null;
  executedAt?: string | null;
  verificationJson?: string | null;
  datahubWritebackJson?: string | null;
}

/**
 * Applies a version-guarded patch to a plan. Throws RemediationPlanNotFoundError
 * if no row with `planId` exists at all, or OptimisticConcurrencyError if a row
 * exists but its current version does not match `expectedVersion` (i.e. someone
 * else already transitioned it). Never silently overwrites a concurrent change.
 */
export async function applyRemediationPlanTransition(
  pool: Queryable,
  planId: string,
  expectedVersion: number,
  patch: RemediationPlanTransitionPatch
): Promise<RemediationPlanRecord> {
  const { rows } = await pool.query(
    `update remediation_plans set
       state = $3,
       version = version + 1,
       approval_action = coalesce($4, approval_action),
       approved_by = coalesce($5, approved_by),
       approval_note = coalesce($6, approval_note),
       approved_at = coalesce($7, approved_at),
       execution_result_json = coalesce($8, execution_result_json),
       executed_at = coalesce($9, executed_at),
       verification_json = coalesce($10, verification_json),
       datahub_writeback_json = coalesce($11, datahub_writeback_json),
       updated_at = $12
     where id = $1 and version = $2
     returning ${SELECT_COLUMNS}`,
    [
      planId,
      expectedVersion,
      patch.state,
      patch.approvalAction ?? null,
      patch.approvedBy ?? null,
      patch.approvalNote ?? null,
      patch.approvedAt ?? null,
      patch.executionResultJson ?? null,
      patch.executedAt ?? null,
      patch.verificationJson ?? null,
      patch.datahubWritebackJson ?? null,
      patch.updatedAt
    ]
  );
  if (rows.length === 0) {
    const existing = await loadRemediationPlan(pool, planId);
    if (!existing) throw new RemediationPlanNotFoundError(planId);
    throw new OptimisticConcurrencyError(planId, expectedVersion);
  }
  return rowToRecord(rows[0]);
}
