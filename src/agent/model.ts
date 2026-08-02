import type { InvestigationFactsForModel } from './prompts/investigation-v1';
import type { ModelInvestigationOutput, ModelSource } from './types';

// ---------------------------------------------------------------------------
// Investigation narrator abstraction. Exactly one provider is selected per
// run via createInvestigationModel() (Anthropic, OpenAI, or deterministic
// template) — no multi-provider retry or silent failover. generateInvestigation
// must still pass Zod validation and reconciliation before it is trusted.
// ---------------------------------------------------------------------------

export interface InvestigationModel {
  /** Set by built-in providers; custom test doubles may omit it. */
  readonly source?: ModelSource;
  generateInvestigation(facts: InvestigationFactsForModel): Promise<ModelInvestigationOutput>;
}

export class ModelOutputParseError extends Error {
  constructor(
    message: string,
    readonly cause: unknown
  ) {
    super(message);
    this.name = 'ModelOutputParseError';
  }
}
