# Threat model (v0.3 experimental adapters)

LedgerGuard assumes a **trusted host process** and an **untrusted LLM**. The model may propose; it must not become authority.

## Protects against (when used as designed)

- LLM-generated arbitrary SQL or unconstrained write tools
- Execution without a trusted `AuthorityContext` capability
- Agent self-approval (`actorType: agent` cannot approve)
- Missing human approval when policy requires it
- Stale approval (plan version mismatch)
- Replay of a **completed** idempotency key (`ALREADY_EXECUTED`, no second mutation)
- PostgreSQL committing a repair that fails in-transaction deterministic verification (rollback)
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
- Atomic control-plane and system-of-record bookkeeping across different databases
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

## Remote approval and recovery

Remote plans bind the complete action, trusted adapter system identity, and source
fingerprint before approval. Execution and recovery reject substitution before
remote I/O. The trusted host must configure unique system IDs and authenticate
human approvers; a caller-controlled server connection is not a trusted identity.

Execution keys have immutable plan/version ownership. Recovery state updates use
an observed-lease compare-and-swap, protecting a renewed reservation from a stale
recovery worker. A lease is not a remote-request cancellation or fencing token.
Unknown remote write outcomes stay recoverable without automatic mutation retry.

## Odoo modes

The legacy JSON-2 sequence has independent read/write/apply transactions. It cannot
atomically enforce approved preconditions against concurrent Odoo writers, and
failed post-write verification does not roll back earlier requests.

The optional inventory addon provides a single constrained Odoo transaction for
an exact quant. It requires current caller permissions and a non-superuser stock
manager, strips arbitrary context flags, checks approved state after acquiring a
row lock, applies/verifies, and stores a receipt atomically. Recovery checks that
receipt rather than assuming a matching quantity proves this action ran. This
still does not create a distributed transaction with LedgerGuard's PostgreSQL.

The lock is not a product/location aggregate lock. Receipt deduplication is per
normalized approved action and authenticated Odoo user, not per plan or across
users. Odoo's second-precision write-date representation is not a globally unique
state version. Trusted Odoo modules and administrators remain outside this threat
model. Existing Odoo stock internals are not rewritten by this addon.

See [the integration guide](integrations/odoo.md) for exact supported scope and
[the evaluator guide](testing/external-tester-guide.md) for reproducible checks.
