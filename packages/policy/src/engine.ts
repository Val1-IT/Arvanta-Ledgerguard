import {
  Capability,
  createPolicyId,
  type PolicyConfig,
  type PolicyDecision,
  type PolicyEvaluationContext,
  type PolicyOutcome,
  DEFAULT_POLICY_CONFIG
} from './primitives';
import { approvalPolicy } from './policies/approval';
import { capabilityPolicy } from './policies/capability';
import { evidencePolicy } from './policies/evidence';
import { idempotencyPolicy } from './policies/idempotency';
import { impactPolicy } from './policies/impact';
import type { PolicyRule } from './policies/types';
import { verificationPolicy } from './policies/verification';

const RANK: Record<PolicyOutcome, number> = {
  ALLOW: 0,
  REQUIRE_APPROVAL: 1,
  DENY: 2
};

export class DeterministicPolicyEngine {
  constructor(private readonly rules: PolicyRule[] = defaultPolicies()) {}

  evaluate(ctx: PolicyEvaluationContext): PolicyDecision {
    const reasons = [];
    let outcome: PolicyOutcome = 'ALLOW';

    for (const rule of this.rules) {
      const result = rule.evaluate(ctx);
      reasons.push(result.reason);
      if (RANK[result.outcome] > RANK[outcome]) {
        outcome = result.outcome;
      }
    }

    return {
      id: createPolicyId(),
      decidedAt: ctx.authority.issuedAt,
      outcome,
      reasons,
      policyIds: this.rules.map((rule) => rule.id),
      approval: {
        required: outcome === 'REQUIRE_APPROVAL',
        requiredCapability: Capability.remediationApprove,
        reasons: reasons.filter((reason) => reason.code === 'APPROVAL_REQUIRED' || reason.code === 'IMPACT_THRESHOLD_EXCEEDED').map((reason) => reason.code)
      }
    };
  }
}

export function defaultPolicies(): PolicyRule[] {
  return [evidencePolicy, verificationPolicy, impactPolicy, capabilityPolicy, approvalPolicy, idempotencyPolicy];
}

export function evaluateExecutionPolicy(
  ctx: Omit<PolicyEvaluationContext, 'requiredCapability' | 'config'> & { config?: PolicyConfig }
): PolicyDecision {
  return new DeterministicPolicyEngine().evaluate({
    ...ctx,
    requiredCapability: Capability.remediationExecute,
    config: ctx.config ?? DEFAULT_POLICY_CONFIG
  });
}
