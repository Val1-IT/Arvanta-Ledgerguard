import { describe, expect, it } from 'vitest';
import { reconcile } from '../../../src/agent/reconciliation';
import { buildDataHubContextFixture, buildEngineResultFixture, buildModelOutputFixture } from './fixtures';

// ---------------------------------------------------------------------------
// reconcile() is the gate between "what the model said" and "what gets
// persisted or written back" (src/agent/reconciliation.ts). Test 1 proves the
// happy path passes all 7 checks; tests 2-8 each construct one fabricated
// model output by hand and prove reconcile() fails the exact rule that
// fabrication violates, without collaterally failing an unrelated rule.
// ---------------------------------------------------------------------------

function otherChecksStillPass(result: ReturnType<typeof reconcile>, failingRule: string): boolean {
  return result.checks.filter((c) => c.rule !== failingRule).every((c) => c.passed);
}

describe('reconcile — happy path', () => {
  it('passes all 7 checks when the model only cites facts that actually appear in the engine result and DataHub context', () => {
    const engineResult = buildEngineResultFixture();
    const datahub = buildDataHubContextFixture();
    const modelOutput = buildModelOutputFixture(engineResult, datahub);

    const result = reconcile(modelOutput, engineResult, datahub);

    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(7);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });
});

describe('reconcile — ASSETS_EXIST_IN_MCP', () => {
  it('fails when a cited asset was never read via MCP', () => {
    const engineResult = buildEngineResultFixture();
    const datahub = buildDataHubContextFixture();
    const modelOutput = buildModelOutputFixture(engineResult, datahub);
    modelOutput.citedAssets = [...modelOutput.citedAssets, 'fabricated_asset'];

    const result = reconcile(modelOutput, engineResult, datahub);

    expect(result.passed).toBe(false);
    const check = result.checks.find((c) => c.rule === 'ASSETS_EXIST_IN_MCP');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain('fabricated_asset');
    expect(otherChecksStillPass(result, 'ASSETS_EXIST_IN_MCP')).toBe(true);
  });
});

describe('reconcile — OWNERS_FROM_DATAHUB', () => {
  it('fails when a cited owner was never returned by DataHub', () => {
    const engineResult = buildEngineResultFixture();
    const datahub = buildDataHubContextFixture();
    const modelOutput = buildModelOutputFixture(engineResult, datahub);
    modelOutput.citedOwners = [...modelOutput.citedOwners, 'owner:fabricated'];

    const result = reconcile(modelOutput, engineResult, datahub);

    expect(result.passed).toBe(false);
    const check = result.checks.find((c) => c.rule === 'OWNERS_FROM_DATAHUB');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain('owner:fabricated');
    expect(otherChecksStillPass(result, 'OWNERS_FROM_DATAHUB')).toBe(true);
  });
});

describe('reconcile — NOMINAL_FIGURES_MATCH_ENGINE', () => {
  it('fails when a cited nominal figure does not equal any value in the engine result', () => {
    const engineResult = buildEngineResultFixture();
    const datahub = buildDataHubContextFixture();
    const modelOutput = buildModelOutputFixture(engineResult, datahub);
    modelOutput.citedNominalFigures = [
      ...modelOutput.citedNominalFigures,
      { label: 'primaryExposure', value: '999999999.99' }
    ];

    const result = reconcile(modelOutput, engineResult, datahub);

    expect(result.passed).toBe(false);
    const check = result.checks.find((c) => c.rule === 'NOMINAL_FIGURES_MATCH_ENGINE');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain('999999999.99');
    expect(otherChecksStillPass(result, 'NOMINAL_FIGURES_MATCH_ENGINE')).toBe(true);
  });
});

describe('reconcile — RECORD_COUNTS_MATCH_ENGINE', () => {
  it('fails when a cited record count does not equal any count in the engine result', () => {
    const engineResult = buildEngineResultFixture();
    const datahub = buildDataHubContextFixture();
    const modelOutput = buildModelOutputFixture(engineResult, datahub);
    modelOutput.citedRecordCounts = [...modelOutput.citedRecordCounts, { label: 'correctionTargetCount', value: 42 }];

    const result = reconcile(modelOutput, engineResult, datahub);

    expect(result.passed).toBe(false);
    const check = result.checks.find((c) => c.rule === 'RECORD_COUNTS_MATCH_ENGINE');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain('42');
    expect(otherChecksStillPass(result, 'RECORD_COUNTS_MATCH_ENGINE')).toBe(true);
  });
});

describe('reconcile — LINEAGE_MATCHES_MCP', () => {
  it('fails when the cited lineage path contains a hop that is not in the real MCP lineage path', () => {
    const engineResult = buildEngineResultFixture();
    const datahub = buildDataHubContextFixture();
    const modelOutput = buildModelOutputFixture(engineResult, datahub);
    modelOutput.citedLineagePath = [...modelOutput.citedLineagePath, 'fabricated_downstream_asset'];

    const result = reconcile(modelOutput, engineResult, datahub);

    expect(result.passed).toBe(false);
    const check = result.checks.find((c) => c.rule === 'LINEAGE_MATCHES_MCP');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain('fabricated_downstream_asset');
    expect(otherChecksStillPass(result, 'LINEAGE_MATCHES_MCP')).toBe(true);
  });
});

describe('reconcile — CORRECTION_TARGETS_MATCH_ENGINE', () => {
  it('fails when a cited correction target was not actually classified as one by the engine', () => {
    const engineResult = buildEngineResultFixture();
    const datahub = buildDataHubContextFixture();
    const modelOutput = buildModelOutputFixture(engineResult, datahub);
    modelOutput.citedCorrectionTargets = [
      ...modelOutput.citedCorrectionTargets,
      { table: 'gross_margin_report', recordId: 'not-a-real-correction-target' }
    ];

    const result = reconcile(modelOutput, engineResult, datahub);

    expect(result.passed).toBe(false);
    const check = result.checks.find((c) => c.rule === 'CORRECTION_TARGETS_MATCH_ENGINE');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain('not-a-real-correction-target');
    expect(otherChecksStillPass(result, 'CORRECTION_TARGETS_MATCH_ENGINE')).toBe(true);
  });
});

describe('reconcile — NO_EVIDENCE_MISCLASSIFIED_AS_CORRECTION', () => {
  it('fails when the model cites a correction-target record as evidence instead', () => {
    const engineResult = buildEngineResultFixture();
    const datahub = buildDataHubContextFixture();
    const modelOutput = buildModelOutputFixture(engineResult, datahub);
    // engineResult.recordImpact.correctionTargets[0] is a real correction target,
    // not evidence — citing it as evidence must be rejected without touching
    // CORRECTION_TARGETS_MATCH_ENGINE (citedCorrectionTargets is untouched).
    modelOutput.citedEvidenceRecords = [...modelOutput.citedEvidenceRecords, engineResult.recordImpact.correctionTargets[0]];

    const result = reconcile(modelOutput, engineResult, datahub);

    expect(result.passed).toBe(false);
    const check = result.checks.find((c) => c.rule === 'NO_EVIDENCE_MISCLASSIFIED_AS_CORRECTION');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain('pu-carton');
    expect(otherChecksStillPass(result, 'NO_EVIDENCE_MISCLASSIFIED_AS_CORRECTION')).toBe(true);
  });
});
