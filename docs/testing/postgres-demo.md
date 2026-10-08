# PostgreSQL demo: two explicit approvals

`pnpm demo:pg` runs the real SQL transaction and persisted replay flow. It requires Node and pnpm versions listed in the root README, plus an already-running **local PostgreSQL 16** instance. It does not run Docker, start a server, reset a database, or create credentials.

## Set up a new disposable database

Use a local PostgreSQL role you already control, with permission to create and own a database and inspect the PostgreSQL catalogs. Use only a fresh database reserved exclusively for this demo. The database name must start with `ledgerguard_demo_` and contain only lowercase letters, digits, and underscores. Do not point this at an application, production, shared, or previously initialized demo database.

With PostgreSQL's command-line tools installed, replace `YOUR_LOCAL_ROLE` and the port below with your local settings:

```sh
createdb --host=127.0.0.1 --port=5432 --username=YOUR_LOCAL_ROLE --template=template0 ledgerguard_demo_first_run
```

This creates an empty database; do not run `db:migrate`, `db:seed`, or `db:setup` on it. Those are separate developer commands with different, potentially destructive behavior. The demo applies its own fresh-database initialization after you approve it.

In the same terminal, explicitly select the database. This overrides any `DATABASE_URL` in `.env`.

macOS/Linux:

```sh
export DATABASE_URL='postgresql://YOUR_LOCAL_ROLE@127.0.0.1:5432/ledgerguard_demo_first_run'
```

Windows PowerShell:

```powershell
$env:DATABASE_URL = 'postgresql://YOUR_LOCAL_ROLE@127.0.0.1:5432/ledgerguard_demo_first_run'
```

Use your existing local authentication configuration. Never commit credentials or paste an authenticated URL into a bug report. Only `localhost` and `127.0.0.1` are accepted; IPv6 literals are currently unsupported. URL query parameters, fragments, remote hosts, and other database names are refused. An omitted port is explicitly normalized to `5432`, regardless of `PGPORT`. A local URL is not proof of isolation if you configured port forwarding: do not use a tunnel or proxy to a remote database.

## Run the one-command demo

From the repository directory:

```sh
pnpm demo:pg
```

The wrapper installs locked dependencies, then launches the TypeScript runner directly through Node without a shell. The first install requires registry access. The command accepts **no flags**; unknown arguments fail before installation or database access. It never automatically selects a default database.

1. Review the credential-free target and type `yes` to authorize initialization. Anything else, including closed input, exits with no database changes and without opening a database connection.
2. The runner verifies database ownership and catalog emptiness before database writes. Existing tables, views, custom schemas, user functions/types, collations, operators/operator classes and families, conversions, text-search objects, non-default extensions, and the other checked user-object catalogs cause refusal. An inspection error also fails closed.
3. Migrations, the compatible Drizzle journal, synthetic baseline, and duplicate fixture are initialized in one transaction. Insertion does not truncate existing tables. Strict table creation rejects competing writers instead of adopting their tables; competing demo initializers are serialized. Failures before commit roll back that transaction when the connection can confirm rollback. A lost commit acknowledgement or connection can leave the outcome uncertain, so inspect the database before retrying. No automatic retry, reset, or cleanup follows a failure.
4. The demo creates a persisted `PENDING_APPROVAL` plan, then displays its actual ID, version, and corrections. Type `yes` at the separate remediation prompt to approve that version and execute it. A changed version cannot silently inherit this approval.

Successful output includes:

```text
Execute: EXECUTED, verification PASS
Replay: ALREADY_EXECUTED
Quantity: 10.000 | Valuation: 850000.00
```

This is a synthetic CLI harness with a trusted test actor. It is not production identity or approval infrastructure.

## Declining or rerunning

Declining the first prompt makes no database changes. Declining remediation leaves the authorized initialization and pending plan stored; no remediation executes. Both declines exit nonzero.

The demo does not delete the database or stop PostgreSQL afterward. A second invocation against that database is refused, preserving its data and schema. To repeat, explicitly create another empty database with a different `ledgerguard_demo_` name and update `DATABASE_URL`. Review and remove old disposable databases yourself when no longer needed. Do not reset an occupied database to get past the safety check.

If connection or catalog inspection fails, check your local server, authentication, database owner, and permissions. Raw database errors and credentials are deliberately omitted from CLI output. If a connection fails during commit, verify the database state before retrying; do not assume that a lost connection proves nothing committed.

For the full integration suite, use a separate disposable test database. The suite's demo tests additionally create randomly named `ledgerguard_demo_test_*` databases using the test role, and drop only those created databases. The role needs `CREATEDB`; `DEMO_PG_TEST_ADMIN_URL` optionally selects a different local administrative connection for these tests. Other integration suites use their existing reset-oriented fixtures.
