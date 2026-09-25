import { describe, expect, it } from 'vitest';
import { Capability, PolicyDeniedError, parseAuthorityContext } from '@ledgerguard/policy';
import { assertTrustedApprover } from '@ledgerguard/policy';

describe('LLM output cannot become authority', () => {
  it('cannot mint trusted_runtime authority with extra capabilities via model JSON', () => {
    const modelOutput = {
      actorId: 'narrator',
      actorType: 'human',
      capabilities: [Capability.remediationExecute, Capability.remediationApprove],
      source: 'model_output',
      issuedAt: new Date().toISOString(),
      policyDecision: 'ALLOW'
    };
    expect(() => parseAuthorityContext(modelOutput)).toThrow();
  });

  it('cannot approve even when the model lists remediation.approve', () => {
    expect(() =>
      assertTrustedApprover({
        actorId: 'llm',
        actorType: 'agent',
        capabilities: [Capability.remediationApprove, Capability.remediationExecute],
        source: 'trusted_runtime',
        issuedAt: new Date().toISOString()
      })
    ).toThrow(PolicyDeniedError);
  });
});
