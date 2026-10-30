# @ledgerguard/odoo

**Experimental** Odoo 19 JSON-2 adapter supporting exactly one constrained action: a `stock.quant` inventory adjustment. Not a general ERP integration and not production-ready. See [docs/integrations/odoo.md](../../docs/integrations/odoo.md).

**Dependencies:** Depends only on `@ledgerguard/core`; must not depend on postgres, DataHub, Next, or LLM SDKs, and must not widen its action allowlist without tests (see Invariants in [CONTRIBUTING.md](../../CONTRIBUTING.md)).

**Tests** (from the repo root):

```bash
pnpm --filter @ledgerguard/odoo test   # unit tests against a fake Odoo; live suites are opt-in
```
