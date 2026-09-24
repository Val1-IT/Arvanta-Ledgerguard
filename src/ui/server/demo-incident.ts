import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { SCHEMA_VERSION as AGENT_SCHEMA_VERSION, type InvestigationRunRecord } from '../../agent/types';
import { saveInvestigationRun } from '../../db/repositories/investigation-runs';
import { loadInvestigationInput } from '../../db/repositories/investigation';
import { investigate } from '@ledgerguard/core';

/**
 * Demo-only fallback when the full agent cannot complete (e.g. MCP unavailable).
 * Uses the live deterministic engine for numbers and a static DataHub citation
 * set so remediation remains REQUEST_APPROVAL — does not call the orchestrator.
 */
const DEMO_DATAHUB_CONTEXT = {
  assetsRead: [
    'urn:li:dataset:(urn:li:dataPlatform:postgres,ledgerguard.public.inventory_valuation,PROD)'
  ],
  owners: ['urn:li:corpGroup:data-platform', 'urn:li:corpGroup:finance-controller'],
  glossaryTerms: [
    'urn:li:glossaryTerm:FinanciallyTrustedDataset',
    'urn:li:glossaryTerm:InventoryValuation'
  ],
  tags: ['urn:li:tag:ERP', 'urn:li:tag:Finance', 'urn:li:tag:Inventory'],
  lineagePath: [
    'urn:li:dataset:(urn:li:dataPlatform:postgres,ledgerguard.public.inventory_valuation,PROD)',
    'urn:li:dataset:(urn:li:dataPlatform:postgres,ledgerguard.public.journal_entries,PROD)',
    'urn:li:dataset:(urn:li:dataPlatform:postgres,ledgerguard.public.gross_margin_report,PROD)'
  ]
} as const;

export async function persistDemoCompletedInvestigation(
  pool: Pool,
  parts: {
    incidentId: string;
    requestedBy: string;
  }
): Promise<InvestigationRunRecord> {
  const input = await loadInvestigationInput(pool);
  const engine = investigate(input);
  const investigationId = randomUUID();
  const now = new Date().toISOString();
  const hasIncident = engine.incidentType !== null;

  const record: InvestigationRunRecord = {
    investigationId,
    incidentId: parts.incidentId,
    input: {
      incidentId: parts.incidentId,
      productId: 'prod-cement-40',
      triggerAsset: 'inventory_valuation',
      requestedBy: parts.requestedBy,
      mode: 'TEST'
    },
    finalState: 'INVESTIGATION_COMPLETED',
    output: {
      schemaVersion: AGENT_SCHEMA_VERSION,
      investigationId,
      incidentId: parts.incidentId,
      status: 'COMPLETED',
      evidenceSufficiency: { sufficient: true, confidence: 0.95, missingEvidence: [] },
      rootCauseExplanation: engine.rootCause
        ? `The root cause is a mismatch on ${engine.rootCause.asset}.${engine.rootCause.field} for unit "${engine.rootCause.unitName}": expected ${engine.rootCause.expectedValue}, actual ${engine.rootCause.actualValue}.`
        : `No root cause was identified; overall status is ${engine.overallStatus}.`,
      businessImpactExplanation: `Primary exposure is ${engine.financialImpact.primaryExposure} ${engine.financialImpact.currency}.`,
      datahubContext: {
        assetsRead: [...DEMO_DATAHUB_CONTEXT.assetsRead],
        owners: [...DEMO_DATAHUB_CONTEXT.owners],
        glossaryTerms: [...DEMO_DATAHUB_CONTEXT.glossaryTerms],
        tags: [...DEMO_DATAHUB_CONTEXT.tags],
        lineagePath: [...DEMO_DATAHUB_CONTEXT.lineagePath]
      },
      provenance: {
        datahubSource: 'STATIC_DEMO_CONTEXT',
        modelSource: 'DETERMINISTIC_TEMPLATE',
        fallbackUsed: true
      },
      engineResultReference: {
        incidentType: engine.incidentType,
        overallStatus: engine.overallStatus,
        primaryExposure: engine.financialImpact.primaryExposure,
        currency: engine.financialImpact.currency,
        affectedRecordCount: engine.recordImpact.uniqueRecordCount,
        correctionTargetCount: engine.recordImpact.correctionTargetCount
      },
      remediationRationale: hasIncident
        ? 'Restore the conversion factor and regenerate downstream valuation and margin figures without rewriting posted journals.'
        : 'No remediable incident was detected.',
      recommendedNextStep: hasIncident ? 'REQUEST_APPROVAL' : 'NO_ACTION_REQUIRED',
      activityLog: [
        {
          seq: 1,
          tool: 'ui.demoIncidentFallback',
          startedAt: now,
          finishedAt: now,
          durationMs: 0,
          inputSummary: parts.incidentId,
          outputSummary: 'Completed via demo engine fallback (orchestrator/MCP unavailable).',
          status: 'OK',
          errorSanitized: null
        }
      ]
    },
    error: null,
    stateHistory: [{ state: 'INVESTIGATION_COMPLETED', at: now }],
    createdAt: now
  };

  await saveInvestigationRun(pool, record);
  return record;
}
