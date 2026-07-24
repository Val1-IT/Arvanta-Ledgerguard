import Anthropic from '@anthropic-ai/sdk';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { ModelOutputParseError, type InvestigationModel } from './model';
import { ModelInvestigationOutputSchema, type ModelInvestigationOutput } from './types';
import { SYSTEM_PROMPT, buildUserPrompt, type InvestigationFactsForModel } from './prompts/investigation-v1';

// ---------------------------------------------------------------------------
// The single real-provider implementation of InvestigationModel (FASE 5:
// "gunakan satu provider utama yang credential-nya tersedia" — no
// multi-provider abstraction). Structured output is forced via a tool call
// so the model cannot reply with prose instead of the required shape; the
// Zod schema is still the final gate — a malformed or missing tool_use block
// throws ModelOutputParseError, which the orchestrator turns into
// MODEL_OUTPUT_INVALID rather than a fake success.
//
// This class is written to the real Anthropic Messages API but has NOT been
// exercised against a live API key in this environment (none is configured
// in .env — see docs/architecture/investigation-agent.md, "Blockers"). The
// deterministic test provider (model-test.ts) is what unit tests and the
// default example generation actually run against.
// ---------------------------------------------------------------------------

const TOOL_NAME = 'submit_investigation';
const DEFAULT_MODEL = 'claude-sonnet-5';

// Hand-written mirror of ModelInvestigationOutputSchema (src/agent/types.ts).
// Kept in sync manually since the two describe the same contract from two
// different angles (Anthropic tool input_schema vs. runtime Zod validation);
// Zod is what actually gates correctness, this only shapes what the model
// sees as its expected output structure.
const INPUT_SCHEMA = {
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
} satisfies Tool.InputSchema as Tool.InputSchema;

export interface AnthropicInvestigationModelOptions {
  apiKey?: string;
  model?: string;
}

export class AnthropicInvestigationModel implements InvestigationModel {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: AnthropicInvestigationModelOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set; the real investigation model cannot be constructed.');
    }
    this.client = new Anthropic({ apiKey });
    this.model = options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  }

  async generateInvestigation(facts: InvestigationFactsForModel): Promise<ModelInvestigationOutput> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(facts) }],
      tools: [
        {
          name: TOOL_NAME,
          description: 'Submit the structured investigation output. This is the only way to respond.',
          input_schema: INPUT_SCHEMA
        }
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME }
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === TOOL_NAME
    );
    if (!toolUse) {
      throw new ModelOutputParseError('Anthropic response did not include the expected tool_use block', response);
    }

    const parsed = ModelInvestigationOutputSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new ModelOutputParseError('Anthropic tool_use input failed schema validation', parsed.error);
    }
    return parsed.data;
  }
}
