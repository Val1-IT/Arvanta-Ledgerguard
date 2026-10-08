import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { makePool } from '../../src/db/client';
import { createRemediationPlan, loadRemediationPlan } from '../../src/db/repositories/remediation-plans';
import { submitRemediationPlanForApproval, decideRemediationPlan } from '../../src/remediation/approve';
import { prepareRemoteActionBinding } from '../../src/remediation/remote-action-binding';
import { executeRemoteConstrainedAction } from '../../src/remediation/execute-remote-action';
import { testHarnessAuthority } from '../../src/remediation/trusted-authority';
import { adapterFromTransport, inventoryAdjustmentAction } from '../../packages/odoo/src/adapter';
import { FakeOdoo, DEMO_QUANT } from '../../packages/odoo/test/fake-odoo';
import { ApprovalRequiredError } from '@ledgerguard/policy';

// Real PostgreSQL persistence + explicitly simulated remote system. This is not
// evidence of Odoo atomicity; the separate Odoo suite tests the real JSON-2 API.
describe('remote execution with real PostgreSQL control plane', () => {
  const pool = makePool();
  afterAll(() => pool.end());
  it('persists the approved binding and verified receipt, then replays without a write', async () => {
    const odoo = new FakeOdoo(DEMO_QUANT);
    const adapter = adapterFromTransport(odoo.transport, 'isolated-odoo');
    const action = inventoryAdjustmentAction({ quantId: 42, productId: 7, locationId: 8, companyId: 1,
      expectedQuantity: 20, targetQuantity: 10, expectedWriteDate: DEMO_QUANT.writeDate });
    const binding = await prepareRemoteActionBinding(adapter, action);
    const id = `remote-pg-${randomUUID()}`;
    const stamp = new Date().toISOString();
    await createRemediationPlan(pool, {
      schemaVersion: '1.0', id, investigationId: id, incidentId: id, productId: 'fixture',
      triggerAsset: 'stock.quant', requestedBy: 'isolated-tester', state: 'DRAFT', version: 1,
      proposedCorrections: [], verificationExpectations: [], remoteActionBinding: binding,
      approvalAction: null, approvedBy: null, approvalNote: null, approvedAt: null,
      executionResult: null, executedAt: null, verification: null, datahubWriteback: null,
      createdAt: stamp, updatedAt: stamp
    });
    const pending = await submitRemediationPlanForApproval(pool, { planId: id, expectedVersion: 1 });
    const approved = await decideRemediationPlan(pool, { planId: id, expectedVersion: pending.version,
      action: 'APPROVE', decidedBy: 'isolated-tester' }, { authority: testHarnessAuthority() });
    expect(approved.remoteActionBinding).toEqual(binding);
    const input = { planId: id, expectedVersion: approved.version, action, expectedFingerprint: binding.expectedFingerprint };
    const deps = { pool, authority: testHarnessAuthority(), adapter };
    const alteredAction = { ...action, targetQuantity: 0 };
    await expect(executeRemoteConstrainedAction({ ...input, action: alteredAction }, deps))
      .rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(odoo.calls.filter((call) => call.method === 'write')).toHaveLength(0);
    expect((await executeRemoteConstrainedAction(input, deps)).outcome).toBe('EXECUTED');
    const persisted = await loadRemediationPlan(pool, id);
    expect(persisted?.state).toBe('RESOLVED');
    expect(persisted?.executionResult?.outcome).toBe('EXECUTED');
    expect(persisted?.verification?.result.overallStatus).toBe('PASS');
    expect((await executeRemoteConstrainedAction(input, deps)).outcome).toBe('ALREADY_EXECUTED');
    expect(odoo.calls.filter((call) => call.method === 'write')).toHaveLength(1);
  });
});
