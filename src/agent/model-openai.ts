import OpenAI from 'openai';
import { ModelOutputParseError, type InvestigationModel } from './model';
import {
  INVESTIGATION_OUTPUT_JSON_SCHEMA,
  INVESTIGATION_TOOL_NAME
} from './model-output-json-schema';
import { ModelInvestigationOutputSchema, type ModelInvestigationOutput } from './types';
import { SYSTEM_PROMPT, buildUserPrompt, type InvestigationFactsForModel } from './prompts/investigation-v1';

// ---------------------------------------------------------------------------
// OpenAI-backed InvestigationModel. Structured output is forced via a required
// tool/function call (same contract as AnthropicInvestigationModel). Zod
// validation remains the final gate — missing or malformed tool arguments
// throw ModelOutputParseError. Raw provider responses and credentials are
// never persisted by this module.
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'gpt-4o-mini';

export interface OpenAIInvestigationModelOptions {
  apiKey?: string;
  model?: string;
  /** Injectable client for unit tests — never used in production paths. */
  client?: OpenAI;
}

export class OpenAIInvestigationModel implements InvestigationModel {
  readonly source = 'OPENAI' as const;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAIInvestigationModelOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey?.trim()) {
      throw new Error('OPENAI_API_KEY is not set; the real investigation model cannot be constructed.');
    }
    this.client = options.client ?? new OpenAI({ apiKey });
    this.model = options.model ?? process.env.OPENAI_MODEL ?? process.env.LLM_MODEL ?? DEFAULT_MODEL;
  }

  async generateInvestigation(facts: InvestigationFactsForModel): Promise<ModelInvestigationOutput> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(facts) }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: INVESTIGATION_TOOL_NAME,
            description: 'Submit the structured investigation output. This is the only way to respond.',
            parameters: INVESTIGATION_OUTPUT_JSON_SCHEMA
          }
        }
      ],
      tool_choice: { type: 'function', function: { name: INVESTIGATION_TOOL_NAME } }
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.find(
      (call) => call.type === 'function' && call.function.name === INVESTIGATION_TOOL_NAME
    );
    if (!toolCall || toolCall.type !== 'function') {
      throw new ModelOutputParseError('OpenAI response did not include the expected tool call', null);
    }

    const rawArgs = toolCall.function.arguments;
    if (!rawArgs?.trim()) {
      throw new ModelOutputParseError('OpenAI tool call arguments were empty', null);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawArgs);
    } catch (error) {
      throw new ModelOutputParseError('OpenAI tool call arguments were not valid JSON', error);
    }

    const parsed = ModelInvestigationOutputSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new ModelOutputParseError('OpenAI tool call arguments failed schema validation', parsed.error);
    }
    return parsed.data;
  }
}
