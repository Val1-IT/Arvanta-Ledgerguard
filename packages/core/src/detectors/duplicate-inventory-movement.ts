import { formatMoney, formatQuantity, toDecimal, ZERO } from '../decimal';
import { buildFinancialImpact } from '../financial-exposure';
import type { EvidenceItem, InventoryMovementRecord, InvestigationInput, ProposedCorrection } from '../types';
import type { DetectorHit, IncidentDetector } from './types';

function isActive(movement: InventoryMovementRecord): boolean {
  return movement.reversedAt == null && movement.reversesId == null;
}

export interface DuplicateGroup {
  eventIdentity: string;
  receiptId: string;
  productId: string;
  quantity: string;
  unitCost: string;
  legitimate: InventoryMovementRecord;
  duplicates: InventoryMovementRecord[];
}

export function findDuplicateMovementGroups(input: InvestigationInput): DuplicateGroup[] {
  const active = input.movements
    .filter((movement) => movement.movementType === 'in')
    .filter(isActive)
    .filter((movement) => Boolean(movement.eventIdentity) && Boolean(movement.sourceReceiptId))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));

  const groups = new Map<string, InventoryMovementRecord[]>();
  for (const movement of active) {
    const key = `${movement.eventIdentity}|${movement.sourceReceiptId}|${movement.productId}`;
    const group = groups.get(key) ?? [];
    group.push(movement);
    groups.set(key, group);
  }

  const duplicates: DuplicateGroup[] = [];
  for (const members of groups.values()) {
    if (members.length < 2 || !members[0]) continue;
    const quantities = new Set(members.map((movement) => movement.quantity));
    const receiptIds = new Set(members.map((movement) => movement.sourceReceiptId));
    if (quantities.size !== 1 || receiptIds.size !== 1) continue;
    const legitimate = members[0];
    duplicates.push({
      eventIdentity: legitimate.eventIdentity ?? '',
      receiptId: legitimate.sourceReceiptId ?? '',
      productId: legitimate.productId,
      quantity: legitimate.quantity,
      unitCost: legitimate.unitCost,
      legitimate,
      duplicates: members.slice(1)
    });
  }
  return duplicates;
}

export const duplicateInventoryMovementDetector: IncidentDetector = {
  incidentType: 'DUPLICATE_INVENTORY_MOVEMENT',
  detect(input: InvestigationInput): DetectorHit | null {
    const groups = findDuplicateMovementGroups(input);
    const group = groups[0];
    if (!group) return null;

    const receipt = (input.receipts ?? []).find((item) => item.id === group.receiptId);
    const valuation = input.valuations.find((item) => item.productId === group.productId);
    const duplicate = group.duplicates[0];
    if (!duplicate) return null;

    const receiptQty = toDecimal(receipt?.quantity ?? group.quantity);
    const actualQty = toDecimal(group.quantity).times(group.duplicates.length + 1);
    const unitCost = toDecimal(group.unitCost);
    const expectedValue = receiptQty.times(unitCost);
    const actualValue = valuation ? toDecimal(valuation.inventoryValue) : actualQty.times(unitCost);
    const now = duplicate.occurredAt;

    const evidence: EvidenceItem[] = [
      {
        table: 'purchase_receipts',
        recordId: group.receiptId,
        field: 'quantity',
        expectedValue: formatQuantity(receiptQty),
        actualValue: formatQuantity(receiptQty),
        delta: '0.000',
        reason: `Receipt ${receipt?.number ?? group.receiptId} exists once with quantity ${formatQuantity(receiptQty)}`
      },
      {
        table: 'inventory_movements',
        recordId: group.legitimate.id,
        field: 'source_receipt_id',
        expectedValue: group.receiptId,
        actualValue: group.receiptId,
        delta: '0',
        reason: `Movement ${group.legitimate.id} derives from receipt ${group.receiptId}`
      },
      {
        table: 'inventory_movements',
        recordId: duplicate.id,
        field: 'source_receipt_id',
        expectedValue: group.receiptId,
        actualValue: group.receiptId,
        delta: '0',
        reason: `Movement ${duplicate.id} also derives from receipt ${group.receiptId}`
      },
      {
        table: 'inventory_movements',
        recordId: duplicate.id,
        field: 'event_identity',
        expectedValue: group.eventIdentity,
        actualValue: group.eventIdentity,
        delta: '0',
        reason: `Both movements share semantic event identity ${group.eventIdentity}`
      },
      {
        table: 'inventory_valuation',
        recordId: valuation?.id ?? group.productId,
        field: 'quantity_on_hand',
        expectedValue: formatQuantity(receiptQty),
        actualValue: formatQuantity(actualQty),
        delta: formatQuantity(actualQty.minus(receiptQty)),
        reason: `Inventory increased by ${formatQuantity(actualQty)} instead of the receipt quantity ${formatQuantity(receiptQty)}`
      }
    ];

    const proposedCorrections: ProposedCorrection[] = [
      {
        sequence: 1,
        action: 'REVERSE_INVENTORY_MOVEMENT',
        table: 'inventory_movements',
        recordId: duplicate.id,
        field: 'reversed_at',
        beforeValue: '',
        afterValue: now.toISOString(),
        financialDelta: null,
        rollbackAssumption: 'clears reversed_at so the duplicate movement becomes active again'
      }
    ];

    if (valuation) {
      proposedCorrections.push(
        {
          sequence: 2,
          action: 'REGENERATE_INVENTORY_VALUATION',
          table: 'inventory_valuation',
          recordId: valuation.id,
          field: 'quantity_on_hand',
          beforeValue: formatQuantity(toDecimal(valuation.quantityOnHand)),
          afterValue: formatQuantity(receiptQty),
          financialDelta: null,
          rollbackAssumption: 'previous on-hand quantity retained for rollback'
        },
        {
          sequence: 3,
          action: 'REGENERATE_INVENTORY_VALUATION',
          table: 'inventory_valuation',
          recordId: valuation.id,
          field: 'inventory_value',
          beforeValue: formatMoney(toDecimal(valuation.inventoryValue)),
          afterValue: formatMoney(expectedValue),
          financialDelta: formatMoney(expectedValue.minus(toDecimal(valuation.inventoryValue))),
          rollbackAssumption: 'previous inventory value retained for rollback'
        }
      );
    }

    const financialImpact = buildFinancialImpact({
      inventoryValueDelta: expectedValue.minus(actualValue),
      cogsDelta: ZERO,
      grossProfitDelta: ZERO,
      grossMarginPercentageDelta: ZERO,
      onHandAffectedUnits: receiptQty,
      soldAffectedUnits: ZERO,
      totalBaseInAffected: receiptQty
    });

    return {
      incidentType: 'DUPLICATE_INVENTORY_MOVEMENT',
      rootCause: {
        asset: 'inventory_movements',
        field: 'event_identity',
        productId: group.productId,
        unitId: duplicate.id,
        unitName: group.eventIdentity,
        expectedValue: formatQuantity(receiptQty),
        actualValue: formatQuantity(actualQty),
        delta: formatQuantity(actualQty.minus(receiptQty)),
        expectedValueSource: {
          type: 'purchase_receipt',
          recordId: group.receiptId,
          capturedAt: receipt?.receivedAt ?? group.legitimate.occurredAt,
          evidenceReference: `purchase_receipts.${group.receiptId}.quantity`
        }
      },
      evidence,
      proposedCorrections,
      verificationExpectations: [],
      affectedMovementIds: [group.legitimate.id, duplicate.id],
      affectedValuationIds: valuation ? [valuation.id] : [],
      financialImpact
    };
  }
};
