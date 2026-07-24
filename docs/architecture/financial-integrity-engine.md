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

## 7. Financial exposure: primary exposure vs. gross statement footprint (FASE 4.1)

FASE 4 originally reported a single `totalExposure = abs(inventoryValueDelta)
+ abs(cogsDelta)`. That formula was audited in FASE 4.1 and found to risk
double-counting: for the conversion-error scenario,
`inventoryValueDelta` (+14.400.000), `cogsDelta` (−14.400.000), and
`grossProfitDelta` (+14.400.000) are three statement-line *representations of
the same single accounting misstatement* — a batch of CARTON units was
recomputed with the wrong conversion factor, and that one error shows up on
the balance sheet (inventory), the income statement (COGS), and the derived
margin figure (gross profit) simultaneously. Summing any two of them without
proof that they describe non-overlapping unit populations overstates the
real exposure.

`src/engine/financial-exposure.ts`'s `buildFinancialImpact()` replaces
`totalExposure` with two distinct, separately named numbers:

### 7.1 `primaryExposure` — the actual financial exposure, proven non-double-counted

The engine only sums `inventoryExposureComponent` (`abs(inventoryValueDelta)`)
and `realizedCogsExposureComponent` (`abs(cogsDelta)`) when it can *prove*
the underlying unit populations are disjoint — never on assumption:

```
onHandAffectedUnits + soldAffectedUnits =?= totalBaseInAffected   (tolerance 0.001)
```

This reconciliation holds by construction: `quantityOnHand = totalBaseIn −
totalBaseOut` is a structural accounting identity for any product — a base
unit that entered inventory is, at any point in time, either still on hand or
already sold, never both. `onHandAffectedUnits` and `soldAffectedUnits` are
therefore proven non-overlapping populations, which is why
`inventoryExposureComponent` (the misstatement on the on-hand population) and
`realizedCogsExposureComponent` (the misstatement on the sold population) can
be added together without double-counting. When this holds,
`exposureMethod: 'DISJOINT_POPULATION_SUM'` and `populationsProvenDisjoint:
true` are reported alongside a human-readable `reconciliationInvariant`
string showing the actual numbers that reconciled.

**Fallback — when the proof does not hold:** if the reconciliation check
ever fails (`exposureMethod: 'MAX_STATEMENT_LINE'`,
`populationsProvenDisjoint: false`), the engine does **not** fall back to
summing anyway. It reports the single largest statement-line absolute value
instead — `max(inventoryExposureComponent, realizedCogsExposureComponent,
abs(grossProfitDelta))` — which is guaranteed never to overstate the true
exposure even without a non-overlap proof. This fallback does not occur
naturally in the current conversion-error demo scenario (the identity always
reconciles there), but it is exercised directly in
`tests/unit/engine/financial-exposure.test.ts` with a deliberately broken
invariant, so the branch is verified rather than theoretical.

For the current seed, both components are 14.400.000 and the identity
reconciles (1440 on-hand + 1440 sold = 2880 total base-in), so
`primaryExposure = 28.800.000` — numerically the same figure FASE 4 reported,
but now backed by an explicit, tested proof instead of an unproven
assumption.

`grossProfitDelta` is never added into `primaryExposure`. Since revenue is
untouched by a unit-conversion error, `grossProfitDelta` is mathematically
`-cogsDelta` by construction (`correctGrossProfit = revenue - correctCogs`) —
the same misstatement restated with the opposite sign, not a third
independent dollar of exposure.

### 7.2 `grossStatementFootprint` — every statement line, deliberately allowed to double-count

```
grossStatementFootprint = abs(inventoryValueDelta) + abs(cogsDelta) + abs(grossProfitDelta)
```

This is the raw sum of every affected statement line, kept only as a
secondary, explicitly-named figure for callers that want "how many statement
lines did this touch, added up naively" — it is never labeled or consumed as
the financial exposure. For the current seed this is 43.200.000 (three times
14.400.000), clearly larger than and never confused with `primaryExposure`
(28.800.000).

**What is still reported per-statement, regardless of the above:**
`inventoryValueDelta`, `cogsDelta`, `grossProfitDelta`, and
`grossMarginPercentageDelta` remain in `financialImpact` unchanged — the
distinction above governs only how they're *combined* into a headline
exposure number, not whether each individual statement effect is shown.

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

## 9a. Record-impact classification: evidence vs. correction target vs. downstream (FASE 4.1)

Before FASE 4.1, `affectedRecordCount` (via `blastRadius`) lumped every
touched record into one number regardless of whether it would ever be
mutated. `record-impact.ts`'s `buildRecordImpact()` splits records into three
non-overlapping buckets, each a list of `{ table, recordId }` refs plus a
count:

- **`evidenceRecords`** — records that help *prove* the incident happened but
  are never themselves mutated. Sourced from the incident's affected
  `inventory_movements` and `journal_entries` IDs. For the current seed:
  24 movements + 36 journal entries = 60.
- **`correctionTargets`** — records that FASE 6 will actually mutate or
  regenerate. Derived from `proposedCorrections`, deduplicated by
  `(table, recordId)` so that e.g. three field-level corrections on the same
  `inventory_valuation` row count once, not three times. `proposedCorrections`
  whose `action` is `RECONCILE_JOURNAL_ENTRIES` are excluded — that action is
  a read-only cross-check (see §10) and never mutates the `journal_entries`
  row it reads, so that row belongs only in `evidenceRecords`, never in
  `correctionTargets`. For the current seed: `product_units`,
  `inventory_valuation`, `gross_margin_report` = 3.
- **`downstreamAffectedRecords`** — records that aren't corrected by this
  remediation but are affected as a knock-on consequence (e.g. a report that
  reads from a corrected table but isn't itself regenerated). Empty for the
  current single-incident scenario; the field exists so a future
  multi-hop-impact scenario has somewhere to put such records without
  overloading `correctionTargets`.

`uniqueRecordCount` is the size of the deduplicated union of all three
buckets — not their naive sum — so a record referenced in more than one
bucket (which cannot currently happen given the exclusion rule above, but is
guarded regardless) is still counted once. For the current seed this equals
`blastRadius.affectedRecordCount` (63), cross-validating both models against
each other from independent code paths.

**Remediation previews must read `correctionTargets`, never
`evidenceRecords`** — a UI or agent building a "what will actually change"
summary should enumerate `recordImpact.correctionTargets`, not all
`affectedRecords`, or it will present read-only evidence as if it were about
to be modified.

## 9b. `incidentType` vs. `overallStatus`: two independent axes (FASE 4.1)

FASE 4 conflated "is there a named incident" with "is everything fine" by
using a shared `HEALTHY` value inside what was effectively an incident-type
field. FASE 4.1 splits this into two independent fields on
`IncidentInvestigationReport`:

- **`incidentType`** — `'UNIT_CONVERSION_MISMATCH' | null`. Names a
  *specific, engine-recognized incident category*. It is `null` whenever no
  such named incident was detected — it is never used to assert "everything
  is fine," because a report can have `incidentType: null` and still be
  unhealthy (see case B below).
- **`overallStatus`** — `'HEALTHY' | 'DEGRADED' | 'CRITICAL'`. The aggregate
  health signal, derived in `investigate.ts`'s `deriveOverallStatus()`:
  1. Any root cause found (`incidentType` non-null) → `CRITICAL`.
  2. Else, any quality check `FAIL` with `severity: 'critical'` → `CRITICAL`.
  3. Else, any quality check `FAIL` with `severity: 'warning'` → `DEGRADED`.
  4. Else → `HEALTHY`.

Three scenarios exercised directly in the test suite:

| Scenario | `incidentType` | `overallStatus` | Test |
|---|---|---|---|
| A. Healthy baseline | `null` | `HEALTHY` | `investigate.test.ts` case 1 |
| B. Pre-existing journal imbalance, no conversion incident | `null` | `CRITICAL` (JournalBalanceCheck is `severity: 'critical'`) | `quality-checks.test.ts` case 7 |
| C. Conversion-factor incident | `UNIT_CONVERSION_MISMATCH` | `CRITICAL` | `investigate.test.ts` case 2 |

Scenario B is the reason this split exists: a structural bookkeeping problem
unrelated to any named incident type must still degrade `overallStatus`,
without being mislabeled as an `UNIT_CONVERSION_MISMATCH` it has nothing to
do with (§6).

Note this is unrelated to `verify.ts`'s `VerificationResult.overallStatus`
(`'PASS' | 'FAIL'`), which aggregates post-remediation check results, not
incident health — the two `overallStatus` fields live on different types and
happen to share a name.

## 9c. Expected-value provenance (FASE 4.1)

`RootCause.expectedValueSource` answers "why is 12 considered correct and 10
considered wrong?" — it is never a hardcoded assumption. For the MVP, the
only source type is `'baseline_snapshot'`:

```ts
{
  type: 'baseline_snapshot',
  recordId: 'baseline',
  capturedAt: <the baseline_snapshot row's captured_at column>,
  evidenceReference: 'baseline_snapshot.conversionFactor.<unitName>'
}
```

`fetchBaselineSnapshot()` (`src/db/repositories/reports.ts`) reads
`captured_at` as a real column alongside the snapshot's JSON blob and merges
it into the parsed `BaselineSnapshot` object — it is not embedded inside the
JSON payload itself, so it reflects the actual row timestamp regardless of
when the JSON was authored. `conversion-impact.ts`'s `selectRootCause()`
takes the loaded baseline as a parameter specifically so it can attach this
provenance to whichever root cause it selects, rather than asserting the
expected value with no traceable origin.

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
  unit-conversion-factor incident type — `incidentType` currently has one
  named value, `UNIT_CONVERSION_MISMATCH`, or `null` when no such incident is
  detected (§9b; `null` does not imply healthy — check `overallStatus`
  separately).
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
