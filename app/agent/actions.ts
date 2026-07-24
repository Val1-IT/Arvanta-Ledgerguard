'use server';

import { redirect } from 'next/navigation';
import { runInvestigation } from '../../src/agent/orchestrator';
import { AnthropicInvestigationModel } from '../../src/agent/model-anthropic';
import { DeterministicTestModel } from '../../src/agent/model-test';
import type { InvestigationModel } from '../../src/agent/model';
import { getServerPool } from '../../src/agent/server-pool';

// ---------------------------------------------------------------------------
// Server action backing the minimum test UI (app/agent/page.tsx). Picks the
// real Anthropic-backed model when ANTHROPIC_API_KEY is configured, otherwise
// falls back to the deterministic test provider — the same selection a caller
// would make outside the UI, not a UI-specific shortcut. This never touches
// remediation: runInvestigation only investigates and writes an "At Risk"
// tag + note back to DataHub (src/agent/orchestrator.ts), it does not execute
// any correction.
// ---------------------------------------------------------------------------

function pickModel(): InvestigationModel {
  return process.env.ANTHROPIC_API_KEY ? new AnthropicInvestigationModel() : new DeterministicTestModel();
}

export async function triggerInvestigation(formData: FormData): Promise<void> {
  const rawInput = {
    incidentId: String(formData.get('incidentId') ?? ''),
    productId: String(formData.get('productId') ?? ''),
    triggerAsset: String(formData.get('triggerAsset') ?? ''),
    requestedBy: String(formData.get('requestedBy') ?? ''),
    mode: String(formData.get('mode') ?? 'TEST')
  };

  const record = await runInvestigation(rawInput, { pool: getServerPool(), model: pickModel() });
  redirect(`/agent/investigations/${record.investigationId}`);
}
