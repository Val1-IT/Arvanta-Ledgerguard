import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ simulate: vi.fn(), seed: vi.fn(), blocking: vi.fn() }));
vi.mock('../../../src/agent/server-pool', () => ({ getServerPool: () => ({}) }));
vi.mock('../../../demo-data/scenarios/conversion-error', () => ({ applyConversionError: mocks.simulate }));
vi.mock('../../../src/db/seed', () => ({ seedDatabase: mocks.seed }));
vi.mock('../../../src/ui/server/queries', () => ({ hasBlockingRemediationPlan: mocks.blocking }));
import { resetDemoAction, simulateConversionErrorAction } from '../../../app/overview/actions';

const actions = [
  { name: 'simulate', action: simulateConversionErrorAction },
  { name: 'reset', action: resetDemoAction }
];

afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe('demo server-action diagnostic boundary', () => {
  it.each(actions)('does not return arbitrary backend errors from $name', async ({ action }) => {
    vi.stubEnv('DEMO_MODE', 'true');
    const failure = new Error('upstream private response synthetic-demo-secret');
    mocks.simulate.mockRejectedValue(failure);
    mocks.seed.mockRejectedValue(failure);
    mocks.blocking.mockResolvedValue(false);
    const result = await action();
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('synthetic-demo-secret');
  });

  it.each(actions)('preserves clear disabled-demo guidance from $name', async ({ action }) => {
    vi.stubEnv('DEMO_MODE', 'false');
    const result = await action();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('DEMO_MODE');
    expect(mocks.simulate).not.toHaveBeenCalled();
    expect(mocks.seed).not.toHaveBeenCalled();
  });

  it('preserves successful reset and the in-flight remediation guard', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    mocks.blocking.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.seed.mockResolvedValue(undefined);
    const blocked = await resetDemoAction();
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toContain('EXECUTING or VERIFYING');
    expect(await resetDemoAction()).toEqual({ ok: true });
  });
});
