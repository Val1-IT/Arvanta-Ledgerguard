import type { PolicyRule } from './types';

export const impactPolicy: PolicyRule = {
  id: 'policy.financial_threshold',
  name: 'Financial impact above threshold requires human approval',
  evaluate(ctx) {
    const threshold = ctx.config.financialApprovalThreshold;
    if (threshold === null || ctx.impactAmount <= threshold) {
      return {
        outcome: 'ALLOW',
        reason: {
          policyId: this.id,
          code: 'POLICY_PASSED',
          message: 'Financial impact is within the configured auto-allow threshold',
          data: { impactAmount: ctx.impactAmount, threshold }
        }
      };
    }

    const approved =
      ctx.plan.state === 'APPROVED' &&
      ctx.plan.approvalAction === 'APPROVE' &&
      ctx.plan.version === ctx.expectedVersion;

    if (approved) {
      return {
        outcome: 'ALLOW',
        reason: {
          policyId: this.id,
          code: 'APPROVAL_GRANTED',
          message: 'Impact exceeded threshold but a valid human approval is recorded for this plan version',
          data: { impactAmount: ctx.impactAmount, threshold, approvedBy: ctx.plan.approvedBy }
        }
      };
    }

    return {
      outcome: 'REQUIRE_APPROVAL',
      reason: {
        policyId: this.id,
        code: 'IMPACT_THRESHOLD_EXCEEDED',
        message: `Financial impact ${ctx.impactAmount} exceeds threshold ${threshold}`,
        data: { impactAmount: ctx.impactAmount, threshold, currency: ctx.config.currency }
      }
    };
  }
};
