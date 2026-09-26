# Changelog

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
