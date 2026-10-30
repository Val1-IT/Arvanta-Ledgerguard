# @ledgerguard/core

Deterministic investigation, evidence, findings, side effects, verification, and execution contracts: detectors, decimal money math, and the ports adapters implement.

**Dependencies:** Must not depend on postgres, DataHub, Next, or LLM SDKs (see Invariants in [CONTRIBUTING.md](../../CONTRIBUTING.md)). Its only runtime dependencies are `decimal.js` and `zod`.

**Tests** (from the repo root):

```bash
pnpm test:core
```
