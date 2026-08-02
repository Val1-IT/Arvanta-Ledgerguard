import { describe, expect, it } from 'vitest';
import type { RemediationPlanRecord } from '../../../src/remediation/types';
import {
  remediationActionsDisabledReason,
  remediationDecisionCopy,
  resolveRemediationAvailableActions
} from '../../../src/ui/server/remediation-actions-policy';

function plan(partial: Partial<RemediationPlanRecord> & Pick<RemediationPlanRecord, 'state'>): RemediationPlanRecord {
  return {
    schemaVersion: '1.0',
    id: 'plan-1',
    investigationId: 'inv-1',
    incidentId: 'inc-1',
    productId: 'prod-cement-40',
    triggerAsset: 'inventory_valuation',
    requestedBy: 'test',
    version: 1,
    proposedCorrections: [],
    verificationExpectations: [],
    approvalAction: null,
    approvedBy: null,
    approvalNote: null,
    approvedAt: null,
    executionResult: null,
    executedAt: null,
    verification: null,
    datahubWriteback: null,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
    ...partial
  };
}

describe('remediation available actions policy', () => {
  it('offers generate plan for completed REQUEST_APPROVAL investigation when demo mode is on', () => {
    const actions = resolveRemediationAvailableActions({
      investigationCompleted: true,
      recommendedNextStep: 'REQUEST_APPROVAL',
      plan: null,
      demoModeEnabled: true
    });
    expect(actions.canGeneratePlan).toBe(true);
    expect(actions.canApprove).toBe(false);
  });

  it('disables all mutating actions when DEMO_MODE is off', () => {
    const actions = resolveRemediationAvailableActions({
      investigationCompleted: true,
      recommendedNextStep: 'REQUEST_APPROVAL',
      plan: plan({ state: 'PENDING_APPROVAL' }),
      demoModeEnabled: false
    });
    expect(Object.values(actions).every((value) => value === false)).toBe(true);
    expect(
      remediationActionsDisabledReason({
        demoModeEnabled: false,
        investigationCompleted: true,
        recommendedNextStep: 'REQUEST_APPROVAL',
        plan: plan({ state: 'PENDING_APPROVAL' }),
        actions
      })
    ).toMatch(/demo mode/i);
  });

  it('exposes distinct approve / reject / keep-frozen while pending approval', () => {
    const actions = resolveRemediationAvailableActions({
      investigationCompleted: true,
      recommendedNextStep: 'REQUEST_APPROVAL',
      plan: plan({ state: 'PENDING_APPROVAL', version: 2 }),
      demoModeEnabled: true
    });
    expect(actions.canApprove).toBe(true);
    expect(actions.canReject).toBe(true);
    expect(actions.canKeepFrozen).toBe(true);
    expect(actions.canExecute).toBe(false);
  });

  it('allows execute only when approved', () => {
    const actions = resolveRemediationAvailableActions({
      investigationCompleted: true,
      recommendedNextStep: 'REQUEST_APPROVAL',
      plan: plan({ state: 'APPROVED', version: 3 }),
      demoModeEnabled: true
    });
    expect(actions.canExecute).toBe(true);
    expect(actions.canApprove).toBe(false);
  });

  it('allows write-back retry when resolved but DataHub sync failed', () => {
    const actions = resolveRemediationAvailableActions({
      investigationCompleted: true,
      recommendedNextStep: 'REQUEST_APPROVAL',
      plan: plan({
        state: 'RESOLVED',
        datahubWriteback: {
          attemptedAt: '2026-07-24T00:00:00.000Z',
          outcome: 'FAILED',
          atRiskTagRemoved: false,
          trustedTagAdded: false,
          message: 'bridge down'
        }
      }),
      demoModeEnabled: true
    });
    expect(actions.canWriteback).toBe(true);
    expect(remediationDecisionCopy(plan({ state: 'RESOLVED' }), 'REQUEST_APPROVAL', actions)).toMatch(/write-back/i);
  });
});
