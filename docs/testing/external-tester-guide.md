# Independent evaluator guide

LedgerGuard is an experimental execution-safety runtime. Start with synthetic
fixtures. Never point the test suite at a production database or ERP.

## 1. Reproduce the offline demo

Use Node.js 20 or later and the pinned pnpm 9.15.9. From a fresh checkout:

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

Use the [evaluation feedback issue](https://github.com/Val1-IT/Arvanta-Ledgerguard/issues/new?template=evaluation.yml).
Include the commit SHA, OS, Node/pnpm versions, adapter/service version, exact
commands, expected/actual output, and a minimal synthetic reproduction.
Remove passwords, API keys, connection strings, customer data, and private URLs.
For a suspected vulnerability, use [SECURITY.md](../../SECURITY.md), not a public
issue containing exploit details or private data.

No independent adoption, production deployment, benchmark, or security audit is
implied by the repository's own tests. Please distinguish what you ran from what
you inspected.
