# Arvanta LedgerGuard — Implementation Plan (revised)

Status: living document. Reflects the Fase 0 audit plus the revision decisions
(DataHub MCP as the agent runtime, deterministic evaluator strategy, single LLM
provider, two-route UI, phased 3A/3B split with a mandatory MCP checkpoint).

## 1. Project summary

LedgerGuard is an autonomous ERP financial-integrity agent that demonstrates one
end-to-end flow: healthy data → simulated unit-conversion error → downstream
damage across inventory valuation, COGS, journals, and gross margin → detection →
DataHub-context investigation via MCP → root cause → blast radius → financial
exposure → remediation plan with dry-run → human approval → safe transactional
execution → verification → DataHub write-back → incident closed.

It is a standalone, public, Apache-2.0 project. Arvanta remains proprietary and is
not part of the submission. Only the relevant slice of the ERP flow is built — not
a full ERP.

## 2. Environment audit (summary)

- Node v24.8.0, npm 11.6.0 (no pnpm/yarn) → npm.
- Docker Engine 29.2.1 + Compose v5.1.0 installed; daemon must be running for the
  demo Postgres and (if self-hosted) DataHub.
- ~19.7 GB RAM (7.6 GB free), 12 cores. Disk C: ~26 GB free (94.5% used) — a real
  constraint for running DataHub OSS locally alongside the demo Postgres. OSS is
  still the locked foundation (see §11); if local capacity proves insufficient the
  fallback is a dedicated VM, not DataHub Cloud.
- Postgres for the demo runs in Docker (host port 5433). No local `psql` needed.

## 3. Architecture

Single Next.js 15 application (not a monorepo). Clear internal separation:

- `src/engine` — deterministic financial-integrity engine. Owns every number and
  every data mutation: affected record count, blast radius, inventory valuation,
  COGS, journal reconciliation, financial exposure, remediation SQL, execution,
  verification.
- `src/agent` — LLM orchestration. Owns judgement, not arithmetic: investigation
  plan, DataHub MCP tool selection/use, evidence summarisation, root-cause
  explanation, remediation rationale, and the "is evidence sufficient?" decision.
  Output is schema-validated (Zod).
- `src/datahub/mcp` — agent's primary DataHub runtime (MCP Server / Agent Context
  Kit): search assets, read schema/owners/glossary/tags, traverse lineage, and
  perform supported write-back.
- `src/datahub/bootstrap` — one-time metadata provisioning via Python SDK /
  ingestion recipes (datasets, schema, owners, glossary, tags, lineage,
  demo metadata).
- `src/datahub/graphql` — supporting adapter for operations not available or not
  practical via MCP.
- `src/db` — Drizzle schema, migrations, seed, reset. PostgreSQL.
- `src/domain` — shared types and Zod schemas.

Determinism rule: the LLM never produces numbers or SQL that mutate data. Numbers
come from the engine; the agent explains them. This satisfies both
"deterministic & reproducible results" and "the agent uses DataHub context".

## 4. Data flow

```
Simulate Conversion Error (product_units.conversion_factor 12 -> 10)
  -> inventory_movements.base_quantity understated
    -> inventory_valuation (qty_on_hand, average_cost, inventory_value wrong)
      -> journal_entries (inventory/COGS postings inconsistent)
        -> gross_margin_report (COGS, gross_profit, margin% wrong)

LedgerGuard: Detect -> Gather DataHub context (MCP) -> Root cause -> Blast radius
  -> Financial impact -> Containment (tag At Risk) -> Remediation plan (+dry-run)
  -> HUMAN APPROVAL -> Execute (txn + rollback) -> Verify -> DataHub write-back
  -> Resolved
```

## 5. Database schema (demo)

Tables: `products`, `product_units`, `inventory_movements`, `inventory_valuation`,
`journal_entries`, `gross_margin_report`, `ledgerguard_incidents`,
`investigation_runs`, `remediation_plans`, plus a `baseline_snapshot` helper for
deterministic reset. COGS is represented as a column on `gross_margin_report` and
as rows in `journal_entries` (consistent with the six DataHub dataset assets).

## 6. DataHub assets, lineage, metadata

- Datasets: products, product_units, inventory_movements, inventory_valuation,
  journal_entries, gross_margin_report.
- Lineage: conversion_factor -> base_quantity -> inventory_value -> journal_entries
  -> gross_margin_report.
- Owners: Inventory Operations, Finance Controller, Data Platform.
- Glossary: Unit Conversion, Inventory Valuation, Cost of Goods Sold, Gross Margin,
  Financially Trusted Dataset.
- Tags: ERP, Finance Critical, Inventory Critical, At Risk, Trusted,
  Requires Approval.

### Quality strategy — `QualityCheckEvaluator`

Do not assume native scheduled/custom-SQL assertions exist on DataHub OSS. Define a
`QualityCheckEvaluator` interface. Primary implementation: LedgerGuard runs the ERP
integrity checks deterministically on the demo Postgres, then writes the results to
DataHub as assertion run status / incident / structured property / tag /
documentation, according to what the connected instance supports. If DataHub Cloud
with native assertions is available and fits the use case, use native assertions.
On OSS, LedgerGuard is the evaluator and DataHub is the context graph and system of
record for quality status.

Integrity checks: (1) conversion_factor > 0; (2) base_quantity = quantity ×
conversion_factor; (3) Σ debit = Σ credit per journal source; (4) inventory
valuation matches movement aggregation; (5) gross margin consistent with revenue
and COGS.

## 7. Agent workflow (MCP-first)

Detect -> Gather Context (MCP) -> Root Cause -> Blast Radius -> Financial Impact ->
Containment -> Remediation Plan (+dry-run) -> Human Approval -> Execute -> Verify ->
Write-back. The UI activity log shows MCP usage explicitly, e.g.: Search DataHub
assets · Read product_units schema · Traverse downstream lineage · Read asset
owners and glossary terms · Mark affected assets At Risk · Write investigation and
resolution context.

LLM provider: one primary provider (Anthropic/Claude by default) with a minimal
abstraction. Do not implement multiple providers before the must-haves are done.
The deterministic template narrator is only for unit tests, CI, local fallback, or
provider failure — the hosted demo and the main video use a real model.

## 8. UI (two routes)

- `/overview` — health tiles (Data Health, Inventory Value, Gross Margin, Active
  Incidents), Simulate Conversion Error, Healthy/At Risk status.
- `/incidents/[id]` — tabs: Investigation · Impact · Remediation · Resolution.
  Impact graph is a lightweight SVG / node-card view (no heavy graph library).

Design: soft neo-brutalism — cream surfaces, navy ink text/borders, amber/gold
accent; hard offset shadows. An independent reconstruction of the Arvanta look; no
Arvanta components are copied.

## 9. Testing

Unit (engine numbers), integration (DataHub MCP client + DB transactions/rollback),
e2e (Playwright full demo flow), plus typecheck, lint, build.

## 10. Security

No production credentials/tenants/DB; synthetic data; demo DB separate from
Arvanta; `DEMO_MODE`-gated simulate/reset; remediation only on the demo DB inside a
transaction; no endpoint touches Arvanta; simple rate limiting when public; secret
scan; secrets in `.env` with `.env.example` committed.

## 11. Deployment

Target `ledgerguard.rakitlogictech.com`, fully separate from Arvanta. DataHub must
not run on Arvanta servers or databases.

**Final DataHub decision (locked):**

1. **DataHub OSS / Core is the primary foundation.** The submission must work end
   to end on OSS alone and must never depend on DataHub Cloud.
2. **Self-hosted DataHub MCP Server** is the agent's context runtime, connected to
   that OSS/Core instance.
3. **DataHub Cloud is an optional hosted alternative only**, used if official
   access becomes available. It is never a requirement.

The hosted demo must remain fully usable even if judges never open the DataHub UI —
all key information stays visible inside LedgerGuard, while the README and video
show the DataHub metadata and write-back as proof.

## 12. Phase order

- FASE 1 — Scaffold, license, lint, typecheck, basic tests.
- FASE 2 — DB schema, deterministic healthy seed, conversion-error scenario, reset.
- FASE 3A — DataHub bootstrap: datasets, schema, owners, glossary, tags, lineage.
- FASE 3B — DataHub MCP connectivity proof (read schema, owners, downstream lineage
  via MCP) before continuing.
- FASE 4 — Deterministic integrity engine + unit tests. **Done.** Pure engine in
  `src/engine/*` (types, decimal safety via decimal.js, conversion/inventory/
  journal/margin impact, blast radius, financial exposure, 5 quality checks,
  remediation preview, verify, investigate orchestrator) + read-only repository
  adapters in `src/db/repositories/*`. 10/10 required unit test cases +
  integration tests against `ledgerguard-postgres` (PostgreSQL demo milik
  Arvanta LedgerGuard) + real example artifacts via `npm run example`. See
  `docs/architecture/financial-integrity-engine.md` for the full design.
- FASE 5 — Agent investigation via MCP. **Done.** `src/agent/*`: 13-state /
  7-failure-state orchestrator (`runInvestigation()`) wiring the FASE 4 engine, a real
  DataHub MCP bridge (`src/agent/datahub-client.ts`, spawning
  `src.datahub.mcp.agent_bridge`), and an LLM planning layer
  (`AnthropicInvestigationModel` + `DeterministicTestModel`) behind a 7-rule
  reconciliation layer (`src/agent/reconciliation.ts`) that rejects any model claim not
  literally backed by the engine result or real DataHub context. Activity logging with
  chronological resequencing and secret redaction
  (`src/agent/activity-log.ts`); persistence via `investigation_runs`
  (`src/db/repositories/investigation-runs.ts`); minimum test UI at `app/agent/page.tsx`.
  14/14 required unit tests + 3 live integration tests against `ledgerguard-postgres`
  and a live DataHub MCP server (`npm run test:agent`) + a real example artifact
  (`npm run example:agent`). Remediation execution is explicitly out of scope — see
  `docs/architecture/investigation-agent.md` for the full design and division of
  responsibility.
- FASE 6 — Containment, dry-run, approval, execution, rollback, verification,
  write-back.
- FASE 7 — Overview and incident UI.
- FASE 8 — E2E testing, security, reset reliability, production build.
- FASE 9 — README, examples, disclosure, screenshots, video, submission.
- FASE 10 — Deployment and final judge-mode verification.

### Mandatory checkpoint after FASE 3B

Stop and report proof: MCP server connected; agent found dataset `product_units`;
read `conversion_factor`; read owner; traversed lineage to `gross_margin_report`;
no secrets entered the repository. Do not proceed to full agent orchestration until
the MCP proof succeeds.

## 13. Scope guardrails

No full ERP. No full multi-provider. No multiple incident scenarios until the one
conversion-error flow is stable. No copying Arvanta source code. Small, verifiable
changes; run relevant tests after each phase.

## 14. Deterministic scenario (single primary)

Product: Cement Premium 40kg. Base unit PCS; alternative unit CARTON;
`1 CARTON = 12 PCS`. Synthetic transactions produce healthy stock, correct
valuation, balanced journals, and a correct gross margin. Trigger: change
`1 CARTON = 12` to `1 CARTON = 10` and recompute so mismatches appear. Exact
counts and the exposure figure are fixed by the seed and must be reproducible; the
engine (not the LLM) computes them.
