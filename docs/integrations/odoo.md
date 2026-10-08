# Odoo 19 integration (experimental)

**Odoo support: experimental v0.3 — one constrained inventory action.**

This is an experimental adapter implementation plus a control-plane executor (`executeRemoteConstrainedAction`). It is not a general Odoo connector, MCP server, or approval UI. Do not treat HTTP 200 as verified success.

## Supported version

Odoo **19 Community**, JSON-2 external API:

`POST /json/2/<model>/<method>`

Authentication: `Authorization: bearer <API_KEY>`  
Optional: `X-Odoo-Database: <db>`

Legacy XML-RPC / JSON-RPC are not used.

## Supported action

Exactly one:

`ODOO_INVENTORY_ADJUSTMENT`

Against `stock.quant` using Odoo inventory-adjustment primitives:

1. `stock.quant/search_read` — load the exact quant
2. Compare product, location, company, on-hand quantity, and `write_date` to the approved action
3. `stock.quant/write` with `{ inventory_quantity: target }` and `context.inventory_mode = true`
4. `stock.quant/action_apply_inventory`
5. Re-read the quant
6. Verify on-hand equals the approved target

An HTTP 200 from Odoo is **not** `COMMITTED`. LedgerGuard only reports verified success after the re-read.

If `write` has already been sent and `action_apply_inventory` returns `stock.inventory.conflict`, the adapter returns `RECOVERY_REQUIRED` with `remoteWriteAttempted: true`. It does not claim `STALE` / `mutated: false`.

## Environment

```
ODOO_BASE_URL=http://127.0.0.1:8069
ODOO_DATABASE=odoo
ODOO_API_KEY=...
```

Never commit API keys. The adapter never logs `Authorization` headers.

## Integration user

Use a dedicated bot user with stock user rights sufficient to count inventory on internal locations. Do not use a full admin key in production.

## Execution lifecycle

DETECT (fixture or investigation) → AUTHORIZE (plan + Odoo fingerprint) → EXECUTE (hardcoded mapping) → VERIFY (independent re-read).

Odoo and LedgerGuard do **not** share a SQL transaction (`nativeTransactions: false`). Crash after Odoo applies the count and before LedgerGuard bookkeeping is recovered with the v0.2 reserved-key protocol:

- applied (quantity is the approved target) → complete, do not adjust again
- not_applied (still the approved pre-state) → controlled retry
- anything else → `RECOVERY_REQUIRED`, zero mutation

## Limitations

- One action type only
- No move cancellation, no accounting, no multi-warehouse orchestration
- No simulation/compensation
- Hosted Odoo.com *One App Free* / Standard plans may not expose the external API; self-hosted Community is the supported path
- Live tests require explicit disposable-instance opt-in; the dedicated Odoo CI workflow starts an isolated service

## Approval-bound integration

Apply migrations before using the remote executor. A remote plan now stores an
immutable `remoteActionBinding` containing the complete action JSON, adapter
`systemId`/`systemType`, and approved source fingerprint. When preparing a DRAFT,
call `prepareRemoteActionBinding(adapter, action)` from
`src/remediation/remote-action-binding.ts`, persist that binding with the draft,
and show the complete binding to the human approver. Then use the normal
submit/approve state transitions. At execution, pass exactly that action and
fingerprint to `executeRemoteConstrainedAction`.

These control-plane helpers are source-level application APIs, not a published
npm package. The packages currently export TypeScript source; use the repository
workspace/toolchain or a compatible TypeScript bundler.

A changed target, quantity, system ID, or source fingerprint requires a new plan
and fresh approval. Old remote plans without a binding fail closed; do not
backfill already-approved plans. A fingerprint describes observed state, not
permission to choose a new action. Adapter system IDs must uniquely identify the
trusted configured ERP instance; never let model output select the connection.

An idempotency key belongs permanently to one plan and execution version. Replay
and recovery use the original version. Resuming an INTERRUPTED plan at its newer
version uses a new key (omit the custom key to use the version-scoped default).
`ExecutionKeyConflictError` means the key belongs to another plan/version.
`ApprovalRequiredError` for a binding mismatch means re-investigate and request
approval, not retry with a newly fabricated fingerprint.

## Transaction and recovery limits

The legacy adapter's read, write, apply, and verification calls are separate
Odoo transactions. Another writer can change inventory between those requests.
Client fingerprints and leases do not make the sequence atomic or fence an
in-flight Odoo request. Do not claim serializable execution, exactly-once ERP
effects, or verify-before-commit across that boundary. See Odoo's
[JSON-2 transaction semantics](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html#transaction).

A remote verification failure may occur after Odoo persisted changes. It does
not mean rollback happened. Transport/verification uncertainty retains the key
reservation and returns `RECOVERY_REQUIRED`; do not automatically retry writes.
Matching final quantity establishes the observed postcondition, not provenance
of which actor caused it. A constrained server-side conditional operation is
required for stronger concurrency and recovery guarantees.

## Explicit live-test safety gate

Mutating live tests require all of:

```sh
export LEDGERGUARD_ODOO_TEST_INSTANCE=1
export ODOO_BASE_URL=http://127.0.0.1:8069
export ODOO_DATABASE=odoo
# Provide the disposable test instance's ODOO_API_KEY securely.
pnpm --filter @ledgerguard/odoo exec vitest run test/live.integration.test.ts
pnpm exec vitest run --config vitest.odoo.config.ts
```

Only loopback hosts are accepted by the test harness. This is an accidental-target
safety guard, not proof that a local proxy cannot reach production. Confirm the
instance is disposable yourself. The adapter itself is not restricted to loopback.

## Opt-in atomic addon (experimental)

The repository includes `addons/ledgerguard_inventory`, an optional Odoo 19
Community addon. It exposes only two constrained methods on `stock.quant`:
`ledgerguard_apply_inventory` and the read-only `ledgerguard_inventory_status`.
Install it only in a disposable evaluation instance first. The supplied Compose
bootstrap installs it and runs server-side tests before starting JSON-2.

```ts
const adapter = new OdooInventoryAdapter(config, {
  systemId: 'unique-trusted-odoo-instance',
  executionMode: 'atomic-addon'
});
```

In this mode there is no fallback to separate `write` / `action_apply_inventory`
requests. The addon checks the authenticated inventory manager's current ACLs and
record rules, locks the exact quant, checks the approved identity and pre-state,
applies the count, verifies it, and inserts an action receipt in the same Odoo
transaction. An exception rolls back that transaction. The adapter still re-reads
for independent verification; the LedgerGuard control plane remains a separate
database (`nativeTransactions: false`).

The endpoint requires a non-superuser inventory manager. It rejects tracked,
lot/package/owner-specific quants, non-internal locations, and pending counts.
Arbitrary caller context flags are discarded. Scope is deliberately narrower
than general Odoo inventory adjustment. Receipts are inaccessible through ORM
CRUD endpoints and deduplicate an identical normalized approved action per Odoo
user, including its expected write date. They do not deduplicate across users or
plan IDs. Recovery uses receipt provenance, not quantity alone. Receipt history
is retained across addon uninstall/reinstall and is not automatically pruned.

Limits remain: only the exact quant is locked, other quants may be created by
concurrent stock activity, wire-format `write_date` is second-precision, and
Odoo's stock internals retain their own existing maintenance privilege behavior.
Do not infer a system-wide inventory lock or production readiness.

The dedicated Odoo CI job executes the addon TransactionCase suite and then the
legacy and atomic JSON-2 live suites sequentially on synthetic fixtures. Review
that job for the exact commit; offline TypeScript/Python tests alone do not prove
Odoo runtime compatibility.
