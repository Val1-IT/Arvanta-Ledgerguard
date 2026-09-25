import { describe, expect, it } from 'vitest';
import { investigate } from '@ledgerguard/core';
import { Capability, assertTrustedApprover, evaluateExecutionPolicy, trustedRuntimeAuthority } from '@ledgerguard/policy';

function duplicateInput() {
  const capturedAt = new Date('2026-03-01T09:00:00.000Z');
  const receivedAt = new Date('2026-03-02T14:15:00.000Z');
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
        movementType: 'in' as const,
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
        movementType: 'in' as const,
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

describe('duplicate inventory policy', () => {
  it('requires approval, denies unauthorized execute, and rejects agent approval', () => {
    const report = investigate(duplicateInput());
    expect(report.incidentType).toBe('DUPLICATE_INVENTORY_MOVEMENT');

    const approvalNeeded = evaluateExecutionPolicy({
      evidenceCount: report.evidence.length,
      verificationExpectationCount: report.verificationExpectations.length,
      impactAmount: Number(report.financialImpact.primaryExposure),
      authority: trustedRuntimeAuthority({
        actorId: 'controller',
        actorType: 'human',
        capabilities: [Capability.remediationExecute, Capability.remediationApprove]
      }),
      plan: { state: 'DRAFT', version: 1, approvalAction: null, approvedBy: null },
      expectedVersion: 1,
      config: { financialApprovalThreshold: 1000, currency: 'IDR' },
      idempotencyCompleted: false
    });
    expect(approvalNeeded.outcome).toBe('REQUIRE_APPROVAL');

    const unauthorized = evaluateExecutionPolicy({
      evidenceCount: report.evidence.length,
      verificationExpectationCount: report.verificationExpectations.length,
      impactAmount: Number(report.financialImpact.primaryExposure),
      authority: trustedRuntimeAuthority({
        actorId: 'reader',
        actorType: 'human',
        capabilities: [Capability.investigationRead]
      }),
      plan: { state: 'APPROVED', version: 2, approvalAction: 'APPROVE', approvedBy: 'controller' },
      expectedVersion: 2,
      config: { financialApprovalThreshold: null, currency: 'IDR' },
      idempotencyCompleted: false
    });
    expect(unauthorized.outcome).toBe('DENY');

    expect(() =>
      assertTrustedApprover({
        actorId: 'llm',
        actorType: 'agent',
        capabilities: [Capability.remediationApprove],
        source: 'trusted_runtime',
        issuedAt: new Date().toISOString()
      })
    ).toThrow();

    const stale = evaluateExecutionPolicy({
      evidenceCount: report.evidence.length,
      verificationExpectationCount: report.verificationExpectations.length,
      impactAmount: Number(report.financialImpact.primaryExposure),
      authority: trustedRuntimeAuthority({
        actorId: 'controller',
        actorType: 'human',
        capabilities: [Capability.remediationExecute, Capability.remediationApprove]
      }),
      plan: { state: 'APPROVED', version: 4, approvalAction: 'APPROVE', approvedBy: 'controller' },
      expectedVersion: 3,
      config: { financialApprovalThreshold: null, currency: 'IDR' },
      idempotencyCompleted: false
    });
    expect(stale.outcome).toBe('DENY');
  });
});
