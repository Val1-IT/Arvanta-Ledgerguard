import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function migrationManifest(root) {
  const directory = join(root, 'drizzle');
  const names = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
  assert(names.length > 0, 'No committed SQL migrations found');
  return [...names, 'meta/_journal.json'].map((name) => [
    name,
    createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')
  ]);
}

/** This harness deliberately supports only application rollback with unchanged migrations. */
export function assertMatchingMigrations(candidate, baseline) {
  assert.deepEqual(migrationManifest(candidate), migrationManifest(baseline),
    'Migration history differs: review upgrade/backward compatibility and restore separately; no automatic down-migration is safe.');
}

/** Refuse environment files by filename, without reading their contents. */
export function rejectEnvironmentFiles(root) {
  const files = readdirSync(root).filter((name) =>
    name.startsWith('.env') && name !== '.env.example');
  assert.equal(files.length, 0, 'Use a fresh checkout without environment files for isolated deployment validation.');
}

/** Next can render backend error fallbacks with HTTP 200, so check real seeded DB values. */
export function assertSmokePage(path, status, body) {
  assert.equal(status, 200, `${path} returned HTTP ${status}`);
  assert(!/Backend unavailable|Backend notice|Incidents unavailable/i.test(body), `${path} rendered a backend error`);
  const expected = {
    '/overview': ['Overview', 'Healthy', 'Rp 72.000.000,00', '33,33%',
      'All quality checks currently pass.', 'Demo mode off',
      'Simulate requires demo mode to be enabled.', 'Reset requires demo mode to be enabled.'],
    '/incidents': ['Incidents', 'No incidents yet'],
    '/agent': ['Investigation Agent', 'Investigations are disabled.']
  }[path];
  assert(expected, `Unsupported smoke route: ${path}`);
  for (const text of expected) assert(body.includes(text), `${path} missing expected content: ${text}`);
  if (path === '/agent') {
    const buttons = body.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
    const submit = buttons.find((button) => />\s*Run investigation\s*<\/button>/.test(button));
    assert(submit && /\sdisabled(?:=|\s|>)/.test(submit), 'Investigation submit must be disabled');
  }
}

export function normalizeDatabaseDump(dump) {
  // command() trims captured stdout, so the final marker may end at EOF.
  return dump.replace(/^\\(?:un)?restrict \S+(?:\r?\n|$)/gm, '');
}

export function assertRuntimeInventory(inventory) {
  const tooling = inventory.packages.filter(({ name }) =>
    ['braces', 'micromatch', 'fast-glob', 'tailwindcss', 'eslint'].includes(name) ||
    /^(?:@eslint\/|@eslint-community\/|eslint-|@tailwindcss\/)/.test(name));
  assert.equal(tooling.length, 0, `Standalone image contains tooling package(s): ${tooling.map(({ name }) => name).join(', ')}`);
  assert.equal(inventory.environmentFiles.length, 0, `Standalone image contains environment file(s): ${inventory.environmentFiles.join(', ')}`);
  assert(inventory.packages.some(({ name }) => name === 'next'), 'Standalone inventory is missing the Next.js package');
}

export function assertReadiness(status, body, ready) {
  assert.equal(status, ready ? 200 : 503, `Readiness returned HTTP ${status}`);
  assert.deepEqual(body, { ready }, 'Readiness must return only the expected ready boolean');
}

export function assertLocalDockerEnvironment(environment) {
  assert(!environment.DOCKER_HOST && !environment.DOCKER_CONTEXT,
    'Run this validation without DOCKER_HOST or DOCKER_CONTEXT overrides; the script will not switch Docker contexts.');
}
export function assertLocalDockerEndpoint(endpoint) {
  const localUnixSocket = typeof endpoint === 'string' && /^unix:\/\/\/[^?#\x00-\x1f\x7f]+$/.test(endpoint);
  const localWindowsPipe = typeof endpoint === 'string' && /^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9_.-]+$/.test(endpoint);
  assert(localUnixSocket || localWindowsPipe,
    'Selected Docker endpoint must be a local Unix socket or local Windows named pipe.');
}

/** Exact equality, with bounded diagnostics for this harness's synthetic data only. */
export function assertDatabaseUnchanged(actual, expected, stage) {
  if (actual === expected) return;
  const actualLines = actual.split('\n');
  const expectedLines = expected.split('\n');
  let line = 0;
  while (line < Math.min(actualLines.length, expectedLines.length) && actualLines[line] === expectedLines[line]) line++;
  const actualLine = actualLines[line];
  const expectedLine = expectedLines[line];
  let column = 0;
  while (column < Math.min(actualLine?.length ?? 0, expectedLine?.length ?? 0) && actualLine[column] === expectedLine[column]) column++;
  const start = Math.max(0, column - 60);
  const end = column + 100;
  const excerpt = (value) => value === undefined ? '<EOF>' : JSON.stringify(
    `${start ? '…' : ''}${value.slice(start, end)}${value.length > end ? '…' : ''}`);
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  throw new Error(`${stage} changed the database schema or seeded rows at line ${line + 1}, column ${column + 1}.\n` +
    `Expected: ${excerpt(expectedLine)}\nActual: ${excerpt(actualLine)}\n` +
    `Expected SHA-256: ${hash(expected)}\nActual SHA-256: ${hash(actual)}`);
}
