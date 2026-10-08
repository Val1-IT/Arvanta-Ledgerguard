import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJson2Transport } from '../src/json2-client';

const config = { baseUrl: 'http://127.0.0.1:8069/', apiKey: 'test-only', database: 'odoo' };
afterEach(() => vi.unstubAllGlobals());

describe('atomic JSON-2 transport routing', () => {
  it('routes only the opted-in fixed inventory endpoint', async () => {
    const fetch = vi.fn(async () => new Response('{"status":"stale"}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const transport = createJson2Transport(config, 'atomic-addon');
    await transport('stock.quant', 'ledgerguard_apply_inventory', { request: { quant_id: 17 } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8069/json/2/stock.quant/ledgerguard_apply_inventory', {
      method: 'POST',
      headers: {
        Authorization: 'bearer test-only', 'Content-Type': 'application/json; charset=utf-8',
        'User-Agent': 'ledgerguard-odoo/0.3.0', 'X-Odoo-Database': 'odoo'
      },
      body: '{"request":{"quant_id":17}}'
    });
  });

  it.each([
    ['stock.quant', 'write'], ['stock.quant', 'action_apply_inventory'],
    ['stock.quant', 'unlink'], ['res.users', 'ledgerguard_apply_inventory']
  ])('rejects %s.%s before fetch in atomic mode', async (model, method) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(createJson2Transport(config, 'atomic-addon')(model, method, {})).rejects.toThrow('rejected');
    expect(fetch).not.toHaveBeenCalled();
  });
});
