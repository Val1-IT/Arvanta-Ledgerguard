import type { RemediationPlanRecord } from '../../remediation/types';

export type RemediationAvailableActions = {
  canGeneratePlan: boolean;
  canSubmitForApproval: boolean;
  canApprove: boolean;
  canReject: boolean;
  canKeepFrozen: boolean;
  canExecute: boolean;
  canWriteback: boolean;
};

/**
 * Pure UI policy derived from terminal backend state. Never invents transitions.
 */
export function resolveRemediationAvailableActions(parts: {
  investigationCompleted: boolean;
  recommendedNextStep: string | null;
  plan: RemediationPlanRecord | null;
  demoModeEnabled: boolean;
}): RemediationAvailableActions {
  const { investigationCompleted, recommendedNextStep, plan, demoModeEnabled } = parts;
  const none: RemediationAvailableActions = {
    canGeneratePlan: false,
    canSubmitForApproval: false,
    canApprove: false,
    canReject: false,
    canKeepFrozen: false,
    canExecute: false,
    canWriteback: false
  };

  if (!demoModeEnabled || !investigationCompleted) return none;

  if (!plan) {
    return {
      ...none,
      canGeneratePlan:
        recommendedNextStep === 'REQUEST_APPROVAL' || recommendedNextStep === 'ESCALATE_TO_OWNER'
    };
  }

  switch (plan.state) {
    case 'DRAFT':
      return { ...none, canSubmitForApproval: true, canGeneratePlan: true };
    case 'PENDING_APPROVAL':
      return { ...none, canApprove: true, canReject: true, canKeepFrozen: true };
    case 'APPROVED':
      return { ...none, canExecute: true };
    case 'RESOLVED':
      return {
        ...none,
        canWriteback: !plan.datahubWriteback || plan.datahubWriteback.outcome === 'FAILED'
      };
    case 'REJECTED':
    case 'EXECUTION_FAILED':
    case 'VERIFICATION_FAILED':
      return { ...none, canGeneratePlan: true };
    default:
      return none;
  }
}

/**
 * Honest empty-state copy when no mutating buttons are available.
 */
export function remediationActionsDisabledReason(parts: {
  demoModeEnabled: boolean;
  investigationCompleted: boolean;
  recommendedNextStep: string | null;
  plan: RemediationPlanRecord | null;
  actions: RemediationAvailableActions;
}): string | null {
  if (Object.values(parts.actions).some(Boolean)) return null;
  if (!parts.demoModeEnabled) {
    return 'Mutating remediation actions require DEMO_MODE=true.';
  }
  if (!parts.investigationCompleted) {
    return 'Remediation actions unlock after the investigation completes successfully.';
  }
  if (!parts.plan) {
    if (
      parts.recommendedNextStep !== 'REQUEST_APPROVAL' &&
      parts.recommendedNextStep !== 'ESCALATE_TO_OWNER'
    ) {
      return 'This investigation does not recommend generating a remediation plan.';
    }
  }
  if (parts.plan?.state === 'EXECUTING' || parts.plan?.state === 'VERIFYING') {
    return `Plan is currently ${parts.plan.state}. Wait for the backend to finish, then refresh.`;
  }
  return 'No remediation actions are available for the current plan state.';
}

export function remediationDecisionCopy(
  plan: RemediationPlanRecord | null,
  recommendedNextStep: string | null,
  actions: RemediationAvailableActions
): string {
  if (!plan) {
    if (actions.canGeneratePlan) {
      return 'Generate a remediation plan from the current live engine snapshot, then submit it for approval.';
    }
    if (recommendedNextStep === 'NO_ACTION_REQUIRED') {
      return 'No remediable incident is indicated for this investigation.';
    }
    return 'A remediation plan cannot be generated from this investigation state.';
  }

  switch (plan.state) {
    case 'DRAFT':
      return 'Plan is in DRAFT. Submit it for approval when the proposed corrections look correct.';
    case 'PENDING_APPROVAL':
      return 'Plan is PENDING_APPROVAL. Choose Approve, Reject, or Keep reports frozen.';
    case 'APPROVED':
      return 'Plan is APPROVED. Execute applies corrections in one transaction with rollback on failure.';
    case 'REJECTED':
      return plan.approvalAction === 'KEEP_REPORTS_FROZEN'
        ? 'Plan was kept frozen (DataHub At Risk remains). Generate a new plan to continue later.'
        : 'Plan was rejected. Generate a new plan if remediation should continue.';
    case 'EXECUTING':
    case 'VERIFYING':
      return `Plan is currently ${plan.state}. Wait for the backend transition to finish.`;
    case 'EXECUTION_FAILED':
    case 'VERIFICATION_FAILED':
      return `Plan ended in ${plan.state}. This plan cannot be retried — generate a new plan.`;
    case 'RESOLVED':
      return plan.datahubWriteback?.outcome === 'SYNCED'
        ? 'Plan is RESOLVED and DataHub write-back synced.'
        : 'Plan is RESOLVED in ERP data. DataHub write-back can be retried if metadata is still stale.';
    default:
      return `Plan state: ${plan.state}`;
  }
}
