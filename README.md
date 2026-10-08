# LedgerGuard

**A deterministic execution integrity runtime for AI agents operating on systems of record.**

Executable repairs come from deterministic detectors and constrained adapters; model output never grants mutation authority.

AI agents may inspect ledgers, correlate evidence, and suggest investigations.
They must not receive mutation authority merely because an LLM generated a tool call.

LedgerGuard separates **probabilistic reasoning** from **deterministic execution authority**. An approved mutation is not successful until postconditions are verified against the system of record.

```
                  AI / AGENT
                       │
                       ▼
             INVESTIGATION / PROPOSAL
                       │
                       ▼
               @ledgerguard/core
                       │
                       ▼
              @ledgerguard/policy
             /        |        \
          DENY   REQUIRE APPROVAL ALLOW
                       │
                       ▼
               TRUSTED AUTHORITY
                       │
                       ▼
                  IDEMPOTENCY
                       │
                       ▼
              SYSTEM ADAPTER  (@ledgerguard/postgres)
                       │
                       ▼
                  TRANSACTION
                       │
                       ▼
                  VERIFICATION
                    /      \
                  PASS     FAIL
                   │         │
                 COMMIT   ROLLBACK

Optional: @ledgerguard/datahub  (catalog context only — not authority)
```

Status: **v0.3.0 (proposed)**. Demonstrates DETECT → AUTHORIZE → EXECUTE → VERIFY on synthetic data, in memory or PostgreSQL. **Odoo support: experimental adapter — one constrained inventory action; not a general ERP product.** Not a production authentication or ERP platform.

License: [Apache-2.0](LICENSE)

## Quickstart: one-command local demo

Requires **Node.js 24 (or 20.19+ / 22.12+)** and **pnpm 9.15.9** (`npm install --global pnpm@9.15.9` if needed). Run these commands in a terminal, including PowerShell on Windows.

In containers/CI images `corepack enable` may fail until COREPACK_HOME is writable (e.g. `export COREPACK_HOME=/tmp/corepack`). The repo pins pnpm 9.15.9; pnpm 10 is untested.

```bash
git clone https://github.com/Val1-IT/Arvanta-Ledgerguard.git
cd Arvanta-Ledgerguard
pnpm demo
```

`pnpm demo` installs only `tsx`, `decimal.js` and `zod` into `examples/inventory-ledger` (on the order of tens of MB, not the Next.js workspace), then runs the duplicate-inventory scenario with the real core and policy packages against a fresh in-memory fixture. The first install needs access to the npm registry. No Docker, `.env`, database, DataHub, or model API key is needed. Existing environment files and databases are not read or changed by the scenario. Reruns start from fresh synthetic data. Pass `--quiet` (or `LEDGERGUARD_DEMO_QUIET=1`) to skip the JSON dumps and keep the DEMO PASS summary. Postgres/Docker is needed only for `pnpm demo:pg` and the web UI.

The demo shows evidence, a proposed repair, `REQUIRE_APPROVAL`, a **simulated human approval**, and verified execution. It exits nonzero if any expected result fails. Successful output ends with:

```text
DEMO PASS: duplicate detected; approval required; repair verified.
Quantity: 20.000 -> 10.000 | Valuation: 1700000.00 -> 850000.00
Replay: DRIFT_DETECTED | Completed-key policy: DENY (DUPLICATE_EXECUTION)
In-memory demonstration only; persisted idempotency and SQL transactions need the PostgreSQL integration path.

---------- DEMO SUMMARY ----------
Result: DEMO PASS
Incident: DUPLICATE_INVENTORY_MOVEMENT
Policy: REQUIRE_APPROVAL → ALLOW (simulated human approval of plan v2)
Execute: committed, verification PASS
Replay: DRIFT_DETECTED | Completed-key policy: DENY (DUPLICATE_EXECUTION)
Quantity: 20.000 → 10.000 | Valuation: 1700000.00 → 850000.00
----------------------------------
```

This is a deterministic terminal demo, not a live agent or web UI. It demonstrates the completed-key **policy decision**, not persisted idempotency or real SQL transactions; use `pnpm demo:pg` below to exercise those.

**Integrating an existing service?** Start with the [adoption tutorial](docs/integrations/adoption-tutorial.md) for adapter boundaries, persisted approval, outcomes, and runnable reference tests.

**Independent evaluation:** follow the [external tester guide](docs/testing/external-tester-guide.md) for reproducible commands, safety checks, and honest evidence boundaries.

**Trying LedgerGuard?** After `pnpm demo`, try [`pnpm demo:pg`](#postgresql-demo-optional-datahub-not-required) (Docker) or point the adapter at your own table with [try-on-your-own-table](docs/try-on-your-own-table.md). [Open a bug report](https://github.com/Val1-IT/Arvanta-Ledgerguard/issues/new?template=bug_report.yml) or [file a tester report](https://github.com/Val1-IT/Arvanta-Ledgerguard/issues/new?template=tester_report.yml) with your OS, Node/pnpm versions, command, expected result, and sanitized output. Tell us where setup or the safety model was confusing. Report security issues through [SECURITY.md](SECURITY.md).

### Manual fallback: same in-memory demo

Use separate steps to diagnose an install failure or rerun without installing:

```bash
pnpm install --frozen-lockfile --prod=false
pnpm scenario:duplicate-inventory:memory
```

If installation fails, check registry/network access and the Node/pnpm versions, then retry. No database reset is needed.

### PostgreSQL demo (optional, DataHub not required)

Requires Docker running with Compose available. The in-memory `pnpm demo` above needs no Docker, `.env`, or database; Postgres/Docker is only for this path and the web UI. Use only the disposable demo database: seeding replaces its synthetic data. No `.env` copy is needed.

```bash
pnpm demo:pg
```

`pnpm demo:pg` uses `DATABASE_URL` if set, otherwise `postgres://ledgerguard:ledgerguard@localhost:5433/ledgerguard` (Compose maps host 5433 → container 5432).

#### Manual fallback: same PostgreSQL demo

Use separate steps to diagnose a Compose/database failure. In a new terminal, explicitly select the local Compose database before running the remaining commands; this takes precedence over a `DATABASE_URL` in `.env`.

macOS/Linux:

```bash
export DATABASE_URL=postgres://ledgerguard:ledgerguard@localhost:5433/ledgerguard
```

Windows PowerShell:

```powershell
$env:DATABASE_URL = 'postgres://ledgerguard:ledgerguard@localhost:5433/ledgerguard'
```

Then, in that same terminal, from the repository directory:

```bash
pnpm install --frozen-lockfile --prod=false
pnpm db:up
pnpm db:wait
pnpm db:migrate
pnpm db:seed

# Scenario 1 — unit conversion mismatch (CARTON 12 → 10)
pnpm scenario:conversion-error

# Reset, then scenario 2 — duplicate inventory movement
pnpm db:seed
pnpm scenario:duplicate-inventory
```

Release checks without Docker:

```bash
pnpm verify
```

PostgreSQL integration (requires a migrated database):

```bash
pnpm verify:integration
```

## Two implemented scenarios

### 1. Unit conversion mismatch

`1 CARTON = 12 PCS` is silently recorded as `10`. Inventory valuation, COGS, and margin reports diverge from posted movements. LedgerGuard traces the blast radius with `decimal.js`, proposes ordered field restorations, and executes only after human approval inside a transaction that verifies before commit.

### 2. Duplicate inventory movement

Receipt RCP-001 received **10** units. A duplicated event posted MOV-001 **+10** and MOV-002 **+10**. Inventory shows **20** / **1,700,000**. The detector uses shared `eventIdentity` + receipt + quantity — not an LLM “these look similar” guess. Repair reverses **only MOV-002**. Expected state: quantity **10**, valuation **850,000**. A completed idempotency key returns `ALREADY_EXECUTED` and does not mutate again.

These are the only detectors in v0.2. LedgerGuard does not claim to detect arbitrary ERP failures.

## Packages

| Package | Role |
| --- | --- |
| `@ledgerguard/core` | Deterministic investigation, evidence, findings, effects, verification, execution contracts |
| `@ledgerguard/policy` | Deterministic ALLOW / DENY / REQUIRE_APPROVAL, trusted `AuthorityContext`, approval and audit primitives |
| `@ledgerguard/postgres` | Allowlisted SQL mutations and transactional execute/verify/commit |
| `@ledgerguard/datahub` | Optional catalog context and metadata write-back |

DataHub is **optional**. It must not authorize mutations, generate SQL, or declare verification success.

The Next.js app under `app/` is a demo shell, not the runtime.

## Demonstrated properties

- No arbitrary LLM-generated SQL
- Typed, allowlisted corrections only
- Deterministic policy (not prompts)
- Trusted runtime supplies capabilities; agents cannot self-approve
- Approval is bound to plan id + version
- Source-state fingerprint on the execution receipt
- Persisted idempotency keys; completed replay → `ALREADY_EXECUTED`
- PostgreSQL records `completed` in the same transaction as the verified mutation
- Expired `reserved` keys are recovered or raised as `RECOVERY_REQUIRED`
- `DRIFT_DETECTED` when live state no longer matches the approved snapshot
- Verify-before-commit; verification failure rolls back
- DataHub failure does not roll back a verified system-of-record repair

See [docs/architecture/execution-integrity.md](docs/architecture/execution-integrity.md), [docs/architecture/authority-model.md](docs/architecture/authority-model.md) and [docs/threat-model.md](docs/threat-model.md).

## Where your agent plugs in

The agent never sends SQL and never self-approves. It produces a snapshot; LedgerGuard decides:

```ts
import { investigate, executeConstrainedRemediation } from '@ledgerguard/core';
import { Capability, evaluateExecutionPolicy, trustedRuntimeAuthority } from '@ledgerguard/policy';

const report = investigate(snapshot); // typed proposal; the agent does not write
const authority = trustedRuntimeAuthority({
  actorId: 'controller',
  actorType: 'human',
  capabilities: [Capability.remediationExecute, Capability.remediationApprove]
});
const policyInput = {
  evidenceCount: report.evidence.length,
  verificationExpectationCount: report.verificationExpectations.length,
  impactAmount: Number(report.financialImpact.primaryExposure),
  authority,
  expectedVersion: 1,
  config: { financialApprovalThreshold: 1000, currency: 'IDR' },
  idempotencyCompleted: false
};
evaluateExecutionPolicy({ ...policyInput, plan: { state: 'DRAFT', version: 1, approvalAction: null, approvedBy: null } });
// REQUIRE_APPROVAL until a human approves this exact plan version
const allowed = evaluateExecutionPolicy({
  ...policyInput,
  expectedVersion: 2,
  plan: { state: 'APPROVED', version: 2, approvalAction: 'APPROVE', approvedBy: 'controller' }
});
if (allowed.outcome === 'ALLOW') {
  await executeConstrainedRemediation(adapter, { approvedCorrections: report.proposedCorrections });
}
```

The same snippet lives in [examples/inventory-ledger/README.md](examples/inventory-ledger/README.md). To point this at your own Postgres table instead of the demo inventory, see [docs/try-on-your-own-table.md](docs/try-on-your-own-table.md).

## Known limitations (v0.3, pre-1.0)

- **Demo authority.** The demo mints `incident-ui` with full capabilities in server code. There is no production authentication.
- **Not exactly-once.** PostgreSQL same-database atomicity closes the post-COMMIT reserved-key window. Other adapters and ambiguous expired reservations are not exactly-once.
- **Detector precedence.** Conversion mismatch wins if both incidents exist. Simultaneous root causes are not aggregated.
- **Adapter scope.** PostgreSQL remains the transactional reference adapter. Odoo 19 support is experimental and opt-in: one `stock.quant` inventory adjustment via JSON-2. See [docs/integrations/odoo.md](docs/integrations/odoo.md).

## Development

```bash
pnpm verify                 # typecheck, lint, unit tests
pnpm verify:integration     # migrate + Postgres integration tests
pnpm test:datahub           # optional; needs live DataHub
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md). Community standards: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## History

LedgerGuard began as a DataHub Agent Hackathon prototype. The OSS runtime extracts the deterministic engine, policy, and PostgreSQL adapter so DataHub is one optional integration rather than the product.

Hackathon-era submission and deployment drafts are preserved in [the historical archive](docs/archive/hackathon/). Current evaluation instructions are in the guides above.


## Deployment gate

The shipped web UI is a **private synthetic-data evaluation app**, not a
production identity or ERP access boundary. Compose now binds published ports to
loopback, copied example configuration disables mutation/provider actions by
default, and `/api/health/ready` checks connectivity plus required migrations and
schema instead of treating a fallback HTML page as healthy.

See [isolated deployment validation](docs/testing/deployment-validation.md) for
the exact build/start/restart/rollback proof and its limits. `DEMO_MODE=true` is an
explicit demo opt-in, not authentication. Do not expose the UI publicly or use
real ERP/customer data without a separately reviewed identity, authorization,
ingress, backup and migration plan.
