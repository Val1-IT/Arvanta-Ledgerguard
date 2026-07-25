# Hackathon submission draft

Copy-paste-ready draft for the submission form. Fill in the placeholders
before submitting; everything else is ready to use as-is.

---

## Project title

Arvanta LedgerGuard

## Tagline

A DataHub-powered financial integrity agent that detects ERP data failures,
traces their downstream impact, and executes human-approved remediation.

## 50-word summary

LedgerGuard detects ERP data-integrity failures — starting with unit-conversion
errors — traces their financial blast radius through DataHub lineage, computes
exact exposure with a deterministic engine, and executes a human-approved,
transactional remediation. The LLM explains and orchestrates; it never
computes a number or writes data without explicit human approval.

## 150-word summary

A single wrong unit-conversion factor can silently corrupt inventory
valuation, cost of goods sold, journal entries, and gross-margin reporting —
and a typical ERP shows the wrong number without explaining why, what's
affected, or how much is at stake. Arvanta LedgerGuard is an agent that closes
that gap. It detects the failure, reads real context from DataHub — schema,
ownership, glossary terms, tags, and lineage — through the DataHub MCP Server
to understand what the data means and what it feeds downstream, and uses a
deterministic, LLM-free TypeScript engine to compute the exact blast radius
and financial exposure. It then proposes a reversible remediation plan that a
human must explicitly approve before anything executes. Execution is
transactional, verified afterward, and only then written back to DataHub —
updating the dataset's trust status so the catalog reflects reality. The LLM
explains and plans; it never decides a number or bypasses human approval.

## Long description

**The problem.** ERP systems compute inventory valuation, cost of goods sold
(COGS), and gross margin from chains of derived data. A single upstream error
— for example a unit-conversion factor silently changed from `1 CARTON = 12
PCS` to `1 CARTON = 10 PCS` — propagates automatically through every
inventory movement, valuation, and journal entry that depends on it, and
surfaces downstream as a wrong margin or a valuation that doesn't reconcile.
The ERP shows the symptom, not the cause, and someone has to manually trace it
backwards under time pressure.

**The solution.** LedgerGuard automates that trace end to end, with a human
approval gate before any correction is applied: Detect → Investigate with
DataHub context → Quantify deterministic financial exposure → Generate a
remediation plan → Human approval → Transactional execution → Verification →
DataHub write-back.

**DataHub usage.** DataHub is not a passive catalog LedgerGuard occasionally
reads — it is the agent's actual context source and its system of record for
data-quality status. The agent reads schema, ownership, glossary terms, tags,
and lineage through the DataHub MCP Server to understand the affected dataset
and compute its blast radius, mutates DataHub the moment an investigation
opens (tagging the dataset "At Risk" with an explanatory note), and writes the
verified resolution back once a remediation is confirmed — restoring "Trusted"
status on DataHub itself, not just in LedgerGuard's own database.

**Technical highlights.** A pure, side-effect-free TypeScript engine
(`src/engine/`) is the single source of truth for every number: blast radius,
financial exposure (computed via a disjoint-population summation over
on-hand vs. sold affected units, so the two exposure components are
mathematically proven not to double-count), the remediation plan, its
transactional execution, and post-execution verification. The investigation
agent (`src/agent/`) wraps this engine and DataHub context with a single LLM
call, constrained to schema-validated structured output and mechanically
reconciled against the engine's own numbers before its explanation is trusted.

**Safety.** The LLM explains and orchestrates; it never computes a financial
number and never writes to the database directly. No remediation executes
without an explicit, persisted human approval, checked with optimistic
concurrency against the plan version actually reviewed. Execution is
transactional with rollback on failure. The incident is only marked resolved
after independent post-execution verification. A DataHub write-back failure
after a verified remediation does not roll back the already-correct ERP fix —
it marks the DataHub-side metadata as stale instead, so the gap is visible
rather than hidden.

**Limitations.** The demo dataset is synthetic and scoped to one clear
scenario. The deployment described is hackathon-grade — a single demo VM, no
multi-tenant isolation. DataHub OSS itself is resource-heavy (~8 GB RAM, ~13
GB disk), independent of anything LedgerGuard does. The live model-provider
smoke test may be gated without a configured API key, falling back to a
deterministic template narrator. LedgerGuard is not a substitute for audit or
accounting review, and it is not a production ERP migration or data-repair
tool.

## Repository link

`[REPOSITORY_LINK_PLACEHOLDER]`

## Live demo link

`[LIVE_DEMO_LINK_PLACEHOLDER]`

## Video link

`[VIDEO_LINK_PLACEHOLDER]`

## Team information

`[TEAM_INFORMATION_PLACEHOLDER]`

## Category

Agents That Do Real Work — the agent uses the DataHub MCP Server / Agent
Context Kit as its primary path to read metadata and write back results.

## Built for

Build with DataHub: The Agent Hackathon. This submission does not claim any
award, placement, or endorsement.

## License

Apache License 2.0.
