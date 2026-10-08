# Write your own action

This example shows how a developer defines a **custom detector and remediation action** with the public `@ledgerguard/core` and `@ledgerguard/policy` APIs. It is the same safety lifecycle as the duplicate-inventory demo, on a different domain: a duplicated invoice line.

In containers and CI images, `corepack enable` may fail until `COREPACK_HOME` is a writable path (for example `export COREPACK_HOME=/tmp/corepack`). The repo pins pnpm **9.15.9**; pnpm 10 is untested.

## What an action is

An action is a typed, allowlisted mutation (`ConstrainedAction`) plus the adapter methods that **validate**, **fingerprint**, **execute**, and **verify** it. The agent never sends SQL and never self-approves.

## What you write vs what LedgerGuard enforces

| You write | LedgerGuard enforces |
| --- | --- |
| Domain snapshot (your table/rows) | Nothing about your schema — core's built-in `investigate()` is inventory-only |
| Deterministic detector and evidence | `evaluateExecutionPolicy` (evidence, verification expectations, impact threshold, capabilities) |
| Correction plan and `ConstrainedAction` | Approval of the exact plan version (`REQUIRE_APPROVAL` → `ALLOW`) |
| `ConstrainedActionAdapter` (validate / fingerprint / execute / verify) | `executeConstrainedAction`: reject invalid actions, compare the approved fingerprint, run verify after execute |
| Postconditions the adapter re-reads | Completed-key policy `DENY` (`DUPLICATE_EXECUTION`); stale fingerprint → `STALE` |

`executeConstrainedRemediation` + `investigate()` remain the built-in inventory path. A custom table uses the `ConstrainedAction` port until core grows a detector registry. Do not treat LLM output as the action type, target, or approval.

## Before / after

| Record | Amount |
| --- | --- |
| INV-1001 LINE-001 | 500,000 (legitimate) |
| INV-1001 LINE-002 | 500,000 (duplicate event `invoice:INV-1001:WIDGET-A`) |
| Invoice total | 1,000,000 |

Repair reverses **LINE-002 only** and restores the invoice total to **500,000**. LINE-001 is untouched. Replay with the approved fingerprint is `STALE`. A completed idempotency key is policy `DENY` (`DUPLICATE_EXECUTION`).

## Run

In-memory harness (no Docker). `pnpm example:custom` installs only `tsx`, `decimal.js`, and `zod` into `examples/custom-action` (same slim nested install as `pnpm demo`):

```
pnpm example:custom
# or, after a full workspace install:
pnpm scenario:custom-action:memory
# or, from this folder after its nested install:
pnpm demo
```

Pass `--quiet` (or `LEDGERGUARD_DEMO_QUIET=1`) to skip JSON dumps and keep the DEMO PASS summary.

Successful output ends with:

```text
DEMO PASS: duplicate invoice line detected; approval required; repair verified.
Invoice total: 1000000.00 -> 500000.00
Replay: STALE | Completed-key policy: DENY (DUPLICATE_EXECUTION)
```

## ~10 lines to change for your own table

In `src/demo.ts`, the constants at the top plus the detector grouping key are the domain-specific surface:

```ts
const LINE_TABLE = 'invoice_lines';       // your table
const INVOICE_TABLE = 'invoices';         // optional parent total
const AMOUNT_FIELD = 'amount';            // field you compare / restore
const ACTION_TYPE = 'REVERSE_DUPLICATE_INVOICE_LINE';
const RESOURCE_TYPE = 'invoice_lines';
const key = `${line.eventIdentity}|${line.invoiceId}|${line.sku}|${line.amount}`;
```

Swap those names, the fixture rows, and the postcondition in `MemoryInvoiceAdapter.verify`. Policy, approval, fingerprint replay, and completed-key denial stay the same.

## Optional Postgres allowlist (existing public APIs)

`allowlist.demo.json` shows how the same table would be declared on the Postgres adapter:

```ts
import { loadAllowlistConfig, PostgresSystemOfRecordAdapter } from '@ledgerguard/postgres';

const allowlist = loadAllowlistConfig('./allowlist.demo.json');
const adapter = new PostgresSystemOfRecordAdapter(pool, { allowlist });
```

Generic allowlisted updates are **numeric** columns with a before-value guard (`invoice_lines.amount` here). Timestamp reverse (`reversed_at`) is hardcoded to `inventory_movements`. `executeConstrainedRemediation` still re-runs the built-in inventory `investigate()` / `verifyState()` loop, so this example stays on `executeConstrainedAction`. See [docs/try-on-your-own-table.md](../../docs/try-on-your-own-table.md).
