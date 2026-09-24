import { investigate } from '../investigate';
import { correctionsMatch } from './corrections-match';
import type {
  ConstrainedRemediationResult,
  CorrectionStepResult,
  SystemOfRecordAdapter
} from '../ports/system-of-record';
import type { ProposedCorrection, VerificationResult } from '../types';
import { verifyState } from '../verify';

export class DriftDetectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriftDetectedError';
  }
}

export class VerificationFailedError extends Error {
  constructor(
    readonly verification: VerificationResult,
    readonly steps: CorrectionStepResult[]
  ) {
    super('Post-mutation verification failed');
    this.name = 'VerificationFailedError';
  }
}

export interface ExecuteConstrainedRemediationInput {
  approvedCorrections: ProposedCorrection[];
  now?: () => Date;
  onWritesApplied?: () => Promise<void>;
}

export async function executeConstrainedRemediation(
  adapter: SystemOfRecordAdapter,
  input: ExecuteConstrainedRemediationInput
): Promise<ConstrainedRemediationResult> {
  const now = input.now ?? (() => new Date());
  let steps: CorrectionStepResult[] = [];

  try {
    const success = await adapter.runInTransaction(async (session) => {
      const snapshot = await session.loadInvestigationInput();
      const fresh = investigate(snapshot);
      if (!correctionsMatch(fresh.proposedCorrections, input.approvedCorrections)) {
        throw new DriftDetectedError(
          'live data no longer matches the state this plan was generated and approved against — the incident data changed or was already remediated since approval; re-investigate and generate a new plan'
        );
      }

      const ordered = [...input.approvedCorrections].sort((a, b) => a.sequence - b.sequence);
      steps = [];
      for (const correction of ordered) {
        steps.push(await session.applyCorrection(correction, now()));
      }

      if (input.onWritesApplied) {
        await input.onWritesApplied();
      }

      const verification = verifyState(await session.loadInvestigationInput());
      if (verification.overallStatus !== 'PASS') {
        throw new VerificationFailedError(verification, steps);
      }

      return { steps, verification };
    });

    return {
      committed: true,
      steps: success.steps,
      verification: success.verification,
      failureReason: null,
      failureDetail: null
    };
  } catch (error) {
    if (error instanceof DriftDetectedError) {
      return {
        committed: false,
        steps: [],
        verification: null,
        failureReason: 'DRIFT_DETECTED',
        failureDetail: error.message
      };
    }
    if (error instanceof VerificationFailedError) {
      return {
        committed: false,
        steps: error.steps,
        verification: error.verification,
        failureReason: 'VERIFICATION_FAILED',
        failureDetail: error.message
      };
    }
    return {
      committed: false,
      steps,
      verification: null,
      failureReason: 'MUTATION_REJECTED',
      failureDetail: error instanceof Error ? error.message : String(error)
    };
  }
}
