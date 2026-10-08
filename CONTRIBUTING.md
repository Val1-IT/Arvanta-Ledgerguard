# Contributing

Please read the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

- Node.js 24, or supported 20.19+ / 22.12+ (see root `engines`)
- pnpm 9 (`packageManager` in root `package.json`)
- Docker (for PostgreSQL integration)

### Offline checks (no database or `.env`)

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm demo
```

### Disposable PostgreSQL and demo UI

```bash
cp .env.example .env
pnpm db:up && pnpm db:wait && pnpm db:migrate && pnpm db:seed
pnpm verify:integration
pnpm dev
```

The committed database defaults use loopback port 5433 and synthetic data. The example disables demo actions and external providers; only set DEMO_MODE=true for an isolated synthetic fixture when you deliberately want those actions.
`.env` is needed for optional UI/demo settings and integrations, not the offline
path. Never point these seed/reset commands at a non-demo database.

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
- PostgreSQL verification is before commit and failure must roll back. Remote failures are not evidence of rollback; keep uncertain outcomes recoverable.
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

## Keep migration metadata in sync

Commit the matching `drizzle/meta/*_snapshot.json` whenever a migration is added,
including handwritten SQL. Preserve the linked snapshot IDs and journal order;
never rewrite already-applied SQL to make generation quiet.

Before submitting a schema change, run `pnpm exec drizzle-kit check` and
`pnpm db:generate` in a disposable checkout. With unchanged schema, generation
must report no changes. With your intended change, inspect that it generates
only that change, not existing tables/columns. The migration-metadata regression
suite checks the snapshot chain and final schema; integration tests apply the
committed SQL against a real disposable PostgreSQL database.
