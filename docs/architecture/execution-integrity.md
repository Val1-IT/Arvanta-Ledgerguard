# Execution integrity (v0.2)

LedgerGuard is a deterministic execution integrity runtime for AI agents operating on systems of record.

The question it answers is not only “is this agent allowed to act?”. It also answers:

1. Is the approved action still valid for the current state?
2. Did it execute through an allowlisted mutation path?
3. Did the resulting system-of-record state satisfy the approved invariants?

An adapter returning success, or HTTP 200, is not proof. Success is declared only after deterministic verification.

```
DETECT → AUTHORIZE → EXECUTE → VERIFY
         (SIMULATE / AUDIT / RECOVER are designed, only RECOVER is partially implemented)
```

## Lifecycle

Successful path:

`PROPOSED → AUTHORIZED → RESERVED → EXECUTING → VERIFYING → COMMITTED`

Failure / recovery statuses:

`DENIED | STALE | VERIFICATION_FAILED | ROLLED_BACK | RECOVERY_REQUIRED | FAILED | ALREADY_EXECUTED`

These statuses appear on the structured `ExecutionReceipt`. The demo plan row still uses the v0.1 remediation state machine (`APPROVED` → `EXECUTING` → `VERIFYING` → `RESOLVED`).

## What v0.2 changes

- **Source-state fingerprint.** SHA-256 of the approved correction set. Stored on the receipt so later audit can see what was authorized.
- **In-transaction idempotency completion (PostgreSQL).** `completed` and the execution journal row are written on the same client as the ERP mutations, after verification PASS and before `COMMIT`. A crash no longer leaves `reserved` after a committed repair.
- **Stale `reserved` recovery.** Reservations carry a lease (default 60s). After expiry, LedgerGuard re-reads live state:
  - already applied → mark `completed` / `ALREADY_EXECUTED`
  - never applied → `failed_retryable` so a later authorized attempt may reserve
  - anything else → `RECOVERY_REQUIRED` (no mutation)
- **Adapter capability flags.** PostgreSQL advertises `nativeTransactions` and `idempotencyInNativeTransaction`. Callers must not assume other adapters can do the same.
- **Invariant primitives.** Existing quality checks are grouped as `InventoryInvariants` / `FinanceInvariants` without changing their evaluators.

## What v0.2 does not claim

- Exactly-once delivery.
- Crash recovery for adapters without native transactions.
- Durable in-process audit logs (`createMemoryAuditLog` is still request-scoped).
- Odoo / ERPNext adapters.
- Production authentication.

See [authority-model.md](authority-model.md) and [threat-model.md](../threat-model.md).
