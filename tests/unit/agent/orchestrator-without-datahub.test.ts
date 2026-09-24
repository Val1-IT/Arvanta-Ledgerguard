import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { investigate } from '@ledgerguard/core';
import { runInvestigation } from '../../../src/agent/orchestrator';
import { DeterministicTestModel } from '../../../src/agent/model-test';
import {
  applyConversionErrorToFixture,
  buildHealthyFixture,
  toInvestigationInput
} from '../../../packages/core/test/fixtures';

function mockPool(): Pool {
  return {
    query: async () => ({ rows: [], rowCount: 0 })
  } as unknown as Pool;
}

describe('investigation without DataHub', () => {
  it('deterministic engine still produces UNIT_CONVERSION_MISMATCH without any catalog', () => {
    const engine = investigate(toInvestigationInput(applyConversionErrorToFixture(buildHealthyFixture())));
    expect(engine.incidentType).toBe('UNIT_CONVERSION_MISMATCH');
    expect(engine.financialImpact.primaryExposure).toBeTruthy();
  });

  it('orchestrator persists engine findings when the catalog is not configured', async () => {
    const input = toInvestigationInput(applyConversionErrorToFixture(buildHealthyFixture()));
    const record = await runInvestigation(
      {
        incidentId: 'incident-no-datahub',
        productId: 'prod-cement-40',
        triggerAsset: 'product_units',
        requestedBy: 'tester',
        mode: 'TEST'
      },
      {
        pool: mockPool(),
        model: new DeterministicTestModel(),
        loadInvestigationInput: async () => input,
        contextProvider: {
          readContext: async () => ({
            context: { assetsRead: [], owners: [], glossaryTerms: [], tags: [], lineagePath: [] },
            source: 'NOT_CONFIGURED',
            activityLog: []
          })
        },
        statusPublisher: null
      }
    );

    expect(record.stateHistory.some((entry) => entry.state === 'ENGINE_ANALYSIS_COMPLETED')).toBe(true);
    expect(record.output?.engineResultReference.incidentType).toBe('UNIT_CONVERSION_MISMATCH');
    expect(record.output?.datahubContext.assetsRead).toEqual([]);
    expect(record.output?.provenance?.datahubSource).toBe('NOT_CONFIGURED');
    expect(record.output?.provenance?.fallbackUsed).toBe(false);
  });
});
