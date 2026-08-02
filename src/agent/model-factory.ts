import { getRuntimePolicy, type RuntimePolicy } from '../runtime/runtime-policy';
import { AnthropicInvestigationModel } from './model-anthropic';
import type { InvestigationModel } from './model';
import { DeterministicTestModel } from './model-test';
import type { ModelSource } from './types';

export type InvestigationModelSelection = {
  model: InvestigationModel;
  modelSource: ModelSource;
};

/**
 * Chooses the narrator once for every runtime entrypoint. Financial amounts
 * remain deterministic-engine output regardless of this selection.
 */
export function createInvestigationModel(
  policy: RuntimePolicy = getRuntimePolicy()
): InvestigationModelSelection {
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return { model: new AnthropicInvestigationModel(), modelSource: 'ANTHROPIC' };
  }

  if (policy.requireLiveModel) {
    throw new Error('ANTHROPIC_API_KEY is required because live model mode is enabled.');
  }

  return { model: new DeterministicTestModel(), modelSource: 'DETERMINISTIC_TEMPLATE' };
}
