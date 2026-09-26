import { investigate } from '../investigate';
import type { InvestigationInput, ProposedCorrection, VerificationExpectation } from '../types';
import { verifyState } from '../verify';
import { correctionsMatch } from './corrections-match';

export type StaleReservationClassification = 'applied' | 'not_applied' | 'ambiguous';

const FIELD_BY_COLUMN: Record<string, string> = {
  reversed_at: 'reversedAt',
  base_quantity: 'baseQuantity',
  quantity_on_hand: 'quantityOnHand',
  inventory_value: 'inventoryValue',
  average_cost: 'averageCost',
  conversion_factor: 'conversionFactor',
  cost_of_goods_sold: 'costOfGoodsSold',
  gross_profit: 'grossProfit',
  gross_margin_percentage: 'grossMarginPercentage'
};

function recordsForTable(snapshot: InvestigationInput, table: string): Array<Record<string, unknown>> {
  switch (table) {
    case 'inventory_movements':
      return snapshot.movements as unknown as Array<Record<string, unknown>>;
    case 'inventory_valuation':
      return snapshot.valuations as unknown as Array<Record<string, unknown>>;
    case 'product_units':
      return snapshot.productUnits as unknown as Array<Record<string, unknown>>;
    case 'gross_margin_report':
      return snapshot.marginReports as unknown as Array<Record<string, unknown>>;
    default:
      return [];
  }
}

function valueApplied(live: unknown, afterValue: string, field: string): boolean {
  if (field === 'reversed_at') {
    return live instanceof Date || (typeof live === 'string' && live.length > 0);
  }
  if (live === null || live === undefined) {
    return false;
  }
  return String(live) === afterValue;
}

export function approvedCorrectionsApplied(
  snapshot: InvestigationInput,
  approvedCorrections: ProposedCorrection[]
): boolean {
  for (const correction of approvedCorrections) {
    if (correction.action === 'RECONCILE_JOURNAL_ENTRIES') {
      continue;
    }
    const records = recordsForTable(snapshot, correction.table);
    const row = records.find((item) => item.id === correction.recordId);
    if (!row) {
      return false;
    }
    const property = FIELD_BY_COLUMN[correction.field] ?? correction.field;
    if (!valueApplied(row[property], correction.afterValue, correction.field)) {
      return false;
    }
  }
  return approvedCorrections.length > 0;
}

export function expectationsHold(
  verificationChecks: Array<{ checkId: string; status: string }>,
  expectations: VerificationExpectation[]
): boolean {
  if (expectations.length === 0) {
    return false;
  }
  const byId = new Map(verificationChecks.map((check) => [check.checkId, check.status]));
  return expectations.every((expectation) => byId.get(expectation.checkId) === expectation.expectedStatus);
}

export function classifyStaleReservation(input: {
  snapshot: InvestigationInput;
  approvedCorrections: ProposedCorrection[];
  verificationExpectations?: VerificationExpectation[];
}): StaleReservationClassification {
  const fresh = investigate(input.snapshot);
  if (correctionsMatch(fresh.proposedCorrections, input.approvedCorrections)) {
    return 'not_applied';
  }

  const verification = verifyState(input.snapshot);
  const expectations = input.verificationExpectations ?? [];
  if (
    verification.overallStatus === 'PASS' &&
    expectationsHold(verification.checks, expectations) &&
    approvedCorrectionsApplied(input.snapshot, input.approvedCorrections)
  ) {
    return 'applied';
  }

  return 'ambiguous';
}
