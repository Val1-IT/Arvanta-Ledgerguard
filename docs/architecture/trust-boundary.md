# Trust boundary

LedgerGuard separates deterministic authority from optional integrations.

```
SYSTEM OF RECORD (ERP / PostgreSQL)
        ↕
LedgerGuard deterministic runtime
  (@ledgerguard/core + system-of-record adapter)
        ↕
optional integrations (DataHub, LLM narration)
```

## What LedgerGuard guarantees without DataHub

- Read-only investigation of trusted system-of-record state
- Deterministic findings, quantities, and financial exposure
- Constrained, allowlisted mutations
- Transactional execute → verify → COMMIT only on PASS, otherwise ROLLBACK
- Human approval for remediation plans

These guarantees do not require DataHub, MCP, or an LLM.

## What DataHub contributes

When configured, `@ledgerguard/datahub` may:

- enrich investigations with lineage, owners, tags, glossary terms, and catalog metadata
- improve LLM explanation by supplying those facts as citations
- receive status write-back (`At Risk` / `Trusted` tags and notes)

DataHub is an external catalog. It is not the system of record and not an authority source.

## What DataHub must not do

DataHub context must not independently:

- authorize mutations
- bypass policy or approval
- generate executable SQL
- determine capabilities
- declare verification successful
- override deterministic engine findings

## When DataHub is unavailable

- Deterministic investigation still runs against the system of record
- Catalog context is empty and provenance is `NOT_CONFIGURED` or `UNAVAILABLE`
- LedgerGuard does not fabricate demo URNs or lineage
- Optional write-back is recorded as `NOT_CONFIGURED` or `FAILED`
- A verified system-of-record repair is not rolled back because catalog publication failed

Judge-mode / demo-fallback flags in the application are hackathon runtime policy, not LedgerGuard core security guarantees.
