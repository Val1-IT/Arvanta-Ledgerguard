## Unreleased — private deployment gates

- Gate investigation UI actions before model, database or DataHub work; disable their controls by default.
- Use loopback-only Compose ports and read-only/deterministic example configuration.
- Add migration/schema-aware readiness and bounded database checks; handle idle pool disconnects without raw diagnostic logging.
- Exclude all non-example environment files from Docker context and constrain CI tokens, credentials and timeouts.
- Add isolated synthetic-data deployment/restart/rollback checks; this does not approve public or real-data production use.

## Unreleased — independent evaluation hardening

- Preserve recovery receipt provenance and persisted receipt fields.
- Snapshot execution requests before awaiting; keep contradictory/uncertain remote outcomes recoverable.
- Do not release remote reservations solely because an expired call currently appears not applied.
- Patch two remaining moderate development-tool dependency paths; one unpatched high braces advisory remains explicit.
- Reconcile PR #5 community forms, contributor guidance and historical archive into this integration branch without merging or editing that PR.
- Run Node 20/22/24 compatibility checks, default tooling/container to Node 24, and exercise real container HTTP startup.

## Unreleased — execution-boundary hardening

- Bind remote approval to persisted action, adapter identity and source fingerprint.
- Reject idempotency-key reuse across plans/versions; fence stale recovery updates by observed lease.
- Persist schema-valid remote results; retain uncertain writes for recovery.
- Add real PostgreSQL remote-control-plane round-trip coverage and explicit local-only Odoo test opt-in.
- Add an independent evaluator guide and structured feedback template.
- Odoo remains experimental; separate JSON-2 calls do not provide atomic preconditions.

# Changelog

## 0.3.0

Experimental Adapter SDK slice + Odoo 19 inventory adjustment. Not a general ERP connector.

- Additive `ConstrainedAction` / `ConstrainedActionAdapter` and `executeConstrainedAction`
- Adapter capabilities: `supportsStateVersioning`, `supportsSimulation`, `supportsCompensation`
- `@ledgerguard/odoo`: JSON-2 client allowlisted to `stock.quant` `search_read` / `write` / `action_apply_inventory`
- HTTP 200 is not verified success; independent re-read required
- State-bound `write_date` fingerprint; recovery classification for remote SoR
- Default CI unchanged; Odoo live tests are opt-in

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

### Atomic Odoo evaluation path

- Add opt-in constrained Odoo inventory addon with permission checks, row locking,
  pre-state validation, transactional verification and durable action receipts.
- Add server-side and live JSON-2 regression suites; retain experimental scope.
- Correct container build to use the pnpm workspace and add a container CI check.
