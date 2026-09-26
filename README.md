# LedgerGuard

**A safety runtime for AI agents operating on systems of record.**

AI agents may inspect ledgers, correlate evidence, and propose repairs.
They must not receive mutation authority merely because an LLM generated a tool call.

LedgerGuard separates **probabilistic reasoning** from **deterministic execution authority**.

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

Status: **v0.1.0 pre-release**. Demonstrates the safety model on synthetic data, in memory or PostgreSQL. Not a production authentication or ERP platform.

License: [Apache-2.0](LICENSE)

## Quickstart: one-command local demo

Requires **Node.js 20+** and **pnpm 9.15.9** (`npm install --global pnpm@9.15.9` if needed). Run these commands in a terminal, including PowerShell on Windows:

```bash
git clone https://github.com/Val1-IT/Arvanta-Ledgerguard.git
cd Arvanta-Ledgerguard
pnpm demo
```

`pnpm demo` installs the locked dependencies (including development tools), then runs the duplicate-inventory scenario with the real core and policy packages against a fresh in-memory fixture. The first install needs access to the npm registry. No Docker, `.env`, database, DataHub, or model API key is needed. Existing environment files and databases are not read or changed by the scenario. Reruns start from fresh synthetic data.

The demo shows evidence, a proposed repair, `REQUIRE_APPROVAL`, a **simulated human approval**, and verified execution. It exits nonzero if any expected result fails. Successful output ends with:

```text
DEMO PASS: duplicate detected; approval required; repair verified.
Quantity: 20.000 -> 10.000 | Valuation: 1700000.00 -> 850000.00
Replay: DRIFT_DETECTED | Completed-key policy: DENY (DUPLICATE_EXECUTION)
```

This is a deterministic terminal demo, not a live agent or web UI. It demonstrates the completed-key **policy decision**, not persisted idempotency or real SQL transactions; use the PostgreSQL path below to exercise those.

**Trying LedgerGuard?** [Open a bug report](https://github.com/Val1-IT/Arvanta-Ledgerguard/issues/new?template=bug_report.md) with your OS, Node/pnpm versions, command, expected result, and sanitized output. Tell us where setup or the safety model was confusing. Report security issues through [SECURITY.md](SECURITY.md).

### Manual fallback: same in-memory demo

Use separate steps to diagnose an install failure or rerun without installing:

```bash
pnpm install --frozen-lockfile --prod=false
pnpm scenario:duplicate-inventory:memory
```

If installation fails, check registry/network access and the Node/pnpm versions, then retry. No database reset is needed.

### PostgreSQL demo (optional, DataHub not required)

Also requires Docker running with Compose available. Use only the disposable demo database: seeding replaces its synthetic data. No `.env` copy is needed. In a new terminal, explicitly select the local Compose database before running the remaining commands; this takes precedence over a `DATABASE_URL` in `.env`.

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

`DATABASE_URL` defaults to `postgres://ledgerguard:ledgerguard@localhost:5433/ledgerguard` (Compose maps host 5433 → container 5432).

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

These are the only detectors in v0.1. LedgerGuard does not claim to detect arbitrary ERP failures.

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
- Persisted idempotency keys; completed replay → `ALREADY_EXECUTED`
- `DRIFT_DETECTED` when live state no longer matches the approved snapshot
- Verify-before-commit; verification failure rolls back
- DataHub failure does not roll back a verified system-of-record repair

See [docs/architecture/authority-model.md](docs/architecture/authority-model.md) and [docs/threat-model.md](docs/threat-model.md).

## Known v0.1 limitations

- **Demo authority.** The demo mints `incident-ui` with full capabilities in server code. There is no production authentication.
- **Idempotency crash window.** Between SQL `COMMIT` and marking the key `completed`, a crash can leave the key `reserved`. This is not exactly-once delivery.
- **Detector precedence.** Conversion mismatch wins if both incidents exist. v0.1 does not aggregate simultaneous root causes.
- **Adapter scope.** PostgreSQL is the execution adapter. Odoo / ERPNext / REST are future work.

## Development

```bash
pnpm verify                 # typecheck, lint, unit tests
pnpm verify:integration     # migrate + Postgres integration tests
pnpm test:datahub           # optional; needs live DataHub
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## History

LedgerGuard began as a DataHub Agent Hackathon prototype. The OSS runtime extracts the deterministic engine, policy, and PostgreSQL adapter so DataHub is one optional integration rather than the product.
