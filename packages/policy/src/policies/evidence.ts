import type { PolicyRule } from './types';

export const evidencePolicy: PolicyRule = {
  id: 'policy.evidence_required',
  name: 'Mutation requires supporting evidence',
  evaluate(ctx) {
    if (ctx.evidenceCount > 0) {
      return {
        outcome: 'ALLOW',
        reason: {
          policyId: this.id,
          code: 'POLICY_PASSED',
          message: 'Proposed mutation is backed by collected evidence'
        }
      };
    }
    return {
      outcome: 'DENY',
      reason: {
        policyId: this.id,
        code: 'MISSING_EVIDENCE',
        message: 'Mutation cannot execute without supporting evidence'
      }
    };
  }
};
