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

function baseResult(
  partial: Omit<ConstrainedActionExecutionResult, 'remoteWriteAttempted'> & { remoteWriteAttempted?: boolean }
): ConstrainedActionExecutionResult {
  return {
    ...partial,
    remoteWriteAttempted: partial.remoteWriteAttempted ?? false
  };
}

export async function executeConstrainedAction(
  adapter: ConstrainedActionAdapter,
  action: ConstrainedAction,
  expectedFingerprint?: string
): Promise<ConstrainedActionExecutionResult> {
  const validated = await adapter.validate(action);
  if (!validated.ok) {
    return baseResult({
      outcome: 'REJECTED',
      httpSucceeded: false,
      verified: false,
      fingerprintBefore: null,
      fingerprintAfter: null,
      detail: validated.reason,
      mutated: false
    });
  }

  const fingerprintBefore = await adapter.fingerprint(action);
  if (expectedFingerprint && expectedFingerprint !== fingerprintBefore) {
    return baseResult({
      outcome: 'STALE',
      httpSucceeded: false,
      verified: false,
      fingerprintBefore,
      fingerprintAfter: null,
      detail: 'Source state changed after approval; re-investigation required',
      mutated: false
    });
  }

  const executed = await adapter.execute(action);
  if (executed.recoveryRequired) {
    const fingerprintAfter = await adapter.fingerprint(action).catch(() => null);
    return baseResult({
      outcome: 'RECOVERY_REQUIRED',
      httpSucceeded: Boolean(executed.httpSucceeded),
      verified: false,
      fingerprintBefore,
      fingerprintAfter,
      detail: executed.detail,
      mutated: true,
      remoteWriteAttempted: executed.remoteWriteAttempted ?? true
    });
  }
  if (executed.stale) {
    return baseResult({
      outcome: 'STALE',
      httpSucceeded: false,
      verified: false,
      fingerprintBefore,
      fingerprintAfter: null,
      detail: executed.detail,
      mutated: false,
      remoteWriteAttempted: executed.remoteWriteAttempted ?? false
    });
  }

  const fingerprintAfter = await adapter.fingerprint(action);
  const verification = await adapter.verify(action);

  if (!executed.httpSucceeded) {
    return baseResult({
      outcome: 'REJECTED',
      httpSucceeded: false,
      verified: false,
      fingerprintBefore,
      fingerprintAfter,
      detail: executed.detail,
      mutated: false,
      remoteWriteAttempted: executed.remoteWriteAttempted ?? false
    });
  }

  if (!verification.pass) {
    return baseResult({
      outcome: 'VERIFICATION_FAILED',
      httpSucceeded: true,
      verified: false,
      fingerprintBefore,
      fingerprintAfter,
      detail: verification.detail,
      mutated: true,
      remoteWriteAttempted: true
    });
  }

  return baseResult({
    outcome: 'VERIFIED',
    httpSucceeded: true,
    verified: true,
    fingerprintBefore,
    fingerprintAfter,
    detail: verification.detail,
    mutated: true,
    remoteWriteAttempted: true
  });
}
