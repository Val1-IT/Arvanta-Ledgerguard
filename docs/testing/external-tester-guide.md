# Independent evaluator guide

LedgerGuard is an experimental execution-safety runtime. Start with synthetic
fixtures. Never point the test suite at a production database or ERP.

## 1. Reproduce the offline demo

Use Node.js 24 (or supported 20.19+ / 22.12+) and the pinned pnpm 9.15.9. From a fresh checkout:

```sh
pnpm demo
pnpm demo
pnpm verify
pnpm build
```

Both demos must end with `DEMO PASS`. The demo uses simulated human approval;
it is not authentication, persisted idempotency, or a production ERP proof.
The full offline suite skips live Odoo tests. Merely having Odoo credentials
in the environment does not authorize those tests to mutate an ERP.

## 2. Exercise a real isolated PostgreSQL service

Start the repository's disposable PostgreSQL container, then migrate and test:

```sh
pnpm db:up
pnpm db:wait
pnpm db:migrate
pnpm test:integration
```

Set `DATABASE_URL` to the disposable local database from `docker-compose.yml`.
The integration suite resets/seeds synthetic tables. It is destructive to that
database. The `remote-control-plane` test uses real PostgreSQL persistence and
an explicitly simulated remote transport. It covers binding, human-approval
transitions, durable result reload, and duplicate replay. It does not establish
Odoo transaction atomicity.

## 3. Evaluate Odoo separately

Follow [the Odoo guide](../integrations/odoo.md). Real Odoo tests mutate a
fixture product and require `LEDGERGUARD_ODOO_TEST_INSTANCE=1`, a loopback URL,
and credentials for a disposable instance. Never reuse a production API key.
The Odoo adapter remains experimental; read the concurrency limitation before
making any safety assessment.

## What to challenge

- Change the target quantity, quant identity, adapter system ID, or fingerprint
  after approval: execution must reject before calling the ERP.
- Replay a completed request: it must not write again.
- Reuse an idempotency key for a different plan/version: it must reject.
- Interrupt the remote response after a write: uncertainty must stay
  `RECOVERY_REQUIRED`, without automatic mutation retry.
- Reload a resolved plan from PostgreSQL: its execution and verification
  records must remain readable.

## Report evidence

Use the [tester report](https://github.com/Val1-IT/Arvanta-Ledgerguard/issues/new?template=tester_report.yml) after its template reaches the default branch. While evaluating an unmerged draft, open the [current issue picker](https://github.com/Val1-IT/Arvanta-Ledgerguard/issues/new) and include the same checklist below; GitHub does not serve issue forms from an arbitrary PR branch.
Include the commit SHA, OS, Node/pnpm versions, adapter/service version, exact
commands, expected/actual output, and a minimal synthetic reproduction.
Remove passwords, API keys, connection strings, customer data, and private URLs.
For a suspected vulnerability, use [SECURITY.md](../../SECURITY.md), not a public
issue containing exploit details or private data.

No independent adoption, production deployment, benchmark, or security audit is
implied by the repository's own tests. Please distinguish what you ran from what
you inspected.

## Check the branch you are evaluating

Record `git rev-parse HEAD` with every result. The integration hardening branch
combines reviewed runtime work with selected community/docs changes from PR #5;
it is a draft proposal, not a release. Do not assume a green check on an earlier
commit applies to a newer one. Read the exact-head workflow runs linked in the PR.

A remote lease expiring is not evidence that its request stopped. In particular,
a `not_applied` recovery observation now remains `RECOVERY_REQUIRED` and does not
authorize another call. Review the persisted original-version receipt and source
fingerprint; if state is still uncertain, stop and ask the maintainer to reconcile
it before proposing a new action.
