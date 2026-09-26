export interface ConstrainedActionTarget {
  systemType: string;
  resourceType: string;
  resourceId: string;
}

export interface ConstrainedAction {
  type: string;
  target: ConstrainedActionTarget;
}

export type ConstrainedActionOutcome =
  | 'VERIFIED'
  | 'STALE'
  | 'VERIFICATION_FAILED'
  | 'REJECTED'
  | 'RECOVERY_REQUIRED';

export interface ConstrainedActionExecutionResult {
  outcome: ConstrainedActionOutcome;
  httpSucceeded: boolean;
  verified: boolean;
  fingerprintBefore: string | null;
  fingerprintAfter: string | null;
  detail: string;
  mutated: boolean;
  remoteWriteAttempted: boolean;
}

export interface ConstrainedActionAdapter {
  readonly meta: {
    systemId: string;
    systemType: string;
    adapterVersion?: string;
    capabilities?: {
      nativeTransactions: boolean;
      idempotencyInNativeTransaction: boolean;
      supportsStateVersioning?: boolean;
      supportsSimulation?: boolean;
      supportsCompensation?: boolean;
    };
  };
  fingerprint(action: ConstrainedAction): Promise<string>;
  validate(action: ConstrainedAction): Promise<{ ok: true } | { ok: false; reason: string }>;
  execute(action: ConstrainedAction): Promise<{
    httpSucceeded: boolean;
    stale?: boolean;
    recoveryRequired?: boolean;
    remoteWriteAttempted?: boolean;
    detail: string;
  }>;
  verify(action: ConstrainedAction): Promise<{ pass: boolean; detail: string }>;
  classifyRecovery(action: ConstrainedAction): Promise<'applied' | 'not_applied' | 'ambiguous'>;
}
