import { afterEach, describe, expect, it } from 'vitest';
import { AnthropicInvestigationModel } from '../../../src/agent/model-anthropic';
import { createInvestigationModel, resolveConfiguredLlmProvider } from '../../../src/agent/model-factory';
import { OpenAIInvestigationModel } from '../../../src/agent/model-openai';
import { DeterministicTestModel } from '../../../src/agent/model-test';

const ENV_KEYS = [
  'LLM_PROVIDER',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'REQUIRE_LIVE_MODEL',
  'JUDGE_MODE',
  'ALLOW_DEMO_FALLBACK'
] as const;

const original: Record<(typeof ENV_KEYS)[number], string | undefined> = {
  LLM_PROVIDER: process.env.LLM_PROVIDER,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  REQUIRE_LIVE_MODEL: process.env.REQUIRE_LIVE_MODEL,
  JUDGE_MODE: process.env.JUDGE_MODE,
  ALLOW_DEMO_FALLBACK: process.env.ALLOW_DEMO_FALLBACK
};

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function clearLiveKeys(): void {
  setEnv('ANTHROPIC_API_KEY', undefined);
  setEnv('OPENAI_API_KEY', undefined);
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    setEnv(key, original[key]);
  }
});

const livePolicy = { judgeMode: true, allowDemoFallback: false, requireLiveModel: true };
const optionalPolicy = { judgeMode: false, allowDemoFallback: true, requireLiveModel: false };

describe('createInvestigationModel / LLM_PROVIDER', () => {
  it('selects OpenAI when LLM_PROVIDER=openai and OPENAI_API_KEY is set', () => {
    setEnv('LLM_PROVIDER', 'openai');
    setEnv('OPENAI_API_KEY', 'sk-test-openai');
    setEnv('ANTHROPIC_API_KEY', undefined);
    const selection = createInvestigationModel(livePolicy);
    expect(selection.model).toBeInstanceOf(OpenAIInvestigationModel);
    expect(selection.modelSource).toBe('OPENAI');
  });

  it('selects Anthropic when LLM_PROVIDER=anthropic and ANTHROPIC_API_KEY is set', () => {
    setEnv('LLM_PROVIDER', 'anthropic');
    setEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    setEnv('OPENAI_API_KEY', undefined);
    const selection = createInvestigationModel(livePolicy);
    expect(selection.model).toBeInstanceOf(AnthropicInvestigationModel);
    expect(selection.modelSource).toBe('ANTHROPIC');
  });

  it('throws when LLM_PROVIDER=openai without key and REQUIRE_LIVE_MODEL=true', () => {
    setEnv('LLM_PROVIDER', 'openai');
    clearLiveKeys();
    expect(() => createInvestigationModel(livePolicy)).toThrow(
      /OPENAI_API_KEY is required because LLM_PROVIDER=openai/
    );
  });

  it('throws when LLM_PROVIDER=anthropic without key and REQUIRE_LIVE_MODEL=true', () => {
    setEnv('LLM_PROVIDER', 'anthropic');
    clearLiveKeys();
    expect(() => createInvestigationModel(livePolicy)).toThrow(
      /ANTHROPIC_API_KEY is required because LLM_PROVIDER=anthropic/
    );
  });

  it('throws when LLM_PROVIDER=deterministic and REQUIRE_LIVE_MODEL=true', () => {
    setEnv('LLM_PROVIDER', 'deterministic');
    clearLiveKeys();
    expect(() => createInvestigationModel(livePolicy)).toThrow(/deterministic cannot be used/);
  });

  it('falls back to deterministic when no provider/key and REQUIRE_LIVE_MODEL=false', () => {
    setEnv('LLM_PROVIDER', undefined);
    clearLiveKeys();
    const selection = createInvestigationModel(optionalPolicy);
    expect(selection.model).toBeInstanceOf(DeterministicTestModel);
    expect(selection.modelSource).toBe('DETERMINISTIC_TEMPLATE');
  });

  it('auto-selects OpenAI when no LLM_PROVIDER and only OPENAI_API_KEY is set', () => {
    setEnv('LLM_PROVIDER', undefined);
    setEnv('OPENAI_API_KEY', 'sk-test-openai');
    setEnv('ANTHROPIC_API_KEY', undefined);
    const selection = createInvestigationModel(optionalPolicy);
    expect(selection.model).toBeInstanceOf(OpenAIInvestigationModel);
    expect(selection.modelSource).toBe('OPENAI');
  });

  it('auto-selects Anthropic when no LLM_PROVIDER and ANTHROPIC_API_KEY is set (backward compatible)', () => {
    setEnv('LLM_PROVIDER', undefined);
    setEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    setEnv('OPENAI_API_KEY', 'sk-test-openai');
    const selection = createInvestigationModel(optionalPolicy);
    expect(selection.model).toBeInstanceOf(AnthropicInvestigationModel);
    expect(selection.modelSource).toBe('ANTHROPIC');
  });

  it('throws a configuration error for an unknown LLM_PROVIDER', () => {
    setEnv('LLM_PROVIDER', 'gemini');
    clearLiveKeys();
    expect(() => resolveConfiguredLlmProvider()).toThrow(/Unknown LLM_PROVIDER/);
    expect(() => createInvestigationModel(optionalPolicy)).toThrow(/Unknown LLM_PROVIDER/);
  });

  it('never includes API key material in thrown configuration errors', () => {
    const secret = 'sk-super-secret-value-should-not-leak';
    setEnv('LLM_PROVIDER', 'openai');
    setEnv('OPENAI_API_KEY', secret);
    setEnv('ANTHROPIC_API_KEY', undefined);
    // Valid selection path must not throw — assert the constructed error paths instead.
    clearLiveKeys();
    try {
      createInvestigationModel(livePolicy);
      throw new Error('expected throw');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(secret);
      expect(message.toLowerCase()).not.toContain('sk-super-secret');
    }

    setEnv('LLM_PROVIDER', 'bad-provider-typo');
    try {
      createInvestigationModel(optionalPolicy);
      throw new Error('expected throw');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(secret);
      expect(message).toMatch(/Unknown LLM_PROVIDER/);
    }
  });
});
