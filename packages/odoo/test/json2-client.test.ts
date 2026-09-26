import { describe, expect, it } from 'vitest';
import { assertAllowlistedCall } from '../src/allowlist';
import { createJson2Transport } from '../src/json2-client';

describe('JSON-2 client internals', () => {
  it('rejects arbitrary model/method pairs before fetch', async () => {
    expect(() => assertAllowlistedCall('account.move', 'post')).toThrow('rejected model');
    const transport = createJson2Transport({ baseUrl: 'http://127.0.0.1:8069', apiKey: 'secret-key' });
    await expect(transport('stock.quant', 'create', { vals: {} })).rejects.toThrow('rejected method');
  });

  it('does not put the API key into thrown Error.message', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'Invalid apikey' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })) as typeof fetch;
    try {
      const transport = createJson2Transport({ baseUrl: 'http://127.0.0.1:8069', apiKey: 'super-secret-key' });
      try {
        await transport('stock.quant', 'search_read', { domain: [['id', '=', 1]], fields: ['id'] });
      } catch (error) {
        expect(String(error)).not.toContain('super-secret-key');
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
