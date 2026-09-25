import type { PolicyRule } from './types';

export const idempotencyPolicy: PolicyRule = {
  id: 'policy.idempotency',
  name: 'Completed idempotency keys cannot mutate again',
  evaluate(ctx) {
    if (ctx.idempotencyCompleted) {
      return {
        outcome: 'DENY',
        reason: {
          policyId: this.id,
          code: 'DUPLICATE_EXECUTION',
          message: 'This execution key has already completed successfully'
        }
      };
    }
    return {
      outcome: 'ALLOW',
      reason: {
        policyId: this.id,
        code: 'POLICY_PASSED',
        message: 'Idempotency key has not completed'
      }
    };
  }
};
