import { describe, expect, it } from 'vitest';
import { InvestigationAgentInputSchema, InvestigationOutputSchema } from '../../../src/agent/types';
import { buildDataHubContextFixture, buildEngineResultFixture, buildModelOutputFixture } from './fixtures';

// ---------------------------------------------------------------------------
// InvestigationAgentInputSchema / InvestigationOutputSchema are the two
// client-facing boundaries the orchestrator enforces (src/agent/types.ts):
// nothing enters or leaves without passing Zod validation first.
// ---------------------------------------------------------------------------

describe('InvestigationAgentInputSchema and InvestigationOutputSchema', () => {
  it('each accept their fully-formed shape and reject a broken one (missing field / bad enum / unrecognized schemaVersion)', () => {
    const validInput = {
      incidentId: 'incident-1',
      productId: 'prod-cement-40',
      triggerAsset: 'product_units',
      requestedBy: 'tester',
      mode: 'TEST'
    };
    expect(InvestigationAgentInputSchema.safeParse(validInput).success).toBe(true);

    const { requestedBy: _omit, ...missingField } = validInput;
    expect(InvestigationAgentInputSchema.safeParse(missingField).success).toBe(false);
    expect(InvestigationAgentInputSchema.safeParse({ ...validInput, mode: 'PROD' }).success).toBe(false);

    const engineResult = buildEngineResultFixture();
    const datahubContext = buildDataHubContextFixture();
    const modelOutput = buildModelOutputFixture(engineResult, datahubContext);

    const output = {
      schemaVersion: modelOutput.schemaVersion,
      investigationId: 'inv-1',
      incidentId: 'incident-1',
      status: 'COMPLETED',
      evidenceSufficiency: modelOutput.evidenceSufficiency,
      rootCauseExplanation: modelOutput.rootCauseExplanation,
      businessImpactExplanation: modelOutput.businessImpactExplanation,
      datahubContext,
      engineResultReference: {
        incidentType: engineResult.incidentType,
        overallStatus: engineResult.overallStatus,
        primaryExposure: engineResult.financialImpact.primaryExposure,
        currency: engineResult.financialImpact.currency,
        affectedRecordCount: engineResult.blastRadius.affectedRecordCount,
        correctionTargetCount: engineResult.recordImpact.correctionTargetCount
      },
      remediationRationale: modelOutput.remediationRationale,
      recommendedNextStep: modelOutput.recommendedNextStep,
      activityLog: []
    };

    expect(InvestigationOutputSchema.safeParse(output).success).toBe(true);
    expect(InvestigationOutputSchema.safeParse({ ...output, schemaVersion: '2.0' }).success).toBe(false);
  });
});
