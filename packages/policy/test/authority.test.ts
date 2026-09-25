import { describe, expect, it } from 'vitest';
import {
  Capability,
  assertTrustedApprover,
  PolicyDeniedError,
  trustedRuntimeAuthority
} from '@ledgerguard/policy';

describe('trusted approver', () => {
  it('accepts a human with remediation.approve from trusted_runtime', () => {
    const authority = assertTrustedApprover(
      trustedRuntimeAuthority({
        actorId: 'controller',
        actorType: 'human',
        capabilities: [Capability.remediationApprove]
      })
    );
    expect(authority.actorType).toBe('human');
  });

  it('rejects an agent even if capabilities list includes approve', () => {
    expect(() =>
      assertTrustedApprover({
        actorId: 'narrator',
        actorType: 'agent',
        capabilities: [Capability.remediationApprove, Capability.remediationExecute],
        source: 'trusted_runtime',
        issuedAt: new Date().toISOString()
      })
    ).toThrow(PolicyDeniedError);
  });
});
