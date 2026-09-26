# Threat model (v0.2)

LedgerGuard assumes a **trusted host process** and an **untrusted LLM**. The model may propose; it must not become authority.

## Protects against (when used as designed)

- LLM-generated arbitrary SQL or unconstrained write tools
- Execution without a trusted `AuthorityContext` capability
- Agent self-approval (`actorType: agent` cannot approve)
- Missing human approval when policy requires it
- Stale approval (plan version mismatch)
- Replay of a **completed** idempotency key (`ALREADY_EXECUTED`, no second mutation)
- Committing a repair that fails deterministic verification (rollback)
- Treating an adapter/HTTP success as execution success without `verifyState`
- Silently retrying an expired `reserved` key whose live state is ambiguous
- Treating DataHub / catalog outage as permission to skip policy or verification

## Does not claim to protect against

- A compromised trusted runtime or malicious server action that mints capabilities
- Stolen database credentials or a malicious DBA
- Broken PostgreSQL isolation/durability guarantees
- Distributed transactions across unrelated systems
- Bugs in a future custom adapter
- Arbitrary code running inside the LedgerGuard process
- Adapters that cannot persist idempotency in the same native transaction as the mutation
- Ambiguous expired reservations (`RECOVERY_REQUIRED`) until a human inspects the system of record

## Trust boundaries

| Component | Trust |
| --- | --- |
| LLM / agent output | Untrusted |
| Demo UI form fields | Untrusted (must not carry capabilities) |
| `AuthorityContext` from application server code | Trusted in the demo (hardcoded `incident-ui`) |
| `@ledgerguard/policy` | Trusted deterministic code |
| `@ledgerguard/postgres` allowlist | Trusted mutation surface |
| `@ledgerguard/datahub` | Untrusted for authority; optional context |

Demo authority is **not** production IAM. v0.2 closes the PostgreSQL post-COMMIT reserved-key window for the default adapter; it does not claim exactly-once delivery.
