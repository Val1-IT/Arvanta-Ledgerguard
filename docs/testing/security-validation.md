# Security validation evidence and remaining work

## Dependency audit, 2026-10-08

`pnpm audit --prod --json` reports **zero known advisory matches** after the
runtime dependency updates. The previous lockfile reported 15 (2 critical,
9 high, 4 moderate). Patched versions include Next 15.5.27, Drizzle ORM 0.45.3,
PostCSS 8.5.23, and sharp 0.35.5. Narrow overrides are committed where an upstream
package pins an affected transitive dependency.

The full `pnpm audit --json` is **not clean**: one high development-tree advisory
remains, down from 40. No moderate or critical entries remain in the current
lockfile audit. The latest hardening pass applies scoped esbuild 0.25.12 and
postcss-selector-parser 7.1.6 overrides. Generated CSS and fresh schema SQL were
byte-identical before/after, and the legacy TypeScript loader's synchronous and
asynchronous transforms still work.

- High: braces 3.0.3, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
  There is no published patched release in the checked registry/advisory. Both
  Tailwind's tooling and Next's ESLint glob helper retain this path; upgrading
  only Tailwind does not eliminate it. A maintained upstream fix or a separately
  reviewed tooling replacement is needed. Avoid attacker-controlled build inputs
  and glob patterns. No advisory suppression or vulnerable dynamic install is
  used to make the audit appear clean.

The production audit's scope does not include that development dependency.
Neither a clean advisory scan nor unit tests establish absence of vulnerabilities.
The CI runtime audit fails on high/critical runtime advisories; it does not hide
or waive the full-tree finding above.

## Safety regression coverage

- Remote approval substitution: quantity, record identity, source fingerprint,
  adapter identity, and recovery requests reject before remote calls.
- Cross-plan/version key reuse rejects; stale recovery cannot replace a renewed
  lease.
- Real PostgreSQL round-trip verifies persisted approval, outcome, verification,
  and replay behavior instead of relying on mocks that discard JSON fields.
- Unknown remote outcomes retain reservations; failed post-write verification
  stays recoverable rather than claiming rollback.
- Atomic addon contract tests validate strict request and bound response shapes.
  Server tests cover caller permission/record rules, transactional rollback,
  receipt isolation/replay, pending counts, and unsupported quant scopes.

Actual Odoo server tests and JSON-2 concurrency cases must pass in the dedicated
isolated workflow for the commit under review. Offline mock tests are not a
substitute. No external security audit or production deployment is claimed.

## Deployment boundary and development-tool containment

The remaining braces advisory is reachable through development build/lint glob
processing. Current committed Tailwind patterns are fixed, shallow patterns;
no application HTTP/database input path into those globs was identified in the
scoped review. Untrusted pull requests can change executable build configuration,
so CI uses disposable hosted runners, explicit read-only token permissions,
non-persisted checkout credentials, timeouts and cancellation of superseded runs.
These controls do not remove the advisory or replace source review.

The final standalone image must be checked for absence of braces, micromatch,
fast-glob, Tailwind and ESLint rather than assuming the development tree equals
the runtime. The isolated deployment workflow performs that inventory check on
the exact built image. Do not build from unreviewed inputs on a privileged host
or introduce production credentials into pull-request jobs.
