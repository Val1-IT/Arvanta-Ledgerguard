# examples/agent

Captured, real output (`InvestigationOutputSchema`) from the FASE 5 DataHub-aware
investigation agent orchestrator (`src/agent/orchestrator.ts`), run end to end
against the seeded conversion-error scenario in `ledgerguard-postgres` and a live
DataHub OSS instance via the real MCP bridge. Regenerate with `npm run example:agent`
(requires the demo database and a bootstrapped DataHub + MCP server already running).
Every value in this file — engine result, DataHub context, reconciliation, activity
log, write-back result — comes from a real run, none are hand-written.
