import { describe, expect, it, vi } from 'vitest';
import { ModelOutputParseError } from '../../../src/agent/model';
import { OpenAIInvestigationModel } from '../../../src/agent/model-openai';
import { INVESTIGATION_TOOL_NAME } from '../../../src/agent/model-output-json-schema';
import { buildDataHubContextFixture, buildEngineResultFixture, buildModelOutputFixture } from './fixtures';

function validToolArguments(): string {
  const engine = buildEngineResultFixture();
  const datahub = buildDataHubContextFixture();
  return JSON.stringify(buildModelOutputFixture(engine, datahub));
}

function makeFacts() {
  return {
    incidentId: 'incident-openai-unit-test',
    triggerAsset: 'inventory_valuation',
    engineResult: buildEngineResultFixture(),
    datahubContext: buildDataHubContextFixture()
  };
}

describe('OpenAIInvestigationModel', () => {
  it('parses a valid structured tool response', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            tool_calls: [
              {
                type: 'function',
                function: {
                  name: INVESTIGATION_TOOL_NAME,
                  arguments: validToolArguments()
                }
              }
            ]
          }
        }
      ]
    });

    const model = new OpenAIInvestigationModel({
      apiKey: 'sk-test',
      client: { chat: { completions: { create } } } as never
    });

    const output = await model.generateInvestigation(makeFacts());
    expect(output.schemaVersion).toBe('1.0');
    expect(output.recommendedNextStep).toBeTruthy();
    expect(create).toHaveBeenCalledOnce();
  });

  it('throws ModelOutputParseError when schema validation fails', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            tool_calls: [
              {
                type: 'function',
                function: {
                  name: INVESTIGATION_TOOL_NAME,
                  arguments: JSON.stringify({ schemaVersion: '9.9' })
                }
              }
            ]
          }
        }
      ]
    });

    const model = new OpenAIInvestigationModel({
      apiKey: 'sk-test',
      client: { chat: { completions: { create } } } as never
    });

    await expect(model.generateInvestigation(makeFacts())).rejects.toBeInstanceOf(ModelOutputParseError);
  });

  it('throws ModelOutputParseError when structured tool output is missing', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'prose without tools', tool_calls: [] } }]
    });

    const model = new OpenAIInvestigationModel({
      apiKey: 'sk-test',
      client: { chat: { completions: { create } } } as never
    });

    await expect(model.generateInvestigation(makeFacts())).rejects.toBeInstanceOf(ModelOutputParseError);
  });

  it('does not perform a real network request when a client is injected', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            tool_calls: [
              {
                type: 'function',
                function: { name: INVESTIGATION_TOOL_NAME, arguments: validToolArguments() }
              }
            ]
          }
        }
      ]
    });

    const model = new OpenAIInvestigationModel({
      apiKey: 'sk-test',
      client: { chat: { completions: { create } } } as never
    });
    await model.generateInvestigation(makeFacts());
    expect(create.mock.calls[0]?.[0]?.model).toBeTruthy();
  });
});
