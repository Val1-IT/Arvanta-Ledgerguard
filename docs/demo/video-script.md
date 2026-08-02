# Demo video script (≤ 3:00)

Target length: 3 minutes. Times are targets, not hard cuts — see "parts that
can be sped up" below if you're running long.

Do not use the phrase **"fully autonomous"** anywhere in narration or on-screen
text. LedgerGuard requires human approval before any remediation executes;
describe it as agent-assisted, human-approved, or similar.

Prep before recording: set the judging environment, run `npm run judge:preflight`,
then `npm run proof:judge-flow`. Confirm the app is on a known port and do one
silent dry run of the full flow so you know current UI wording and timings.

---

## 0:00–0:15 — Problem

**On-screen:** Overview page, healthy state (`healthy-overview-desktop.png`
composition).

**Narration:** "This is a healthy ERP. Every number here — inventory value,
cost of goods sold, gross margin — depends on data upstream, like how many
units are in a carton. One wrong conversion factor here can quietly corrupt
everything downstream, and a typical ERP won't tell you why."

**Expected status:** Data Health: healthy. No incidents.

**Must not cut:** The healthy baseline — it's the contrast the rest of the
video depends on.

## 0:15–0:35 — Simulate

**On-screen action:** Press "Simulate Conversion Error" (or run
`npm run scenario:conversion-error` just before recording and show the
resulting state if the UI has no live trigger button).

**Narration:** "I'll simulate exactly that: the CARTON unit's conversion
factor gets silently changed from 12 to 10."

**Expected status:** Overview flips to an at-risk/critical state
(`at-risk-overview-desktop.png`).

**Can be sped up:** The transition animation, if any — cut straight to the
at-risk state.

## 0:35–1:05 — Investigation

**On-screen:** Incident detail → Investigation tab
(`incident-investigation-desktop.png`).

**Narration:** "LedgerGuard opens an investigation. It reads real context from
DataHub — schema, ownership, the glossary term for unit conversion, lineage —
through the DataHub MCP Server, not just from its own database. It finds the
root cause: CARTON should convert at 12, it's reading 10."

**On-screen actions:** Point out the DataHub context panel / MCP activity log
and the lineage graph if visible; highlight the compact `Live MCP` provenance,
"root cause", and "evidence sufficiency" indicators.

**Expected status:** Investigation complete, root cause identified, DataHub
tag shows "At Risk" with an explanatory note (visible if you check the
DataHub UI directly, optional).

**If DataHub fails:** Do not present a completed fallback in judging mode. Show
the visible failure, repair the live service, then restart the flow; use only a
recorded successful live pass in the final edit.

## 1:05–1:35 — Impact

**On-screen:** Impact tab (`incident-impact-desktop.png`).

**Narration:** "The exposure is computed by a deterministic engine, not the
LLM. 24 inventory-movement records and 36 journal entries are affected. The
primary financial exposure is about 28.8 million rupiah, with a gross
statement footprint of about 43.2 million — and the on-hand and sold portions
are mathematically proven not to overlap, so this number isn't double
counted."

**On-screen actions:** Show the evidence list (24 movements, 36 journal
entries), the exposure figures, the correction-target list, and the lineage
graph highlighting the affected downstream datasets.

**Expected status:** Impact fully populated with the numbers above.

**Can be sped up:** Scrolling through the full evidence list — a few seconds
of scroll is enough; you don't need to read every row on camera.

## 1:35–2:10 — Human-approved remediation

**On-screen actions:** Click "Generate remediation plan" → "Submit for
approval" → switch to the approver view (or scroll to the approval panel) →
"Approve".

**Narration:** "Now the human-in-the-loop part. LedgerGuard proposes a
correction plan, but nothing executes yet — it has to be explicitly approved.
Approval is checked against the exact plan version reviewed, so a stale
approval can't slip through. LedgerGuard never rewrites a journal entry
directly — it only executes a plan a human has already seen and approved."

**Expected status:** Plan generated → pending approval → approved.

**Must not cut:** The moment of explicit approval — this is the safety
property judges most need to see.

## 2:10–2:35 — Execute and verify

**On-screen action:** Click "Execute".

**Narration:** "Execution runs inside one database transaction. If anything
fails, it rolls back completely. Afterward, LedgerGuard independently
re-verifies the correction before marking anything resolved."

**Expected status:** Executing → Verifying → Resolved
(`executing-verifying-desktop.png`, `resolved-desktop.png`).

**Can be sped up:** The execution/verification wait itself, if it takes more
than a couple of seconds — cut to the resolved state.

## 2:35–2:50 — DataHub write-back

**On-screen:** DataHub write-back status on the resolved incident, or the
DataHub UI showing the dataset's tag restored to "Trusted"
(`datahub-writeback-failed-desktop.png` only if demonstrating the failure
path — otherwise show the success state).

**Narration:** "Finally, LedgerGuard writes the resolution back to DataHub
itself, restoring the dataset's trust status — so the catalog reflects
reality, not just LedgerGuard's own database."

**Expected status:** Write-back succeeded, "Trusted" tag restored.

**Backup path if write-back is slow:** Narrate over the pending state ("this
call is happening live against DataHub right now") rather than cutting away;
if it's still pending after a few seconds, cut to a state captured in an
earlier dry run and say so verbally ("here's that same write-back completing
from an earlier run").

## 2:50–3:00 — Closing

**On-screen:** Back to Overview, healthy again (after `npm run db:reset` run
off-camera, or shown live if time allows).

**Narration:** "One data error, traced end to end, with a human approving
every change — that's LedgerGuard."

**Must not cut:** The closing line — it's the one sentence that has to land.
