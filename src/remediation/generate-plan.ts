import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { investigate } from '../engine/investigate';
import { loadInvestigationInput } from '../db/repositories/investigation';
import { loadInvestigationRun } from '../db/repositories/investigation-runs';
import { SCHEMA_VERSION, type RemediationPlanRecord } from './types';

// ---------------------------------------------------------------------------
// FASE 6 — deterministic remediation plan generator. This is the ONLY place a
// RemediationPlanRecord's proposedCorrections/verificationExpectations are
// produced, and they are always a verbatim copy of a fresh investigate() run
// — never LLM-authored, never hand-edited. The model layer (src/agent) has no
// involvement here at all: this module only calls the pure engine plus
// read-only repositories.
//
// `investigationId` must reference a FASE 5 investigation_runs row that
// reached INVESTIGATION_COMPLETED — a plan is never generated from a run that
// failed or is still in progress. The plan's proposedCorrections are re-derived
// fresh against current live data rather than trusted from that old run's
// stored output (InvestigationOutput does not carry proposedCorrections at
// all — only the deterministic IncidentInvestigationReport does), so the plan
// always reflects what remediation would do if it ran right now.
// ---------------------------------------------------------------------------

export interface GenerateRemediationPlanInput {
  investigationId: string;
  requestedBy: string;
}

export interface GenerateRemediationPlanDeps {
  pool: Pool;
  now?: () => Date;
  idGenerator?: () => string;
}

export class NoRemediableIncidentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoRemediableIncidentError';
  }
}

export async function generateRemediationPlan(
  input: GenerateRemediationPlanInput,
  deps: GenerateRemediationPlanDeps
): Promise<RemediationPlanRecord> {
  const now = deps.now ?? (() => new Date());
  const idGenerator = deps.idGenerator ?? randomUUID;

  const investigation = await loadInvestigationRun(deps.pool, input.investigationId);
  if (!investigation) {
    throw new Error(`Investigation not found: ${input.investigationId}`);
  }
  if (investigation.finalState !== 'INVESTIGATION_COMPLETED' || !investigation.output) {
    throw new Error(
      `Cannot generate a remediation plan from an investigation that did not complete (investigationId=${input.investigationId}, finalState=${investigation.finalState})`
    );
  }

  const engineInput = await loadInvestigationInput(deps.pool);
  const report = investigate(engineInput);

  if (report.incidentType === null || report.rootCause === null) {
    throw new NoRemediableIncidentError(
      'No remediable incident detected: investigate() found no root cause against current live data. ' +
        'Either the incident was already fixed, or this investigation is stale.'
    );
  }
  if (report.proposedCorrections.length === 0) {
    throw new NoRemediableIncidentError('investigate() produced no proposed corrections for the current root cause.');
  }

  const timestamp = now().toISOString();

  const plan: RemediationPlanRecord = {
    schemaVersion: SCHEMA_VERSION,
    id: idGenerator(),
    investigationId: input.investigationId,
    incidentId: investigation.incidentId,
    productId: investigation.input.productId,
    triggerAsset: investigation.input.triggerAsset,
    requestedBy: input.requestedBy,

    state: 'DRAFT',
    version: 1,

    proposedCorrections: report.proposedCorrections,
    verificationExpectations: report.verificationExpectations,

    approvalAction: null,
    approvedBy: null,
    approvalNote: null,
    approvedAt: null,

    executionResult: null,
    executedAt: null,

    verification: null,

    datahubWriteback: null,

    createdAt: timestamp,
    updatedAt: timestamp
  };

  return plan;
}
