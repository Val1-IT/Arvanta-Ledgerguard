import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { investigate } from '@ledgerguard/core';
import { makePool, getDatabaseUrl } from '../src/db/client';
import { waitForDatabase } from '../src/db/wait';
import { migrateDatabase } from '../src/db/migrate';
import { seedDatabase } from '../src/db/seed';
import { applyDuplicateInventoryError } from '../demo-data/scenarios/duplicate-inventory';
import { loadInvestigationInput } from '../src/db/repositories/investigation';
import { saveInvestigationRun } from '../src/db/repositories/investigation-runs';
import { SCHEMA_VERSION as AGENT_SCHEMA_VERSION, type InvestigationRunRecord } from '../src/agent/types';
import {
  createRemediationPlan,
  decideRemediationPlan,
  submitRemediationPlanForApproval
} from '../src/remediation/approve';
import { executeRemediationPlan } from '../src/remediation/execute';
import { testHarnessAuthority } from '../src/remediation/trusted-authority';

const DEFAULT_URL = 'postgres://ledgerguard:ledgerguard@localhost:5433/ledgerguard';

function commandExists(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: true });
  return result.status === 0;
}

function dockerComposeAvailable(): boolean {
  return commandExists('docker', ['compose', 'version']) || commandExists('docker-compose', ['version']);
}

function runPnpm(script: string): void {
  const result = spawnSync('pnpm', ['run', script], { stdio: 'inherit', shell: true });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`pnpm run ${script} exited ${result.status}`);
  }
}

async function promptYes(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question('Type yes to approve this exact plan version (anything else aborts): ', resolve);
  });
  rl.close();
  return answer.trim().toLowerCase() === 'yes';
}

async function seedCompletedInvestigation(pool: ReturnType<typeof makePool>): Promise<string> {
  const investigationId = randomUUID();
  const incidentId = `incident-${investigationId}`;
  const record: InvestigationRunRecord = {
    investigationId,
    incidentId,
    input: {
      incidentId,
      productId: 'ITEM-001',
      triggerAsset: 'inventory_movements',
      requestedBy: 'cli-tester',
      mode: 'TEST'
    },
    finalState: 'INVESTIGATION_COMPLETED',
    output: {
      schemaVersion: AGENT_SCHEMA_VERSION,
      investigationId,
      incidentId,
      status: 'COMPLETED',
      evidenceSufficiency: { sufficient: true, confidence: 0.95, missingEvidence: [] },
      rootCauseExplanation: 'duplicate inventory movement fixture',
      businessImpactExplanation: 'quantity 20 instead of 10',
      datahubContext: { assetsRead: [], owners: [], glossaryTerms: [], tags: [], lineagePath: [] },
      engineResultReference: {
        incidentType: 'DUPLICATE_INVENTORY_MOVEMENT',
        overallStatus: 'CRITICAL',
        primaryExposure: '850000.00',
        currency: 'IDR',
        affectedRecordCount: 3,
        correctionTargetCount: 2
      },
      remediationRationale: 'reverse MOV-002 only',
      recommendedNextStep: 'REQUEST_APPROVAL',
      activityLog: []
    },
    error: null,
    stateHistory: [{ state: 'INVESTIGATION_COMPLETED', at: new Date().toISOString() }],
    createdAt: new Date().toISOString()
  };
  await saveInvestigationRun(pool, record);
  return investigationId;
}

function missingPostgresHelp(detail: string): never {
  console.error('DEMO:PG FAILED');
  console.error(detail);
  console.error(
    [
      'The Postgres demo needs Docker Compose, or an already-running Postgres 16 at DATABASE_URL.',
      `Default URL: ${DEFAULT_URL}`,
      'Install Docker Desktop / Engine, start it, and retry `pnpm demo:pg`.',
      'Or start Postgres yourself, export DATABASE_URL, then retry.',
      'The in-memory path needs neither: `pnpm demo`.'
    ].join('\n')
  );
  process.exit(1);
}

async function ensurePostgres(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = DEFAULT_URL;
  }

  const dockerOk = dockerComposeAvailable();
  if (dockerOk) {
    console.log('Docker Compose is available; bringing up Postgres (`pnpm db:up`).');
    try {
      runPnpm('db:up');
    } catch (error) {
      missingPostgresHelp(
        `Docker Compose failed to start Postgres: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  } else {
    console.log('Docker Compose is not available; looking for an already-running Postgres.');
  }

  try {
    await waitForDatabase(dockerOk ? 60_000 : 8_000);
  } catch (error) {
    const last = error instanceof Error ? error.message : String(error);
    if (dockerOk) {
      missingPostgresHelp(`Postgres did not become ready after Compose up. ${last}`);
    }
    missingPostgresHelp(`Postgres is not reachable at ${getDatabaseUrl()}. ${last}`);
  }
}

async function main(): Promise<void> {
  console.log('LedgerGuard Postgres demo: duplicate inventory → approve → execute → verify → replay.');
  await ensurePostgres();

  console.log('Migrating and seeding the disposable demo database…');
  await migrateDatabase();
  const pool = makePool();
  try {
    await seedDatabase(pool);
    await applyDuplicateInventoryError(pool);

    const report = investigate(await loadInvestigationInput(pool));
    if (report.incidentType !== 'DUPLICATE_INVENTORY_MOVEMENT') {
      throw new Error(`expected DUPLICATE_INVENTORY_MOVEMENT, got ${report.incidentType}`);
    }

    console.log('\nProposed corrections:');
    for (const correction of report.proposedCorrections) {
      console.log(
        `  ${correction.sequence}. ${correction.action} ${correction.table}.${correction.field} ${correction.recordId}: ${correction.beforeValue} → ${correction.afterValue}`
      );
    }

    const approvedByHuman = await promptYes();
    if (!approvedByHuman) {
      console.error('Approval declined. No mutation was applied.');
      process.exit(1);
    }

    const authority = testHarnessAuthority('cli-tester');
    const investigationId = await seedCompletedInvestigation(pool);
    const draft = await createRemediationPlan(
      { investigationId, requestedBy: 'cli-tester' },
      { pool, authority }
    );
    const pending = await submitRemediationPlanForApproval(pool, {
      planId: draft.id,
      expectedVersion: draft.version
    });
    const approved = await decideRemediationPlan(
      pool,
      {
        planId: pending.id,
        expectedVersion: pending.version,
        action: 'APPROVE',
        decidedBy: 'cli-tester'
      },
      { authority }
    );

    const executed = await executeRemediationPlan(
      { planId: approved.id, expectedVersion: approved.version },
      { pool, authority }
    );
    if (executed.outcome !== 'EXECUTED' || executed.plan.verification?.result.overallStatus !== 'PASS') {
      throw new Error(
        `expected EXECUTED with verification PASS, got ${executed.outcome} / ${executed.plan.verification?.result.overallStatus}`
      );
    }

    const replay = await executeRemediationPlan(
      { planId: approved.id, expectedVersion: approved.version },
      { pool, authority }
    );
    if (replay.outcome !== 'ALREADY_EXECUTED') {
      throw new Error(`expected ALREADY_EXECUTED on replay, got ${replay.outcome}`);
    }

    const valuation = await pool.query(
      `select quantity_on_hand as qty, inventory_value as value from inventory_valuation where id = 'val-item-001'`
    );

    console.log('\n---------- DEMO:PG SUMMARY ----------');
    console.log('Result: PASS');
    console.log(`Execute: ${executed.outcome}, verification PASS`);
    console.log(`Replay: ${replay.outcome}`);
    console.log(
      `Quantity: ${valuation.rows[0]?.qty} | Valuation: ${valuation.rows[0]?.value}`
    );
    if (executed.receipt) {
      console.log(`Receipt status: ${executed.receipt.status}`);
    }
    console.log('------------------------------------');
    console.log('Postgres is still running. Stop it with: pnpm db:down');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('DEMO:PG FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
