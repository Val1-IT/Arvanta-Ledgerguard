import { investigate } from '../investigate';
import type { InvestigationInput, ProposedCorrection } from '../types';
import { correctionsMatch } from './corrections-match';

export type StaleReservationClassification = 'applied' | 'not_applied' | 'ambiguous';

export function classifyStaleReservation(input: {
  snapshot: InvestigationInput;
  approvedCorrections: ProposedCorrection[];
}): StaleReservationClassification {
  const fresh = investigate(input.snapshot);
  if (correctionsMatch(fresh.proposedCorrections, input.approvedCorrections)) {
    return 'not_applied';
  }
  if (fresh.incidentType === null && fresh.proposedCorrections.length === 0) {
    return 'applied';
  }
  return 'ambiguous';
}
