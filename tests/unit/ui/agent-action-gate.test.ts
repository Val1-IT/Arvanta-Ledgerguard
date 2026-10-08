import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn(), model: vi.fn(() => ({})), pool: vi.fn(() => ({})), redirect: vi.fn() }));
vi.mock('../../../src/agent/orchestrator', () => ({ runInvestigation: mocks.run }));
vi.mock('../../../src/agent/model-factory', () => ({ createInvestigationModel: mocks.model }));
vi.mock('../../../src/agent/server-pool', () => ({ getServerPool: mocks.pool }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
import { triggerInvestigation } from '../../../app/agent/actions';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('investigation UI deployment gate', () => {
  it.each(['', 'false', 'TRUE', ' true '])('blocks before all side effects when DEMO_MODE=%j', async (mode) => {
    vi.stubEnv('DEMO_MODE', mode);
    await expect(triggerInvestigation(new FormData())).rejects.toThrow('DEMO_MODE');
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.pool).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('runs only after explicit isolated-demo opt-in', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    mocks.run.mockResolvedValueOnce({ investigationId: 'synthetic-investigation' });
    await triggerInvestigation(new FormData());
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).toHaveBeenCalledWith('/agent/investigations/synthetic-investigation');
  });
});
