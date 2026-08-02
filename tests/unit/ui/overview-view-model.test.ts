import { describe, expect, it } from 'vitest';
import { buildOverviewViewModel } from '../../../src/ui/server/overview';

describe('overview view model', () => {
  it('builds a healthy overview state', () => {
    const vm = buildOverviewViewModel({
      dataHealth: 'HEALTHY',
      inventoryValue: '72000000.00',
      grossMarginPercentage: '33.3333',
      datahubStatus: 'CONNECTED',
      datahubStatusDetail: 'ok',
      lastVerificationStatus: 'PASS',
      lastVerificationAt: '2026-07-24T00:00:00.000Z',
      lastVerificationFailingChecks: [],
      recentIncidents: [],
      demoModeEnabled: true,
      resetDisabledReason: null,
      simulateDisabledReason: null,
      backendAvailable: true,
      backendError: null
    });

    expect(vm.dataHealth).toBe('HEALTHY');
    expect(vm.activeIncidentCount).toBe(0);
    expect(vm.inventoryValueLabel).toContain('72.000.000');
    expect(vm.grossMarginLabel).toContain('33,33');
  });

  it('builds an at-risk overview state from critical incidents', () => {
    const vm = buildOverviewViewModel({
      dataHealth: 'CRITICAL',
      inventoryValue: '57600000.00',
      grossMarginPercentage: '20.0000',
      datahubStatus: 'CONNECTED',
      datahubStatusDetail: 'ok',
      lastVerificationStatus: 'FAIL',
      lastVerificationAt: '2026-07-24T00:00:00.000Z',
      lastVerificationFailingChecks: ['BASE_QUANTITY_CONSISTENCY'],
      recentIncidents: [
        {
          id: 'run-1',
          incidentId: 'inc-1',
          title: 'Unit conversion mismatch',
          overallStatus: 'CRITICAL',
          finalState: 'INVESTIGATION_COMPLETED',
          primaryExposure: '28800000.00',
          currency: 'IDR',
          createdAt: '2026-07-24T00:00:00.000Z',
          recommendedNextStep: 'REQUEST_APPROVAL'
        }
      ],
      demoModeEnabled: true,
      resetDisabledReason: null,
      simulateDisabledReason: null,
      backendAvailable: true,
      backendError: null
    });

    expect(vm.dataHealth).toBe('CRITICAL');
    expect(vm.activeIncidentCount).toBe(1);
    expect(vm.recentIncidents[0]?.primaryExposure).toBe('28800000.00');
  });
});
