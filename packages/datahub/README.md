# @ledgerguard/datahub

Optional DataHub catalog context and metadata write-back. It enriches investigations with catalog metadata but is outside the execution authority boundary.

**Dependencies:** Must stay optional: nothing in core, policy, or the adapters may require it, and it must never authorize or execute mutations (see Invariants in [CONTRIBUTING.md](../../CONTRIBUTING.md)). Its only runtime dependency is `zod`.

**Tests** (from the repo root):

```bash
pnpm test:datahub-pkg   # offline package tests
pnpm test:datahub       # optional live DataHub suite
```
