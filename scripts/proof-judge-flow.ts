import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runInvestigation } from '../src/agent/orchestrator';
import { createInvestigationModel } from '../src/agent/model-factory';
import { makePool } from '../src/db/client';
import { seedDatabase } from '../src/db/seed';
import { createRemediationPlan, decideRemediationPlan, submitRemediationPlanForApproval } from '../src/remediation/approve';
import { executeRemediationPlan } from '../src/remediation/execute';
import { testHarnessAuthority } from '../src/remediation/trusted-authority';
import { writebackRemediationResolution } from '../src/remediation/writeback';
import { getRuntimePolicy } from '../src/runtime/runtime-policy';
import { applyConversionError } from '../demo-data/scenarios/conversion-error';

const root = path.resolve(__dirname, '..');
const actor = 'judge-proof-actor';

function redacted(text: string): string {
  return text.replace(/\b(api[_-]?key|token|password|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

async function main(): Promise<void> {
  const policy = getRuntimePolicy();
  if (!policy.judgeMode || policy.allowDemoFallback) {
    throw new Error('JUDGE_MODE=true with demo fallback effectively disabled is required for the live proof flow.');
  }

  const pool = makePool();
  try {
    await seedDatabase(pool);
    await applyConversionError(pool);

    const selection = createInvestigationModel(policy);
    const investigation = await runInvestigation(
      {
        incidentId: `judge-proof-${Date.now()}`,
        productId: 'prod-cement-40',
        triggerAsset: 'inventory_valuation',
        requestedBy: actor,
        mode: 'LIVE'
      },
      { pool, ...selection }
    );
    if (investigation.finalState !== 'INVESTIGATION_COMPLETED' || !investigation.output) {
      throw new Error(`Live investigation did not complete: ${investigation.error?.message ?? investigation.finalState}`);
    }
    if (investigation.output.provenance?.datahubSource !== 'LIVE_MCP' || investigation.output.provenance.fallbackUsed) {
      throw new Error('Live proof refused a non-live DataHub provenance record.');
    }

    const authority = testHarnessAuthority(actor);
    const draft = await createRemediationPlan(
      { investigationId: investigation.investigationId, requestedBy: actor },
      { pool, authority }
    );
    const pending = await submitRemediationPlanForApproval(pool, { planId: draft.id, expectedVersion: draft.version });
    const approved = await decideRemediationPlan(
      pool,
      {
        planId: pending.id,
        expectedVersion: pending.version,
        action: 'APPROVE',
        decidedBy: actor,
        note: 'Automated live proof using the isolated synthetic demo database.'
      },
      { authority }
    );
    const executed = await executeRemediationPlan(
      { planId: approved.id, expectedVersion: approved.version },
      { pool, authority }
    );
    if (executed.plan.state !== 'RESOLVED' || executed.plan.verification?.result.overallStatus !== 'PASS') {
      throw new Error(`Transactional remediation did not resolve: ${executed.plan.state}`);
    }
    const synced = await writebackRemediationResolution({ planId: executed.plan.id }, { pool });
    if (synced.datahubWriteback?.outcome !== 'SYNCED') {
      throw new Error(`Live DataHub resolution write-back did not sync: ${synced.datahubWriteback?.message ?? 'unknown failure'}`);
    }

    const outputDir = path.join(root, 'examples', 'judge-proof');
    await mkdir(outputDir, { recursive: true });
    const activity = investigation.output.activityLog.map((entry) => ({
      ...entry,
      inputSummary: redacted(entry.inputSummary),
      outputSummary: redacted(entry.outputSummary),
      errorSanitized: entry.errorSanitized ? redacted(entry.errorSanitized) : null
    }));
    const artifact = {
      generatedAt: new Date().toISOString(),
      actor,
      investigationId: investigation.investigationId,
      planId: synced.id,
      datahubSource: investigation.output.provenance.datahubSource,
      fallbackUsed: investigation.output.provenance.fallbackUsed,
      modelSource: investigation.output.provenance.modelSource,
      remediationState: synced.state,
      verificationStatus: synced.verification?.result.overallStatus ?? 'FAIL',
      datahubWritebackStatus: synced.datahubWriteback.outcome,
      activityLogPath: 'examples/judge-proof/mcp-activity-log.jsonl'
    };
    await writeFile(path.join(outputDir, 'live-flow-proof.json'), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    await writeFile(path.join(outputDir, 'mcp-activity-log.jsonl'), `${activity.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
    console.log('Live judge proof completed. Sanitized artifacts written to examples/judge-proof/.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Judge proof failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
