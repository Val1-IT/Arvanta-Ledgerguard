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

Status: **v0.1.0 pre-release**. Demonstrates the safety model on synthetic PostgreSQL data. Not a production authentication or ERP platform.

License: [Apache-2.0](LICENSE)

## Quickstart (PostgreSQL only — DataHub not required)

Requires Node.js 20+, pnpm 9, and Docker.

```bash
git clone https://github.com/Val1-IT/Arvanta-Ledgerguard.git
cd Arvanta-Ledgerguard
cp .env.example .env
pnpm install
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
