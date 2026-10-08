import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FailureStateSchema, type InvestigationRunRecord } from '../../../src/agent/types';

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../../../src/db/repositories/investigation-runs', () => ({ loadInvestigationRun: mocks.load }));
vi.mock('../../../src/agent/server-pool', () => ({ getServerPool: () => ({}) }));
import InvestigationRunPage from '../../../app/agent/investigations/[id]/page';

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('legacy investigation failure display', () => {
  it.each(FailureStateSchema.options)('shows the %s code without rendering stored raw diagnostics', async (failureState) => {
    // Vitest's classic JSX transform needs React for the Next server component.
    vi.stubGlobal('React', React);
    const record: InvestigationRunRecord = {
      investigationId: 'legacy-run', incidentId: 'incident',
      input: { incidentId: 'incident', productId: 'product', triggerAsset: 'asset', requestedBy: 'tester', mode: 'TEST' },
      finalState: failureState, output: null,
      error: { failureState, message: 'upstream private diagnostic synthetic-legacy-secret', occurredAt: '2026-10-08T00:00:00.000Z' },
      stateHistory: [], createdAt: '2026-10-08T00:00:00.000Z'
    };
    mocks.load.mockResolvedValue(record);
    const html = renderToStaticMarkup(await InvestigationRunPage({ params: Promise.resolve({ id: 'legacy-run' }) }));
    expect(html).toContain(failureState);
    expect(html).not.toContain('synthetic-legacy-secret');
    expect(html).not.toContain('upstream private diagnostic');
  });
});
