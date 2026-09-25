import type {
  EvidenceItem,
  FinancialImpact,
  IncidentType,
  InvestigationInput,
  ProposedCorrection,
  RootCause,
  VerificationExpectation
} from '../types';

export interface DetectorHit {
  incidentType: NonNullable<IncidentType>;
  rootCause: RootCause;
  evidence: EvidenceItem[];
  proposedCorrections: ProposedCorrection[];
  verificationExpectations: VerificationExpectation[];
  affectedMovementIds: string[];
  affectedValuationIds: string[];
  financialImpact: FinancialImpact;
}

export interface IncidentDetector {
  readonly incidentType: NonNullable<IncidentType>;
  detect(input: InvestigationInput): DetectorHit | null;
}
