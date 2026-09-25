import type { PolicyEvaluationContext, PolicyOutcome, PolicyReason } from '../primitives';

export interface PolicyRule {
  id: string;
  name: string;
  evaluate(ctx: PolicyEvaluationContext): { outcome: PolicyOutcome; reason: PolicyReason };
}
