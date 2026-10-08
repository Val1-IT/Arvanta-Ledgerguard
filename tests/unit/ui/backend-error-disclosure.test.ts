import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadOverviewViewModel } from '../../../src/ui/server/overview';
import { probeDatahubStatus } from '../../../src/ui/server/datahub-status';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../../src/agent/server-pool', () => ({ getServerPool: () => ({ query: mocks.query }) }));
import IncidentsPage from '../../../app/incidents/page';

const marker = 'synthetic-backend-secret';
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('read-only UI error disclosure', () => {
  it('returns useful backend-unavailable status without exposing database diagnostics', async () => {
    vi.stubEnv('DATAHUB_GMS_URL', '');
    const pool = { query: async () => { throw new Error(`private upstream response ${marker}`); } } as unknown as Pool;
    const vm = await loadOverviewViewModel(pool);
    expect(vm.backendAvailable).toBe(false);
    expect(vm.lastVerificationFailingChecks).toEqual(['BACKEND_UNAVAILABLE']);
    expect(vm.backendError).toMatch(/backend unavailable/i);
    expect(JSON.stringify(vm)).not.toContain(marker);
  });

  it('renders an unavailable incident list without exposing database diagnostics', async () => {
    vi.stubGlobal('React', React);
    mocks.query.mockRejectedValue(new Error(`private upstream response ${marker}`));
    const html = renderToStaticMarkup(await IncidentsPage());
    expect(html).toContain('Incidents unavailable');
    expect(html).not.toContain(marker);
  });

  it.each(['success', 'http-error', 'exception'] as const)('does not expose configured URLs or raw diagnostics from a DataHub %s', async (result) => {
    vi.stubEnv('DATAHUB_GMS_URL', `https://user:${marker}@example.invalid`);
    vi.stubGlobal('fetch', async () => {
      if (result === 'exception') throw new Error(`private upstream response ${marker}`);
      return new Response('', { status: result === 'success' ? 200 : 503 });
    });
    const status = await probeDatahubStatus();
    expect(status.status).toBe(result === 'success' ? 'CONNECTED' : 'UNAVAILABLE');
    expect(JSON.stringify(status)).not.toContain(marker);
    expect(status.detail).not.toContain('example.invalid');
    if (result === 'http-error') expect(status.detail).toContain('503');
  });
});
