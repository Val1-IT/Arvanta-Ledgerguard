import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalRequiredError, PolicyDeniedError } from '@ledgerguard/policy';
import { NoRemediableIncidentError } from '../../../src/remediation/generate-plan';
import { InvalidTransitionError, OptimisticConcurrencyError, RemediationPlanNotFoundError } from '../../../src/remediation/types';

const mocks = vi.hoisted(() => ({ pool: vi.fn(), writeback: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../../src/agent/server-pool', () => ({ getServerPool: mocks.pool }));
vi.mock('../../../src/remediation/writeback', () => ({ writebackRemediationResolution: mocks.writeback }));
import {
  decideRemediationPlanAction, executeRemediationPlanAction, generateRemediationPlanAction,
  submitRemediationPlanAction, writebackRemediationResolutionAction
} from '../../../app/incidents/[id]/remediation-actions';

const marker = 'synthetic-action-secret';
const actions = [
  ['generate', () => generateRemediationPlanAction({ investigationId: 'run' })],
  ['submit', () => submitRemediationPlanAction({ investigationId: 'run', planId: 'plan', expectedVersion: 1 })],
  ['decide', () => decideRemediationPlanAction({ investigationId: 'run', planId: 'plan', expectedVersion: 1, action: 'APPROVE' })],
  ['execute', () => executeRemediationPlanAction({ investigationId: 'run', planId: 'plan', expectedVersion: 1 })],
  ['writeback', () => writebackRemediationResolutionAction({ investigationId: 'run', planId: 'plan' })]
] as const;

beforeEach(() => vi.stubEnv('DEMO_MODE', 'true'));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe('remediation server action errors', () => {
  it.each(actions)('%s never returns arbitrary backend diagnostic prose', async (_label, action) => {
    for (const error of [new Error(marker), marker, { message: marker }]) {
      mocks.pool.mockImplementation(() => { throw error; });
      const result = await action();
      expect(result).toMatchObject({ ok: false, code: 'UNKNOWN' });
      expect(JSON.stringify(result)).not.toContain(marker);
      expect(result.ok ? '' : result.error).toMatch(/check|refresh/i);
    }
  });

  it.each([
    [new NoRemediableIncidentError(marker), 'NO_REMEDIABLE_INCIDENT', /no remediable incident/i],
    [new OptimisticConcurrencyError(marker, 1), 'OPTIMISTIC_CONCURRENCY', /refresh/i],
    [new InvalidTransitionError(marker, 'APPROVED', 'DRAFT'), 'INVALID_TRANSITION', /refresh/i],
    [new RemediationPlanNotFoundError(marker), 'NOT_FOUND', /not found/i],
    [new PolicyDeniedError(marker, {}), 'POLICY_DENIED', /policy/i],
    [new ApprovalRequiredError(marker, {}), 'APPROVAL_REQUIRED', /approval/i]
  ])('preserves %s typed code and guidance without arbitrary diagnostic fields', async (error, code, guidance) => {
    mocks.pool.mockImplementation(() => { throw error; });
    const result = await generateRemediationPlanAction({ investigationId: 'run' });
    expect(result).toMatchObject({ ok: false, code });
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(result.ok ? '' : result.error).toMatch(guidance as RegExp);
  });

  it.each(actions)('%s preserves the disabled demo mode explanation', async (_label, action) => {
    vi.stubEnv('DEMO_MODE', 'false');
    const result = await action();
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('DEMO_MODE');
    expect(mocks.pool).not.toHaveBeenCalled();
  });

  it.each(['FAILED', 'NOT_CONFIGURED'] as const)('does not reflect a legacy %s writeback message', async (outcome) => {
    mocks.pool.mockReturnValue({});
    mocks.writeback.mockResolvedValue({ id: 'plan', state: 'RESOLVED', version: 3,
      datahubWriteback: { outcome, message: marker } });
    const result = await writebackRemediationResolutionAction({ investigationId: 'run', planId: 'plan' });
    expect(result).toMatchObject({ ok: false, code: 'WRITEBACK_FAILED' });
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(result.ok ? '' : result.error).toMatch(outcome === 'NOT_CONFIGURED' ? /not configured/i : /retry/i);
  });
});
