// ---------------------------------------------------------------------------
// Shared JSON Schema mirror of ModelInvestigationOutputSchema. Used only to
// shape structured-output / tool contracts for live providers (Anthropic tool
// input_schema, OpenAI function parameters). Zod validation in
// ModelInvestigationOutputSchema remains the authoritative runtime gate.
// ---------------------------------------------------------------------------

export const INVESTIGATION_TOOL_NAME = 'submit_investigation';

export const INVESTIGATION_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'evidenceSufficiency',
    'rootCauseExplanation',
    'businessImpactExplanation',
    'remediationRationale',
    'recommendedNextStep',
    'citedAssets',
    'citedOwners',
    'citedGlossaryTerms',
    'citedTags',
    'citedLineagePath',
    'citedNominalFigures',
    'citedRecordCounts',
    'citedCorrectionTargets',
    'citedEvidenceRecords'
  ],
  properties: {
    schemaVersion: { type: 'string', enum: ['1.0'] },
    evidenceSufficiency: {
      type: 'object',
      additionalProperties: false,
      required: ['sufficient', 'confidence', 'missingEvidence'],
      properties: {
        sufficient: { type: 'boolean' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        missingEvidence: { type: 'array', items: { type: 'string' } }
      }
    },
    rootCauseExplanation: { type: 'string' },
    businessImpactExplanation: { type: 'string' },
    remediationRationale: { type: 'string' },
    recommendedNextStep: {
      type: 'string',
      enum: ['REQUEST_APPROVAL', 'COLLECT_MORE_EVIDENCE', 'ESCALATE_TO_OWNER', 'NO_ACTION_REQUIRED']
    },
    citedAssets: { type: 'array', items: { type: 'string' } },
    citedOwners: { type: 'array', items: { type: 'string' } },
    citedGlossaryTerms: { type: 'array', items: { type: 'string' } },
    citedTags: { type: 'array', items: { type: 'string' } },
    citedLineagePath: { type: 'array', items: { type: 'string' } },
    citedNominalFigures: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'value'],
        properties: { label: { type: 'string' }, value: { type: 'string' } }
      }
    },
    citedRecordCounts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'value'],
        properties: { label: { type: 'string' }, value: { type: 'number' } }
      }
    },
    citedCorrectionTargets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['table', 'recordId'],
        properties: { table: { type: 'string' }, recordId: { type: 'string' } }
      }
    },
    citedEvidenceRecords: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['table', 'recordId'],
        properties: { table: { type: 'string' }, recordId: { type: 'string' } }
      }
    }
  }
} as const;
