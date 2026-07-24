# Financial Integrity Engine (FASE 4)

Status: implemented and tested (unit + integration). This document describes the
deterministic engine that is the single source of truth for every number
LedgerGuard reports. It does not describe the LLM agent (FASE 5) or the UI
(FASE 7) — those consume this engine's output but never compute or alter it.

## 1. Boundary: deterministic engine vs. LLM agent

`src/engine/*` is pure TypeScript: every function takes plain data objects
(arrays/records already loaded from the database) and returns plain data
objects. It has zero imports from `pg`, Drizzle, Next.js, DataHub, or any LLM
client. This means:

- The engine can be unit tested with in-memory fixtures — no database, no
  network, no model call required (see `tests/unit/engine/`).
- It is safe to call repeatedly; nothing in it depends on wall-clock time,
  randomness, or external state.
- All I/O is isolated in `src/db/repositories/*`, which fetch rows from
  Postgres (the `ledgerguard-postgres` demo database) and validate them
  through the Zod schemas in `src/engine/types.ts` before they ever reach the
  engine. `src/db/repositories/investigation.ts`'s `loadInvestigationInput`
  is the only place that touches the database for an investigation, and it
  issues nothing but `select` statements.

The future LLM agent (FASE 5) will call into this engine's output — an
`IncidentInvestigationReport` — and use it as ground truth to narrate, plan
DataHub context reads, and explain findings in natural language. The agent
is never allowed to invent, adjust, or "double-check" a number the engine
already produced; if the agent disagrees with a number, that is a bug in the
engine, not a judgement call for the agent to override.

## 2. Decimal safety

**Chosen strategy: `decimal.js`** (`^10.6.0`), configured once in
`src/engine/decimal.ts`:

```ts
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
```

Rationale: ordinary JavaScript `number` arithmetic (IEEE-754 double) loses
precision on repeating decimals and large sums of currency values (e.g.
`0.1 + 0.2 !== 0.3`), which is unacceptable for financial figures. Postgres
`numeric` columns already store exact decimal values as strings when read
through `pg` (no implicit float coercion), so the engine treats every
numeric-as-string column as the money/quantity/factor/percentage it is and
converts it to a `Decimal` at the boundary via `toDecimal()`.

All intermediate arithmetic — division, multiplication, summation — happens
at full 40-digit `Decimal` precision. Rounding to the column's actual scale
happens exactly once, at the output boundary, via:

```
SCALE = { money: 2, quantity: 3, factor: 4, percentage: 4 }
formatMoney(d)      -> d.toFixed(2)
formatQuantity(d)   -> d.toFixed(3)
formatFactor(d)     -> d.toFixed(4)
formatPercentage(d) -> d.toFixed(4)
```

This scale mirrors the actual `numeric(precision, scale)` definitions in
`src/db/schema.ts`. Every currency and quantity field in
`IncidentInvestigationReport` is a decimal **string**, never a `number` —
this avoids silently reintroducing float imprecision when the report is
serialized to JSON and consumed by the UI or the agent.

`safeDiv(numerator, denominator, fallback = 0)` guards every division
(e.g. `totalPurchaseValue / totalBaseIn` when computing average cost) so a
degenerate zero-quantity scenario returns a defined fallback instead of
`Infinity`/`NaN` propagating through the report.

See `tests/unit/engine/rounding.test.ts` for the concrete regression this
protects against: a CARTON factor of 3 turns `100.00 / 3` into a repeating
decimal; rounding the average cost to 2dp *before* multiplying it back by
the quantity would silently lose one cent (`99.99` instead of `100.00`).
Carrying full precision through the multiply and rounding only once at the
end reproduces the original invoiced value exactly.

## 3. Root-cause detection

`conversion-impact.ts`'s `detectConversionFactorChanges()` compares the
*live* `product_units.conversion_factor` for each unit against the value
recorded for that unit in `baseline_snapshot` (captured once, at seed time,
via `src/db/seed.ts`). Any unit whose current factor differs from its
baseline factor by more than a negligible tolerance is a candidate root
cause. `selectRootCause()` picks the single candidate with the largest
absolute delta.

**Scope limitation, by design:** FASE 4 surfaces exactly one root cause per
investigation (the dominant one). A scenario with two independent,
simultaneous conversion-factor corruptions is out of scope for this phase —
extending to multiple concurrent root causes is a FASE 5+ concern if the
demo scenario ever requires it.

## 4. Recomputation strategy: baseline factor, not current factor

This is the single most important design decision in the engine, and it is
easy to get backwards.

- `inventory-impact.ts` (`recomputeMovements`, `recomputeValuations`)
  recomputes what inventory movements and valuation **should** be using the
  **baseline (expected)** conversion factor — the factor that was actually in
  effect when each historical movement was posted — never the current,
  possibly-corrupted factor. Movement `total_value` (the real invoiced money)
  is trusted as-is; only the unit-conversion math is recomputed. This is what
  lets the engine answer "what should the numbers actually be?"
- `quality-checks.ts`'s `BaseQuantityConsistencyCheck` does the opposite on
  purpose: it cross-references each movement's stored `base_quantity`
  against the **current** `product_units.conversion_factor`. This is what
  makes the check actually fail during a live incident — it's detecting "the
  stored data is inconsistent with itself right now," not "the stored data
  differs from history." It matches `tests/integration/db.test.ts`'s
  raw-SQL check 2 exactly, by design.

These are two different questions ("what actually happened, financially?"
vs. "is the current state internally consistent?") and conflating them would
make either the exposure figures or the pass/fail checks wrong.

## 5. Self-consistency vs. correctness-vs-baseline

`InventoryValuationConsistencyCheck` (`inventory_value == quantity_on_hand *
average_cost`) and `GrossMarginConsistencyCheck` (`gross_profit == revenue -
cost_of_goods_sold`; `gross_margin_percentage == gross_profit / revenue *
100`) check only the **internal arithmetic** of a stored row — not whether
that row is correct relative to the baseline.

In the conversion-error demo scenario, the corruption script
(`demo-data/scenarios/conversion-error.ts`) recomputes `inventory_valuation`
and `gross_margin_report` consistently with the *wrong* factor — so these
two rows remain internally self-consistent even though they are wrong
relative to the truth. Both checks therefore legitimately **PASS** during
the incident. This is intentional, not a defect: catching "wrong vs.
baseline" is the explicit job of `inventory-impact.ts` / `margin-impact.ts`
(surfaced as `financialImpact` and `evidence`), while these two checks catch
a different, complementary class of bug — internal arithmetic corruption
(e.g. a bad manual data patch that leaves `inventory_value` not equal to
`quantity_on_hand * average_cost`) that baseline comparison alone would
never notice.

## 6. Pre-existing issues vs. incident-caused effects

`JournalBalanceCheck` (`checkJournalBalance()` in `journal-impact.ts`) is a
purely structural check — debit total must equal credit total, grouped by
`(source_type, source_id)` — completely independent of the conversion-factor
incident. `tests/unit/engine/quality-checks.test.ts` ("pre-existing
imbalance independent of the incident") demonstrates this: corrupting a
journal entry's debit while leaving the conversion factor untouched trips
`JournalBalanceCheck` alone; `incidentType` stays `HEALTHY` (no root cause is
detected) and every other check still passes. A real deployment would need
this separation — a structural bookkeeping bug should never be misreported
as "caused by" an unrelated conversion-factor incident just because both
happened to be found in the same investigation run.

## 7. Financial exposure formula

```
totalExposure = abs(inventoryValueDelta) + abs(cogsDelta)
```

implemented in `src/engine/financial-exposure.ts`. `delta` is defined
throughout as `correctValue − currentlyReportedValue` (positive =
understatement, negative = overstatement), so both terms are taken as
absolute values before summing.

**What is included:** the balance-sheet misstatement (inventory value) and
the income-statement misstatement (realized COGS) — the two places money is
actually wrong on the books.

**What is deliberately excluded, and why:**

- `grossProfitDelta` is **not** added a second time. Since revenue is
  untouched by a unit-conversion error, `grossProfitDelta` is mathematically
  `-cogsDelta` — the same misstatement, viewed from the income-statement
  side, with the opposite sign. Adding it in would double-count the same
  dollar of exposure. `grossProfitDelta` is still reported in
  `financialImpact` as a business-readable framing of the same number, but
  it does not contribute to `totalExposure`.
- `grossMarginPercentageDelta` is a ratio, not a currency amount, and cannot
  be summed with money figures.

**Limitation:** this formula assumes the two misstatements do not overlap
(e.g. it would not be correct as written if a scenario also misstated
revenue directly — that case does not occur in the current conversion-error
scenario and is out of scope for FASE 4).

## 8. Evidence model

Every finding is traceable via `EvidenceItem`:

```ts
{ table, recordId, field, expectedValue, actualValue, delta, reason }
```

`investigate()`'s `buildEvidence()` emits one evidence item for the root
cause itself (the `product_units.conversion_factor` divergence) plus one
per mismatched field on any valuation or margin report that diverged from
its recomputed-correct value. `expectedValue`/`actualValue`/`delta` are
always formatted decimal strings — never floats — so the report is safe to
serialize and diff exactly.

## 9. Blast radius

`blast-radius.ts`'s `buildBlastRadius()` classifies every asset touched by
an incident into one of three roles:

- `root_cause` — the asset that actually changed (`product_units`), always
  included even when its own record count is 1.
- `requires_correction` — assets whose stored values are wrong and must be
  regenerated (`inventory_valuation`, `gross_margin_report`).
- `evidence_only` — assets that prove the incident happened but are not
  themselves corrected — `inventory_movements` (their `base_quantity` was
  correct when posted; only the *interpretation* changed) and
  `journal_entries` (untouched by the corruption scenario; used only to
  reconcile that the ledger-posted COGS still matches history).

Assets with zero affected records are omitted (except `root_cause`, which is
always shown). `affectedRecordCount` is the sum of `recordCount` across the
included assets.

## 10. Safe remediation preview (FASE 4 only previews; FASE 6 executes)

`remediation-preview.ts`'s `buildRemediationPreview()` produces an ordered
list of `ProposedCorrection`s and a list of `VerificationExpectation`s. It
never touches the database — see §1. The ordering is fixed:

1. `RESTORE_CONVERSION_FACTOR` — always first; nothing downstream can be
   safely recomputed until the root cause itself is corrected.
2. `RECOMPUTE_INVENTORY_MOVEMENT` — one row per movement whose
   baseline-recomputed `base_quantity` actually differs from what's stored.
   In the current demo scenario this list is empty (the corruption script
   never touches `inventory_movements`), which is correct — the engine does
   not fabricate a correction that isn't needed just to make the list
   non-empty (see "no invented values").
3. `REGENERATE_INVENTORY_VALUATION` — up to three field-level rows per
   mismatched valuation (`quantity_on_hand`, `average_cost`,
   `inventory_value`), each carrying an explicit before/after value.
4. `RECONCILE_JOURNAL_ENTRIES` — a single read-only verification row
   (`beforeValue == afterValue`, `financialDelta: null`) confirming the
   recomputed COGS matches what's already posted in the ledger, emitted only
   when a margin mismatch exists. Journal entries are never rewritten by
   this engine.
5. `REGENERATE_GROSS_MARGIN_REPORT` — up to three field-level rows per
   mismatched report (`cost_of_goods_sold`, `gross_profit`,
   `gross_margin_percentage`).

Sequence numbers are assigned by a closure-scoped counter
(`makeCorrectionBuilder()`), created fresh on every `buildRemediationPreview`
call — there is no shared module-level mutable state, which is what makes
repeated investigation calls produce byte-identical output (§11).

No SQL is generated by an LLM at this phase, and none is generated at all —
FASE 4 emits structured `{ table, recordId, field, beforeValue, afterValue
}` data. When FASE 6 turns this into actual statements, they must be
parameterized, scoped to the explicit record IDs listed here, wrapped in a
transaction, and must never touch anything outside the demo database.

`VerificationExpectation`s simply assert that every `QualityCheckEvaluator`
(§11) is expected to return `PASS` once FASE 6 has executed the corrections
above — `verify.ts`'s `verifyState()` is the function FASE 6 will call
post-remediation to confirm this.

## 11. Quality checks (`QualityCheckEvaluator`)

Five implementations of the shared interface, all in `src/engine/quality-checks.ts`,
collected in `ALL_QUALITY_CHECKS`:

| checkId | Purpose | Severity on FAIL |
|---|---|---|
| `CONVERSION_FACTOR_POSITIVE` | every `product_units.conversion_factor > 0` | critical |
| `BASE_QUANTITY_CONSISTENCY` | `base_quantity == quantity × current factor` | critical |
| `INVENTORY_VALUATION_CONSISTENCY` | `inventory_value == quantity_on_hand × average_cost` (self-consistency, §5) | warning |
| `JOURNAL_BALANCE` | `Σ debit == Σ credit` per journal source | critical |
| `GROSS_MARGIN_CONSISTENCY` | `gross_profit == revenue − COGS`; `margin% == gross_profit / revenue × 100` (self-consistency, §5) | warning |

Each result carries `checkId`, `status` (`PASS`/`FAIL`), `severity`,
`expected`, `actual`, `affectedRecordIds`, `evidence`, and a
`remediationHint`. Every check is pure (`QualityCheckInput -> QualityCheckResult`)
and can run before an incident, during one, and after remediation — the same
five checks, unmodified, are what `verify.ts` runs post-remediation in
FASE 6.

## 12. Idempotency

`investigate()` has no timestamp field and no source of non-determinism —
given the same `InvestigationInput`, it always returns byte-identical
output. This is asserted directly:
`tests/unit/engine/investigate.test.ts` ("repeated investigation") and
`tests/integration/engine.test.ts` ("produces identical output when
investigating the same state twice") both call `investigate()` twice on the
same input and assert `JSON.stringify()` equality.

## 13. What this engine does not do

- It does not call an LLM, DataHub, or any HTTP endpoint.
- It does not execute any correction — `proposedCorrections` is a preview
  only; FASE 6 executes, after human approval, in a transaction.
- It does not detect more than one root cause per investigation (§3).
- It does not attempt cross-scenario generalization beyond the
  unit-conversion-factor incident type — `IncidentType` currently has two
  values, `HEALTHY` and `UNIT_CONVERSION_MISMATCH`.
- It never reads or writes anything outside the demo database
  (`ledgerguard-postgres`).

## 14. Where the numbers come from

Every number in `examples/investigations/conversion-error-investigation.json`
and `examples/remediations/conversion-error-remediation.json` was produced by
actually running `npm run example` (`scripts/generate-example.ts`) against
the seeded `ledgerguard-postgres` demo database — nothing in those files is
hand-written. The same figures are independently cross-checked by three
separate test suites reaching them by different paths: the pre-existing raw
SQL assertions in `tests/integration/db.test.ts`, the pure-fixture unit
tests in `tests/unit/engine/investigate.test.ts`, and the real-database
integration tests in `tests/integration/engine.test.ts`.
