import { isDeepStrictEqual } from 'node:util';
import type { ConstrainedAction, ConstrainedActionAdapter } from '@ledgerguard/core';
import { ApprovalRequiredError } from '@ledgerguard/policy';
import { RemoteActionBindingSchema, type RemediationPlanRecord, type RemoteActionBinding } from './types';

/** Capture this snapshot when creating the DRAFT, before presenting it for human approval.
 * The persisted binding has no update API. Changed intent requires a new plan and approval.
 */
export async function prepareRemoteActionBinding(
  adapter: ConstrainedActionAdapter,
  action: ConstrainedAction
): Promise<RemoteActionBinding> {
  // Snapshot caller-owned objects before awaiting validation or I/O.
  const actionJson = JSON.stringify(action);
  const snapshot = JSON.parse(actionJson) as ConstrainedAction;
  const validation = await adapter.validate(snapshot);
  if (!validation.ok) throw new Error(validation.reason);
  return RemoteActionBindingSchema.parse({
    systemId: adapter.meta.systemId,
    systemType: adapter.meta.systemType,
    actionJson,
    expectedFingerprint: await adapter.fingerprint(snapshot)
  });
}

export function assertRemoteActionBinding(
  plan: RemediationPlanRecord,
  adapter: ConstrainedActionAdapter,
  action: ConstrainedAction,
  expectedFingerprint: string
): void {
  const binding = plan.remoteActionBinding;
  if (!binding) {
    throw new ApprovalRequiredError('Remote action was not bound before approval; create and approve a new plan', { planId: plan.id });
  }
  let matches = false;
  try {
    matches = isDeepStrictEqual(JSON.parse(binding.actionJson), JSON.parse(JSON.stringify(action)));
  } catch {
    // Malformed persisted or caller input must never reach an adapter.
  }
  if (!matches || binding.systemId !== adapter.meta.systemId || binding.systemType !== adapter.meta.systemType ||
      binding.expectedFingerprint !== expectedFingerprint) {
    throw new ApprovalRequiredError('Remote action, adapter, or source fingerprint differs from the approved snapshot', { planId: plan.id });
  }
}
