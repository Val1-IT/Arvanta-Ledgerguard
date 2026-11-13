/**
 * Browser port of `@ledgerguard/policy` (packages/policy).
 *
 * Outcomes, reason codes, messages, and the six default rules stay identical to
 * the TypeScript package. `tests/policy-parity.test.mjs` compares the two on a
 * shared fixture set. Do not invent new policy behavior here.
 */

export const Capability = {
  investigationRead: "investigation.read",
  remediationPropose: "remediation.propose",
  remediationApprove: "remediation.approve",
  remediationExecute: "remediation.execute",
};

export const DEFAULT_POLICY_CONFIG = {
  financialApprovalThreshold: null,
  currency: "IDR",
};

export function createPolicyId() {
  return `pol_${crypto.randomUUID().replaceAll("-", "")}`;
}

export class PolicyDeniedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "PolicyDeniedError";
    this.details = details;
  }
}

export function parseAuthorityContext(value) {
  if (value == null || typeof value !== "object") {
    throw new Error("Invalid authority context");
  }
  const allowedActors = new Set(["human", "system", "agent"]);
  const allowedCapabilities = new Set(Object.values(Capability));
  if (typeof value.actorId !== "string" || value.actorId.length < 1) {
    throw new Error("Invalid authority context");
  }
  if (!allowedActors.has(value.actorType)) {
    throw new Error("Invalid authority context");
  }
  if (!Array.isArray(value.capabilities) || value.capabilities.some((item) => !allowedCapabilities.has(item))) {
    throw new Error("Invalid authority context");
  }
  if (value.source !== "trusted_runtime") {
    throw new Error("Invalid authority context");
  }
  if (typeof value.issuedAt !== "string" || Number.isNaN(Date.parse(value.issuedAt))) {
    throw new Error("Invalid authority context");
  }
  return {
    actorId: value.actorId,
    actorType: value.actorType,
    capabilities: [...value.capabilities],
    source: "trusted_runtime",
    issuedAt: value.issuedAt,
  };
}

export function hasCapability(authority, capability) {
  return authority.capabilities.includes(capability);
}

export function assertTrustedApprover(authority) {
  const parsed = parseAuthorityContext(authority);
  if (parsed.actorType === "agent") {
    throw new PolicyDeniedError("An AI agent cannot approve a remediation plan", {
      actorId: parsed.actorId,
      actorType: parsed.actorType,
    });
  }
  if (!hasCapability(parsed, Capability.remediationApprove)) {
    throw new PolicyDeniedError("Approver lacks remediation.approve", {
      actorId: parsed.actorId,
    });
  }
  return parsed;
}

export function assertTrustedExecutor(authority) {
  const parsed = parseAuthorityContext(authority);
  if (!hasCapability(parsed, Capability.remediationExecute)) {
    throw new PolicyDeniedError("Executor lacks remediation.execute", {
      actorId: parsed.actorId,
    });
  }
  return parsed;
}

export function trustedRuntimeAuthority(input) {
  return parseAuthorityContext({
    actorId: input.actorId,
    actorType: input.actorType,
    capabilities: input.capabilities,
    source: "trusted_runtime",
    issuedAt: input.issuedAt ?? new Date().toISOString(),
  });
}

export const evidencePolicy = {
  id: "policy.evidence_required",
  name: "Mutation requires supporting evidence",
  evaluate(ctx) {
    if (ctx.evidenceCount > 0) {
      return {
        outcome: "ALLOW",
        reason: {
          policyId: this.id,
          code: "POLICY_PASSED",
          message: "Proposed mutation is backed by collected evidence",
        },
      };
    }
    return {
      outcome: "DENY",
      reason: {
        policyId: this.id,
        code: "MISSING_EVIDENCE",
        message: "Mutation cannot execute without supporting evidence",
      },
    };
  },
};

export const verificationPolicy = {
  id: "policy.verification_required",
  name: "Mutation requires deterministic verification rules",
  evaluate(ctx) {
    if (ctx.verificationExpectationCount > 0) {
      return {
        outcome: "ALLOW",
        reason: {
          policyId: this.id,
          code: "POLICY_PASSED",
          message: "Required verification expectations are attached to the plan",
        },
      };
    }
    return {
      outcome: "DENY",
      reason: {
        policyId: this.id,
        code: "MISSING_VERIFICATION",
        message: "Mutation cannot execute without deterministic verification rules",
      },
    };
  },
};

export const impactPolicy = {
  id: "policy.financial_threshold",
  name: "Financial impact above threshold requires human approval",
  evaluate(ctx) {
    const threshold = ctx.config.financialApprovalThreshold;
    if (threshold === null || ctx.impactAmount <= threshold) {
      return {
        outcome: "ALLOW",
        reason: {
          policyId: this.id,
          code: "POLICY_PASSED",
          message: "Financial impact is within the configured auto-allow threshold",
          data: { impactAmount: ctx.impactAmount, threshold },
        },
      };
    }
    const approved =
      ctx.plan.state === "APPROVED" &&
      ctx.plan.approvalAction === "APPROVE" &&
      ctx.plan.version === ctx.expectedVersion;
    if (approved) {
      return {
        outcome: "ALLOW",
        reason: {
          policyId: this.id,
          code: "APPROVAL_GRANTED",
          message: "Impact exceeded threshold but a valid human approval is recorded for this plan version",
          data: { impactAmount: ctx.impactAmount, threshold, approvedBy: ctx.plan.approvedBy },
        },
      };
    }
    return {
      outcome: "REQUIRE_APPROVAL",
      reason: {
        policyId: this.id,
        code: "IMPACT_THRESHOLD_EXCEEDED",
        message: `Financial impact ${ctx.impactAmount} exceeds threshold ${threshold}`,
        data: { impactAmount: ctx.impactAmount, threshold, currency: ctx.config.currency },
      },
    };
  },
};

export const capabilityPolicy = {
  id: "policy.capability",
  name: "Actor must possess the required capability",
  evaluate(ctx) {
    if (ctx.authority.capabilities.includes(ctx.requiredCapability)) {
      return {
        outcome: "ALLOW",
        reason: {
          policyId: this.id,
          code: "POLICY_PASSED",
          message: `Actor ${ctx.authority.actorId} has ${ctx.requiredCapability}`,
          data: { source: ctx.authority.source },
        },
      };
    }
    return {
      outcome: "DENY",
      reason: {
        policyId: this.id,
        code: "INSUFFICIENT_CAPABILITY",
        message: `Actor ${ctx.authority.actorId} lacks ${ctx.requiredCapability}`,
        data: { required: ctx.requiredCapability, actorType: ctx.authority.actorType },
      },
    };
  },
};

export const approvalPolicy = {
  id: "policy.approval",
  name: "Execution requires approval of the exact plan version",
  evaluate(ctx) {
    if (ctx.requiredCapability !== Capability.remediationExecute) {
      return {
        outcome: "ALLOW",
        reason: {
          policyId: this.id,
          code: "POLICY_PASSED",
          message: "Approval gate applies only to execution",
        },
      };
    }
    if (ctx.plan.version !== ctx.expectedVersion) {
      return {
        outcome: "DENY",
        reason: {
          policyId: this.id,
          code: "STALE_PLAN_VERSION",
          message: "Approval does not apply to this plan version",
          data: { currentVersion: ctx.plan.version, expectedVersion: ctx.expectedVersion },
        },
      };
    }
    if (ctx.plan.state === "APPROVED" && ctx.plan.approvalAction === "APPROVE") {
      return {
        outcome: "ALLOW",
        reason: {
          policyId: this.id,
          code: "APPROVAL_GRANTED",
          message: `Plan ${ctx.plan.version} is approved by ${ctx.plan.approvedBy ?? "unknown"}`,
        },
      };
    }
    return {
      outcome: "REQUIRE_APPROVAL",
      reason: {
        policyId: this.id,
        code: "APPROVAL_REQUIRED",
        message: "Human approval of this exact plan version is required before execution",
        data: { state: ctx.plan.state, approvalAction: ctx.plan.approvalAction },
      },
    };
  },
};

export const idempotencyPolicy = {
  id: "policy.idempotency",
  name: "Completed idempotency keys cannot mutate again",
  evaluate(ctx) {
    if (ctx.idempotencyCompleted) {
      return {
        outcome: "DENY",
        reason: {
          policyId: this.id,
          code: "DUPLICATE_EXECUTION",
          message: "This execution key has already completed successfully",
        },
      };
    }
    return {
      outcome: "ALLOW",
      reason: {
        policyId: this.id,
        code: "POLICY_PASSED",
        message: "Idempotency key has not completed",
      },
    };
  },
};

const RANK = { ALLOW: 0, REQUIRE_APPROVAL: 1, DENY: 2 };

export function defaultPolicies() {
  return [evidencePolicy, verificationPolicy, impactPolicy, capabilityPolicy, approvalPolicy, idempotencyPolicy];
}

export class DeterministicPolicyEngine {
  constructor(rules = defaultPolicies()) {
    this.rules = rules;
  }

  evaluate(ctx) {
    const reasons = [];
    let outcome = "ALLOW";
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
        required: outcome === "REQUIRE_APPROVAL",
        requiredCapability: Capability.remediationApprove,
        reasons: reasons
          .filter((reason) => reason.code === "APPROVAL_REQUIRED" || reason.code === "IMPACT_THRESHOLD_EXCEEDED")
          .map((reason) => reason.code),
      },
    };
  }
}

export function evaluateExecutionPolicy(ctx) {
  return new DeterministicPolicyEngine().evaluate({
    ...ctx,
    requiredCapability: Capability.remediationExecute,
    config: ctx.config ?? DEFAULT_POLICY_CONFIG,
  });
}
