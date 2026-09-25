# Duplicate inventory movement example

This example proves LedgerGuard can handle a second incident type without DataHub and without a parallel execution stack.

## Before

| Record | Quantity |
| --- | --- |
| Receipt RCP-001 | 10 |
| MOV-001 | +10 |
| MOV-002 | +10 (duplicate event `receipt:RCP-001:ITEM-001`) |
| Inventory | 20 units / 1,700,000 |

## Investigation

Deterministic detector: same receipt, same item, same event identity, same inbound quantity, two active movements. Earliest movement is legitimate; later one is the duplicate.

## Repair

`REVERSE_INVENTORY_MOVEMENT` on MOV-002 only, then valuation 20 → 10 and 1,700,000 → 850,000.

## After

Inventory 10. MOV-001 untouched.

## Safety lifecycle

evidence → policy (`REQUIRE_APPROVAL` above threshold) → trusted authority → approval of exact plan version → idempotency → transaction → verify → commit. A second run is `DRIFT_DETECTED` / no further reversal.

In-memory harness (no Docker):

```
pnpm scenario:duplicate-inventory:memory
```

PostgreSQL (after `pnpm db:migrate && pnpm db:seed`):

```
pnpm scenario:duplicate-inventory
```
