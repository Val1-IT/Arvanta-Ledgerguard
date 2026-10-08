# Isolated deployment and application rollback validation

This is a synthetic-only rehearsal for the Next.js standalone demo and its own
PostgreSQL database. It does not deploy a public service, connect to a private ERP,
use model/DataHub credentials, publish images, or establish production readiness.

## Reproduce

Use a local Docker Engine endpoint (absolute Unix socket or local Windows named
pipe), Node.js 24 (or the supported 20.19+/22.12+ versions), and a fresh
checkout with no root `.env` or `.env.*` files other than `.env.example`. The script
checks environment-file names without reading their contents. Host environment
variables such as `DATABASE_URL` are not forwarded to the containers.

The harness inspects the currently selected Docker context before any daemon
operation. SSH/TCP endpoints (including loopback TCP) and nonempty `DOCKER_HOST`
or `DOCKER_CONTEXT` overrides are rejected without printing their values. Use
an already selected local context with those overrides absent; the script does
not select another context or change Docker configuration. A local endpoint
check does not establish that an unrelated daemon is safe to use: run this only
on your intended local disposable-development Docker installation.

From the candidate checkout:

```sh
git worktree add --detach ../ledgerguard-smoke-baseline 047dee30d4cfef40fffe4a936593954686775b10
node scripts/deployment-smoke.mjs --baseline-source ../ledgerguard-smoke-baseline
git worktree remove ../ledgerguard-smoke-baseline
```

The pinned baseline is the previous PR 7 candidate, not a released or deployed
production version. It predates the new investigation-action/readiness safeguards:
rolling back to it would discard those safeguards. It is a technical rehearsal
baseline, **not an approved operational fallback**. Any actual fallback image
needs its own security review and approval. The candidate is the working tree from which the script runs;
for review evidence use a clean checkout and record its full commit SHA. The
GitHub `Isolated deployment smoke` workflow prints both checkout SHAs and both
runtime image IDs. PR workflows may test the GitHub-generated merge commit;
match its recorded SHA to the PR and also check the push run for the branch head.

Docker builds may need registry access. Node and PostgreSQL base tags currently
follow the repository's Dockerfile and PostgreSQL 16 demo choice; dependencies
inside the app are locked, but mutable base tags mean this is a repeatable
procedure, not a promise of bit-for-bit image reproducibility.

## What must pass

1. SQL migration files and the migration journal are byte-identical between the
   previous candidate and current candidate. A different history fails before
   creating any database or running a build.
2. Both Dockerfiles build their `build` tooling stage and `runner` standalone
   stage; each standalone server parses and runs as a non-root user. The candidate
   runner inventory must contain no installed braces, micromatch, fast-glob,
   Tailwind, ESLint-family packages, or non-example `.env*` files. The package
   manifest inventory is printed with versions; this is not a scan of bundled
   source code or a substitute for vulnerability auditing.
3. A unique internal Docker network and new named volume are created. PostgreSQL
   and the app expose no host ports. No existing database or volume is accepted.
4. Before migrations, the candidate `/api/health/ready` endpoint must return
   HTTP 503 with only `{"ready":false}`. The previous tooling image then applies migrations and loads the destructive seed
   only into that new, disposable synthetic database.
5. The previous image serves `/overview` and `/incidents`. The overview must show
   the healthy synthetic values (Rp 72.000.000,00 and 33,33%), passing quality checks,
   and demo mode off. An HTTP 200 with a backend error fallback is a failure.
6. The candidate migration runner is replayed twice without changing a complete
   schema/data dump. The candidate serves the same DB-backed routes with
   `DEMO_MODE=false`, then does so again after a container restart. Its `/agent`
   page must show "Investigations are disabled." and a disabled Run investigation
   submit button. Readiness must return HTTP 200 with only `{"ready":true}`. The older baseline does not claim this new agent-page gate.
7. Stopping the isolated database must turn readiness to HTTP 503. Starting it
   again must restore readiness and the DB-backed routes without replacing or
   restarting the app process; schema/data must remain unchanged.
8. The app container is replaced with the previous image against the same volume.
   The DB-backed routes must still pass, and schema/data must remain identical.
9. The candidate is deployed again after that rollback; readiness, all three
   candidate routes, and identical schema/data must still pass.
10. Only this run's randomly named containers, network, volume, and image tags are
   deleted. A failed cleanup makes the script fail. The ephemeral GitHub runner
   also removes this workflow's labeled resources after interruption.

The script prints `DEPLOYMENT SMOKE PASS` only after the checks and cleanup succeed. It uses
`pg_dump` to compare schema and rows, stripping only the random PostgreSQL dump
restriction markers, including the final marker when captured output has no
trailing newline. All remaining bytes are compared exactly. On a mismatch the
script reports the first differing line/column, bounded synthetic-data excerpts,
and complete dump hashes rather than printing the whole database. It never restores a dump, truncates an existing database,
or runs a down-migration. Seeding is never part of a real upgrade or rollback.

## Reading the result honestly

This proves application-image rollback for **unchanged SQL history and this
synthetic dataset**. It does not prove an older image can read a future schema,
that live workloads are quiesced, that in-flight execution recovery is safe in
all failure modes, or that a backup can be restored. It does not exercise browser
hydration, production identity/session/role enforcement, TLS, reverse proxies,
secret management, durable backups, production monitoring, DataHub, or Odoo.
The SQL/integrity unit and integration suites remain separate required evidence.

When a migration changes, do not edit the baseline simply to make this gate
pass. Review forward/backward compatibility and data-loss risks, name an approved
rollback or roll-forward strategy, and validate backup restoration separately
on disposable data. If a down-migration would discard information, switching the
app image is not enough to make a rollback safe.

The demonstration UI is not a production authentication platform. Any private
staging deployment still needs a named environment owner, approved ingress and
access control, destination-specific credentials, monitoring, and a separate
release/deployment decision. This rehearsal grants no authority to deploy.

## Available evidence

Local environments without a Docker daemon can run the validation guard tests:

```sh
pnpm exec vitest run tests/unit/deployment-smoke.test.ts
node --check scripts/deployment-smoke.mjs
```

These are not container execution evidence. Use a green workflow for the exact
candidate commit before reporting that the image startup/rollback rehearsal
passed. A PostgreSQL-only test on another version is supplementary evidence and
does not replace the PostgreSQL 16 container run.
