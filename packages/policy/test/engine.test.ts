import { describe, expect, it } from 'vitest';
import {
  Capability,
  evaluateExecutionPolicy,
  parseAuthorityContext,
  trustedRuntimeAuthority,
  type PolicyEvaluationContext
} from '@ledgerguard/policy';

function baseCtx(overrides: Partial<PolicyEvaluationContext> = {}): PolicyEvaluationContext {
  return {
    evidenceCount: 3,
    verificationExpectationCount: 5,
    impactAmount: 500_000,
    authority: trustedRuntimeAuthority({
      actorId: 'controller',
      actorType: 'human',
      capabilities: [Capability.remediationExecute, Capability.remediationApprove]
    }),
    requiredCapability: Capability.remediationExecute,
    plan: {
      state: 'APPROVED',
      version: 3,
      approvalAction: 'APPROVE',
      approvedBy: 'controller'
    },
    expectedVersion: 3,
    config: { financialApprovalThreshold: null, currency: 'IDR' },
    idempotencyCompleted: false,
    ...overrides
  };
}

describe('deterministic policy engine', () => {
  it('allows an evidenced, verified, approved execution', () => {
    const decision = evaluateExecutionPolicy(baseCtx());
    expect(decision.outcome).toBe('ALLOW');
    expect(decision.reasons.every((reason) => reason.code !== 'MISSING_EVIDENCE')).toBe(true);
  });

  it('denies mutation with no evidence', () => {
    const decision = evaluateExecutionPolicy(baseCtx({ evidenceCount: 0 }));
    expect(decision.outcome).toBe('DENY');
    expect(decision.reasons.some((reason) => reason.code === 'MISSING_EVIDENCE')).toBe(true);
  });

  it('denies mutation with no verification rules', () => {
    const decision = evaluateExecutionPolicy(baseCtx({ verificationExpectationCount: 0 }));
    expect(decision.outcome).toBe('DENY');
    expect(decision.reasons.some((reason) => reason.code === 'MISSING_VERIFICATION')).toBe(true);
  });

  it('requires approval when impact exceeds the configured threshold', () => {
    const decision = evaluateExecutionPolicy(
      baseCtx({
        plan: { state: 'DRAFT', version: 1, approvalAction: null, approvedBy: null },
        expectedVersion: 1,
        config: { financialApprovalThreshold: 1000, currency: 'IDR' },
        impactAmount: 50_000
      })
    );
    expect(decision.outcome).toBe('REQUIRE_APPROVAL');
    expect(decision.reasons.some((reason) => reason.code === 'IMPACT_THRESHOLD_EXCEEDED')).toBe(true);
  });

  it('denies missing capability', () => {
    const decision = evaluateExecutionPolicy(
      baseCtx({
        authority: trustedRuntimeAuthority({
          actorId: 'reader',
          actorType: 'human',
          capabilities: [Capability.investigationRead]
        })
      })
    );
    expect(decision.outcome).toBe('DENY');
    expect(decision.reasons.some((reason) => reason.code === 'INSUFFICIENT_CAPABILITY')).toBe(true);
  });

  it('denies a stale plan version even if previously approved', () => {
    const decision = evaluateExecutionPolicy(baseCtx({ expectedVersion: 2 }));
    expect(decision.outcome).toBe('DENY');
    expect(decision.reasons.some((reason) => reason.code === 'STALE_PLAN_VERSION')).toBe(true);
  });

  it('denies a completed idempotency key', () => {
    const decision = evaluateExecutionPolicy(baseCtx({ idempotencyCompleted: true }));
    expect(decision.outcome).toBe('DENY');
    expect(decision.reasons.some((reason) => reason.code === 'DUPLICATE_EXECUTION')).toBe(true);
  });
});

describe('authority parsing', () => {
  it('rejects unknown capabilities and agent-forged source values', () => {
    expect(() =>
      parseAuthorityContext({
        actorId: 'llm',
        actorType: 'agent',
        capabilities: ['god.mode'],
        source: 'trusted_runtime',
        issuedAt: new Date().toISOString()
      })
    ).toThrow();

    expect(() =>
      parseAuthorityContext({
        actorId: 'llm',
        actorType: 'human',
        capabilities: [Capability.remediationExecute],
        source: 'model_output',
        issuedAt: new Date().toISOString()
      })
    ).toThrow();
  });

  it('strips unknown fields so model JSON cannot inject extra privileges', () => {
    const parsed = parseAuthorityContext({
      actorId: 'controller',
      actorType: 'human',
      capabilities: [Capability.investigationRead],
      source: 'trusted_runtime',
      issuedAt: new Date().toISOString(),
      extraAdmin: true,
      capabilitiesForged: [Capability.remediationExecute]
    });
    expect(parsed.capabilities).toEqual([Capability.investigationRead]);
    expect('extraAdmin' in parsed).toBe(false);
  });
});
