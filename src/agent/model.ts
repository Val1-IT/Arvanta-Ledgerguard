import type { InvestigationFactsForModel } from './prompts/investigation-v1';
import type { ModelInvestigationOutput, ModelSource } from './types';

// ---------------------------------------------------------------------------
// Single-provider model abstraction (FASE 5 requirement: "gunakan satu
// provider utama", no multi-provider abstraction). generateInvestigation must
// return a value that still has to pass Zod validation and the reconciliation
// layer before it is trusted — this interface makes no promise about output
// correctness, only about the call shape.
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
