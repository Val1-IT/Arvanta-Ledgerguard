import type { AffectedAsset, AffectedRecords, AssetRole, BlastRadius, RootCause } from './types';

// ---------------------------------------------------------------------------
// Pure aggregation: turns already-identified record-ID lists into the
// structured blast-radius report. This module makes no decisions about
// *which* records are affected — conversion-impact.ts, inventory-impact.ts,
// journal-impact.ts, and margin-impact.ts decide that. Here we only count
// and classify by role.
// ---------------------------------------------------------------------------

export interface BlastRadiusInput {
  rootCause: RootCause | null;
  affectedMovementIds: string[];
  affectedValuationIds: string[];
  affectedJournalEntryIds: string[];
  affectedReportIds: string[];
}

export function buildBlastRadius(input: BlastRadiusInput): { affectedRecords: AffectedRecords; blastRadius: BlastRadius } {
  const affectedRecords: AffectedRecords = {
    inventoryMovements: input.affectedMovementIds,
    inventoryValuations: input.affectedValuationIds,
    journalEntries: input.affectedJournalEntryIds,
    reports: input.affectedReportIds
  };

  if (!input.rootCause) {
    return {
      affectedRecords,
      blastRadius: { affectedAssetCount: 0, affectedRecordCount: 0, assets: [] }
    };
  }

  const asset = (name: string, role: AssetRole, recordCount: number): AffectedAsset | null =>
    recordCount > 0 || role === 'root_cause' ? { asset: name, role, recordCount } : null;

  const assets = [
    asset('product_units', 'root_cause', 1),
    asset('inventory_movements', 'evidence_only', input.affectedMovementIds.length),
    asset('inventory_valuation', 'requires_correction', input.affectedValuationIds.length),
    asset('journal_entries', 'evidence_only', input.affectedJournalEntryIds.length),
    asset('gross_margin_report', 'requires_correction', input.affectedReportIds.length)
  ].filter((a): a is AffectedAsset => a !== null);

  const affectedRecordCount = assets.reduce((sum, a) => sum + a.recordCount, 0);

  return {
    affectedRecords,
    blastRadius: {
      affectedAssetCount: assets.length,
      affectedRecordCount,
      assets
    }
  };
}
