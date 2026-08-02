# LedgerGuard demo flow (< 3 minutes)

Synthetic ERP demo only. Do not point `DATABASE_URL` at Arvanta or production databases.

## Required environment (names only)

- `DEMO_MODE` — must be exactly `true` for Simulate / Reset / remediation mutations
- `DATABASE_URL` — demo Postgres (compose default host port `5433`)
- `DATAHUB_GMS_URL` / `DATAHUB_GMS_TOKEN` — optional for live metadata; write-back may fail without them
- `LLM_PROVIDER` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` — optional live narrator; without a live key the UI uses the deterministic test narrator
- `LLM_USE_TEMPLATE_FALLBACK` — optional local/CI fallback

No demo login credentials: the UI has no auth surface.

## Prep

1. `npm run db:setup`
2. Copy `.env.example` → `.env` and set `DEMO_MODE=true`
3. `npm run dev` (prefer `http://127.0.0.1:3010` if port 3000 is occupied)

## Demo script

| Step | Route | Action | Expected |
|------|-------|--------|----------|
| 1 | `/overview` | Confirm banner *Demo environment — synthetic ERP data only.* | Data Health healthy, inventory/margin baseline |
| 2 | `/overview` | **Reset Demo** → confirm | Healthy baseline restored |
| 3 | `/overview` | **Simulate Conversion Error** | Redirect to `/incidents/[id]` |
| 4 | Incident → **Investigation** | Read root cause / activity | Completed investigation, critical exposure |
| 5 | **Impact** | Check primary exposure vs footprint | Exposure headline;  evidence ≠ correction targets |
| 6 | **Remediation** | **Generate** → **Submit** → **Approve** | Draft → Pending approval → Approved (`vN` visible) |
| 7 | **Resolution** | **Execute remediation** → confirm | ERP restored, verification Pass, plan Resolved |
| 8 | **Resolution** | Note DataHub badge / optional **Retry DataHub write-back** | Synced, or stale metadata with retry |
| 9 | `/overview` | **Reset Demo** | Back to healthy baseline |

## DataHub write-back fallback

If write-back fails:

- ERP plan state stays **Resolved**
- UI headline: *ERP data integrity has been restored. DataHub metadata still requires synchronization.*
- **Retry DataHub write-back** remains available
- Do **not** claim “all systems resolved”

If MCP is unavailable during Simulate, the UI demo fallback still creates a completed investigation from the live engine so remediation can continue.

## Reset procedure

1. Ensure no plan is stuck in Executing / Verifying
2. Overview → **Reset Demo** → confirm
3. Or CLI: `npm run db:reset`

## Routes

- `/overview` — health + demo controls
- `/incidents` — recent runs
- `/incidents/[id]` — Investigation · Impact · Remediation · Resolution
- `/agent` — harness (hidden from primary nav)
