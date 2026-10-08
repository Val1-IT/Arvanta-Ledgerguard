import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config', () => ({
  findRepoRoot: () => { throw new Error('No source checkout in a standalone distribution'); },
  datahubPythonRoot: () => '/not-available',
  isDataHubConfigured: () => false
}));

describe('standalone distributions without optional Python bridge assets', () => {
  it('can import the catalog package without searching for a repository root', async () => {
    const catalog = await import('../src/index');
    expect(catalog.EMPTY_CATALOG_CONTEXT.assetsRead).toEqual([]);
    expect(catalog.isDataHubConfigured()).toBe(false);
  });

  it('reports an optional bridge failure only when the bridge is explicitly used', async () => {
    const catalog = await import('../src/index');
    await expect(catalog.readDataHubContext('fixture'))
      .rejects.toMatchObject({ name: 'DataHubBridgeError', failureState: 'MCP_UNAVAILABLE',
        message: expect.stringContaining('not included in the standalone app image') });
  });
});
