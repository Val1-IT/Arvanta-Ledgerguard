import { describe, expect, it } from 'vitest';

const configured = Boolean(process.env.ODOO_BASE_URL && process.env.ODOO_API_KEY);

describe.skipIf(!configured)('Odoo 19 live JSON-2 (opt-in)', () => {
  it('documents that live coverage is gated on ODOO_BASE_URL and ODOO_API_KEY', () => {
    expect(process.env.ODOO_BASE_URL).toMatch(/^https?:\/\//);
  });
});
