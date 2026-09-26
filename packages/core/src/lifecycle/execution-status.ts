export const ExecutionStatus = {
  proposed: 'PROPOSED',
  authorized: 'AUTHORIZED',
  reserved: 'RESERVED',
  executing: 'EXECUTING',
  verifying: 'VERIFYING',
  committed: 'COMMITTED',
  denied: 'DENIED',
  stale: 'STALE',
  verificationFailed: 'VERIFICATION_FAILED',
  rolledBack: 'ROLLED_BACK',
  recoveryRequired: 'RECOVERY_REQUIRED',
  failed: 'FAILED',
  alreadyExecuted: 'ALREADY_EXECUTED'
} as const;

export type ExecutionStatusName = (typeof ExecutionStatus)[keyof typeof ExecutionStatus];
