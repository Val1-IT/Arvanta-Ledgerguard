import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs helper without type declarations
import { COREPACK_HINT, PINNED_PNPM, findNpxCli, isCorepackCacheError, resolvePnpm } from '../../scripts/lib/run-pnpm.mjs';

describe('demo pnpm runner', () => {
  it('detects Corepack cache permission failures only', () => {
    expect(isCorepackCacheError('Failed to create cache directory. Please ensure the user has write access to the target directory (/usr/local/share/corepack/v1).')).toBe(true);
    expect(isCorepackCacheError("Internal Error: EACCES: permission denied, mkdir '/root/.cache/node/corepack'")).toBe(true);
    expect(isCorepackCacheError('ERR_PNPM_OUTDATED_LOCKFILE Cannot install with "frozen-lockfile"')).toBe(false);
    expect(isCorepackCacheError('EACCES: permission denied, open /app/file')).toBe(false);
    expect(isCorepackCacheError('')).toBe(false);
  });

  it('prints the COREPACK_HOME fix and the pinned pnpm', () => {
    expect(COREPACK_HINT).toContain('COREPACK_HOME');
    expect(COREPACK_HINT).toContain(PINNED_PNPM);
    expect(PINNED_PNPM).toBe('pnpm@9.15.9');
  });

  it('runs the launching pnpm entry through Node, never a shell', () => {
    expect(resolvePnpm({ env: { npm_execpath: '/x/pnpm/bin/pnpm.cjs' }, platform: 'win32', execPath: 'C:/node/node.exe', npxCli: null }))
      .toEqual(['C:/node/node.exe', ['/x/pnpm/bin/pnpm.cjs']]);
    expect(resolvePnpm({ env: {}, platform: 'linux', execPath: '/usr/bin/node', npxCli: null })).toEqual(['pnpm', []]);
  });

  it('falls back to npx pnpm@9.15.9 on Windows when not launched by pnpm', () => {
    expect(resolvePnpm({ env: { npm_execpath: 'C:/npm/bin/npm-cli.js' }, platform: 'win32', execPath: 'C:/node/node.exe', npxCli: 'C:/node/npx-cli.js' }))
      .toEqual(['C:/node/node.exe', ['C:/node/npx-cli.js', '--yes', 'pnpm@9.15.9']]);
    expect(resolvePnpm({ env: {}, platform: 'win32', execPath: 'C:/node/node.exe', npxCli: null })).toBeNull();
  });

  it('locates npx-cli.js next to Node for each platform layout', () => {
    const seen: string[] = [];
    const exists = (p: string) => { seen.push(p); return true; };
    expect(findNpxCli(join('/opt', 'node', 'bin', 'node'), 'linux', exists)).toBe(join('/opt', 'node', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'));
    expect(findNpxCli(join('C:', 'node', 'node.exe'), 'win32', exists)).toBe(join('C:', 'node', 'node_modules', 'npm', 'bin', 'npx-cli.js'));
    expect(findNpxCli('/opt/node/bin/node', 'linux', () => false)).toBeNull();
  });
});
