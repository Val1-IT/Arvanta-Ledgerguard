import { Capability } from '../primitives';
import type { PolicyRule } from './types';

export const approvalPolicy: PolicyRule = {
  id: 'policy.approval',
  name: 'Execution requires approval of the exact plan version',
  evaluate(ctx) {
    if (ctx.requiredCapability !== Capability.remediationExecute) {
      return {
        outcome: 'ALLOW',
        reason: {
          policyId: this.id,
          code: 'POLICY_PASSED',
          message: 'Approval gate applies only to execution'
        }
      };
    }

    if (ctx.plan.version !== ctx.expectedVersion) {
      return {
        outcome: 'DENY',
        reason: {
          policyId: this.id,
          code: 'STALE_PLAN_VERSION',
          message: 'Approval does not apply to this plan version',
          data: { currentVersion: ctx.plan.version, expectedVersion: ctx.expectedVersion }
        }
      };
    }

    if (ctx.plan.state === 'APPROVED' && ctx.plan.approvalAction === 'APPROVE') {
      return {
        outcome: 'ALLOW',
        reason: {
          policyId: this.id,
          code: 'APPROVAL_GRANTED',
          message: `Plan ${ctx.plan.version} is approved by ${ctx.plan.approvedBy ?? 'unknown'}`
        }
      };
    }

    return {
      outcome: 'REQUIRE_APPROVAL',
      reason: {
        policyId: this.id,
        code: 'APPROVAL_REQUIRED',
        message: 'Human approval of this exact plan version is required before execution',
        data: { state: ctx.plan.state, approvalAction: ctx.plan.approvalAction }
      }
    };
  }
};
