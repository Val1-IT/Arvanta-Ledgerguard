# Duplicate inventory movement example

This example proves LedgerGuard can handle a second incident type without DataHub and without a parallel execution stack.

In containers and CI images, `corepack enable` may fail until `COREPACK_HOME` is a writable path (for example `export COREPACK_HOME=/tmp/corepack`). The repo pins pnpm **9.15.9**; pnpm 10 is untested.

## Before

| Record | Quantity |
| --- | --- |
| Receipt RCP-001 | 10 |
| MOV-001 | +10 |
| MOV-002 | +10 (duplicate event `receipt:RCP-001:ITEM-001`) |
| Inventory | 20 units / 1,700,000 |

## Investigation

Deterministic detector: same receipt, same item, same event identity, same inbound quantity, two active movements. Earliest movement is legitimate; later one is the duplicate.

## Repair

`REVERSE_INVENTORY_MOVEMENT` on MOV-002 only, then valuation 20 → 10 and 1,700,000 → 850,000.

## After

Inventory 10. MOV-001 untouched.

## Safety lifecycle

evidence → policy (`REQUIRE_APPROVAL` above threshold) → trusted authority → approval of exact plan version → idempotency → transaction → verify → commit. A second run is `DRIFT_DETECTED` / no further reversal.

In-memory harness (no Docker):

```
pnpm demo
# or, after a full install:
pnpm scenario:duplicate-inventory:memory
```

Pass `--quiet` (or `LEDGERGUARD_DEMO_QUIET=1`) to skip the JSON dumps and keep the DEMO PASS summary.

PostgreSQL (Docker or an already-running demo database):

```
pnpm demo:pg
```

## Where your agent plugs in

The agent never sends SQL and never self-approves. It produces a snapshot; LedgerGuard decides:

```ts
import { investigate, executeConstrainedRemediation } from '@ledgerguard/core';
import { Capability, evaluateExecutionPolicy, trustedRuntimeAuthority } from '@ledgerguard/policy';

const report = investigate(snapshot); // typed proposal; the agent does not write
const authority = trustedRuntimeAuthority({
  actorId: 'controller',
  actorType: 'human',
  capabilities: [Capability.remediationExecute, Capability.remediationApprove]
});
const policyInput = {
  evidenceCount: report.evidence.length,
  verificationExpectationCount: report.verificationExpectations.length,
  impactAmount: Number(report.financialImpact.primaryExposure),
  authority,
  expectedVersion: 1,
  config: { financialApprovalThreshold: 1000, currency: 'IDR' },
  idempotencyCompleted: false
};
evaluateExecutionPolicy({ ...policyInput, plan: { state: 'DRAFT', version: 1, approvalAction: null, approvedBy: null } });
// REQUIRE_APPROVAL until a human approves this exact plan version
const allowed = evaluateExecutionPolicy({
  ...policyInput,
  expectedVersion: 2,
  plan: { state: 'APPROVED', version: 2, approvalAction: 'APPROVE', approvedBy: 'controller' }
});
if (allowed.outcome === 'ALLOW') {
  await executeConstrainedRemediation(adapter, { approvedCorrections: report.proposedCorrections });
}
```

To point this at your own Postgres table instead of the demo inventory, see [docs/try-on-your-own-table.md](../../docs/try-on-your-own-table.md).
