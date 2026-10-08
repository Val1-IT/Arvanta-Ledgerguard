import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveConfig } from './live-bootstrap';

afterEach(() => vi.unstubAllEnvs());
describe('live test isolation guard', () => {
  it('does not enable mutating tests just because adapter credentials exist', () => {
    vi.stubEnv('ODOO_BASE_URL', 'http://127.0.0.1:8069');
    vi.stubEnv('ODOO_API_KEY', 'test-only');
    vi.stubEnv('LEDGERGUARD_ODOO_TEST_INSTANCE', '');
    expect(liveConfig()).toBeNull();
  });
  it('rejects a non-loopback target even with explicit test opt-in', () => {
    vi.stubEnv('ODOO_BASE_URL', 'https://erp.example.com');
    vi.stubEnv('ODOO_API_KEY', 'test-only');
    vi.stubEnv('LEDGERGUARD_ODOO_TEST_INSTANCE', '1');
    expect(() => liveConfig()).toThrow('loopback');
  });
  it('allows the explicitly selected disposable loopback instance', () => {
    vi.stubEnv('ODOO_BASE_URL', 'http://127.0.0.1:8069');
    vi.stubEnv('ODOO_API_KEY', 'test-only');
    vi.stubEnv('LEDGERGUARD_ODOO_TEST_INSTANCE', '1');
    expect(liveConfig()?.baseUrl).toBe('http://127.0.0.1:8069');
  });
});
