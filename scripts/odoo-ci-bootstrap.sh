#!/usr/bin/env bash
set -euo pipefail

# Disposable local compose fixture only. Never point this at an existing server.
compose=(docker compose -f docker-compose.odoo.yml)

"${compose[@]}" up -d odoo-db >&2
ready=0
for i in $(seq 1 30); do
  if "${compose[@]}" exec -T odoo-db pg_isready -U odoo >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [[ "$ready" != 1 ]]; then
  echo 'Odoo test PostgreSQL did not become ready' >&2
  exit 1
fi

# Install the opt-in addon and run its real ORM/ACL/rollback TransactionCase suite
# before exposing JSON-2. The image already includes /mnt/extra-addons by default.
"${compose[@]}" run --rm odoo odoo \
  --db_host=odoo-db --db_user=odoo --db_password=odoo \
  -d odoo -i stock,ledgerguard_inventory --stop-after-init --without-demo=all \
  --test-enable --test-tags /ledgerguard_inventory >&2

"${compose[@]}" up -d odoo >&2
ready=0
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8069/web/login >/dev/null; then
    ready=1
    break
  fi
  sleep 3
done
if [[ "$ready" != 1 ]]; then
  echo 'Odoo test server did not become ready' >&2
  exit 1
fi

# Use a dedicated inventory manager. The atomic endpoint rejects superuser-mode
# calls and never relies on a settings administrator's all-access permissions.
key="$("${compose[@]}" exec -T odoo odoo shell --no-http \
  --db_host=odoo-db --db_user=odoo --db_password=odoo -d odoo <<'PY'
from datetime import datetime, timedelta
from odoo import Command
# Fixture provisioning is privileged; the runtime key remains stock-only.
# Stock managers can adjust quants but cannot create product templates.
product = env['product.product'].search([('default_code', '=', 'LEDGERGUARD-DEMO-001')], limit=1)
if not product:
    product = env['product.product'].create({
        'name': 'LedgerGuard Demo 001',
        'default_code': 'LEDGERGUARD-DEMO-001',
        'is_storable': True,
        'type': 'consu',
    })
bot = env['res.users'].search([('login', '=', 'ledgerguard-ci')], limit=1)
if not bot:
    bot = env['res.users'].with_context(no_reset_password=True).create({
        'name': 'LedgerGuard Disposable CI',
        'login': 'ledgerguard-ci',
        'group_ids': [Command.set([env.ref('stock.group_stock_manager').id])],
        'company_id': env.company.id,
        'company_ids': [Command.set([env.company.id])],
    })
print(env['res.users.apikeys'].with_user(bot)._generate(None, 'ledgerguard-ci', datetime.now() + timedelta(hours=12)))
env.cr.commit()
PY
)"

# A missing key is a bootstrap failure, not a reason to silently skip live tests.
key="$(printf '%s\n' "$key" | tail -n 1)"
if [[ ! "$key" =~ ^[a-fA-F0-9]{40}$ ]]; then
  echo 'Odoo test API key was not generated in the expected format' >&2
  exit 1
fi
printf '%s\n' "$key"
