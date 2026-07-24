# Arvanta LedgerGuard

**Autonomous ERP financial-integrity agent, powered by DataHub context.**

LedgerGuard detects, traces, explains, and helps safely remediate the impact of
operational data errors on stock, inventory valuation, cost of goods sold (COGS),
accounting journals, and gross-margin reporting.

It demonstrates one clear end-to-end flow:

1. The system starts with healthy ERP data.
2. A user simulates a **unit-conversion error** (e.g. `1 CARTON = 12 PCS` is
   wrongly changed to `1 CARTON = 10 PCS`).
3. The error ripples downstream:
   `product_units → inventory_movements → inventory_valuation → journal_entries → gross_margin_report`.
4. LedgerGuard detects the problem, reads **DataHub context** (schema, lineage,
   ownership, glossary, tags, quality signals) through the **DataHub MCP Server**,
   finds the root cause, computes the **blast radius** and **estimated financial
   exposure**, proposes a **remediation plan**, requires **human approval**,
   executes the fix in a safe transaction, re-verifies integrity, and writes the
   investigation and resolution back to DataHub before closing the incident.

> **Category:** Agents That Do Real Work — the agent uses the DataHub MCP Server /
> Agent Context Kit as its primary path to read metadata and write back results.

## Architecture at a glance

- **Deterministic financial engine** (TypeScript) computes every number: affected
  records, blast radius, inventory valuation, COGS, journal reconciliation,
  financial exposure, remediation SQL, execution, and verification.
- **Agent** (single primary LLM provider) handles judgement, not arithmetic: it
  plans the investigation, selects and calls DataHub MCP tools, summarises
  evidence, explains the root cause, and produces the remediation rationale — all
  as schema-validated structured output.
- **DataHub** is the context graph and the system of record for quality status.
  Bootstrap (datasets, schema, owners, glossary, tags, lineage) is done via the
  DataHub Python SDK / ingestion recipes; the agent reads and writes back through
  MCP; GraphQL/OpenAPI is a supporting adapter only.
- **PostgreSQL** holds the synthetic demo ERP data. Remediation runs inside a
  database transaction with rollback on failure.

## Tech stack

Next.js 15 (App Router) · React 18 · TypeScript · Tailwind CSS · Drizzle ORM ·
PostgreSQL · Zod · DataHub (MCP + SDK) · Vitest.

## Status

Early build. Implementation proceeds in phases (see
`docs/plans/arvanta-ledgerguard-implementation-plan.md`). Currently completed:
project scaffold (FASE 1) and demo database schema, deterministic seed,
conversion-error scenario, and reset (FASE 2).

## Local development

```bash
cp .env.example .env      # then fill in values as needed
npm install
npm run db:setup          # up + wait + migrate + seed (fully non-interactive)
npm run dev               # http://localhost:3000
```

`db:setup` is a convenience wrapper. The individual steps are:

```bash
npm run db:up             # start demo PostgreSQL (Docker) on host port 5433
npm run db:wait           # block until Postgres accepts connections
npm run db:migrate        # apply committed SQL migrations from ./drizzle
npm run db:seed           # load deterministic healthy baseline
```

Every step is non-interactive and safe to re-run. `db:migrate` replays the
versioned SQL files committed under `drizzle/` and records what it has applied in
`__drizzle_migrations`; it never prompts and never diffs against a live database.
(`drizzle-kit push` is deliberately **not** used — it is interactive and unsuitable
for reproducible setup. `npm run db:generate` is for authoring a new migration
after changing `src/db/schema.ts`.)

Other database commands:

```bash
npm run db:reset          # truncate + reseed back to the healthy baseline
npm run db:down           # stop the container (keeps data volume)
npm run db:nuke           # stop and DELETE this project's data volume
npm run scenario:conversion-error   # apply the unit-conversion error scenario
```

Validation:

```bash
npm run typecheck
npm run lint
npm run test              # unit tests — no database required
npm run build
npm run test:integration  # requires a running, migrated, seeded database
```

## Safety

- No production credentials, tenants, or databases are used. All data is
  synthetic.
- The demo database is fully separate from any Arvanta infrastructure.
- Simulation and reset endpoints are gated behind `DEMO_MODE`.
- Remediation only ever runs against the demo database, inside a transaction.
- Secrets live in `.env` (git-ignored); `.env.example` documents the shape.

## Disclosure

> Arvanta is an existing proprietary ERP product. Arvanta LedgerGuard is a new
> standalone hackathon project created during the competition period. This
> repository contains the newly developed DataHub integration, agent workflow,
> financial-impact engine, remediation flow, demo interface, and synthetic sample
> data. The existing Arvanta ERP codebase is not included in this submission.

## License

Apache License 2.0 — see [LICENSE](./LICENSE).
