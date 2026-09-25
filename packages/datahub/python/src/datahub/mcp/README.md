# src/datahub/mcp

The agent's **primary** DataHub runtime: the DataHub MCP Server / Agent Context
Kit. All agent reads of DataHub context (search assets, read schema, read
ownership, traverse lineage, read quality context) and supported write-back go
through here.

Built in FASE 3B (connectivity proof) and FASE 5 (agent investigation).
