# Duplicate inventory movement

Second independent LedgerGuard scenario. It uses the same runtime as conversion mismatch: `investigate()` detector registry, policy, trusted authority, approval, idempotency, constrained adapter, verify-before-commit.

It does not use DataHub.

## Before

- Purchase receipt RCP-001 quantity 10
- MOV-001 +10 for event `receipt:RCP-001:ITEM-001`
- MOV-002 +10 for the same event (duplicated system posting)
- Inventory 20 units, valuation 1,700,000

## Investigation

The detector groups active inbound movements by `eventIdentity + sourceReceiptId + productId`. A group is a duplicate only when size ≥ 2 and quantities match. Different receipts on the same purchase order are not duplicates. Different quantities are not auto-reversed.

## Repair

Reverse only the later movement (`REVERSE_INVENTORY_MOVEMENT` on `reversed_at`). Update inventory quantity 20 → 10 and valuation 1,700,000 → 850,000.

## After

Inventory 10. MOV-001 remains active.

## Safety

The repair cannot execute without evidence, verification rules, `remediation.execute`, and approval of the exact plan version. A second identical execution does not reverse again.
