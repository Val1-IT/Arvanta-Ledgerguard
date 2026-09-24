import type { PolicyRule } from './types';

export const capabilityPolicy: PolicyRule = {
  id: 'policy.capability',
  name: 'Actor must possess the required capability',
  evaluate(ctx) {
    if (ctx.authority.capabilities.includes(ctx.requiredCapability)) {
      return {
        outcome: 'ALLOW',
        reason: {
          policyId: this.id,
          code: 'POLICY_PASSED',
          message: `Actor ${ctx.authority.actorId} has ${ctx.requiredCapability}`,
          data: { source: ctx.authority.source }
        }
      };
    }
    return {
      outcome: 'DENY',
      reason: {
        policyId: this.id,
        code: 'INSUFFICIENT_CAPABILITY',
        message: `Actor ${ctx.authority.actorId} lacks ${ctx.requiredCapability}`,
        data: { required: ctx.requiredCapability, actorType: ctx.authority.actorType }
      }
    };
  }
};
