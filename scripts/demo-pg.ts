import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { investigate } from '@ledgerguard/core';
import { Pool } from 'pg';
import { DemoSafetyError, initializeDemoDatabase, validateDemoTarget } from './postgres-demo-safety';
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

function promptYes(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    let answered = false;
    rl.once('close', () => { if (!answered) resolve(false); });
    rl.question(question, (answer) => {
      answered = true;
      resolve(answer.trim().toLowerCase() === 'yes');
      rl.close();
    });
  });
}

async function seedCompletedInvestigation(pool: Pool): Promise<string> {
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

async function main(): Promise<void> {
  if (process.argv.length > 2) throw new DemoSafetyError('Unknown arguments. This demo accepts no flags.');
  const target = validateDemoTarget(process.env.DATABASE_URL);
  console.log('LedgerGuard Postgres demo: initialize → approve → execute → verify → replay.');
  console.log(`Disposable target: ${target.label} (credentials hidden).`);
  console.log('Initialization creates the schema, synthetic baseline, duplicate inventory fixture, and a pending plan. It never resets an existing database.');
  console.log('Use only a new empty local database you own, reserved exclusively for this demo. No Docker commands will run.');
  if (!await promptYes('Type yes to initialize this empty disposable database (anything else aborts): ')) {
    console.error('Initialization declined. No database changes were made.');
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString: target.url, connectionTimeoutMillis: 5_000 });
  pool.on('error', () => console.error('A background demo database connection failed. Details were withheld.'));
  let initialized = false;
  try {
    await initializeDemoDatabase(pool, target.database);
    initialized = true;
    console.log('Authorized initialization committed. Synthetic demo data is now stored in the database.');

    const report = investigate(await loadInvestigationInput(pool));
    if (report.incidentType !== 'DUPLICATE_INVENTORY_MOVEMENT') {
      throw new Error(`expected DUPLICATE_INVENTORY_MOVEMENT, got ${report.incidentType}`);
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
    console.log(`\nPending plan: ${pending.id} | version: ${pending.version}`);
    console.log('Proposed corrections:');
    for (const correction of pending.proposedCorrections) {
      console.log(`  ${correction.sequence}. ${correction.action} ${correction.table}.${correction.field} ${correction.recordId}: ${correction.beforeValue} → ${correction.afterValue}`);
    }
    if (!await promptYes('Type yes to approve this exact plan version (anything else aborts): ')) {
      console.error('Remediation approval declined. Authorized initialization and the pending plan remain; no remediation was executed.');
      process.exitCode = 1;
      return;
    }

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
    console.log('Demo data remains in the disposable database. Use a new empty database for another run.');
  } catch (error) {
    if (error instanceof DemoSafetyError) throw error;
    throw new DemoSafetyError(initialized
      ? 'Demo failed after authorized initialization. Demo data remains; inspect the plan and execution journal before retrying. Database error details were withheld.'
      : 'Database initialization could not complete. No reset or cleanup was attempted. Check the local connection, catalog permissions, and disposable database before retrying. Database error details were withheld.');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('DEMO:PG FAILED:', error instanceof DemoSafetyError ? error.message : 'Unexpected error. Database details were withheld.');
  process.exitCode = 1;
}).finally(() => {
  // Closing readline pauses an open pipe but can leave its handle referenced.
  // Release stdin only after all database finally blocks have completed.
  process.stdin.destroy();
});
