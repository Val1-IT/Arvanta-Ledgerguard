# Security policy

LedgerGuard is pre-1.0 research/demo software. The v0.1 demo does not provide production authentication.

## Reporting a vulnerability

Please use **GitHub private vulnerability reporting** on this repository (Security → Report a vulnerability) if it is enabled.

If that feature is not available, open a **private** security advisory from the repository Security tab, or contact the repository owners through GitHub without attaching exploit payloads to a public issue.

Do not file public issues that include working exploits against the demo database or adapter allowlist.

## What is security-sensitive

- Bypass of policy, approval, or capability checks
- Arbitrary SQL execution through a “correction”
- Idempotency bypass that double-applies a mutation
- Verification skipped or spoofed so a failed repair commits
- Accepting `AuthorityContext` from the client or the LLM

## Supported versions

Only the current `main` / pre-release `0.1.x` line is considered. There is no long-term support commitment until a stable 1.0.
