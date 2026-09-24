import { Capability, trustedRuntimeAuthority, type AuthorityContext } from '@ledgerguard/policy';

export function incidentUiAuthority(): AuthorityContext {
  return trustedRuntimeAuthority({
    actorId: 'incident-ui',
    actorType: 'human',
    capabilities: [
      Capability.investigationRead,
      Capability.remediationPropose,
      Capability.remediationApprove,
      Capability.remediationExecute
    ]
  });
}

export function testHarnessAuthority(actorId = 'tester'): AuthorityContext {
  return trustedRuntimeAuthority({
    actorId,
    actorType: 'human',
    capabilities: [
      Capability.investigationRead,
      Capability.remediationPropose,
      Capability.remediationApprove,
      Capability.remediationExecute
    ]
  });
}
