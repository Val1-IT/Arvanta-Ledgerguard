# Execution readiness milestones

Baseline: main `318448a`; open Odoo PR #3 head `1a7db2d`; latest published tag
`v0.2.0`. This branch builds on PR #3 and does not merge or release it.

1. **Control-plane integrity:** reproduce and fix unbound remote approval,
   cross-plan/version idempotency reuse, stale recovery overwrites, invalid
   persisted results, and accidental live-test activation. Add regression tests
   and validate against real isolated PostgreSQL.
2. **Odoo conditional operation:** implement an optional constrained server-side
   method with permission checks, approved-state validation, inventory mutation,
   verification and durable replay in one Odoo transaction. Retain explicit
   experimental labeling until isolated integration evidence passes.
3. **Independent evaluation:** keep demo/validation commands reproducible; add
   integration limitations, an evaluator guide, and structured feedback intake.

The acceptance evidence is executable tests and reviewable changes, not claims
of production readiness or outside adoption. A passing mock test is not proof
of remote transaction atomicity. Program selection remains discretionary and no
Codex OSS application is submitted by these changes.
