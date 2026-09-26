import type {
  ConstrainedAction,
  ConstrainedActionAdapter,
  ConstrainedActionExecutionResult
} from '../ports/constrained-action';

export class StaleActionError extends Error {
  readonly name = 'StaleActionError';
  constructor(message: string) {
    super(message);
  }
}

export async function executeConstrainedAction(
  adapter: ConstrainedActionAdapter,
  action: ConstrainedAction,
  expectedFingerprint?: string
): Promise<ConstrainedActionExecutionResult> {
  const validated = await adapter.validate(action);
  if (!validated.ok) {
    return {
      outcome: 'REJECTED',
      httpSucceeded: false,
      verified: false,
      fingerprintBefore: null,
      fingerprintAfter: null,
      detail: validated.reason,
      mutated: false
    };
  }

  const fingerprintBefore = await adapter.fingerprint(action);
  if (expectedFingerprint && expectedFingerprint !== fingerprintBefore) {
    return {
      outcome: 'STALE',
      httpSucceeded: false,
      verified: false,
      fingerprintBefore,
      fingerprintAfter: null,
      detail: 'Source state changed after approval; re-investigation required',
      mutated: false
    };
  }

  const executed = await adapter.execute(action);
  if (executed.stale) {
    return {
      outcome: 'STALE',
      httpSucceeded: false,
      verified: false,
      fingerprintBefore,
      fingerprintAfter: null,
      detail: executed.detail,
      mutated: false
    };
  }

  const fingerprintAfter = await adapter.fingerprint(action);
  const verification = await adapter.verify(action);

  if (!executed.httpSucceeded) {
    return {
      outcome: 'REJECTED',
      httpSucceeded: false,
      verified: false,
      fingerprintBefore,
      fingerprintAfter,
      detail: executed.detail,
      mutated: false
    };
  }

  if (!verification.pass) {
    return {
      outcome: 'VERIFICATION_FAILED',
      httpSucceeded: true,
      verified: false,
      fingerprintBefore,
      fingerprintAfter,
      detail: verification.detail,
      mutated: true
    };
  }

  return {
    outcome: 'VERIFIED',
    httpSucceeded: true,
    verified: true,
    fingerprintBefore,
    fingerprintAfter,
    detail: verification.detail,
    mutated: true
  };
}
