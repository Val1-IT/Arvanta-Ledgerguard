import type { PolicyRule } from './types';

export const verificationPolicy: PolicyRule = {
  id: 'policy.verification_required',
  name: 'Mutation requires deterministic verification rules',
  evaluate(ctx) {
    if (ctx.verificationExpectationCount > 0) {
      return {
        outcome: 'ALLOW',
        reason: {
          policyId: this.id,
          code: 'POLICY_PASSED',
          message: 'Required verification expectations are attached to the plan'
        }
      };
    }
    return {
      outcome: 'DENY',
      reason: {
        policyId: this.id,
        code: 'MISSING_VERIFICATION',
        message: 'Mutation cannot execute without deterministic verification rules'
      }
    };
  }
};
