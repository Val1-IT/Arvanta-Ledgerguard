import { getRuntimePolicy, type RuntimePolicy } from '../runtime/runtime-policy';
import { AnthropicInvestigationModel } from './model-anthropic';
import type { InvestigationModel } from './model';
import { OpenAIInvestigationModel } from './model-openai';
import { DeterministicTestModel } from './model-test';
import type { ModelSource } from './types';

export type InvestigationModelSelection = {
  model: InvestigationModel;
  modelSource: ModelSource;
};

/** Explicit LLM_PROVIDER values. Empty input means auto / backward-compatible selection. */
export type ConfiguredLlmProvider = 'anthropic' | 'openai' | 'deterministic';

export type ResolvedLlmProvider = ConfiguredLlmProvider | 'auto';

function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function hasOpenAIKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/**
 * Resolves LLM_PROVIDER without constructing a client. Throws on unknown
 * values so typos fail closed. Does not log or return credential values.
 */
export function resolveConfiguredLlmProvider(): ResolvedLlmProvider {
  const raw = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (!raw) return 'auto';
  if (raw === 'anthropic' || raw === 'openai' || raw === 'deterministic') return raw;
  throw new Error(
    `Unknown LLM_PROVIDER value. Expected anthropic, openai, or deterministic.`
  );
}

function selectAnthropic(requireLiveModel: boolean): InvestigationModelSelection {
  if (hasAnthropicKey()) {
    return { model: new AnthropicInvestigationModel(), modelSource: 'ANTHROPIC' };
  }
  if (requireLiveModel) {
    throw new Error('ANTHROPIC_API_KEY is required because LLM_PROVIDER=anthropic and live model mode is enabled.');
  }
  return { model: new DeterministicTestModel(), modelSource: 'DETERMINISTIC_TEMPLATE' };
}

function selectOpenAI(requireLiveModel: boolean): InvestigationModelSelection {
  if (hasOpenAIKey()) {
    return { model: new OpenAIInvestigationModel(), modelSource: 'OPENAI' };
  }
  if (requireLiveModel) {
    throw new Error('OPENAI_API_KEY is required because LLM_PROVIDER=openai and live model mode is enabled.');
  }
  return { model: new DeterministicTestModel(), modelSource: 'DETERMINISTIC_TEMPLATE' };
}

function selectAuto(requireLiveModel: boolean): InvestigationModelSelection {
  if (hasAnthropicKey()) {
    return { model: new AnthropicInvestigationModel(), modelSource: 'ANTHROPIC' };
  }
  if (hasOpenAIKey()) {
    return { model: new OpenAIInvestigationModel(), modelSource: 'OPENAI' };
  }
  if (requireLiveModel) {
    throw new Error(
      'A live model API key is required because REQUIRE_LIVE_MODEL=true. Set ANTHROPIC_API_KEY or OPENAI_API_KEY (and optionally LLM_PROVIDER).'
    );
  }
  return { model: new DeterministicTestModel(), modelSource: 'DETERMINISTIC_TEMPLATE' };
}

/**
 * Chooses the narrator once for every runtime entrypoint. Financial amounts
 * remain deterministic-engine output regardless of this selection.
 */
export function createInvestigationModel(
  policy: RuntimePolicy = getRuntimePolicy()
): InvestigationModelSelection {
  const provider = resolveConfiguredLlmProvider();

  if (provider === 'deterministic') {
    if (policy.requireLiveModel) {
      throw new Error(
        'LLM_PROVIDER=deterministic cannot be used when REQUIRE_LIVE_MODEL=true. Choose anthropic or openai with a live API key.'
      );
    }
    return { model: new DeterministicTestModel(), modelSource: 'DETERMINISTIC_TEMPLATE' };
  }

  if (provider === 'anthropic') return selectAnthropic(policy.requireLiveModel);
  if (provider === 'openai') return selectOpenAI(policy.requireLiveModel);
  return selectAuto(policy.requireLiveModel);
}

/** Preflight-friendly summary of the active live-model credential check. */
export function describeLiveModelCredentialStatus(policy: RuntimePolicy = getRuntimePolicy()): {
  ok: boolean;
  detail: string;
  provider: ResolvedLlmProvider | ConfiguredLlmProvider;
} {
  if (!policy.requireLiveModel) {
    return {
      ok: true,
      detail: 'Live model is optional; proof artifacts will state the selected model source.',
      provider: resolveConfiguredLlmProvider()
    };
  }

  let provider: ResolvedLlmProvider;
  try {
    provider = resolveConfiguredLlmProvider();
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      provider: 'auto'
    };
  }

  if (provider === 'deterministic') {
    return {
      ok: false,
      detail: 'LLM_PROVIDER=deterministic cannot satisfy REQUIRE_LIVE_MODEL=true.',
      provider
    };
  }

  if (provider === 'anthropic') {
    return hasAnthropicKey()
      ? { ok: true, detail: 'provider=anthropic', provider }
      : {
          ok: false,
          detail: 'ANTHROPIC_API_KEY is required because LLM_PROVIDER=anthropic.',
          provider
        };
  }

  if (provider === 'openai') {
    return hasOpenAIKey()
      ? { ok: true, detail: 'provider=openai', provider }
      : {
          ok: false,
          detail: 'OPENAI_API_KEY is required because LLM_PROVIDER=openai.',
          provider
        };
  }

  // auto
  if (hasAnthropicKey()) {
    return { ok: true, detail: 'provider=anthropic (auto)', provider: 'anthropic' };
  }
  if (hasOpenAIKey()) {
    return { ok: true, detail: 'provider=openai (auto)', provider: 'openai' };
  }
  return {
    ok: false,
    detail:
      'A live model API key is required because REQUIRE_LIVE_MODEL=true. Set ANTHROPIC_API_KEY or OPENAI_API_KEY (and optionally LLM_PROVIDER).',
    provider: 'auto'
  };
}
