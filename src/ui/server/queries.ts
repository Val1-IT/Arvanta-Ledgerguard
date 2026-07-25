import type { Pool } from 'pg';
import { InvestigationRunRecordSchema, type InvestigationRunRecord } from '../../agent/types';
import { RemediationPlanRecordSchema, SCHEMA_VERSION, type RemediationPlanRecord } from '../../remediation/types';

/**
 * Thin read-only UI queries. No schema changes — SELECT only against existing tables.
 */

function parseRunRow(row: {
  investigationId: string;
  incidentId: string;
  inputJson: string;
  finalState: string;
  outputJson: string | null;
  errorJson: string | null;
  stateHistoryJson: string;
  createdAt: Date | string;
}): InvestigationRunRecord {
  return InvestigationRunRecordSchema.parse({
    investigationId: row.investigationId,
    incidentId: row.incidentId,
    input: JSON.parse(row.inputJson),
    finalState: row.finalState,
    output: row.outputJson ? JSON.parse(row.outputJson) : null,
    error: row.errorJson ? JSON.parse(row.errorJson) : null,
    stateHistory: JSON.parse(row.stateHistoryJson),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt
  });
}

export async function listInvestigationRuns(
  pool: Pool,
  limit = 20
): Promise<InvestigationRunRecord[]> {
  const { rows } = await pool.query(
    `select id as "investigationId", incident_id as "incidentId", input_json as "inputJson",
            final_state as "finalState", output_json as "outputJson", error_json as "errorJson",
            state_history_json as "stateHistoryJson", created_at as "createdAt"
       from investigation_runs
      order by created_at desc
      limit $1`,
    [limit]
  );
  return rows.map(parseRunRow);
}

export async function countActiveInvestigationRuns(pool: Pool): Promise<number> {
  const { rows } = await pool.query(
    `select count(*)::int as count
       from investigation_runs
      where final_state = 'INVESTIGATION_COMPLETED'
        and coalesce(status, '') <> 'FAILED'`
  );
  return Number(rows[0]?.count ?? 0);
}

type RemediationPlanRow = {
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
};

function parseRemediationPlanRow(row: RemediationPlanRow): RemediationPlanRecord {
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
    approvedAt: row.approvedAt instanceof Date ? row.approvedAt.toISOString() : row.approvedAt,
    executionResult: row.executionResultJson ? JSON.parse(row.executionResultJson) : null,
    executedAt: row.executedAt instanceof Date ? row.executedAt.toISOString() : row.executedAt,
    verification: row.verificationJson ? JSON.parse(row.verificationJson) : null,
    datahubWriteback: row.datahubWritebackJson ? JSON.parse(row.datahubWritebackJson) : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt
  });
}

const REMEDIATION_PLAN_SELECT = `select id, investigation_id as "investigationId", incident_id as "incidentId",
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
       from remediation_plans`;

export async function loadLatestRemediationPlanForInvestigation(
  pool: Pool,
  investigationId: string
): Promise<RemediationPlanRecord | null> {
  const { rows } = await pool.query(
    `${REMEDIATION_PLAN_SELECT}
      where investigation_id = $1
      order by created_at desc
      limit 1`,
    [investigationId]
  );
  if (rows.length === 0) return null;
  return parseRemediationPlanRow(rows[0] as RemediationPlanRow);
}

/** Newest-first history for the Remediation tab (active plan is index 0). */
export async function listRemediationPlansForInvestigation(
  pool: Pool,
  investigationId: string,
  limit = 10
): Promise<RemediationPlanRecord[]> {
  const { rows } = await pool.query(
    `${REMEDIATION_PLAN_SELECT}
      where investigation_id = $1
      order by created_at desc
      limit $2`,
    [investigationId, limit]
  );
  return (rows as RemediationPlanRow[]).map(parseRemediationPlanRow);
}

export async function hasBlockingRemediationPlan(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query(
    `select 1
       from remediation_plans
      where state in ('EXECUTING', 'VERIFYING')
      limit 1`
  );
  return rows.length > 0;
}
