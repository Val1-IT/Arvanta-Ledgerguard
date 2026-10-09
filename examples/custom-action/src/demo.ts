import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  executeConstrainedAction,
  formatMoney,
  toDecimal,
  type ConstrainedAction,
  type ConstrainedActionAdapter,
  type EvidenceItem
} from '@ledgerguard/core';
import {
  Capability,
  evaluateExecutionPolicy,
  trustedRuntimeAuthority
} from '@ledgerguard/policy';

// ---------------------------------------------------------------------------
// Customize these ~10 lines for your own table.
// LedgerGuard does not register this detector; you own the domain shape.
// ---------------------------------------------------------------------------
const LINE_TABLE = 'invoice_lines';
const INVOICE_TABLE = 'invoices';
const AMOUNT_FIELD = 'amount';
const TOTAL_FIELD = 'total';
const ACTION_TYPE = 'REVERSE_DUPLICATE_INVOICE_LINE';
const INCIDENT_TYPE = 'DUPLICATE_INVOICE_LINE';
const RESOURCE_TYPE = 'invoice_lines';
const CURRENCY = 'IDR';
const APPROVAL_THRESHOLD = 1000;

export interface InvoiceRecord {
  id: string;
  number: string;
  total: string;
}

export interface InvoiceLineRecord {
  id: string;
  invoiceId: string;
  sku: string;
  amount: string;
  eventIdentity: string;
  postedAt: Date;
  reversedAt: Date | null;
}

export interface InvoiceLedger {
  invoices: InvoiceRecord[];
  lines: InvoiceLineRecord[];
}

export interface ReverseDuplicateInvoiceLineAction extends ConstrainedAction {
  type: typeof ACTION_TYPE;
  target: {
    systemType: 'memory';
    resourceType: typeof RESOURCE_TYPE;
    resourceId: string;
  };
  invoiceId: string;
  expectedAmount: string;
  expectedInvoiceTotal: string;
  repairedInvoiceTotal: string;
}

export interface CustomIncidentReport {
  incidentType: typeof INCIDENT_TYPE;
  evidence: EvidenceItem[];
  proposedCorrections: Array<{
    sequence: number;
    table: string;
    recordId: string;
    field: string;
    beforeValue: string;
    afterValue: string;
  }>;
  verificationExpectations: Array<{ checkId: string; description: string }>;
  financialImpact: { primaryExposure: string; currency: string };
  action: ReverseDuplicateInvoiceLineAction;
}

function isActive(line: InvoiceLineRecord): boolean {
  return line.reversedAt == null;
}

function isReverseAction(action: ConstrainedAction): action is ReverseDuplicateInvoiceLineAction {
  return action.type === ACTION_TYPE && action.target.resourceType === RESOURCE_TYPE;
}

export function scenario(): InvoiceLedger {
  const postedAt = new Date('2026-04-01T10:00:00.000Z');
  return {
    invoices: [{ id: 'INV-1001', number: 'INV-1001', total: '1000000.00' }],
    lines: [
      {
        id: 'LINE-001',
        invoiceId: 'INV-1001',
        sku: 'WIDGET-A',
        amount: '500000.00',
        eventIdentity: 'invoice:INV-1001:WIDGET-A',
        postedAt,
        reversedAt: null
      },
      {
        id: 'LINE-002',
        invoiceId: 'INV-1001',
        sku: 'WIDGET-A',
        amount: '500000.00',
        eventIdentity: 'invoice:INV-1001:WIDGET-A',
        postedAt: new Date('2026-04-01T10:00:00.250Z'),
        reversedAt: null
      }
    ]
  };
}

/**
 * Deterministic detector you write: same invoice, sku, amount, and event
 * identity on two active lines. Earliest line is legitimate; later is the duplicate.
 */
export function detectDuplicateInvoiceLine(ledger: InvoiceLedger): CustomIncidentReport | null {
  const active = [...ledger.lines]
    .filter(isActive)
    .sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime() || a.id.localeCompare(b.id));

  const groups = new Map<string, InvoiceLineRecord[]>();
  for (const line of active) {
    const key = `${line.eventIdentity}|${line.invoiceId}|${line.sku}|${line.amount}`;
    const group = groups.get(key) ?? [];
    group.push(line);
    groups.set(key, group);
  }

  const duplicateGroup = [...groups.values()].find((members) => members.length >= 2);
  const legitimate = duplicateGroup?.[0];
  const duplicate = duplicateGroup?.[1];
  if (!legitimate || !duplicate) return null;

  const invoice = ledger.invoices.find((row) => row.id === duplicate.invoiceId);
  if (!invoice) return null;

  const expectedTotal = formatMoney(toDecimal(invoice.total).minus(duplicate.amount));
  const reversedAt = duplicate.postedAt.toISOString();

  return {
    incidentType: INCIDENT_TYPE,
    evidence: [
      {
        table: LINE_TABLE,
        recordId: legitimate.id,
        field: AMOUNT_FIELD,
        expectedValue: legitimate.amount,
        actualValue: legitimate.amount,
        delta: '0.00',
        reason: 'Earliest matching line is the legitimate posting'
      },
      {
        table: LINE_TABLE,
        recordId: duplicate.id,
        field: 'eventIdentity',
        expectedValue: 'single active line for this event',
        actualValue: duplicate.eventIdentity,
        delta: duplicate.amount,
        reason: 'Later line repeats invoice, sku, amount, and event identity'
      },
      {
        table: INVOICE_TABLE,
        recordId: invoice.id,
        field: TOTAL_FIELD,
        expectedValue: expectedTotal,
        actualValue: invoice.total,
        delta: duplicate.amount,
        reason: 'Invoice total includes the duplicated line'
      }
    ],
    proposedCorrections: [
      {
        sequence: 1,
        table: LINE_TABLE,
        recordId: duplicate.id,
        field: 'reversed_at',
        beforeValue: 'null',
        afterValue: reversedAt
      },
      {
        sequence: 2,
        table: INVOICE_TABLE,
        recordId: invoice.id,
        field: TOTAL_FIELD,
        beforeValue: invoice.total,
        afterValue: expectedTotal
      }
    ],
    verificationExpectations: [
      { checkId: 'duplicate-line-reversed', description: `${duplicate.id} must be reversed` },
      { checkId: 'original-line-untouched', description: `${legitimate.id} must remain active` },
      { checkId: 'invoice-total-restored', description: `${invoice.id} total must equal ${expectedTotal}` }
    ],
    financialImpact: { primaryExposure: duplicate.amount, currency: CURRENCY },
    action: {
      type: ACTION_TYPE,
      target: { systemType: 'memory', resourceType: RESOURCE_TYPE, resourceId: duplicate.id },
      invoiceId: invoice.id,
      expectedAmount: duplicate.amount,
      expectedInvoiceTotal: invoice.total,
      repairedInvoiceTotal: expectedTotal
    }
  };
}

function fingerprintLedger(ledger: InvoiceLedger, action: ReverseDuplicateInvoiceLineAction): string {
  const line = ledger.lines.find((row) => row.id === action.target.resourceId);
  const invoice = ledger.invoices.find((row) => row.id === action.invoiceId);
  return createHash('sha256')
    .update(JSON.stringify({
      lineId: line?.id ?? null,
      amount: line?.amount ?? null,
      reversedAt: line?.reversedAt?.toISOString() ?? null,
      invoiceTotal: invoice?.total ?? null
    }))
    .digest('hex');
}

export class MemoryInvoiceAdapter implements ConstrainedActionAdapter {
  readonly meta = { systemId: 'example-custom-action', systemType: 'memory' as const };

  constructor(public ledger: InvoiceLedger) {}

  async fingerprint(action: ConstrainedAction): Promise<string> {
    if (!isReverseAction(action)) return 'invalid-action';
    return fingerprintLedger(this.ledger, action);
  }

  async validate(action: ConstrainedAction): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!isReverseAction(action)) {
      return { ok: false, reason: `Unsupported action type: ${action.type}` };
    }
    const line = this.ledger.lines.find((row) => row.id === action.target.resourceId);
    if (!line) return { ok: false, reason: `Invoice line ${action.target.resourceId} not found` };
    const invoice = this.ledger.invoices.find((row) => row.id === action.invoiceId);
    if (!invoice) return { ok: false, reason: `Invoice ${action.invoiceId} not found` };
    return { ok: true };
  }

  async execute(action: ConstrainedAction): Promise<{
    httpSucceeded: boolean;
    stale?: boolean;
    remoteWriteAttempted?: boolean;
    detail: string;
  }> {
    if (!isReverseAction(action)) {
      return { httpSucceeded: false, detail: `Unsupported action type: ${action.type}` };
    }
    const line = this.ledger.lines.find((row) => row.id === action.target.resourceId);
    const invoice = this.ledger.invoices.find((row) => row.id === action.invoiceId);
    if (!line || !invoice) {
      return { httpSucceeded: false, detail: 'Target row missing' };
    }
    if (!isActive(line) || line.amount !== action.expectedAmount || invoice.total !== action.expectedInvoiceTotal) {
      return {
        httpSucceeded: false,
        stale: true,
        remoteWriteAttempted: false,
        detail: 'Source state no longer matches the approved reverse'
      };
    }

    const reversedAt = new Date(line.postedAt);
    line.reversedAt = reversedAt;
    invoice.total = action.repairedInvoiceTotal;
    return {
      httpSucceeded: true,
      remoteWriteAttempted: true,
      detail: `${LINE_TABLE}.${action.target.resourceId} reversed; ${INVOICE_TABLE}.${invoice.id} ${TOTAL_FIELD} ${action.expectedInvoiceTotal} -> ${action.repairedInvoiceTotal}`
    };
  }

  async verify(action: ConstrainedAction): Promise<{ pass: boolean; detail: string }> {
    if (!isReverseAction(action)) return { pass: false, detail: `Unsupported action type: ${action.type}` };
    const line = this.ledger.lines.find((row) => row.id === action.target.resourceId);
    const invoice = this.ledger.invoices.find((row) => row.id === action.invoiceId);
    const original = this.ledger.lines.find((row) => row.id !== action.target.resourceId && row.invoiceId === action.invoiceId);
    if (!line?.reversedAt) return { pass: false, detail: 'Duplicate line is still active' };
    if (original && !isActive(original)) return { pass: false, detail: 'Original line was mutated' };
    if (invoice?.total !== action.repairedInvoiceTotal) {
      return { pass: false, detail: `Invoice total is ${invoice?.total ?? 'missing'}, expected ${action.repairedInvoiceTotal}` };
    }
    return { pass: true, detail: 'Duplicate reversed; original untouched; invoice total restored' };
  }

  async classifyRecovery(action: ConstrainedAction): Promise<'applied' | 'not_applied' | 'ambiguous'> {
    if (!isReverseAction(action)) return 'ambiguous';
    const line = this.ledger.lines.find((row) => row.id === action.target.resourceId);
    if (!line) return 'ambiguous';
    return isActive(line) ? 'not_applied' : 'applied';
  }
}

const quiet =
  process.argv.includes('--quiet') || process.env.LEDGERGUARD_DEMO_QUIET === '1';

function log(title: string, value: unknown) {
  if (quiet) return;
  console.log(`\n=== ${title} ===`);
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function printSummary() {
  console.log('\n---------- DEMO SUMMARY ----------');
  console.log('Result: DEMO PASS');
  console.log(`Incident: ${INCIDENT_TYPE}`);
  console.log('Policy: REQUIRE_APPROVAL → ALLOW (simulated human approval of plan v2)');
  console.log('Execute: verified, LINE-002 reversed');
  console.log('Replay: STALE | Completed-key policy: DENY (DUPLICATE_EXECUTION)');
  console.log('Invoice total: 1000000.00 → 500000.00');
  console.log('----------------------------------');
}

function policyInput(report: CustomIncidentReport, authority: ReturnType<typeof trustedRuntimeAuthority>) {
  return {
    evidenceCount: report.evidence.length,
    verificationExpectationCount: report.verificationExpectations.length,
    impactAmount: Number(report.financialImpact.primaryExposure),
    authority,
    config: { financialApprovalThreshold: APPROVAL_THRESHOLD, currency: CURRENCY },
    idempotencyCompleted: false
  };
}

export async function runCustomActionDemo() {
  console.log('LedgerGuard custom-action example: synthetic in-memory invoice data; no database or API keys.');
  const ledger = scenario();
  const originalLine = ledger.lines[0];
  assert.ok(originalLine, 'demo fixture must include the legitimate invoice line');
  const originalLineSnapshot = structuredClone(originalLine);
  const report = detectDuplicateInvoiceLine(ledger);
  assert.ok(report, 'demo must detect the duplicate invoice line');
  assert.equal(report.incidentType, INCIDENT_TYPE);
  log('Incident', report.incidentType);
  log('Evidence', report.evidence.map((item) => ({
    table: item.table, recordId: item.recordId, field: item.field, reason: item.reason
  })));
  log('Proposed repair', report.proposedCorrections);

  const authority = trustedRuntimeAuthority({
    actorId: 'controller',
    actorType: 'human',
    capabilities: [Capability.remediationExecute, Capability.remediationApprove]
  });
  const basePolicy = policyInput(report, authority);
  const beforeApproval = evaluateExecutionPolicy({
    ...basePolicy,
    plan: { state: 'DRAFT', version: 1, approvalAction: null, approvedBy: null },
    expectedVersion: 1
  });
  log('Policy before approval', { outcome: beforeApproval.outcome, codes: beforeApproval.reasons.map((reason) => reason.code) });
  assert.equal(beforeApproval.outcome, 'REQUIRE_APPROVAL', 'unapproved custom plan must require approval');

  // This fixed fixture simulates a human controller approval, not production authentication.
  console.log('\nSimulating human approval of custom-action plan version 2.');
  const afterApproval = evaluateExecutionPolicy({
    ...basePolicy,
    plan: { state: 'APPROVED', version: 2, approvalAction: 'APPROVE', approvedBy: 'controller' },
    expectedVersion: 2
  });
  log('Policy after approval', { outcome: afterApproval.outcome });
  assert.equal(afterApproval.outcome, 'ALLOW', 'approved custom plan must be allowed before execution');

  const adapter = new MemoryInvoiceAdapter(ledger);
  const approvedFingerprint = await adapter.fingerprint(report.action);
  const executed = await executeConstrainedAction(adapter, report.action, approvedFingerprint);
  assert.equal(executed.outcome, 'VERIFIED', 'custom repair must verify');
  assert.equal(executed.verified, true, 'custom repair must pass verification');
  assert.ok(adapter.ledger.lines.find((row) => row.id === 'LINE-002')?.reversedAt, 'duplicate line must be reversed');
  assert.deepEqual(adapter.ledger.lines.find((row) => row.id === 'LINE-001'), originalLineSnapshot, 'original line must remain unchanged');
  assert.equal(adapter.ledger.invoices[0]?.total, '500000.00', 'repaired invoice total must be 500000.00');
  log('Execution', {
    outcome: executed.outcome,
    verified: executed.verified,
    invoiceTotal: adapter.ledger.invoices[0]?.total,
    duplicateReversed: Boolean(adapter.ledger.lines.find((row) => row.id === 'LINE-002')?.reversedAt)
  });

  const repairedLedger = structuredClone(adapter.ledger);
  const replay = await executeConstrainedAction(adapter, report.action, approvedFingerprint);
  assert.equal(replay.outcome, 'STALE', 'replay against the approved fingerprint must be stale');
  assert.equal(replay.mutated, false, 'stale replay must not mutate');
  assert.deepEqual(adapter.ledger, repairedLedger, 'replay must not change repaired data');
  log('Approved-fingerprint replay', { outcome: replay.outcome, mutated: replay.mutated });

  const alreadyExecuted = await executeConstrainedAction(adapter, report.action);
  assert.equal(alreadyExecuted.outcome, 'STALE', 'adapter replay without a fingerprint must report already-applied state as stale');
  assert.deepEqual(adapter.ledger, repairedLedger, 'already-executed adapter replay must not change repaired data');
  log('Already-executed adapter replay', { outcome: alreadyExecuted.outcome, detail: alreadyExecuted.detail });

  const completedKeyPolicy = evaluateExecutionPolicy({
    ...basePolicy,
    plan: { state: 'APPROVED', version: 2, approvalAction: 'APPROVE', approvedBy: 'controller' },
    expectedVersion: 2,
    idempotencyCompleted: true
  });
  log('Completed-key replay (idempotency, no mutation)', {
    outcome: completedKeyPolicy.outcome,
    codes: completedKeyPolicy.reasons.map((reason) => reason.code)
  });
  assert.equal(completedKeyPolicy.outcome, 'DENY', 'completed-key policy must deny another execution');
  assert.ok(
    completedKeyPolicy.reasons.some((reason) => reason.code === 'DUPLICATE_EXECUTION'),
    'completed-key policy must identify duplicate execution'
  );

  console.log('\nDEMO PASS: duplicate invoice line detected; approval required; repair verified.');
  console.log('Invoice total: 1000000.00 -> 500000.00');
  console.log('Replay: STALE | Completed-key policy: DENY (DUPLICATE_EXECUTION)');
  console.log('In-memory ConstrainedAction demonstration only; inventory investigate()/executeConstrainedRemediation() is a separate built-in path.');
  printSummary();
  return { executed, replay, alreadyExecuted, completedKeyPolicy, ledger: adapter.ledger, report };
}

/*
 * Optional Postgres mapping (docs only — existing public APIs, no library change).
 *
 * loadAllowlistConfig('./allowlist.demo.json') plus
 * `new PostgresSystemOfRecordAdapter(pool, { allowlist })` declare the writable
 * surface. Generic allowlisted updates are numeric columns with a before-value
 * guard (`invoice_lines.amount` in allowlist.demo.json). Timestamp reverse
 * (`reversed_at`) is hardcoded to `inventory_movements`.
 *
 * executeConstrainedRemediation() still re-runs the built-in inventory
 * investigate()/verifyState() loop, so a custom invoice detector cannot plug
 * into that helper today. Keep this ConstrainedActionAdapter +
 * evaluateExecutionPolicy lifecycle, and only use the Postgres allowlist for a
 * numeric correction you apply after policy ALLOW.
 */
