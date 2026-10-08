# Security validation evidence and remaining work

## Dependency audit, 2026-10-08

`pnpm audit --prod --json` reports **zero known advisory matches** after the
runtime dependency updates. The previous lockfile reported 15 (2 critical,
9 high, 4 moderate). Patched versions include Next 15.5.27, Drizzle ORM 0.45.3,
PostCSS 8.5.23, and sharp 0.35.5. Narrow overrides are committed where an upstream
package pins an affected transitive dependency.

The full `pnpm audit --json` is **not clean**: 3 development-tree advisories
remain, down from 40, with no critical entries:

- High: braces 3.0.3, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
  No published patched version was available during this pass. It is reached
  through the Tailwind/globbing tooling tree; a build-system migration or audited
  upstream fix is needed. Avoid attacker-controlled build inputs/glob patterns.
- Moderate: esbuild 0.18.20,
  [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99),
  retained by Drizzle kit's legacy loader. Do not expose development servers to
  untrusted networks.
- Moderate: postcss-selector-parser 6.1.4,
  [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf),
  retained by Tailwind 3. A compatible upstream tooling upgrade needs separate
  testing.

The production audit's scope does not include those development dependencies.
Neither a clean advisory scan nor unit tests establish absence of vulnerabilities.
The CI runtime audit fails on high/critical runtime advisories; it does not hide
or waive the full-tree findings above.

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
