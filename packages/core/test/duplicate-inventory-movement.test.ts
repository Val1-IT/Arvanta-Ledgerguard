import { describe, expect, it } from 'vitest';
import {
  executeConstrainedRemediation,
  investigate,
  type InvestigationInput,
  type ProposedCorrection,
  type SystemOfRecordAdapter,
  type SystemOfRecordSession
} from '@ledgerguard/core';
import { duplicateIncidentInput } from './duplicate-fixtures';

class MemoryAdapter implements SystemOfRecordAdapter {
  readonly meta = { systemId: 'duplicate-memory', systemType: 'memory' };
  commits = 0;
  rollbacks = 0;
  snapshot: InvestigationInput;

  constructor(
    snapshot: InvestigationInput,
    private readonly apply: (current: InvestigationInput, correction: ProposedCorrection) => InvestigationInput
  ) {
    this.snapshot = structuredClone(snapshot);
  }

  async runInTransaction<T>(work: (session: SystemOfRecordSession) => Promise<T>): Promise<T> {
    const working = structuredClone(this.snapshot);
    const session: SystemOfRecordSession = {
      loadInvestigationInput: async () => structuredClone(working),
      applyCorrection: async (correction) => {
        Object.assign(working, this.apply(working, correction));
        return {
          sequence: correction.sequence,
          action: correction.action,
          table: correction.table,
          recordId: correction.recordId,
          status: 'APPLIED',
          detail: `${correction.field}: ${correction.beforeValue} -> ${correction.afterValue}`
        };
      }
    };
    try {
      const result = await work(session);
      this.snapshot = working;
      this.commits += 1;
      return result;
    } catch (error) {
      this.rollbacks += 1;
      throw error;
    }
  }
}

function applyDuplicateRepair(snapshot: InvestigationInput, correction: ProposedCorrection): InvestigationInput {
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

describe('DUPLICATE_INVENTORY_MOVEMENT detector', () => {
  it('detects a true duplicate with structured evidence', () => {
    const report = investigate(duplicateIncidentInput());
    expect(report.incidentType).toBe('DUPLICATE_INVENTORY_MOVEMENT');
    expect(report.evidence.some((item) => item.recordId === 'RCP-001')).toBe(true);
    expect(report.evidence.some((item) => item.recordId === 'MOV-001')).toBe(true);
    expect(report.evidence.some((item) => item.recordId === 'MOV-002' && item.field === 'event_identity')).toBe(true);
    expect(report.proposedCorrections[0]?.action).toBe('REVERSE_INVENTORY_MOVEMENT');
    expect(report.proposedCorrections[0]?.recordId).toBe('MOV-002');
    expect(report.financialImpact.primaryExposure).toBe('850000.00');
  });

  it('does not flag two receipts on the same purchase order as duplicates', () => {
    const input = duplicateIncidentInput({
      receipts: [
        {
          id: 'RCP-001',
          number: 'RCP-001',
          purchaseOrderId: 'PO-001',
          productId: 'ITEM-001',
          quantity: '10.000',
          receivedAt: new Date('2026-03-02T14:15:00.000Z')
        },
        {
          id: 'RCP-002',
          number: 'RCP-002',
          purchaseOrderId: 'PO-001',
          productId: 'ITEM-001',
          quantity: '10.000',
          receivedAt: new Date('2026-03-03T10:00:00.000Z')
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
          occurredAt: new Date('2026-03-02T14:15:00.000Z'),
          sourceReceiptId: 'RCP-001',
          eventIdentity: 'receipt:RCP-001:ITEM-001',
          reversedAt: null,
          reversesId: null
        },
        {
          id: 'MOV-003',
          productId: 'ITEM-001',
          movementType: 'in',
          quantity: '10.000',
          unitName: 'PCS',
          baseQuantity: '10.000',
          unitCost: '85000.00',
          totalValue: '850000.00',
          occurredAt: new Date('2026-03-03T10:00:00.000Z'),
          sourceReceiptId: 'RCP-002',
          eventIdentity: 'receipt:RCP-002:ITEM-001',
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
          calculatedAt: new Date('2026-03-03T10:00:00.000Z')
        }
      ]
    });
    expect(investigate(input).incidentType).toBeNull();
  });

  it('does not reverse when quantities differ', () => {
    const input = duplicateIncidentInput({
      movements: duplicateIncidentInput().movements.map((movement, index) =>
        index === 1 ? { ...movement, quantity: '8.000', baseQuantity: '8.000', totalValue: '680000.00' } : movement
      )
    });
    expect(investigate(input).incidentType).toBeNull();
  });
});

describe('duplicate repair execution', () => {
  it('reverses only MOV-002 and leaves MOV-001 active', async () => {
    const broken = duplicateIncidentInput();
    const approved = investigate(broken).proposedCorrections;
    const adapter = new MemoryAdapter(broken, applyDuplicateRepair);
    const result = await executeConstrainedRemediation(adapter, { approvedCorrections: approved });

    expect(result.committed).toBe(true);
    expect(result.verification?.overallStatus).toBe('PASS');
    const repaired = investigate(adapter.snapshot);
    expect(repaired.incidentType).toBeNull();
    expect(adapter.snapshot.movements.find((movement) => movement.id === 'MOV-001')?.reversedAt).toBeNull();
    expect(adapter.snapshot.movements.find((movement) => movement.id === 'MOV-002')?.reversedAt).not.toBeNull();
    expect(adapter.snapshot.valuations[0]?.quantityOnHand).toBe('10.000');
    expect(adapter.snapshot.valuations[0]?.inventoryValue).toBe('850000.00');
  });

  it('rolls back when verification is intentionally wrong', async () => {
    const broken = duplicateIncidentInput();
    const approved = investigate(broken).proposedCorrections;
    const adapter = new MemoryAdapter(broken, (snapshot) => snapshot);
    const result = await executeConstrainedRemediation(adapter, { approvedCorrections: approved });
    expect(result.committed).toBe(false);
    expect(result.failureReason).toBe('VERIFICATION_FAILED');
    expect(adapter.rollbacks).toBe(1);
    expect(adapter.snapshot.valuations[0]?.quantityOnHand).toBe('20.000');
  });

  it('does not mutate again after a successful repair', async () => {
    const broken = duplicateIncidentInput();
    const approved = investigate(broken).proposedCorrections;
    const adapter = new MemoryAdapter(broken, applyDuplicateRepair);
    await executeConstrainedRemediation(adapter, { approvedCorrections: approved });
    const second = await executeConstrainedRemediation(adapter, { approvedCorrections: approved });
    expect(second.committed).toBe(false);
    expect(second.failureReason).toBe('DRIFT_DETECTED');
    expect(adapter.snapshot.valuations[0]?.quantityOnHand).toBe('10.000');
  });
});


