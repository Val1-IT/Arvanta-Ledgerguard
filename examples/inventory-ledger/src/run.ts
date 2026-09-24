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
  if (correction.action === 'REVERSE_INVENTORY_MOVEMENT') {
    return {
      ...snapshot,
      movements: snapshot.movements.map((movement) =>
        movement.id === correction.recordId ? { ...movement, reversedAt: new Date(correction.afterValue) } : movement
      )
    };
  }
  if (correction.table === 'inventory_valuation') {
    return {
      ...snapshot,
      valuations: snapshot.valuations.map((row) => {
        if (row.id !== correction.recordId) return row;
        if (correction.field === 'quantity_on_hand') return { ...row, quantityOnHand: correction.afterValue };
        if (correction.field === 'inventory_value') return { ...row, inventoryValue: correction.afterValue };
        return row;
      })
    };
  }
  return snapshot;
}

class MemoryAdapter implements SystemOfRecordAdapter {
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

async function main() {
  const input = scenario();
  const report = investigate(input);
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

  const adapter = new MemoryAdapter(input);
  const executed = await executeConstrainedRemediation(adapter, { approvedCorrections: report.proposedCorrections });
  log('Execution', {
    committed: executed.committed,
    verification: executed.verification?.overallStatus,
    quantity: adapter.snapshot.valuations[0]?.quantityOnHand,
    valuation: adapter.snapshot.valuations[0]?.inventoryValue
  });

  const replay = await executeConstrainedRemediation(adapter, { approvedCorrections: report.proposedCorrections });
  log('Idempotent replay', { committed: replay.committed, failureReason: replay.failureReason });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
