# Execution integrity (v0.3 experimental adapters)

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

These statuses appear on the structured `ExecutionReceipt`. The demo plan row uses `APPROVED` → `EXECUTING` → `VERIFYING` → `RESOLVED`. Native PostgreSQL crash recovery may use recovery-only transitions `EXECUTING|VERIFYING → RESOLVED` (applied) or `→ INTERRUPTED` (not applied). `INTERRUPTED → EXECUTING` resumes the original approval; it is not a new approval.

Reserved-key recovery runs **before** fresh execution policy and **before** `APPROVED → EXECUTING`. An in-flight leftover is not treated as a new execution attempt.

See [execution key state diagrams](execution-key-states.md) for key transitions and lease-expiry recovery.

## PostgreSQL atomicity vs other adapters

On PostgreSQL, `beforeCommit` writes the idempotency completion, execution journal, and `VERIFYING`/`RESOLVED` plan transitions on the **same client** as the verified mutations. `onWritesApplied` is not used for the default Postgres adapter.

Adapters without `idempotencyInNativeTransaction` still persist `VERIFYING` on a separate connection. Recovery remains the protocol for those leftovers. This is not exactly-once delivery.

Odoo 19 (`@ledgerguard/odoo`) is experimental: one `stock.quant` inventory adjustment over JSON-2. It declares `nativeTransactions: false` and never treats HTTP 200 as verified success.

## What v0.2 changes

- **Source-state fingerprint.** SHA-256 of the approved correction set. Stored on the receipt so later audit can see what was authorized.
- **In-transaction idempotency completion (PostgreSQL).** `completed` and the execution journal row are written on the same client as the ERP mutations, after verification PASS and before `COMMIT`. A crash no longer leaves `reserved` after a committed repair.
- **Stale `reserved` recovery.** Reservations carry a lease (default 60s). After expiry, LedgerGuard re-reads live state **before** approval/EXECUTING gates:
  - applied (verification PASS + expectations + after-values) → complete key, journal, plan `RESOLVED`, `ALREADY_EXECUTED`
  - not applied → `failed_retryable`; `EXECUTING`/`VERIFYING` become `INTERRUPTED` for a controlled retry
  - anything else, including vanished incidents with failed postconditions → `RECOVERY_REQUIRED` (no mutation, key stays reserved)
- **Adapter capability flags.** PostgreSQL advertises `nativeTransactions` and `idempotencyInNativeTransaction`. Callers must not assume other adapters can do the same.
- **Invariant primitives.** Existing quality checks are grouped as `InventoryInvariants` / `FinanceInvariants` without changing their evaluators.

## What v0.2 does not claim

- Exactly-once delivery.
- A distributed transaction across the control plane and remote adapters.
- Durable in-process audit logs (`createMemoryAuditLog` is still request-scoped).
- General-purpose Odoo or ERPNext mutation support.
- Production authentication.

See [authority-model.md](authority-model.md) and [threat-model.md](../threat-model.md).

## Remote approval snapshot and conditional Odoo operation

A remote plan persists `remoteActionBinding` at draft creation. It binds exact
action JSON, trusted system ID/type, and fingerprint; the normal human approval
transition approves that persisted snapshot. Execution and replay validate the
binding before reading keys or contacting the adapter. Changing intent requires
a new draft. Existing approved remote rows without a binding fail closed.

A post-write remote verification failure remains `VERIFYING` with
`RECOVERY_REQUIRED`; it is not a SQL rollback. Valid execution and verification
records remain loadable after persistence, including failed/uncertain outcomes.

The optional Odoo addon performs its conditional action, verification and receipt
write inside one Odoo transaction. `nativeTransactions` and
`idempotencyInNativeTransaction` stay false for the cross-system control plane;
narrow addon capabilities describe only that remote conditional operation.
See [Odoo scope and limits](../integrations/odoo.md).

## Preserved evidence and conservative remote retries

Recovered receipts and journal rows identify the original execution-key owner
version and approved source fingerprint. The live plan version is used only for
optimistic state transitions. Receipt fields survive the plan schema parser and
reload, so operators can inspect the same execution identity after recovery.

For remote actions, a lease deadline is not a cancellation acknowledgement.
Even a current `not_applied` observation cannot prove the old request will never
arrive. The control plane therefore keeps the reservation and reports
`RECOVERY_REQUIRED`; it does not automatically release a key or start another
remote attempt. This intentionally differs from native transactional recovery.
