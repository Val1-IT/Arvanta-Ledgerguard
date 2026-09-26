import { describe, expect, it } from 'vitest';
import {
  executeConstrainedRemediation,
  investigate,
  type InvestigationInput,
  type ProposedCorrection,
  type SystemOfRecordAdapter,
  type SystemOfRecordSession
} from '@ledgerguard/core';
import { applyConversionErrorToFixture, buildHealthyFixture, toInvestigationInput } from './fixtures';

class RecordingAdapter implements SystemOfRecordAdapter {
  readonly meta = { systemId: 'test-memory', systemType: 'memory' };
  commits = 0;
  rollbacks = 0;
  writesApplied = 0;

  currentSnapshot(): InvestigationInput {
    return structuredClone(this.snapshot);
  }

  constructor(
    private snapshot: InvestigationInput,
    private readonly apply: (
      sessionSnapshot: InvestigationInput,
      correction: ProposedCorrection
    ) => InvestigationInput | 'reject'
  ) {}

  async runInTransaction<T>(work: (session: SystemOfRecordSession) => Promise<T>): Promise<T> {
    const working = structuredClone(this.snapshot);
    const session: SystemOfRecordSession = {
      loadInvestigationInput: async () => structuredClone(working),
      applyCorrection: async (correction) => {
        const next = this.apply(working, correction);
        if (next === 'reject') {
          throw new Error(`no writable column mapping for ${correction.table}.${correction.field}`);
        }
        Object.assign(working, next);
        this.writesApplied += 1;
        return {
          sequence: correction.sequence,
          action: correction.action,
          table: correction.table,
          recordId: correction.recordId,
          status: 'APPLIED',
          detail: `${correction.field}: ${correction.beforeValue} -> ${correction.afterValue}`
        };
      }
    };

    try {
      const result = await work(session);
      this.snapshot = working;
      this.commits += 1;
      return result;
    } catch (error) {
      this.rollbacks += 1;
      throw error;
    }
  }
}

function applyPreviewCorrection(snapshot: InvestigationInput, correction: ProposedCorrection): InvestigationInput {
  if (correction.action === 'RECONCILE_JOURNAL_ENTRIES') {
    return snapshot;
  }
  if (correction.table === 'product_units') {
    return {
      ...snapshot,
      productUnits: snapshot.productUnits.map((unit) =>
        unit.id === correction.recordId ? { ...unit, conversionFactor: correction.afterValue } : unit
      )
    };
  }
  if (correction.table === 'inventory_valuation') {
    return {
      ...snapshot,
      valuations: snapshot.valuations.map((row) => {
        if (row.id !== correction.recordId) return row;
        if (correction.field === 'quantity_on_hand') return { ...row, quantityOnHand: correction.afterValue };
        if (correction.field === 'average_cost') return { ...row, averageCost: correction.afterValue };
        if (correction.field === 'inventory_value') return { ...row, inventoryValue: correction.afterValue };
        return row;
      })
    };
  }
  if (correction.table === 'gross_margin_report') {
    return {
      ...snapshot,
      marginReports: snapshot.marginReports.map((row) => {
        if (row.id !== correction.recordId) return row;
        if (correction.field === 'cost_of_goods_sold') return { ...row, costOfGoodsSold: correction.afterValue };
        if (correction.field === 'gross_profit') return { ...row, grossProfit: correction.afterValue };
        if (correction.field === 'gross_margin_percentage') return { ...row, grossMarginPercentage: correction.afterValue };
        return row;
      })
    };
  }
  if (correction.table === 'inventory_movements') {
    return {
      ...snapshot,
      movements: snapshot.movements.map((row) =>
        row.id === correction.recordId && correction.field === 'base_quantity'
          ? { ...row, baseQuantity: correction.afterValue }
          : row
      )
    };
  }
  return snapshot;
}

describe('executeConstrainedRemediation', () => {
  it('commits only after deterministic verification passes', async () => {
    const broken = toInvestigationInput(applyConversionErrorToFixture(buildHealthyFixture()));
    const approved = investigate(broken).proposedCorrections;
    const adapter = new RecordingAdapter(broken, applyPreviewCorrection);
    let writesHook = 0;

    const result = await executeConstrainedRemediation(adapter, {
      approvedCorrections: approved,
      onWritesApplied: async () => {
        writesHook += 1;
      }
    });

    expect(result.committed).toBe(true);
    expect(result.failureReason).toBeNull();
    expect(result.verification?.overallStatus).toBe('PASS');
    expect(result.sourceStateFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(adapter.commits).toBe(1);
    expect(adapter.rollbacks).toBe(0);
    expect(writesHook).toBe(1);
    expect(investigate(adapter.currentSnapshot()).incidentType).toBeNull();
  });

  it('rolls back when approved corrections no longer match live state', async () => {
    const broken = toInvestigationInput(applyConversionErrorToFixture(buildHealthyFixture()));
    const approved = investigate(broken).proposedCorrections;
    const drifted = {
      ...broken,
      productUnits: broken.productUnits.map((unit) =>
        unit.unitName === 'CARTON' ? { ...unit, conversionFactor: '8.0000' } : unit
      )
    };
    const adapter = new RecordingAdapter(drifted, applyPreviewCorrection);

    const result = await executeConstrainedRemediation(adapter, { approvedCorrections: approved });

    expect(result.committed).toBe(false);
    expect(result.failureReason).toBe('DRIFT_DETECTED');
    expect(adapter.commits).toBe(0);
    expect(adapter.rollbacks).toBe(1);
    expect(adapter.writesApplied).toBe(0);
  });

  it('rolls back when a mutation is rejected', async () => {
    const broken = toInvestigationInput(applyConversionErrorToFixture(buildHealthyFixture()));
    const approved = investigate(broken).proposedCorrections;
    const adapter = new RecordingAdapter(broken, () => 'reject');

    const result = await executeConstrainedRemediation(adapter, { approvedCorrections: approved });

    expect(result.committed).toBe(false);
    expect(result.failureReason).toBe('MUTATION_REJECTED');
    expect(adapter.rollbacks).toBe(1);
    expect(adapter.commits).toBe(0);
  });

  it('rolls back when verification fails after writes', async () => {
    const broken = toInvestigationInput(applyConversionErrorToFixture(buildHealthyFixture()));
    const approved = investigate(broken).proposedCorrections;
    const adapter = new RecordingAdapter(broken, (snapshot) => snapshot);

    const result = await executeConstrainedRemediation(adapter, { approvedCorrections: approved });

    expect(result.committed).toBe(false);
    expect(result.failureReason).toBe('VERIFICATION_FAILED');
    expect(result.verification?.overallStatus).toBe('FAIL');
    expect(adapter.rollbacks).toBe(1);
    expect(adapter.commits).toBe(0);
  });
});
