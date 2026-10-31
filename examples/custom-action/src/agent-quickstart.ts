// Use LedgerGuard in your own agent: propose → require approval → approve → execute with key → retry denied.
import { executeConstrainedAction } from '@ledgerguard/core';
import { Capability, evaluateExecutionPolicy, trustedRuntimeAuthority } from '@ledgerguard/policy';
import { detectDuplicateInvoiceLine, MemoryInvoiceAdapter, scenario } from './demo';

export async function agentQuickstart() {
  const adapter = new MemoryInvoiceAdapter(scenario());
  const proposal = detectDuplicateInvoiceLine(adapter.ledger); // 1. agent proposes; a deterministic detector supplies the action
  if (!proposal) throw new Error('nothing to repair');
  const completedKeys = new Set<string>(); // your idempotency store
  const key = `reverse:${proposal.action.target.resourceId}`;
  const policy = (state: 'DRAFT' | 'APPROVED', approvedBy: string | null) => evaluateExecutionPolicy({
    evidenceCount: proposal.evidence.length,
    verificationExpectationCount: proposal.verificationExpectations.length,
    impactAmount: Number(proposal.financialImpact.primaryExposure),
    authority: trustedRuntimeAuthority({ actorId: 'controller', actorType: 'human', capabilities: [Capability.remediationExecute, Capability.remediationApprove] }),
    config: { financialApprovalThreshold: 1000, currency: 'IDR' },
    plan: { state, version: 1, approvalAction: approvedBy ? 'APPROVE' : null, approvedBy },
    expectedVersion: 1,
    idempotencyCompleted: completedKeys.has(key)
  }).outcome;

  const beforeApproval = policy('DRAFT', null); // 2. REQUIRE_APPROVAL: the model cannot self-approve
  const afterApproval = policy('APPROVED', 'controller'); // 3. a human approves this exact plan version
  if (afterApproval !== 'ALLOW') throw new Error(`policy: ${afterApproval}`);
  const result = await executeConstrainedAction(adapter, proposal.action, await adapter.fingerprint(proposal.action)); // 4. execute + verify
  if (result.verified) completedKeys.add(key);
  const retry = policy('APPROVED', 'controller'); // 5. same key again → DENY (DUPLICATE_EXECUTION)
  return { beforeApproval, afterApproval, execution: result.outcome, retry };
}

if (process.argv[1]?.endsWith('agent-quickstart.ts')) {
  agentQuickstart().then((r) => console.log(r), (e) => { console.error(e); process.exitCode = 1; });
}
