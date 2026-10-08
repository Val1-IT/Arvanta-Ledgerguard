# Hackathon archive

These files are from the DataHub Agent Hackathon prototype that LedgerGuard
grew out of. They are kept for history, not as current contributor docs.

Current testers should start at the repository [README](../../../README.md)
(`pnpm demo`) and [CONTRIBUTING](../../../CONTRIBUTING.md).

| File | What it was |
| --- | --- |
| [`submission.md`](submission.md) | Copy-paste draft for the hackathon submission form |
| [`deployment.md`](deployment.md) | Hackathon-grade single-VM demo deployment notes |
| [`video-script.md`](video-script.md) | Judge-demo video narration script |
| [`arvanta-ledgerguard-implementation-plan.md`](arvanta-ledgerguard-implementation-plan.md) | Original phased implementation plan (pre-monorepo) |

## Not moved in this housekeeping pass

These still live at their original paths so this PR does not touch runtime
scripts, `package.json` scripts, or examples:

- `scripts/judge-preflight.ts` / `pnpm judge:preflight`
- `scripts/proof-judge-flow.ts` / `pnpm proof:judge-flow`
- `examples/judge-proof/` (directory for sanitized live artifacts; none are shipped)
- `.env.example` judge-mode flags (`JUDGE_MODE`, `REQUIRE_LIVE_MODEL`, …)

They are leftover hackathon runtime policy, not part of the public `pnpm demo`
path. See also `docs/architecture/trust-boundary.md`.
