import { Capability, parseAuthorityContext, type AuthorityContext, type CapabilityName } from './primitives';
import { PolicyDeniedError } from './errors';

export function hasCapability(authority: AuthorityContext, capability: CapabilityName): boolean {
  return authority.capabilities.includes(capability);
}

export function assertTrustedApprover(authority: unknown): AuthorityContext {
  const parsed = parseAuthorityContext(authority);
  if (parsed.actorType === 'agent') {
    throw new PolicyDeniedError('An AI agent cannot approve a remediation plan', {
      actorId: parsed.actorId,
      actorType: parsed.actorType
    });
  }
  if (!hasCapability(parsed, Capability.remediationApprove)) {
    throw new PolicyDeniedError('Approver lacks remediation.approve', {
      actorId: parsed.actorId
    });
  }
  return parsed;
}

export function assertTrustedExecutor(authority: unknown): AuthorityContext {
  const parsed = parseAuthorityContext(authority);
  if (!hasCapability(parsed, Capability.remediationExecute)) {
    throw new PolicyDeniedError('Executor lacks remediation.execute', {
      actorId: parsed.actorId
    });
  }
  return parsed;
}

export function trustedRuntimeAuthority(input: {
  actorId: string;
  actorType: Exclude<AuthorityContext['actorType'], 'agent'>;
  capabilities: CapabilityName[];
  issuedAt?: string;
}): AuthorityContext {
  return parseAuthorityContext({
    actorId: input.actorId,
    actorType: input.actorType,
    capabilities: input.capabilities,
    source: 'trusted_runtime',
    issuedAt: input.issuedAt ?? new Date().toISOString()
  });
}
