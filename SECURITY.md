# Security policy

LedgerGuard is pre-1.0 research/demo software. The demo does not provide production authentication.

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

Report issues against current `main` or the exact commit of an open development PR; the latest published release is v0.2.0 and v0.3 is experimental. There is no long-term support commitment until a stable 1.0.

| Code line | Reporting scope |
| --- | --- |
| Current main / v0.2.x release line | Report reproducible issues against the exact revision. |
| Open development PRs / experimental v0.3 | Include the commit SHA; draft code is not a released production guarantee. |
| v0.1.x and older | No continuing maintenance commitment; reproduce on current code if possible. |
