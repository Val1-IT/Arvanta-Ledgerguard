# @ledgerguard/policy

Deterministic policy decisions, trusted capability authority (`AuthorityContext`), approval gates, and safety audit primitives. Policy is ordinary TypeScript, not prompts.

**Dependencies:** Must not depend on postgres or DataHub, and must never accept capabilities or policy decisions from model output (see Invariants in [CONTRIBUTING.md](../../CONTRIBUTING.md)). Depends only on `@ledgerguard/core` and `zod`.

**Tests** (from the repo root):

```bash
pnpm --filter @ledgerguard/policy test
```
