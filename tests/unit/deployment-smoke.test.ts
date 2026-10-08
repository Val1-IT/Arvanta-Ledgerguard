import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertMatchingMigrations,
  assertDatabaseUnchanged,
  assertLocalDockerEnvironment,
  assertLocalDockerEndpoint,
  assertSmokePage,
  assertRuntimeInventory,
  assertReadiness,
  normalizeDatabaseDump,
  rejectEnvironmentFiles
} from '../../scripts/deployment-smoke-checks.mjs';

import { cleanupDockerResources } from '../../scripts/deployment-smoke-cleanup.mjs';

const directories: string[] = [];
function fixture(sql = 'CREATE TABLE example(id text);', journal = '{"entries":[]}') {
  const root = mkdtempSync(join(tmpdir(), 'ledgerguard-smoke-test-'));
  directories.push(root);
  mkdirSync(join(root, 'drizzle', 'meta'), { recursive: true });
  writeFileSync(join(root, 'drizzle', '0000_example.sql'), sql);
  writeFileSync(join(root, 'drizzle', 'meta', '_journal.json'), journal);
  return root;
}
afterEach(() => directories.splice(0).forEach((root) => rmSync(root, { recursive: true })));

describe('isolated deployment validation guards', () => {
  it('accepts only local Docker socket/pipe endpoints', () => {
    for (const endpoint of ['unix:///var/run/docker.sock', 'unix:///run/user/1000/docker.sock', 'npipe:////./pipe/docker_engine']) {
      expect(() => assertLocalDockerEndpoint(endpoint)).not.toThrow();
    }
    for (const endpoint of [undefined, '', 'tcp://127.0.0.1:2375', 'tcp://remote:2376',
      'ssh://user:synthetic-private-value@host', 'http://localhost:2375',
      'unix://remote/path/docker.sock', 'npipe:////remote/pipe/docker_engine']) {
      expect(() => assertLocalDockerEndpoint(endpoint)).toThrowError(/^Selected Docker endpoint must be a local Unix socket or local Windows named pipe\.$/);
    }
  });

  it('rejects Docker endpoint/context overrides without disclosing their values', () => {
    expect(() => assertLocalDockerEnvironment({})).not.toThrow();
    expect(() => assertLocalDockerEnvironment({ DOCKER_HOST: '', DOCKER_CONTEXT: '' })).not.toThrow();
    for (const environment of [{ DOCKER_HOST: 'ssh://synthetic-private-value@host' },
      { DOCKER_HOST: 'unix:///var/run/docker.sock' }, { DOCKER_CONTEXT: 'synthetic-private-value' }]) {
      expect(() => assertLocalDockerEnvironment(environment)).toThrowError(/^Run this validation without DOCKER_HOST or DOCKER_CONTEXT overrides; the script will not switch Docker contexts\.$/);
    }
  });

  it('allows only an unchanged SQL migration history for image rollback', () => {
    const candidate = fixture();
    expect(() => assertMatchingMigrations(candidate, fixture())).not.toThrow();
    expect(() => assertMatchingMigrations(candidate, fixture('DROP TABLE example;')))
      .toThrow(/migration history differs/i);
    expect(() => assertMatchingMigrations(candidate, fixture(undefined, '{"entries":[{}]}')))
      .toThrow(/migration history differs/i);
    const extra = fixture();
    writeFileSync(join(extra, 'drizzle', '0001_new.sql'), 'ALTER TABLE example ADD COLUMN value text;');
    expect(() => assertMatchingMigrations(candidate, extra)).toThrow(/migration history differs/i);
  });

  it('refuses to build a checkout containing root environment files', () => {
    const root = fixture();
    writeFileSync(join(root, '.env.example'), 'SYNTHETIC=value');
    expect(() => rejectEnvironmentFiles(root)).not.toThrow();
    writeFileSync(join(root, '.env.production'), 'DO_NOT_READ=private');
    expect(() => rejectEnvironmentFiles(root)).toThrow(/environment files/i);
  });

  it('requires seeded DB evidence instead of trusting a successful HTTP response', () => {
    const body = 'Overview Healthy Rp 72.000.000,00 33,33% All quality checks currently pass. Demo mode off Simulate requires demo mode to be enabled. Reset requires demo mode to be enabled.';
    expect(() => assertSmokePage('/overview', 200, body)).not.toThrow();
    expect(() => assertSmokePage('/overview', 200, `${body} Backend unavailable`)).toThrow();
    expect(() => assertSmokePage('/overview', 200, 'Overview Healthy')).toThrow();
    expect(() => assertSmokePage('/overview', 401, body)).toThrow(/HTTP 401/);
  });

  it('checks the empty persisted incident route and rejects its error fallback', () => {
    expect(() => assertSmokePage('/incidents', 200, 'Incidents No incidents yet')).not.toThrow();
    expect(() => assertSmokePage('/incidents', 200, 'Incidents unavailable')).toThrow();
    expect(() => assertSmokePage('/unexpected', 200, 'anything')).toThrow(/unsupported/i);
  });

  it('requires a disabled investigation submit button on the candidate agent page', () => {
    const body = 'Investigation Agent Investigations are disabled. <button type="submit" disabled="">Run investigation</button>';
    expect(() => assertSmokePage('/agent', 200, body)).not.toThrow();
    expect(() => assertSmokePage('/agent', 200, body.replace('disabled=""', ''))).toThrow();
    expect(() => assertSmokePage('/agent', 200, body.replace('Investigations are disabled.', ''))).toThrow();
  });

  it('rejects tooling packages or environment files in the standalone inventory', () => {
    expect(() => assertRuntimeInventory({ packages: [{ name: 'next', version: '15.5.27' }], environmentFiles: [] })).not.toThrow();
    for (const name of ['braces', 'micromatch', 'fast-glob', 'tailwindcss', 'eslint', '@eslint/js', 'eslint-config-next']) {
      expect(() => assertRuntimeInventory({ packages: [{ name, version: '1.0.0' }], environmentFiles: [] })).toThrow(/tooling package/i);
    }
    expect(() => assertRuntimeInventory({ packages: [], environmentFiles: ['/app/.env.production'] })).toThrow(/environment file/i);
    expect(() => assertRuntimeInventory({ packages: [], environmentFiles: [] })).toThrow(/Next.js package/i);
  });

  it('distinguishes ready and unmigrated responses without accepting error details', () => {
    expect(() => assertReadiness(200, { ready: true }, true)).not.toThrow();
    expect(() => assertReadiness(503, { ready: false }, false)).not.toThrow();
    expect(() => assertReadiness(200, { ready: false }, false)).toThrow();
    expect(() => assertReadiness(503, { ready: false, error: 'private' }, false)).toThrow();
    expect(() => assertReadiness(200, { ready: true }, false)).toThrow();
  });

  it('scans actual runner files for package names and environment files', () => {
    const root = fixture();
    mkdirSync(join(root, 'node_modules', 'example'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'example', 'package.json'), JSON.stringify({ name: 'braces', version: '3.0.3' }));
    writeFileSync(join(root, '.env.local'), 'SYNTHETIC_ONLY=value');
    const script = fileURLToPath(new URL('../../scripts/deployment-image-inventory.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    const inventory = JSON.parse(result.stdout);
    expect(inventory.packages).toEqual([{ name: 'braces', version: '3.0.3' }]);
    expect(inventory.environmentFiles).toEqual([realpathSync(join(root, '.env.local'))]);
  });

  it('fails cleanup closed on Docker list/removal failures', () => {
    const resources = [['container', 'owned-app'], ['volume', 'owned-db']];
    expect(cleanupDockerResources(resources, () => ({ status: 1, stdout: '' }))).toHaveLength(2);
    expect(cleanupDockerResources(resources, () => ({ status: 0, stdout: '' }))).toEqual([]);
    const calls: string[][] = [];
    const errors = cleanupDockerResources(resources, (args: string[]) => {
      calls.push(args);
      return args.includes('ls') ? { status: 0, stdout: 'owned-resource' } : { status: 1, stdout: '' };
    });
    expect(errors).toHaveLength(2);
    expect(calls).toContainEqual(['container', 'rm', '--force', 'owned-app']);
    expect(calls).toContainEqual(['volume', 'rm', 'owned-db']);
    expect(calls.some((args) => args.includes('prune'))).toBe(false);
  });

  it('removes pg_dump restriction markers after command capture trims the final newline', () => {
    for (const newline of ['\n', '\r\n']) {
      const before = ['-- dump', '\\restrict tokenBefore', 'CREATE TABLE x(id integer);',
        'INSERT INTO x VALUES (1);', '\\unrestrict tokenBefore', ''].join(newline);
      const after = before.replaceAll('tokenBefore', 'tokenAfter');
      expect(normalizeDatabaseDump(before.trim())).toBe(normalizeDatabaseDump(after.trim()));
      expect(normalizeDatabaseDump(before)).toBe(normalizeDatabaseDump(after));
      expect(normalizeDatabaseDump(before.trim())).not.toContain('tokenBefore');
      expect(normalizeDatabaseDump(before.trim())).not.toBe(normalizeDatabaseDump(after.replace('(1)', '(2)').trim()));
      expect(normalizeDatabaseDump(before.trim())).not.toBe(normalizeDatabaseDump(after.replace('id integer', 'id text').trim()));
    }
  });

  it('reports the first actual schema/data difference without logging whole dumps', () => {
    const prefix = Array.from({ length: 600 }, (_, i) => `-- unchanged line ${i}`).join('\n');
    const expected = `${prefix}\nINSERT INTO x VALUES ('${'a'.repeat(800)}', 1);\n-- end`;
    const actual = expected.replace("', 1)", "', 2)");
    expect(() => assertDatabaseUnchanged(expected, expected, 'migration replay')).not.toThrow();
    let message = '';
    try { assertDatabaseUnchanged(actual, expected, 'migration replay'); } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('migration replay changed the database schema or seeded rows');
    expect(message).toContain('line 601');
    expect(message).toContain("', 1)");
    expect(message).toContain("', 2)");
    expect(message).not.toContain('-- unchanged line');
    expect(message.length).toBeLessThan(900);
    expect(() => assertDatabaseUnchanged('same\nextra', 'same', 'append')).toThrow(/<EOF>/);
  });

  it('ignores only pg_dump random restriction markers when comparing data', () => {
    const a = '-- dump\n\\restrict abc\nINSERT INTO x VALUES (1);\n\\unrestrict abc\n';
    const b = '-- dump\n\\restrict def\nINSERT INTO x VALUES (1);\n\\unrestrict def\n';
    expect(normalizeDatabaseDump(a)).toBe(normalizeDatabaseDump(b));
    expect(normalizeDatabaseDump(a)).not.toBe(normalizeDatabaseDump(b.replace('(1)', '(2)')));
  });
});
