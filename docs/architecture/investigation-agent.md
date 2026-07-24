# FASE 5 — DataHub-Aware Investigation Agent

This document describes `src/agent/*` — the orchestrator that turns a raw incident
trigger into a persisted, reconciled, DataHub-grounded investigation. It follows the
same structure as [`docs/architecture/financial-integrity-engine.md`](financial-integrity-engine.md)
(FASE 4), which this agent wraps rather than replaces.

## 1. Scope and boundary

The investigation agent does **three** things and nothing else:

1. Calls the FASE 4 deterministic engine (`investigateIncident()`) to get numbers.
2. Calls DataHub, via its MCP server, to get metadata (schema, owners, glossary, tags,
   lineage) and to write an "At Risk" tag + explanatory note back onto the affected
   dataset.
3. Calls an LLM to turn (1) and (2) into a plain-language explanation, a remediation
   rationale, and a recommendation — then mechanically checks that explanation against
   (1) and (2) before trusting it with anything.

It does **not** decide what the numbers are, does **not** decide what DataHub's metadata
says, and does **not** execute any remediation. FASE 6 (containment, approval, execution,
rollback) is out of scope for everything in this document — `runInvestigation()` never
calls anything from `src/engine/remediation` beyond reading the engine's own
`safeCorrectionPreview`, and it never writes anything to the operational database.

## 2. Division of responsibility

Three systems, three kinds of authority, enforced structurally rather than by
convention:

| System | Owns | Enforced by |
|---|---|---|
| Deterministic engine (`src/engine/*`) | Every number: root cause value, financial impact, record IDs, blast radius. | The model is only ever given the engine's `IncidentInvestigationReport` as read-only JSON; nothing in `src/agent/*` re-derives a number from raw rows. |
| DataHub via MCP (`src/datahub/mcp/*`, called through `src/agent/datahub-client.ts`) | Schema, owners, glossary terms, tags, lineage, and the write-back itself. | The model is only ever given a `DataHubContext` object built exclusively from real MCP tool responses (see §5); nothing in `src/agent/*` invents an owner or lineage hop. |
| LLM (`src/agent/model.ts` and implementations) | Planning: explaining root cause/blast radius/impact in prose, remediation rationale, evidence-sufficiency judgment, next-step recommendation. | The model's output is untrusted (`ModelInvestigationOutputSchema`) until it survives reconciliation (§6); it is structurally incapable of adding a number, owner, or lineage hop that isn't already `cited` from the two systems above, because the reconciliation checks reject anything that doesn't literally appear in the inputs it was given. |

This mirrors the engine/LLM split from FASE 4, extended with a second authoritative
source (DataHub) that the model must also cite rather than invent. The system prompt in
[`src/agent/prompts/investigation-v1.ts`](../../src/agent/prompts/investigation-v1.ts)
states this contract explicitly to the model, but the prompt is advisory — the
reconciliation layer is what actually enforces it, because a model can ignore
instructions and reconciliation cannot.

## 3. Input and the 13-state / 7-failure workflow

Minimum input (`InvestigationAgentInputSchema`, `src/agent/types.ts`):

```ts
{ incidentId: string; productId: string; triggerAsset: string; requestedBy: string; mode: 'LIVE' | 'TEST' }
```

`mode: 'TEST'` is what every automated test and `npm run example:agent` uses — it
selects `DeterministicTestModel` instead of a live Anthropic call (see §7). It does not
change engine or DataHub behavior in any way; both are always real.

`runInvestigation()` (`src/agent/orchestrator.ts`) drives a linear state machine through
`WorkflowStateSchema`'s 13 states:

```
INCIDENT_RECEIVED
  → ENGINE_ANALYSIS_STARTED → ENGINE_ANALYSIS_COMPLETED
  → DATAHUB_ASSET_SEARCH → DATAHUB_SCHEMA_READ → DATAHUB_OWNER_READ
    → DATAHUB_GLOSSARY_READ → DATAHUB_LINEAGE_TRAVERSED
  → EVIDENCE_RECONCILED
  → MODEL_ANALYSIS_STARTED → MODEL_ANALYSIS_VALIDATED
  → INVESTIGATION_SUMMARY_WRITTEN
  → INVESTIGATION_COMPLETED
```

Each transition is appended to `stateHistory` with a timestamp before the next step
runs, so a persisted record always shows exactly how far an investigation got, even on
failure. Any step can instead short-circuit to one of the 7 `FailureStateSchema` states,
via a `fail()` closure that builds an `ErrorState` (failure state + message + partial
activity log) and returns immediately:

| Failure state | Raised when |
|---|---|
| `MCP_UNAVAILABLE` | The DataHub MCP bridge subprocess cannot be reached at all. |
| `DATASET_NOT_FOUND` | `triggerAsset` does not resolve to a real DataHub dataset. |
| `LINEAGE_INCOMPLETE` | DataHub lineage traversal returns no path beyond the trigger asset itself. |
| `ENGINE_FAILED` | `investigateIncident()` throws (bad productId, DB unavailable, etc). |
| `MODEL_OUTPUT_INVALID` | The model's structured output fails Zod parsing, or fails reconciliation (§6). |
| `EVIDENCE_INSUFFICIENT` | The model itself reports `evidenceSufficiency.sufficient: false`. |
| `WRITEBACK_FAILED` | The DataHub write-back call fails after evidence was judged sufficient. |

Critically, **every** path — success or failure — ends in a call to
`saveInvestigationRun()` (§8). A crashed or rejected investigation is never silently
dropped; it is persisted with its failure state and partial activity log, exactly the
same way a completed one is persisted with its output. This is what lets
[`app/agent/page.tsx`](../../app/agent/page.tsx)'s activity-log lookup work uniformly
regardless of outcome, and it is what
`tests/datahub/agent-orchestrator.test.ts`'s third test case (`DATASET_NOT_FOUND`)
verifies directly: a bad trigger asset produces a named failure state and a persisted
record, never a fabricated `INVESTIGATION_COMPLETED`.

On the happy path, `INVESTIGATION_SUMMARY_WRITTEN` is only reached once evidence has
been judged sufficient — the orchestrator always writes back a summary before
completing, regardless of whether the engine actually found an incident (the
"healthy baseline" test case still writes a `NO_ACTION_REQUIRED` note; see §5's
write-back constraints for what that note contains).

## 4. Engine call

`runInvestigation()` calls the FASE 4 engine's `investigateIncident()` exactly as
described in `financial-integrity-engine.md`, against the real Postgres pool passed in
via `deps.pool` — no fixtures, no mocking, in either tests or production use.
`buildEngineResultReference()` copies the fields the model is allowed to cite
(`EngineResultReferenceSchema`) directly off the engine's own
`IncidentInvestigationReport`, field by field, so there is no transcription step where a
number could be altered.

## 5. DataHub context and the bridge

`src/agent/datahub-client.ts` is the only bridge between TypeScript and DataHub. It
spawns `python -m src.datahub.mcp.agent_bridge <read|writeback>` per call (via
`resolveInterpreter()`, which prefers a project `.venv` interpreter and falls back to
`python`/`python3`), writes the call's JSON arguments to stdin, and parses one JSON
object back from stdout. This is a different process-invocation shape than
`scripts/py.mjs` (used for `datahub:*` npm scripts), which inherits stdio for a human to
watch — the bridge instead needs to parse the child's output programmatically, so its
stdio is piped.

Two calls, both required, both real MCP sessions opened by the Python side:

- **`readDataHubContext()`** — resolves `triggerAsset` to a real dataset URN, then reads
  schema, owners, glossary terms, tags, and lineage via the live MCP server, returning a
  `DataHubContext`. If the asset does not resolve, the bridge raises before opening an
  MCP session at all, and the TypeScript side surfaces that as `DATASET_NOT_FOUND` —
  this is the exact path `tests/datahub/agent-orchestrator.test.ts`'s third test
  exercises against live infrastructure.
- **`writeInvestigationSummary()`** — called only after evidence is judged sufficient
  (§3). It applies the `At Risk` tag and an editable-description note built by
  `buildWritebackSummary()`. The note always starts with the literal string
  `LedgerGuard investigation note`, always includes the `investigationId`, and always
  states the finding is **pending human approval** — it never claims a fix was applied,
  because none has been (write-back constraint per the governing FASE 5 spec: tag
  "At Risk" only, never close or resolve the incident). `tests/datahub/writeback.test.ts`
  establishes that the underlying `add_tags`/`update_description` MCP tools sometimes
  need more than one argument-shape probe before one validates (`_try_call` in
  `src/datahub/mcp/writeback.py`); the bridge tolerates that the same way, and those
  rejected probes surface as individual `ERROR`-status activity log entries even on an
  otherwise fully successful write-back (see §6 of `agent-orchestrator.test.ts`'s second
  test case, and §9 below).

Any non-`ok` response from either call raises a `DataHubBridgeError` carrying a
`failureState` and whatever partial activity log the Python side had already produced,
so a mid-call failure still contributes real entries to the persisted activity log
rather than losing them.

## 6. Reconciliation — the structural trust boundary

`src/agent/reconciliation.ts` is what makes the LLM's output safe to persist and write
back, despite the LLM being untrusted. It runs 7 independent, mechanical checks — never
re-judging the model's prose, only comparing its `cited*` claims against the real engine
result and real `DataHubContext` it was given:

| Rule | Rejects the output if... |
|---|---|
| `ASSETS_EXIST_IN_MCP` | Any cited asset, tag, or glossary term does not appear in the real `DataHubContext`. |
| `OWNERS_FROM_DATAHUB` | Any cited owner does not appear in the real `DataHubContext.owners`. |
| `NOMINAL_FIGURES_MATCH_ENGINE` | Any cited figure value does not equal a value literally present in the engine's `financialImpact`/`rootCause`. |
| `RECORD_COUNTS_MATCH_ENGINE` | Any cited record count does not equal a count literally present in the engine's `recordImpact`. |
| `LINEAGE_MATCHES_MCP` | The cited lineage path is not an order-preserving subsequence of the real MCP lineage path (checked with a monotonically-advancing cursor, so a model can drop hops but never reorder or fabricate them). |
| `CORRECTION_TARGETS_MATCH_ENGINE` | Any cited correction target is not one the engine itself classified as a correction target. |
| `NO_EVIDENCE_MISCLASSIFIED_AS_CORRECTION` | A record the engine classified as evidence-only is cited as a correction target, or vice versa. |

A single failing check fails the whole `ReconciliationResult`, and the orchestrator
treats that as `MODEL_OUTPUT_INVALID` — it never proceeds to write-back on a
reconciliation failure, regardless of how sufficient the model's own
`evidenceSufficiency` claim was. This is the mechanism that actually enforces §2's
division of responsibility; the system prompt's hard rules (§7) are what the model is
told, reconciliation is what is actually checked.

## 7. The model layer

`InvestigationModel` (`src/agent/model.ts`) is a single-method interface:
`generateInvestigation(facts): Promise<ModelInvestigationOutput>`. Two implementations:

- **`AnthropicInvestigationModel`** (`src/agent/model-anthropic.ts`) — the real
  implementation, using forced tool-call structured output
  (`tool_choice: { type: 'tool', name: 'submit_investigation' }`) against a JSON schema
  hand-mirrored from `ModelInvestigationOutputSchema`, with the system prompt from
  [`src/agent/prompts/investigation-v1.ts`](../../src/agent/prompts/investigation-v1.ts).
  That prompt is explicit about the hard rules reconciliation enforces (never
  recompute a number, never invent DataHub metadata, never call
  `grossStatementFootprint` the primary exposure, never suggest editing a posted journal
  entry directly, no chain-of-thought in any field) so that a well-behaved model fails
  reconciliation rarely, not never — reconciliation, not the prompt, is the actual
  safety boundary. **This implementation has not been exercised against a live
  Anthropic API key in this environment**, because none is configured in `.env`; it is
  reviewed for correctness against the schema and prompt contract but not run.
- **`DeterministicTestModel`** (`src/agent/model-test.ts`) — no network call. It echoes
  the facts it is given verbatim into every `cited*` field, so it passes reconciliation
  by construction, and derives `recommendedNextStep`/`evidenceSufficiency` from simple,
  documented rules (`decideRecommendedNextStep()`, `missingEvidenceFor()`). This is what
  every unit test, the live orchestrator integration test, and `npm run example:agent`
  use — it lets the rest of the pipeline (engine, DataHub bridge, reconciliation,
  activity log, persistence) be exercised against **real** infrastructure without
  requiring a live LLM call or making test outcomes depend on model non-determinism.

Prompts are versioned by filename (`investigation-v1.ts`, `PROMPT_VERSION` constant)
rather than edited in place once used for a real run, because the prompt is part of the
reconciliation contract's provenance trail — changing what a model was told after the
fact would make a persisted `InvestigationRunRecord` impossible to audit correctly.

## 8. Activity log and persistence

`ActivityLogger` (`src/agent/activity-log.ts`) is instantiated once per investigation
run. It absorbs two kinds of entries into one timeline:

- `record()` — times an in-process call directly (the engine call, the model call).
- `ingest()` — absorbs pre-formed entries reported by the Python-side DataHub bridge,
  which times its own MCP tool calls (including individual argument-shape probes; see
  §5) and reports them back as already-timestamped entries.

`finalize()` re-sorts every entry — regardless of source — by `startedAt` and
reassigns sequential `seq` numbers 1..N. This is what lets a subprocess call's internal
timeline (potentially several MCP tool attempts) interleave correctly with in-process
engine/model timing into one coherent, strictly-sequential activity log, which
`tests/datahub/agent-orchestrator.test.ts` verifies directly
(`activityLog.map(e => e.seq)).toEqual(activityLog.map((_, i) => i + 1))`).

Before any error is stored, `sanitizeError()` redacts it: `Bearer`/`Authorization`
header values, any value under a key/token/secret/password/credential-labeled field, and
any generic opaque token 32+ characters long, all via regex, with the result capped at
300 characters. This is the concrete mechanism satisfying the FASE 5 spec's requirement
that activity logs never contain tokens or credentials — it runs unconditionally on
every error the logger stores, not just ones a caller remembers to sanitize.

`saveInvestigationRun()` / `loadInvestigationRun()`
(`src/db/repositories/investigation-runs.ts`) upsert and re-validate the entire
Zod-checked `InvestigationRunRecord` (`on conflict (id) do update`), so a record loaded
back from Postgres has already passed the same schema validation as one freshly
produced — `tests/datahub/agent-orchestrator.test.ts` checks
`loadInvestigationRun(...)` against the in-memory `record` for byte-for-byte equality on
every test case, including the failure case.

## 9. What this agent does NOT do

- It does not execute, stage, or preview remediation writes against the operational
  database. It reads the engine's `safeCorrectionPreview` only to let the model explain
  *why* a correction makes sense — FASE 6 owns actually running one.
- It does not close, resolve, or downgrade a DataHub incident/tag. The only DataHub
  mutation it ever performs is adding the `At Risk` tag and an editable-description
  note that explicitly states the finding is pending human approval.
- It does not retry a failed MCP call by falling back to fabricated or cached metadata —
  a bridge failure is a named failure state, never silently papered over.
- It does not let the model's own confidence override reconciliation. A model that
  claims `evidenceSufficiency.sufficient: true` but cites even one figure, owner, or
  lineage hop that doesn't check out is still rejected as `MODEL_OUTPUT_INVALID`.
- It does not treat "every activity log entry succeeded" as the correctness bar for a
  run. Individual MCP argument-shape probes are expected to fail before one succeeds
  (§5); what must hold is that the run reaches `INVESTIGATION_COMPLETED` with a valid,
  reconciled output and a correctly-sequenced log — which is what
  `tests/datahub/agent-orchestrator.test.ts` actually asserts, backed by an independent
  GMS GraphQL read-after-write check that the tag and note really landed in DataHub.
- It is not the FASE 7 incident dashboard. `app/agent/page.tsx` exists only to trigger a
  run and look up a prior run's activity log, so this agent's behavior is testable
  end-to-end from a browser without waiting for FASE 7's UI.

## 10. Where the numbers come from

Every value in
[`examples/agent/conversion-error-investigation-run.json`](../../examples/agent/conversion-error-investigation-run.json)
is real orchestrator output — `npm run example:agent` runs `runInvestigation()` end to
end against the seeded conversion-error scenario in `ledgerguard-postgres` and a live,
bootstrapped DataHub instance via the real MCP bridge, using `DeterministicTestModel` so
the run has no network dependency on an LLM provider. It restores both the demo database
and DataHub's metadata afterward, the same way the DataHub test suite's own teardown
does (`tests/datahub/global-setup.ts`). Nothing in that JSON file is hand-written.

Test coverage backing every claim in this document:

- `tests/unit/agent/*.test.ts` — 14 required unit test cases: reconciliation rules in
  isolation, activity log sequencing/sanitization, orchestrator failure-state branching
  against fixtures (no real Postgres or DataHub).
- `tests/datahub/agent-orchestrator.test.ts` — 3 integration tests against live Postgres
  and live DataHub: healthy baseline (`NO_ACTION_REQUIRED`), real conversion-error
  incident (`REQUEST_APPROVAL` + verified write-back), and unknown trigger asset
  (`DATASET_NOT_FOUND`).
- `npm run test:agent` runs both suites together; `npm run example:agent` regenerates
  the example artifact.
