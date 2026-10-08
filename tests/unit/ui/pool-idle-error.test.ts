import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
vi.mock('pg', () => ({ Pool: class extends EventEmitter {} }));
import { makePool } from '../../../src/db/client';

describe('database pool outage behavior', () => {
  it('handles an idle connection error without crashing or logging its raw diagnostic', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const pool = makePool('postgres://synthetic@localhost/synthetic');
      expect(() => pool.emit('error', new Error('synthetic-private-diagnostic'))).not.toThrow();
      expect(log).toHaveBeenCalledWith('A background database connection failed; the pool will reconnect on demand.');
    } finally { log.mockRestore(); }
  });
});
