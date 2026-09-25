# Contributing

## Setup

- Node.js 20+
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
