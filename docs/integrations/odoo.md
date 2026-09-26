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
- Live tests are opt-in (`ODOO_BASE_URL` + `ODOO_API_KEY`); default CI does not start Odoo
