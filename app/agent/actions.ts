'use server';

import { redirect } from 'next/navigation';
import { runInvestigation } from '../../src/agent/orchestrator';
import { createInvestigationModel } from '../../src/agent/model-factory';
import { getServerPool } from '../../src/agent/server-pool';

// ---------------------------------------------------------------------------
// Server action backing the minimum test UI (app/agent/page.tsx). Uses
// createInvestigationModel() (LLM_PROVIDER + Anthropic/OpenAI keys, else
// deterministic template). This never touches remediation: runInvestigation
// only investigates and writes an "At Risk" tag + note back to DataHub.
// ---------------------------------------------------------------------------

export async function triggerInvestigation(formData: FormData): Promise<void> {
  const rawInput = {
    incidentId: String(formData.get('incidentId') ?? ''),
    productId: String(formData.get('productId') ?? ''),
    triggerAsset: String(formData.get('triggerAsset') ?? ''),
    requestedBy: String(formData.get('requestedBy') ?? ''),
    mode: String(formData.get('mode') ?? 'TEST')
  };

  const record = await runInvestigation(rawInput, {
    pool: getServerPool(),
    ...createInvestigationModel()
  });
  redirect(`/agent/investigations/${record.investigationId}`);
}
