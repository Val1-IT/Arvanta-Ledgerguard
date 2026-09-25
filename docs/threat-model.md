# Threat model (v0.1)

LedgerGuard assumes a **trusted host process** and an **untrusted LLM**. The model may propose; it must not become authority.

## Protects against (when used as designed)

- LLM-generated arbitrary SQL or unconstrained write tools
- Execution without a trusted `AuthorityContext` capability
- Agent self-approval (`actorType: agent` cannot approve)
- Missing human approval when policy requires it
- Stale approval (plan version mismatch)
- Replay of a **completed** idempotency key (`ALREADY_EXECUTED`, no second mutation)
- Committing a repair that fails deterministic verification (rollback)
- Treating DataHub / catalog outage as permission to skip policy or verification

## Does not claim to protect against

- A compromised trusted runtime or malicious server action that mints capabilities
- Stolen database credentials or a malicious DBA
- Broken PostgreSQL isolation/durability guarantees
- Distributed transactions across unrelated systems
- Bugs in a future custom adapter
- Arbitrary code running inside the LedgerGuard process
- The known crash window between `COMMIT` and idempotency `completed`

## Trust boundaries

| Component | Trust |
| --- | --- |
| LLM / agent output | Untrusted |
| Demo UI form fields | Untrusted (must not carry capabilities) |
| `AuthorityContext` from application server code | Trusted in v0.1 (demo-hardcoded) |
| `@ledgerguard/policy` | Trusted deterministic code |
| `@ledgerguard/postgres` allowlist | Trusted mutation surface |
| `@ledgerguard/datahub` | Untrusted for authority; optional context |

v0.1 demo authority is **not** production IAM.
