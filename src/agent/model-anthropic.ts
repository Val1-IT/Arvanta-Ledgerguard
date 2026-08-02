import Anthropic from '@anthropic-ai/sdk';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { ModelOutputParseError, type InvestigationModel } from './model';
import {
  INVESTIGATION_OUTPUT_JSON_SCHEMA,
  INVESTIGATION_TOOL_NAME
} from './model-output-json-schema';
import { ModelInvestigationOutputSchema, type ModelInvestigationOutput } from './types';
import { SYSTEM_PROMPT, buildUserPrompt, type InvestigationFactsForModel } from './prompts/investigation-v1';

// ---------------------------------------------------------------------------
// Anthropic-backed InvestigationModel. Structured output is forced via a tool
// call; Zod remains the final gate. See also OpenAIInvestigationModel for the
// parallel OpenAI provider — both share INVESTIGATION_OUTPUT_JSON_SCHEMA.
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'claude-sonnet-5';

const INPUT_SCHEMA = INVESTIGATION_OUTPUT_JSON_SCHEMA as unknown as Tool.InputSchema;

export interface AnthropicInvestigationModelOptions {
  apiKey?: string;
  model?: string;
}

export class AnthropicInvestigationModel implements InvestigationModel {
  readonly source = 'ANTHROPIC' as const;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: AnthropicInvestigationModelOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set; the real investigation model cannot be constructed.');
    }
    this.client = new Anthropic({ apiKey });
    this.model = options.model ?? process.env.ANTHROPIC_MODEL ?? process.env.LLM_MODEL ?? DEFAULT_MODEL;
  }

  async generateInvestigation(facts: InvestigationFactsForModel): Promise<ModelInvestigationOutput> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(facts) }],
      tools: [
        {
          name: INVESTIGATION_TOOL_NAME,
          description: 'Submit the structured investigation output. This is the only way to respond.',
          input_schema: INPUT_SCHEMA
        }
      ],
      tool_choice: { type: 'tool', name: INVESTIGATION_TOOL_NAME }
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === 'tool_use' && block.name === INVESTIGATION_TOOL_NAME
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
