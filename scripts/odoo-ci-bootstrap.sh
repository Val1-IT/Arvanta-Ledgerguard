#!/usr/bin/env bash
set -euo pipefail

compose=(docker compose -f docker-compose.odoo.yml)

"${compose[@]}" up -d odoo-db
for i in $(seq 1 30); do
  if "${compose[@]}" exec -T odoo-db pg_isready -U odoo >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

"${compose[@]}" run --rm odoo odoo \
  --db_host=odoo-db --db_user=odoo --db_password=odoo \
  -d odoo -i stock --stop-after-init --without-demo=all

"${compose[@]}" up -d odoo
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8069/web/login >/dev/null; then
    break
  fi
  sleep 3
done

key="$("${compose[@]}" exec -T odoo odoo shell --no-http \
  --db_host=odoo-db --db_user=odoo --db_password=odoo -d odoo <<'PY'
admin = env.ref('base.user_admin')
print(env['res.users.apikeys'].with_user(admin)._generate(None, 'ledgerguard-ci'))
env.cr.commit()
PY
)"

echo "$key" | tail -n 1
