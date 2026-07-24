import { describe, expect, it } from 'vitest';
import { DeterministicTestModel } from '../../../src/agent/model-test';
import { buildDataHubContextFixture, buildEngineResultFixture } from './fixtures';

// ---------------------------------------------------------------------------
// DeterministicTestModel (src/agent/model-test.ts) is the no-network test
// provider used when mode=TEST. Its evidence-sufficiency judgment is a real
// piece of logic (not just a stub), so it is worth testing directly: it must
// flag insufficiency whenever DataHub context is incomplete, and every
// "cited*" field it emits must be copied verbatim from the facts it was
// given (reconcile() depends on that being true by construction).
// ---------------------------------------------------------------------------

describe('DeterministicTestModel — sufficient evidence', () => {
  it('judges evidence sufficient and recommends REQUEST_APPROVAL when an incident was detected and DataHub context is complete', async () => {
    const engineResult = buildEngineResultFixture();
    const datahubContext = buildDataHubContextFixture();
    const model = new DeterministicTestModel();

    const output = await model.generateInvestigation({
      incidentId: 'inc-1',
      triggerAsset: 'product_units',
      engineResult,
      datahubContext
    });

    expect(output.evidenceSufficiency.sufficient).toBe(true);
    expect(output.evidenceSufficiency.missingEvidence).toEqual([]);
    expect(output.recommendedNextStep).toBe('REQUEST_APPROVAL');
    expect(output.citedAssets).toEqual(datahubContext.assetsRead);
    expect(output.citedCorrectionTargets).toEqual(engineResult.recordImpact.correctionTargets);
  });
});

describe('DeterministicTestModel — insufficient evidence', () => {
  it('judges evidence insufficient and lists missing evidence when DataHub context has no assets or owners', async () => {
    const engineResult = buildEngineResultFixture();
    const datahubContext = { ...buildDataHubContextFixture(), assetsRead: [], owners: [] };
    const model = new DeterministicTestModel();

    const output = await model.generateInvestigation({
      incidentId: 'inc-1',
      triggerAsset: 'product_units',
      engineResult,
      datahubContext
    });

    expect(output.evidenceSufficiency.sufficient).toBe(false);
    expect(output.evidenceSufficiency.missingEvidence).toEqual(
      expect.arrayContaining(['no DataHub assets were read', 'no dataset owner was found in DataHub'])
    );
    expect(output.recommendedNextStep).toBe('COLLECT_MORE_EVIDENCE');
  });
});
