import { describe, expect, it } from 'vitest';

// Baseline smoke test proving the test runner is wired up. Real engine unit
// tests arrive in FASE 4.
describe('smoke', () => {
  it('runs the test runner', () => {
    expect(1 + 1).toBe(2);
  });
});
