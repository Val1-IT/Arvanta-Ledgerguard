# Contributing

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) before opening issues or pull requests.

## Setup

- Node.js 20+ (Node 20 reached end-of-life in April 2026; CI also runs 22 and 24)
- pnpm 9 (`packageManager` in root `package.json`)
- Docker (only for PostgreSQL integration and the Next.js demo UI)

### Unit tests and the in-memory demo (no `.env`, Docker, or database)

```bash
pnpm install
pnpm verify
```

`pnpm demo` / `pnpm scenario:duplicate-inventory:memory` also run without `.env`. `.env.example` is not required for this path.

### PostgreSQL integration or the demo UI

Copy [`.env.example`](.env.example) to `.env`. The committed defaults already match Compose (`DATABASE_URL=postgres://ledgerguard:ledgerguard@localhost:5433/ledgerguard`, `DEMO_MODE=true`). DataHub URLs and LLM API keys are optional.

`src/db/*` and Drizzle load `.env` via `dotenv` and fall back to that same `DATABASE_URL` if the variable is unset, so the copy is what turns on `DEMO_MODE` for the UI and holds optional DataHub/LLM keys — not a required extra database URL.

```bash
cp .env.example .env
pnpm db:up && pnpm db:wait && pnpm db:migrate && pnpm db:seed
pnpm verify:integration
```

Then `pnpm dev` for the Next.js demo UI. Do not point `DATABASE_URL` at a non-demo database.

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
- Repair proposals come from deterministic detectors; the LLM never authors mutations.
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
5. Document the scenario and that v0.2 still prefers conversion mismatch when both fire.

## Pull requests

- Keep the conversion-mismatch tests green.
- Add tests for new behavior.
- Do not commit secrets.
- Do not claim production readiness.
