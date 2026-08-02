import { z } from 'zod';
import {
  FinancialImpactSchema,
  ProposedCorrectionSchema,
  RecordImpactSchema,
  RecordRefSchema,
  VerificationResultSchema
} from '../../engine/types';
import { ApprovalActionSchema, RemediationPlanStateSchema } from '../../remediation/types';

export const UiLabeledUrnSchema = z.object({
  urn: z.string(),
  label: z.string()
});

export const UiActivityLogEntrySchema = z.object({
  seq: z.number().int().positive(),
  tool: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  durationMs: z.number(),
  inputSummary: z.string(),
  outputSummary: z.string(),
  status: z.enum(['OK', 'ERROR']),
  errorSanitized: z.string().nullable()
});

export const UiActivityLogSourceSchema = z.enum([
  'output',
  'none'
]);

export const IncidentDetailViewModelSchema = z.object({
  schemaVersion: z.literal('1.0'),
  generatedAt: z.string(),

  // Route identity: investigation run id (durable persisted identity).
  id: z.string(),
  incidentId: z.string(),
  title: z.string(),
  severity: z.enum(['HEALTHY', 'DEGRADED', 'CRITICAL', 'UNKNOWN']),
  status: z.string(),
  investigationCompleted: z.boolean(),
  detectedAt: z.string(),
  ownerLabels: z.array(z.string()),
  recommendedNextStep: z.string().nullable(),
  primaryExposure: z.string().nullable(),
  currency: z.literal('IDR').nullable(),

  investigation: z.object({
    finalState: z.string(),
    outputStatus: z.string().nullable(),
    rootCauseSummary: z.string().nullable(),
    expectedValueProvenance: z
      .object({
        type: z.string(),
        recordId: z.string(),
        capturedAt: z.string(),
        evidenceReference: z.string(),
        expectedValue: z.string().nullable(),
        actualValue: z.string().nullable(),
        field: z.string().nullable(),
        asset: z.string().nullable()
      })
      .nullable(),
    evidenceSufficiency: z
      .object({
        sufficient: z.boolean(),
        confidence: z.number(),
        missingEvidence: z.array(z.string())
      })
      .nullable(),
    explanations: z.object({
      rootCause: z.string().nullable(),
      businessImpact: z.string().nullable(),
      remediationRationale: z.string().nullable()
    }),
    datahubContext: z.object({
      assets: z.array(UiLabeledUrnSchema),
      owners: z.array(UiLabeledUrnSchema),
      tags: z.array(UiLabeledUrnSchema),
      glossary: z.array(UiLabeledUrnSchema),
      lineage: z.array(UiLabeledUrnSchema)
    }),
    provenance: z
      .object({
        datahubSource: z.enum(['LIVE_MCP', 'STATIC_DEMO_CONTEXT']),
        modelSource: z.enum(['ANTHROPIC', 'OPENAI', 'DETERMINISTIC_TEMPLATE']),
        fallbackUsed: z.boolean()
      })
      .nullable(),
    stateHistory: z.array(z.object({ state: z.string(), at: z.string() })),
    activityLog: z.array(UiActivityLogEntrySchema),
    activityLogSource: UiActivityLogSourceSchema,
    activityLogNote: z.string().nullable(),
    failure: z
      .object({
        failureState: z.string(),
        message: z.string(),
        occurredAt: z.string()
      })
      .nullable()
  }),

  impact: z.object({
    engineAvailable: z.boolean(),
    financialImpact: FinancialImpactSchema.nullable(),
    recordImpact: RecordImpactSchema.nullable(),
    evidenceMovements: z.array(RecordRefSchema),
    evidenceJournals: z.array(RecordRefSchema),
    correctionTargets: z.array(RecordRefSchema),
    proposedCorrections: z.array(ProposedCorrectionSchema),
    lineageNodes: z.array(z.string()),
    primaryExposureTooltip: z.string()
  }),

  remediation: z.object({
    planAvailable: z.boolean(),
    planId: z.string().nullable(),
    state: RemediationPlanStateSchema.nullable(),
    version: z.number().int().nullable(),
    approvalAction: ApprovalActionSchema.nullable(),
    steps: z.array(ProposedCorrectionSchema),
    correctionTargets: z.array(RecordRefSchema),
    transactionSafetyNote: z.string(),
    journalPolicyNote: z.string(),
    availableDecision: z.string(),
    actionsEnabled: z.boolean(),
    actionsDisabledReason: z.string().nullable(),
    availableActions: z.object({
      canGeneratePlan: z.boolean(),
      canSubmitForApproval: z.boolean(),
      canApprove: z.boolean(),
      canReject: z.boolean(),
      canKeepFrozen: z.boolean(),
      canExecute: z.boolean(),
      canWriteback: z.boolean()
    }),
    planHistory: z.array(
      z.object({
        planId: z.string(),
        state: RemediationPlanStateSchema,
        version: z.number().int(),
        approvalAction: ApprovalActionSchema.nullable(),
        createdAt: z.string(),
        updatedAt: z.string(),
        executedAt: z.string().nullable(),
        verificationStatus: z.enum(['PASS', 'FAIL']).nullable(),
        isActive: z.boolean(),
        proposedCorrections: z.array(ProposedCorrectionSchema)
      })
    )
  }),

  resolution: z.object({
    remediationState: RemediationPlanStateSchema.nullable(),
    verification: VerificationResultSchema.nullable(),
    executionFailureReason: z.string().nullable(),
    executionFailureDetail: z.string().nullable(),
    executionSteps: z.array(
      z.object({
        sequence: z.number().int().positive(),
        action: z.string(),
        table: z.string(),
        recordId: z.string(),
        status: z.enum(['APPLIED', 'SKIPPED_NO_WRITE', 'FAILED']),
        detail: z.string()
      })
    ),
    datahubWriteback: z
      .object({
        attemptedAt: z.string(),
        outcome: z.enum(['SYNCED', 'FAILED']),
        atRiskTagRemoved: z.boolean(),
        trustedTagAdded: z.boolean(),
        message: z.string().nullable()
      })
      .nullable(),
    placeholder: z.string().nullable(),
    semantics: z.object({
      erpRestored: z.boolean(),
      verificationPassed: z.boolean(),
      datahubSynced: z.boolean(),
      datahubStale: z.boolean(),
      headline: z.string(),
      detail: z.string().nullable()
    })
  }),

  uiFlags: z.object({
    showCompletionPanels: z.boolean(),
    showFailurePanel: z.boolean(),
    resetBlocked: z.boolean(),
    backendUnavailable: z.boolean()
  })
});

export type IncidentDetailViewModel = z.infer<typeof IncidentDetailViewModelSchema>;
