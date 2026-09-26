# Changelog

## 0.2.0

Reliability slice for execution integrity. Not a full adapter SDK and not exactly-once semantics.

- Structured `ExecutionReceipt` with source-state fingerprint and lifecycle status
- PostgreSQL completes the idempotency key and writes `ledgerguard_execution_journal` in the same transaction as verified mutations
- Stale `reserved` keys gain a lease; recovery runs before fresh approval/EXECUTING gates
- Applied recovery verifies postconditions, persists a recovered receipt/journal, and reconciles the plan to `RESOLVED`
- Not-applied leftovers become `INTERRUPTED` for a controlled retry; ambiguous leftovers return `RECOVERY_REQUIRED`
- PostgreSQL writes `VERIFYING`/`RESOLVED` on the same client as verified mutations (not a split pool update)
- Adapter capability flags: `nativeTransactions`, `idempotencyInNativeTransaction`
- Inventory and finance invariant primitives re-export the existing quality checks
- v0.1 public investigation, policy, and allowlisted correction behavior is unchanged
- PostgreSQL integration tests cover atomic commit, pre-commit rollback, verification failure, completed-key replay, and the 0005 journal migration
- `@ledgerguard/policy` 0.2.0 adds recovery audit event types (`execution.recovery_*`, `execution.reconciled`)

## 0.1.1

External usability / tester onboarding. No execution-integrity architecture changes.

- One-command `pnpm demo` (in-memory duplicate-inventory scenario)
- README leads with clone + `pnpm demo`; no Docker, `.env`, database, or API key for the basic demo
- Fresh-clone CI on Ubuntu and Windows, including a repeat demo run
- Asserted demo output (`DEMO PASS`) and additional demo safety tests
- Tester bug-report CTA in README

## 0.1.0

First public-facing LedgerGuard cut (GitHub source; packages are not published to npm).

- Extracted `@ledgerguard/core` (deterministic investigation, evidence, verification, execution contracts)
- Extracted `@ledgerguard/postgres` (allowlisted transactional adapter)
- Optional `@ledgerguard/datahub` (catalog context; not authority)
- `@ledgerguard/policy` (ALLOW / DENY / REQUIRE_APPROVAL, trusted capabilities)
- Plan-version human approval and persisted execution idempotency
- Completed-key replay returns `ALREADY_EXECUTED` without a second mutation
- Scenario: unit conversion mismatch (`1 CARTON = 12` recorded as `10`)
- Scenario: duplicate inventory movement (receipt 10, two +10 postings)
- Verify-before-commit with rollback on verification failure
