import assert from 'node:assert/strict';
import {
  executeConstrainedRemediation,
  investigate,
  type InvestigationInput,
  type ProposedCorrection,
  type SystemOfRecordAdapter,
  type SystemOfRecordSession
} from '@ledgerguard/core';
import {
  Capability,
  evaluateExecutionPolicy,
  trustedRuntimeAuthority
} from '@ledgerguard/policy';

const capturedAt = new Date('2026-03-01T09:00:00.000Z');
const receivedAt = new Date('2026-03-02T14:15:00.000Z');

function scenario(): InvestigationInput {
  return {
    products: [{ id: 'ITEM-001', sku: 'WDG-001', name: 'Industrial Widget', baseUnit: 'PCS', standardCost: '85000.00' }],
    productUnits: [
      {
        id: 'pu-item-001-pcs',
        productId: 'ITEM-001',
        unitName: 'PCS',
        conversionFactor: '1.0000',
        validFrom: capturedAt,
        updatedAt: capturedAt
      }
    ],
    movements: [
      {
        id: 'MOV-001',
        productId: 'ITEM-001',
        movementType: 'in',
        quantity: '10.000',
        unitName: 'PCS',
        baseQuantity: '10.000',
        unitCost: '85000.00',
        totalValue: '850000.00',
        occurredAt: receivedAt,
        sourceReceiptId: 'RCP-001',
        eventIdentity: 'receipt:RCP-001:ITEM-001',
        reversedAt: null,
        reversesId: null
      },
      {
        id: 'MOV-002',
        productId: 'ITEM-001',
        movementType: 'in',
        quantity: '10.000',
        unitName: 'PCS',
        baseQuantity: '10.000',
        unitCost: '85000.00',
        totalValue: '850000.00',
        occurredAt: new Date('2026-03-02T14:15:00.250Z'),
        sourceReceiptId: 'RCP-001',
        eventIdentity: 'receipt:RCP-001:ITEM-001',
        reversedAt: null,
        reversesId: null
      }
    ],
    valuations: [
      {
        id: 'val-item-001',
        productId: 'ITEM-001',
        quantityOnHand: '20.000',
        averageCost: '85000.00',
        inventoryValue: '1700000.00',
        calculatedAt: new Date('2026-03-02T14:15:00.250Z')
      }
    ],
    journalEntries: [],
    marginReports: [],
    receipts: [
      {
        id: 'RCP-001',
        number: 'RCP-001',
        purchaseOrderId: 'PO-001',
        productId: 'ITEM-001',
        quantity: '10.000',
        receivedAt
      }
    ],
    baseline: {
      conversionFactor: { PCS: 1 },
      movements: { totalBaseIn: 10, totalBaseOut: 0, quantityOnHand: 10 },
      valuation: { averageCost: 85000, inventoryValue: 850000, quantityOnHand: 10 },
      margin: { revenue: 0, costOfGoodsSold: 0, grossProfit: 0, grossMarginPercentage: 0 },
      capturedAt
    }
  };
}

function applyRepair(snapshot: InvestigationInput, correction: ProposedCorrection): InvestigationInput {
  if (correction.action === 'REVERSE_INVENTORY_MOVEMENT' &&
      correction.table === 'inventory_movements' && correction.field === 'reversed_at') {
    assert.ok(snapshot.movements.some(row => row.id === correction.recordId), 'Demo movement record not found');
    return {
      ...snapshot,
      movements: snapshot.movements.map((movement) =>
        movement.id === correction.recordId ? { ...movement, reversedAt: new Date(correction.afterValue) } : movement
      )
    };
  }
  if (correction.action === 'REGENERATE_INVENTORY_VALUATION' &&
      correction.table === 'inventory_valuation' &&
      (correction.field === 'quantity_on_hand' || correction.field === 'inventory_value')) {
    assert.ok(snapshot.valuations.some(row => row.id === correction.recordId), 'Demo valuation record not found');
    return {
      ...snapshot,
      valuations: snapshot.valuations.map((row) => {
        if (row.id !== correction.recordId) return row;
        if (correction.field === 'quantity_on_hand') return { ...row, quantityOnHand: correction.afterValue };
        return { ...row, inventoryValue: correction.afterValue };
      })
    };
  }
  throw new Error(`Unsupported demo correction: ${correction.action} / ${correction.table}.${correction.field}`);
}

export class MemoryAdapter implements SystemOfRecordAdapter {
  readonly meta = { systemId: 'example-memory', systemType: 'memory' };
  constructor(public snapshot: InvestigationInput) {}
  async runInTransaction<T>(work: (session: SystemOfRecordSession) => Promise<T>): Promise<T> {
    const working = structuredClone(this.snapshot);
    try {
      const result = await work({
        loadInvestigationInput: async () => structuredClone(working),
        applyCorrection: async (correction) => {
          Object.assign(working, applyRepair(working, correction));
          return {
            sequence: correction.sequence,
            action: correction.action,
            table: correction.table,
            recordId: correction.recordId,
            status: 'APPLIED',
            detail: `${correction.field}: ${correction.beforeValue} -> ${correction.afterValue}`
          };
        }
      });
      this.snapshot = working;
      return result;
    } catch (error) {
      throw error;
    }
  }
}

function log(title: string, value: unknown) {
  console.log(`\n=== ${title} ===`);
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

export async function runInventoryDemo() {
  console.log('LedgerGuard local demo: synthetic in-memory data; no database or API keys.');
  const input = scenario();
  const report = investigate(input);
  assert.equal(report.incidentType, 'DUPLICATE_INVENTORY_MOVEMENT', 'demo must detect the duplicate movement');
  log('Incident', report.incidentType);
  log('Evidence', report.evidence.map((item) => ({ table: item.table, recordId: item.recordId, field: item.field, reason: item.reason })));
  log('Proposed repair', report.proposedCorrections);
  log('Side effects', {
    quantity: '20.000 → 10.000',
    valuation: '1700000.00 → 850000.00',
    primaryExposure: report.financialImpact.primaryExposure
  });

  const authority = trustedRuntimeAuthority({
    actorId: 'controller',
    actorType: 'human',
    capabilities: [Capability.remediationExecute, Capability.remediationApprove]
  });
  const beforeApproval = evaluateExecutionPolicy({
    evidenceCount: report.evidence.length,
    verificationExpectationCount: report.verificationExpectations.length,
    impactAmount: Number(report.financialImpact.primaryExposure),
    authority,
    plan: { state: 'DRAFT', version: 1, approvalAction: null, approvedBy: null },
    expectedVersion: 1,
    config: { financialApprovalThreshold: 1000, currency: 'IDR' },
    idempotencyCompleted: false
  });
  log('Policy before approval', { outcome: beforeApproval.outcome, codes: beforeApproval.reasons.map((reason) => reason.code) });
  assert.equal(beforeApproval.outcome, 'REQUIRE_APPROVAL', 'unapproved demo plan must require approval');

  // This fixed fixture simulates a human controller approval, not production authentication.
  console.log('\nSimulating human approval of demo plan version 2.');
  const afterApproval = evaluateExecutionPolicy({
    evidenceCount: report.evidence.length,
    verificationExpectationCount: report.verificationExpectations.length,
    impactAmount: Number(report.financialImpact.primaryExposure),
    authority,
    plan: { state: 'APPROVED', version: 2, approvalAction: 'APPROVE', approvedBy: 'controller' },
    expectedVersion: 2,
    config: { financialApprovalThreshold: 1000, currency: 'IDR' },
    idempotencyCompleted: false
  });
  log('Policy after approval', { outcome: afterApproval.outcome });
  assert.equal(afterApproval.outcome, 'ALLOW', 'approved demo plan must be allowed before execution');

  const adapter = new MemoryAdapter(input);
  const executed = await executeConstrainedRemediation(adapter, { approvedCorrections: report.proposedCorrections });
  assert.equal(executed.committed, true, 'demo repair must commit');
  assert.equal(executed.verification?.overallStatus, 'PASS', 'demo repair must pass verification');
  assert.equal(adapter.snapshot.valuations[0]?.quantityOnHand, '10.000', 'repaired quantity must be 10');
  assert.equal(adapter.snapshot.valuations[0]?.inventoryValue, '850000.00', 'repaired valuation must be 850000');
  assert.deepEqual(adapter.snapshot.movements.find(row => row.id === 'MOV-001'), input.movements[0], 'original movement must remain unchanged');
  assert.ok(adapter.snapshot.movements.find(row => row.id === 'MOV-002')?.reversedAt, 'duplicate movement must be reversed');
  log('Execution', {
    committed: executed.committed,
    verification: executed.verification?.overallStatus,
    quantity: adapter.snapshot.valuations[0]?.quantityOnHand,
    valuation: adapter.snapshot.valuations[0]?.inventoryValue
  });

  const repairedSnapshot = structuredClone(adapter.snapshot);
  const replay = await executeConstrainedRemediation(adapter, { approvedCorrections: report.proposedCorrections });
  assert.equal(replay.committed, false, 'stale adapter replay must not commit');
  assert.equal(replay.failureReason, 'DRIFT_DETECTED', 'stale adapter replay must detect drift');
  assert.deepEqual(adapter.snapshot, repairedSnapshot, 'replay must not change repaired data');
  log('Genuine drift (adapter replay without completed key)', {
    committed: replay.committed,
    failureReason: replay.failureReason
  });

  const completedKeyPolicy = evaluateExecutionPolicy({
    evidenceCount: report.evidence.length,
    verificationExpectationCount: report.verificationExpectations.length,
    impactAmount: Number(report.financialImpact.primaryExposure),
    authority,
    plan: { state: 'APPROVED', version: 2, approvalAction: 'APPROVE', approvedBy: 'controller' },
    expectedVersion: 2,
    config: { financialApprovalThreshold: 1000, currency: 'IDR' },
    idempotencyCompleted: true
  });
  log('Completed-key replay (idempotency, no drift check)', {
    outcome: completedKeyPolicy.outcome,
    codes: completedKeyPolicy.reasons.map((reason) => reason.code)
  });
  assert.equal(completedKeyPolicy.outcome, 'DENY', 'completed-key policy must deny another execution');
  assert.ok(completedKeyPolicy.reasons.some(reason => reason.code === 'DUPLICATE_EXECUTION'), 'completed-key policy must identify duplicate execution');
  console.log('\nDEMO PASS: duplicate detected; approval required; repair verified.');
  console.log('Quantity: 20.000 -> 10.000 | Valuation: 1700000.00 -> 850000.00');
  console.log('Replay: DRIFT_DETECTED | Completed-key policy: DENY (DUPLICATE_EXECUTION)');
  console.log('In-memory demonstration only; persisted idempotency and SQL transactions need the PostgreSQL integration path.');
  return { executed, replay, completedKeyPolicy, snapshot: adapter.snapshot };
}
