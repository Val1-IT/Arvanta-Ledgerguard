# @ledgerguard/postgres

Constrained PostgreSQL system-of-record adapter and the transactional reference adapter: allowlisted SQL, typed corrections, and verification before commit with rollback on failure.

**Dependencies:** No arbitrary write SQL: mutations go only through typed corrections and the adapter allowlist. Must not depend on DataHub, Next, or LLM SDKs; depends on `@ledgerguard/core` and `pg`.

**Tests** (from the repo root):

```bash
pnpm test:postgres   # unit tests, no database
pnpm verify:integration   # needs a disposable PostgreSQL (see CONTRIBUTING.md)
```
