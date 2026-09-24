# LedgerGuard authority model

Reasoning is not authority. An LLM may propose a repair. Trusted runtime supplies identity and capabilities. Deterministic policy decides whether execution is permitted. Humans approve high-impact plans. The system-of-record adapter applies only allowlisted mutations. Verification, not the model, determines success. Idempotency prevents duplicate effects.

```
AI / AGENT
    │
    ▼
PROPOSED ACTION
    │
    ▼
POLICY ───────── DENY
    │
    ▼
AUTHORITY ────── DENY
    │
    ▼
APPROVAL ─────── WAIT
    │
    ▼
IDEMPOTENCY ──── ALREADY EXECUTED
    │
    ▼
TRANSACTION
    │
    ▼
VERIFY
   / \
PASS FAIL
 │     │
COMMIT ROLLBACK
```

## Trusted authority

`AuthorityContext` is constructed only by application/runtime code (`source: "trusted_runtime"`). Server actions do not accept capabilities from the client or from model output. Zod rejects unknown capability names and unknown sources.

An actor with `actorType: "agent"` cannot approve a plan.

## Policy

`@ledgerguard/policy` evaluates ordinary TypeScript rules:

- evidence present
- verification expectations present
- financial impact vs configured threshold
- required capability
- approval of the exact plan version
- completed idempotency keys cannot mutate again

Outcomes: `ALLOW`, `DENY`, `REQUIRE_APPROVAL`.

Thresholds come from trusted `PolicyConfig`, never from the model.

## Approval

The existing remediation state machine remains the approval record: `PENDING_APPROVAL` → `APPROVED` for a specific plan id and version. If the plan version changes, prior approval does not apply.

## Idempotency

PostgreSQL table `ledgerguard_execution_keys` enforces uniqueness on the execution key (default `remediation:<planId>:<version>`).

- `reserved` — in-flight (`ConcurrentExecutionError`)
- `completed` — verified COMMIT; a later request with the same key returns `ALREADY_EXECUTED` before any transaction or drift check
- `failed_retryable` — rolled back; a new attempt may reserve again, but a terminal plan state still requires a new plan

`DRIFT_DETECTED` means live data no longer matches the approved correction snapshot. It is not used for completed-key replay.

Completed is recorded after verification PASS and COMMIT. A crash between COMMIT and `completed` can leave `reserved`; a concurrent request sees `in_flight`. That window is documented; both rows live in the same PostgreSQL database as the ERP tables.

## DataHub

Catalog write-back is not an authority input. DataHub unavailability does not change policy, approval, or execution.
