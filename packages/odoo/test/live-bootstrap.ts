/** Test-only JSON-2 helpers. Not part of the public @ledgerguard/odoo API. */

export function liveConfig() {
  const baseUrl = process.env.ODOO_BASE_URL;
  const apiKey = process.env.ODOO_API_KEY;
  if (!baseUrl || !apiKey) {
    return null;
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ''), database: process.env.ODOO_DATABASE, apiKey };
}

export async function json2(config: { baseUrl: string; database?: string; apiKey: string }, model: string, method: string, body: Record<string, unknown>) {
  const headers: Record<string, string> = {
    Authorization: `bearer ${config.apiKey}`,
    'Content-Type': 'application/json; charset=utf-8',
    'User-Agent': 'ledgerguard-odoo-live-test'
  };
  if (config.database) headers['X-Odoo-Database'] = config.database;
  const response = await fetch(`${config.baseUrl}/json/2/${model}/${method}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const parsed = await response.json();
  if (!response.ok) {
    throw new Error(typeof parsed?.message === 'string' ? parsed.message : `JSON-2 ${model}.${method} ${response.status}`);
  }
  return parsed;
}

export async function seedDemoQuant(config: { baseUrl: string; database?: string; apiKey: string }, quantity: number) {
  const products = await json2(config, 'product.product', 'search_read', {
    domain: [['default_code', '=', 'LEDGERGUARD-DEMO-001']],
    fields: ['id']
  });
  let productId = Array.isArray(products) && products[0]?.id;
  if (!productId) {
    const templates = await json2(config, 'product.template', 'create', {
      vals_list: [
        {
          name: 'LedgerGuard Demo 001',
          default_code: 'LEDGERGUARD-DEMO-001',
          is_storable: true,
          type: 'consu'
        }
      ]
    });
    const created = Array.isArray(templates) ? templates[0] : templates;
    const variants = await json2(config, 'product.product', 'search_read', {
      domain: [['product_tmpl_id', '=', created]],
      fields: ['id']
    });
    productId = variants[0].id;
  }
  const locations = await json2(config, 'stock.location', 'search_read', {
    domain: [['usage', '=', 'internal']],
    fields: ['id', 'company_id'],
    limit: 1
  });
  const locationId = locations[0].id;
  const companyId = Array.isArray(locations[0].company_id) ? locations[0].company_id[0] : locations[0].company_id;
  const quants = await json2(config, 'stock.quant', 'search_read', {
    domain: [
      ['product_id', '=', productId],
      ['location_id', '=', locationId]
    ],
    fields: ['id', 'quantity', 'write_date', 'company_id']
  });
  let quant = quants[0];
  if (!quant) {
    await json2(config, 'stock.quant', 'create', {
      vals_list: [{ product_id: productId, location_id: locationId, inventory_quantity: quantity }],
      context: { inventory_mode: true }
    });
    const created = await json2(config, 'stock.quant', 'search_read', {
      domain: [
        ['product_id', '=', productId],
        ['location_id', '=', locationId]
      ],
      fields: ['id', 'quantity', 'write_date', 'company_id']
    });
    quant = created[0];
    await json2(config, 'stock.quant', 'action_apply_inventory', {
      ids: [quant.id],
      context: { inventory_mode: true }
    });
    const applied = await json2(config, 'stock.quant', 'search_read', {
      domain: [['id', '=', quant.id]],
      fields: ['id', 'quantity', 'write_date', 'company_id']
    });
    quant = applied[0];
  } else if (Number(quant.quantity) !== quantity) {
    await json2(config, 'stock.quant', 'write', {
      ids: [quant.id],
      vals: { inventory_quantity: quantity },
      context: { inventory_mode: true }
    });
    await json2(config, 'stock.quant', 'action_apply_inventory', {
      ids: [quant.id],
      context: { inventory_mode: true }
    });
    const applied = await json2(config, 'stock.quant', 'search_read', {
      domain: [['id', '=', quant.id]],
      fields: ['id', 'quantity', 'write_date', 'company_id']
    });
    quant = applied[0];
  }
  return {
    productId: Number(productId),
    locationId: Number(locationId),
    companyId: companyId == null || companyId === false ? null : Number(companyId),
    quantId: Number(quant.id),
    quantity: Number(quant.quantity),
    writeDate: String(quant.write_date)
  };
}
