import type { Client } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { databaseReady, REQUIRED_MIGRATION_TIMES } from '../../../src/db/readiness';

function client() {
  return { connect: vi.fn(async () => {}), query: vi.fn(async () => ({ rows: [{ count: REQUIRED_MIGRATION_TIMES.length }] })), end: vi.fn(async () => {}) };
}
afterEach(() => vi.unstubAllEnvs());
describe('read-only database readiness', () => {
  it('requires committed migrations and the current schema contract', async () => {
    const db = client();
    expect(await databaseReady(db as unknown as Client)).toBe(true);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.end).toHaveBeenCalledOnce();
  });
  it('rejects a database missing migrations without pretending the UI fallback is healthy', async () => {
    const db = client();
    db.query.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    expect(await databaseReady(db as unknown as Client)).toBe(false);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.end).toHaveBeenCalledOnce();
  });
  it('returns unavailable and closes the connection on schema failure without exposing diagnostics', async () => {
    const db = client();
    db.query.mockRejectedValueOnce(new Error('synthetic-private-diagnostic'));
    expect(await databaseReady(db as unknown as Client)).toBe(false);
    expect(db.end).toHaveBeenCalledOnce();
  });
  it('treats malformed connection configuration as unavailable without throwing', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://%ZZ:synthetic@localhost/demo');
    await expect(databaseReady()).resolves.toBe(false);
  });
  it('closes failed connections too', async () => {
    const db = client();
    db.connect.mockRejectedValueOnce(new Error('synthetic-connection-secret'));
    expect(await databaseReady(db as unknown as Client)).toBe(false);
    expect(db.end).toHaveBeenCalledOnce();
  });
});
