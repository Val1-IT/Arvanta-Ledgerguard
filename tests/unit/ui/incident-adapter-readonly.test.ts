import { describe, expect, it, vi } from 'vitest';
import type { InvestigationRunRecord } from '../../../src/agent/types';
import { buildIncidentDetailViewModel } from '../../../src/ui/server/incident-detail';

describe('incident adapter read-only contract', () => {
  it('buildIncidentDetailViewModel does not perform I/O or mutate inputs', () => {
    const run = {
      investigationId: 'id-1',
      incidentId: 'inc-1',
      input: {
        incidentId: 'inc-1',
        productId: 'prod-cement-40',
        triggerAsset: 'inventory_valuation',
        requestedBy: 'test',
        mode: 'TEST'
      },
      finalState: 'ENGINE_FAILED',
      output: null,
      error: {
        failureState: 'ENGINE_FAILED',
        message: 'engine failed',
        occurredAt: '2026-07-24T00:00:00.000Z'
      },
      stateHistory: [{ state: 'ENGINE_FAILED', at: '2026-07-24T00:00:00.000Z' }],
      createdAt: '2026-07-24T00:00:00.000Z'
    } satisfies InvestigationRunRecord;

    const frozen = Object.freeze(run);
    const query = vi.fn();
    const vm = buildIncidentDetailViewModel({
      run: frozen,
      engineReport: null,
      remediationPlan: null
    });

    expect(query).not.toHaveBeenCalled();
    expect(vm.uiFlags.showCompletionPanels).toBe(false);
    expect(vm.remediation.availableActions.canApprove).toBe(false);
    expect(vm.remediation.availableActions.canExecute).toBe(false);
  });
});

