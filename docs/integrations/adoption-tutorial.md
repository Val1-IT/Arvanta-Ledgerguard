# Integrate LedgerGuard into an existing service

This tutorial uses the repository workspace. The packages currently export
TypeScript source; do not assume a prebuilt npm distribution or a production
identity provider. Use Node 24 and pnpm 9.15.9 for the repository tools. The core
runtime has no dependency on a model provider, Next.js, PostgreSQL, or DataHub.

## 1. Run the reference behavior before adapting it

```sh
pnpm install --frozen-lockfile
pnpm scenario:duplicate-inventory:memory
pnpm verify
```

Read `examples/inventory-ledger/src/demo.ts`. It shows deterministic
`investigate(input)`, the evidence/corrections it produces, a policy decision
before approval, and execution against `MemoryAdapter`. The approval identity in
that demo is simulated. Do not copy its hardcoded authority into a web endpoint.

For a real database reference, use a disposable PostgreSQL instance configured
with the repository's Compose defaults:

```sh
pnpm db:up
pnpm db:wait
pnpm db:migrate
pnpm test:integration
```

`tests/integration/execution-integrity.test.ts` is an executable reference for
proposal, human approval, same-transaction mutation/verification/bookkeeping,
rollback, and replay. These fixtures seed/reset tables; never use a production
`DATABASE_URL`.

## 2. Put a trusted server between model output and execution

Your application owns authentication and capability issuance. A human approver
must be authenticated by that application, and the server derives
`AuthorityContext` from the authenticated session. Never deserialize authority,
capabilities, approval state, or connection configuration from model output or a
browser form. The model can supply investigation context or a proposal; trusted
code must select the supported action and deterministic evidence.

Choose the correct boundary:

- `SystemOfRecordAdapter.runInTransaction(work)` and
  `executeConstrainedRemediation` are the provider-neutral transaction API.
- `PostgresSystemOfRecordAdapter` supplies allowlisted SQL corrections and native
  mutation/verification transaction semantics.
- `ConstrainedActionAdapter` supplies remote action validation, fingerprint,
  execute, verify, and recovery classification. It is a low-level mechanism, not
  an approval gate by itself. Use the persisted control-plane executor for
  approved remote work.

Keep write credentials only in the trusted adapter process. Configure a unique
stable system ID for each database/ERP; do not let the model choose that ID or
its URL. Prefer the minimum dedicated service-account permissions needed for
the selected constrained operation.

## 3. Bind remote intent before asking for approval

In your server's existing DRAFT-creation flow, capture and persist:

```ts
import { prepareRemoteActionBinding } from './src/remediation/remote-action-binding';
import { createRemediationPlan as persistPlan } from './src/db/repositories/remediation-plans';

const binding = await prepareRemoteActionBinding(adapter, action);
await persistPlan(pool, { ...draftPlan, remoteActionBinding: binding });
```

`draftPlan` is your server-created `RemediationPlanRecord` in DRAFT state. Show
its evidence and the full bound action (including product/location/company,
source/target quantities and fingerprint) to the authenticated human. Then use
`submitRemediationPlanForApproval` and `decideRemediationPlan` from
`src/remediation/approve.ts`, with the trusted approver authority. Changing any
intent requires a new draft and approval. Never add a binding retroactively to
an already-approved legacy plan.

After approval, your trusted execution handler calls:

```ts
import { executeRemoteConstrainedAction } from './src/remediation/execute-remote-action';

const result = await executeRemoteConstrainedAction({
  planId: approvedPlan.id,
  expectedVersion: approvedPlan.version,
  action: JSON.parse(approvedPlan.remoteActionBinding!.actionJson),
  expectedFingerprint: approvedPlan.remoteActionBinding!.expectedFingerprint
}, { pool, adapter, authority: serverIssuedExecutorAuthority });
```

The snippets belong inside your server's existing authenticated workflow; the
named pool, draft, adapter and identities must be supplied by your application.
They are not a standalone public mutation endpoint. A complete executable
persistence example is `tests/integration/remote-control-plane.test.ts`; its
remote transport and human identity are explicitly test fixtures.

## 4. Handle outcomes without turning uncertainty into a retry

| Signal | Application behavior |
| --- | --- |
| `ApprovalRequiredError` | Show the pending/mismatched intent; obtain a new valid approval. |
| `PolicyDeniedError` | Stop. Do not manufacture capabilities or lower thresholds. |
| `ConcurrentExecutionError` | An execution/recovery owns the reservation; inspect status. |
| `ExecutionKeyConflictError` | Key belongs to another plan/version; correct request identity. |
| `EXECUTED` | Persisted success and verification; expose the receipt to the operator. |
| `ALREADY_EXECUTED` | Replay/reconciliation result; do not issue another mutation. |
| `FAILED` with drift | Re-investigate and create a new plan; the old approval is stale. |
| `RECOVERY_REQUIRED` | Inspect/reconcile remote state. Never automatically replay a write. |

A custom idempotency key is permanently scoped to one plan and execution version.
For replay/recovery retain the original version. For an authorized INTERRUPTED
resume at a newer version, use a new key or the default version-scoped key.
Do not infer rollback from a remote verification failure.

## 5. Evaluate Odoo's opt-in atomic path

Follow [Odoo setup and limitations](odoo.md). The atomic addon deliberately
supports fewer operations than Odoo itself. It binds a durable receipt to the
complete action and authenticated Odoo user, and requires a non-superuser
inventory manager. It does not create a distributed transaction with your
control-plane database or lock aggregate inventory across all quants.

Before inviting outside evaluation, run the
[external tester checklist](../testing/external-tester-guide.md), retain the exact
commit and command output, and review
[security validation limitations](../testing/security-validation.md). Do not use
passing mocks or a local demo as evidence of production readiness.
