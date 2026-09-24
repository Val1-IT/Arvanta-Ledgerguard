import type { Queryable } from '../queryable';
import { BaselineSnapshotSchema, GrossMarginReportRecordSchema, type BaselineSnapshot, type GrossMarginReportRecord } from '@ledgerguard/core';

export async function fetchGrossMarginReports(pool: Queryable): Promise<GrossMarginReportRecord[]> {
  const { rows } = await pool.query(
    `select id, period, revenue, cost_of_goods_sold as "costOfGoodsSold", gross_profit as "grossProfit",
            gross_margin_percentage as "grossMarginPercentage", generated_at as "generatedAt"
       from gross_margin_report
      order by period, id`
  );
  return rows.map((row) => GrossMarginReportRecordSchema.parse(row));
}

/** The canonical healthy-state reference captured once at seed time (see src/db/seed.ts). */
export async function fetchBaselineSnapshot(pool: Queryable): Promise<BaselineSnapshot> {
  const { rows } = await pool.query(
    `select value_json as "valueJson", captured_at as "capturedAt" from baseline_snapshot where key = 'baseline'`
  );
  if (rows.length === 0) {
    throw new Error("baseline_snapshot row 'baseline' not found — run `npm run db:seed` first");
  }
  // capturedAt lives in its own DB column, not inside the JSON blob (see
  // src/db/seed.ts) — merge it in before validating against the schema.
  return BaselineSnapshotSchema.parse({ ...JSON.parse(rows[0].valueJson), capturedAt: rows[0].capturedAt });
}
