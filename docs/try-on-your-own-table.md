# Try LedgerGuard on your own table

The in-memory `pnpm demo` uses a synthetic inventory fixture. The Postgres adapter will not write arbitrary SQL: it only updates columns you put on the allowlist. Omitted config keeps the **demo inventory defaults**. Passing `null` or an empty `writableColumns` object **fails closed** (no writes).

Do not point this at a production database.

## 1. Declare the writable surface

JSON file (see `examples/inventory-ledger/allowlist.demo.json` for the demo tables):

```json
{
  "writableColumns": {
    "warehouse_bins": ["qty"]
  },
  "touchTimestamps": {
    "warehouse_bins": "updated_at"
  }
}
```

Or a config object at adapter construction:

```ts
import { loadAllowlistConfig, PostgresSystemOfRecordAdapter } from '@ledgerguard/postgres';

const allowlist = loadAllowlistConfig('./allowlist.json');
const adapter = new PostgresSystemOfRecordAdapter(pool, { allowlist });
```

A missing file, invalid JSON, `null`, or `{ "writableColumns": {} }` does not fall back to the demo tables.

Table, writable-column, and timestamp names are exact-case SQL identifiers. Supported names start with an ASCII letter or underscore, contain only ASCII letters, digits or underscores, and are at most 63 bytes. They are quoted consistently, so `Warehouse_Bins` is distinct from `warehouse_bins`; reserved words are supported. Schema-qualified paths, spaces, embedded quotes, control characters, and overlong identifiers fail closed in both JSON and code configuration.

## 2. Propose a typed correction

Your agent fills a `ProposedCorrection` (table, column, before/after, record id). It does not send SQL. A correction whose table or column is not on the allowlist throws `UnallowlistedMutationError` before any statement is issued.

## 3. Policy, then a human, then execute

`evaluateExecutionPolicy` returns ALLOW / DENY / REQUIRE_APPROVAL. Approval is bound to that plan id and version. After approval, `executeConstrainedRemediation` (or the Postgres `executeRemediationPlan` path) runs the writes in one transaction.

## 4. Verify before commit

Add a postcondition the runtime can check on a re-read of live rows (quantity equals the approved after-value, duplicate reverse landed, and so on). Verification failure rolls the transaction back. Replay of a completed idempotency key returns `ALREADY_EXECUTED`.

Wiring a new incident type into `executeConstrainedRemediation` also needs a detector and verification expectations in `@ledgerguard/core`; this page is only the mutation allowlist. For an in-memory custom detector that stays on the public `ConstrainedAction` APIs (no core change), see [examples/custom-action](../examples/custom-action/).
