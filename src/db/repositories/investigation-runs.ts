import type { Pool } from 'pg';
import { InvestigationRunRecordSchema, type InvestigationRunRecord } from '../../agent/types';

// ---------------------------------------------------------------------------
// Persistence for FASE 5 investigation runs (src/agent/orchestrator.ts). One
// row per run, upserted on every terminal transition (success or one of the 7
// failure states) — never a fake success. The row is the exact,
// already-Zod-validated InvestigationRunRecord shape: no chain-of-thought
// field exists on that type, so none is ever persisted here.
// ---------------------------------------------------------------------------

export async function saveInvestigationRun(pool: Pool, record: InvestigationRunRecord): Promise<void> {
  await pool.query(
    `insert into investigation_runs
       (id, incident_id, product_id, trigger_asset, requested_by, mode, final_state, status,
        input_json, output_json, error_json, state_history_json, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (id) do update set
       final_state = excluded.final_state,
       status = excluded.status,
       output_json = excluded.output_json,
       error_json = excluded.error_json,
       state_history_json = excluded.state_history_json`,
    [
      record.investigationId,
      record.incidentId,
      record.input.productId,
      record.input.triggerAsset,
      record.input.requestedBy,
      record.input.mode,
      record.finalState,
      record.output?.status ?? null,
      JSON.stringify(record.input),
      record.output ? JSON.stringify(record.output) : null,
      record.error ? JSON.stringify(record.error) : null,
      JSON.stringify(record.stateHistory),
      record.createdAt
    ]
  );
}

export async function loadInvestigationRun(pool: Pool, investigationId: string): Promise<InvestigationRunRecord | null> {
  const { rows } = await pool.query(
    `select id as "investigationId", incident_id as "incidentId", input_json as "inputJson",
            final_state as "finalState", output_json as "outputJson", error_json as "errorJson",
            state_history_json as "stateHistoryJson", created_at as "createdAt"
       from investigation_runs
      where id = $1`,
    [investigationId]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
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
