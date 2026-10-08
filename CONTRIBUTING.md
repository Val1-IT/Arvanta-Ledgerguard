# Contributing

## Setup

- Node.js 24, or supported 20.19+ / 22.12+ (see root `engines`)
- pnpm 9 (`packageManager` in root `package.json`)
- Docker (for PostgreSQL integration)

```bash
pnpm install
cp .env.example .env
pnpm db:up && pnpm db:wait && pnpm db:migrate && pnpm db:seed
pnpm verify
```

## Commands

| Command | What it runs |
| --- | --- |
| `pnpm verify` | typecheck, lint, unit tests (no DataHub, no Docker) |
| `pnpm verify:integration` | migrate + Postgres integration tests |
| `pnpm test:datahub` | optional live DataHub suite |

## Packages

- `packages/core` — investigation, evidence, verification, execution ports
- `packages/policy` — deterministic policy and `AuthorityContext`
- `packages/postgres` — allowlisted SQL adapter
- `packages/datahub` — optional catalog integration
- `app/` — demo UI only

## Invariants (do not weaken)

- The LLM is not authority. Do not accept capabilities or policy decisions from model output.
- No arbitrary write SQL. Mutations go through typed corrections and the adapter allowlist.
- Verify-before-commit. Verification failure must roll back.
- Policy is ordinary TypeScript, not prompts.
- DataHub is optional and outside the execution authority boundary.
- `@ledgerguard/core` must not depend on postgres, DataHub, Next, or LLM SDKs.
- `@ledgerguard/policy` must not depend on postgres or DataHub.

## Adding a detector

1. Implement `IncidentDetector` under `packages/core/src/detectors/`.
2. Keep detection deterministic (structured evidence, no NLP as the proof).
3. Add unit tests for true positive, false positive, and repair/verify.
4. If PostgreSQL columns are required, migrate with a new `drizzle/*.sql` file and an integration test.
5. Document the scenario and that v0.1 still prefers conversion mismatch when both fire.

## Pull requests

- Keep the conversion-mismatch tests green.
- Add tests for new behavior.
- Do not commit secrets.
- Do not claim production readiness.

## Execution-boundary regression checks

Use a disposable PostgreSQL database for `pnpm verify:integration`; its fixtures
reset synthetic tables. `tests/integration/remote-control-plane.test.ts` exercises
persisted remote approval and receipt reload with a simulated remote transport.
Keep the distinction from the real Odoo JSON-2 suite explicit.

For remote runtime changes, cover action substitution after approval, stale state,
wrong-plan idempotency keys, renewed-lease recovery races, post-write transport
failure, verification failure followed by recovery, and durable record reloads.
A passing mocked pool must not substitute for database integration coverage.

For Odoo addon changes, run offline TypeScript/Python checks, then the isolated
Odoo CI server and live suites. Never run mutating integration tests with a
production credential or connection string.
