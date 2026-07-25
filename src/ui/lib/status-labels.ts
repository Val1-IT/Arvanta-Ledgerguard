const PLAN_STATE_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  EXECUTING: 'Executing',
  VERIFYING: 'Verifying',
  EXECUTION_FAILED: 'Execution failed',
  VERIFICATION_FAILED: 'Verification failed',
  RESOLVED: 'Resolved',
  NO_PLAN: 'No plan',
  NONE: 'None'
};

const APPROVAL_LABELS: Record<string, string> = {
  APPROVE: 'Approved',
  REJECT: 'Rejected',
  KEEP_REPORTS_FROZEN: 'Keep reports frozen'
};

const WRITEBACK_LABELS: Record<string, string> = {
  SYNCED: 'Synced',
  FAILED: 'Failed',
  NOT_ATTEMPTED: 'Not attempted'
};

const VERIFICATION_LABELS: Record<string, string> = {
  PASS: 'Pass',
  FAIL: 'Fail',
  NOT_RUN: 'Not run'
};

export function labelPlanState(state: string | null | undefined): string {
  if (!state) return PLAN_STATE_LABELS.NO_PLAN;
  return PLAN_STATE_LABELS[state] ?? state.replaceAll('_', ' ');
}

export function labelApprovalAction(action: string | null | undefined): string {
  if (!action) return '—';
  return APPROVAL_LABELS[action] ?? action.replaceAll('_', ' ');
}

export function labelWriteback(outcome: string | null | undefined): string {
  if (!outcome) return WRITEBACK_LABELS.NOT_ATTEMPTED;
  return WRITEBACK_LABELS[outcome] ?? outcome;
}

export function labelVerification(status: string | null | undefined): string {
  if (!status) return VERIFICATION_LABELS.NOT_RUN;
  return VERIFICATION_LABELS[status] ?? status;
}
