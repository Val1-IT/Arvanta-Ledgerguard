#!/usr/bin/env node
// Synthetic-only Docker deployment rehearsal. Never accepts a DATABASE_URL,
// existing container, existing volume, or environment file from the caller.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  assertMatchingMigrations, assertLocalDockerEnvironment, assertLocalDockerEndpoint, assertSmokePage, assertRuntimeInventory, assertReadiness, normalizeDatabaseDump, rejectEnvironmentFiles
} from './deployment-smoke-checks.mjs';

import { cleanupDockerResources } from './deployment-smoke-cleanup.mjs';

const usage = 'Usage: node scripts/deployment-smoke.mjs --baseline-source /path/to/previous/checkout';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log(`${usage}\nRequires Docker, Node 20.19+, and two environment-file-free checkouts with identical SQL migration history.\nCreates and deletes only its own synthetic Docker resources. No deployment or schema downgrade.`);
  process.exit(0);
}
if (args.length !== 2 || args[0] !== '--baseline-source') {
  console.error(usage);
  process.exit(2);
}

const candidate = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = resolve(args[1]);
// Validate the rollback boundary before creating resources or running either build.
rejectEnvironmentFiles(candidate);
rejectEnvironmentFiles(baseline);
assertMatchingMigrations(candidate, baseline);

const id = `ledgerguard-smoke-${randomBytes(8).toString('hex')}`;
const network = `${id}-net`;
const volume = `${id}-db`;
const db = `${id}-postgres`;
const app = `${id}-app`;
const migration = `${id}-migration`;
const probe = `${id}-probe`;
const images = [`${id}:baseline-tools`, `${id}:baseline`, `${id}:candidate-tools`, `${id}:candidate`];
const [baselineTools, baselineImage, candidateTools, candidateImage] = images;
const password = randomBytes(24).toString('hex');
const databaseUrl = `postgres://ledgerguard:${password}@postgres:5432/ledgerguard_smoke`;
const label = 'ledgerguard.validation=isolated-deployment';
let cleaning = false;
let dockerAvailable = false;
let validated = false;

function command(program, argv, options = {}) {
  const result = spawnSync(program, argv, {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 15 * 60 * 1000,
    stdio: options.capture ? 'pipe' : 'inherit', ...options
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${program} ${argv[0]} failed (${result.status ?? result.error?.message}): ${result.stderr ?? ''}`);
  }
  return result.stdout?.trim() ?? '';
}
const docker = (argv, options) => command('docker', argv, options);
function cleanup() {
  if (cleaning || !dockerAvailable) return;
  cleaning = true;
  // Enumerate only random names reserved by this invocation; no broad prune.
  const resources = [
    ...[app, migration, probe, db].map((name) => ['container', name]),
    ['volume', volume], ['network', network], ...images.map((name) => ['image', name])
  ];
  const errors = cleanupDockerResources(resources, (argv) => spawnSync('docker', argv,
    { encoding: 'utf8', timeout: 15000 }));
  if (errors.length) console.error(errors.join('\n'));
  if (errors.length) {
    console.error(`Cleanup incomplete. Inspect only resources prefixed ${id}; do not prune unrelated resources.`);
    process.exitCode = 1;
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { process.exitCode = signal === 'SIGINT' ? 130 : 143; cleanup(); process.exit(); });
}
process.on('exit', cleanup);

function build(source, toolsImage, runtimeImage) {
  docker(['build', '--target', 'build', '--label', label, '--tag', toolsImage, source]);
  docker(['build', '--target', 'runner', '--label', label, '--tag', runtimeImage, source]);
  docker(['run', '--rm', '--name', probe, '--label', label, '--network', 'none', runtimeImage, 'node', '--check', 'server.js']);
  const uid = docker(['run', '--rm', '--name', probe, '--label', label, '--network', 'none', runtimeImage,
    'node', '-p', 'process.getuid()'], { capture: true });
  assert.notEqual(uid, '0', 'Standalone image must run without root privileges');
}
function tooling(image, script) {
  docker(['run', '--rm', '--name', migration, '--label', label, '--network', network,
    '--env', `DATABASE_URL=${databaseUrl}`, '--env', 'DEMO_MODE=false',
    image, 'pnpm', 'run', script]);
}
function dump() {
  return normalizeDatabaseDump(docker(['exec', db, 'pg_dump', '--username', 'ledgerguard',
    '--dbname', 'ledgerguard_smoke', '--no-owner', '--no-privileges', '--inserts'], { capture: true }));
}
function start(image) {
  docker(['run', '--detach', '--name', app, '--label', label, '--network', network,
    '--env', `DATABASE_URL=${databaseUrl}`, '--env', 'DEMO_MODE=false',
    '--env', 'DATAHUB_GMS_URL=', '--env', 'DATAHUB_MCP_URL=',
    '--env', 'LLM_PROVIDER=deterministic', image]);
}
function request(path) {
  const script = `const r = await fetch(${JSON.stringify(`http://127.0.0.1:3000${path}`)}, {signal: AbortSignal.timeout(5000)}); console.log(JSON.stringify({status:r.status,body:await r.text()}));`;
  return JSON.parse(docker(['exec', app, 'node', '--input-type=module', '-e', script],
    { capture: true, timeout: 10000 }));
}
async function checkReadiness(ready, stage = ready ? 'after migration' : 'before migration') {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = request('/api/health/ready');
      assertReadiness(response.status, JSON.parse(response.body), ready);
      console.log(`PASS: readiness reports ready=${ready} ${stage}.`);
      return;
    } catch (error) { lastError = error; }
    await sleep(2000);
  }
  throw new Error(`Readiness: ${lastError?.message}`);
}
async function checkApp(stage, checkAgent = false) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      for (const path of ['/overview', '/incidents', ...(checkAgent ? ['/agent'] : [])]) {
        const result = request(path);
        assertSmokePage(path, result.status, result.body);
      }
      if (checkAgent) {
        const response = request('/api/health/ready');
        assertReadiness(response.status, JSON.parse(response.body), true);
      }
      console.log(`PASS: ${stage}: seeded overview and incident list, demo mutations disabled.`);
      return;
    } catch (error) { lastError = error; }
    await sleep(2000);
  }
  throw new Error(`${stage}: ${lastError?.message}`);
}
function assertPrivate(name) {
  const bindings = JSON.parse(docker(['inspect', '--format', '{{json .NetworkSettings.Ports}}', name], { capture: true }));
  assert(Object.values(bindings ?? {}).every((value) => value === null), `${name} exposes a host port`);
}
function assertUnchanged(expected, stage) {
  assert.equal(dump(), expected, `${stage} changed the database schema or seeded rows`);
  console.log(`PASS: ${stage}: schema and data unchanged.`);
}

try {
  // Context inspection reads local CLI configuration only. Never connect to a
  // daemon until its selected endpoint has passed the local-only guard.
  assertLocalDockerEnvironment(process.env);
  const selectedContext = spawnSync('docker', ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'],
    { encoding: 'utf8', timeout: 15000 });
  if (selectedContext.error || selectedContext.status !== 0) {
    throw new Error('Unable to inspect the selected Docker context; no daemon action was attempted.');
  }
  let endpoint;
  try { endpoint = JSON.parse(selectedContext.stdout); } catch {
    throw new Error('Unable to read the selected Docker endpoint; no daemon action was attempted.');
  }
  assertLocalDockerEndpoint(endpoint);
  docker(['info'], { capture: true, timeout: 15000 });
  dockerAvailable = true;
  console.log('Building baseline and candidate standalone images; external service credentials are not supplied.');
  build(baseline, baselineTools, baselineImage);
  build(candidate, candidateTools, candidateImage);
  const inventoryScript = readFileSync(new URL('./deployment-image-inventory.mjs', import.meta.url), 'utf8');
  const inventory = JSON.parse(docker(['run', '--rm', '--name', probe, '--label', label, '--network', 'none', candidateImage,
    'node', '--input-type=module', '-e', inventoryScript], { capture: true }));
  assertRuntimeInventory(inventory);
  console.log(`Standalone runtime inventory: ${JSON.stringify(inventory)}`);
  const baselineId = docker(['image', 'inspect', '--format', '{{.Id}}', baselineImage], { capture: true });
  const candidateId = docker(['image', 'inspect', '--format', '{{.Id}}', candidateImage], { capture: true });
  console.log(JSON.stringify({ baselineImage: baselineId, candidateImage: candidateId }));
  docker(['pull', 'postgres:16-alpine']);
  docker(['network', 'create', '--internal', '--label', label, network]);
  docker(['volume', 'create', '--label', label, volume]);
  docker(['run', '--detach', '--name', db, '--label', label, '--network', network, '--network-alias', 'postgres',
    '--env', 'POSTGRES_USER=ledgerguard', '--env', `POSTGRES_PASSWORD=${password}`,
    '--env', 'POSTGRES_DB=ledgerguard_smoke', '--mount', `type=volume,source=${volume},target=/var/lib/postgresql/data`,
    'postgres:16-alpine']);
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const check = spawnSync('docker', ['exec', db, 'pg_isready', '-h', '127.0.0.1', '-U', 'ledgerguard', '-d', 'ledgerguard_smoke'], { stdio: 'ignore', timeout: 10000 });
    if (check.status === 0) { ready = true; break; }
    await sleep(2000);
  }
  assert(ready, 'Disposable PostgreSQL did not become ready');
  assertPrivate(db);
  start(candidateImage);
  assertPrivate(app);
  await checkReadiness(false);
  docker(['rm', '--force', app]);
  tooling(baselineTools, 'db:migrate');
  tooling(baselineTools, 'db:seed'); // Destructive only to the newly created synthetic database above.
  const seeded = dump();
  console.log(`Seeded schema/data SHA-256: ${createHash('sha256').update(seeded).digest('hex')}`);
  start(baselineImage);
  assertPrivate(app);
  await checkApp('baseline startup');
  docker(['rm', '--force', app]);
  tooling(candidateTools, 'db:migrate');
  tooling(candidateTools, 'db:migrate');
  assertUnchanged(seeded, 'candidate migration replay');
  start(candidateImage);
  assertPrivate(app);
  await checkApp('candidate startup', true);
  docker(['restart', app]);
  await checkApp('candidate restart', true);
  assertUnchanged(seeded, 'candidate restart');
  const appProcess = docker(['inspect', '--format', '{{.State.Pid}}:{{.RestartCount}}', app], { capture: true });
  docker(['stop', '--time', '10', db]);
  await checkReadiness(false, 'during database outage');
  docker(['start', db]);
  await checkApp('candidate after database recovery', true);
  assert.equal(docker(['inspect', '--format', '{{.State.Pid}}:{{.RestartCount}}', app], { capture: true }),
    appProcess, 'The app process restarted during the database outage');
  assertUnchanged(seeded, 'database outage and recovery');
  docker(['rm', '--force', app]);
  start(baselineImage);
  await checkApp('previous-image rollback on unchanged schema');
  assertUnchanged(seeded, 'previous-image rollback');
  validated = true;
} catch (error) {
  console.error(error.message);
  if (dockerAvailable) {
    for (const name of [app, db]) spawnSync('docker', ['logs', '--tail', '100', name], { stdio: 'inherit' });
  }
  process.exitCode = 1;
} finally {
  cleanup();
}

if (validated && !process.exitCode) {
  console.log('DEPLOYMENT SMOKE PASS: isolated startup, migration replay, restart, and application-only rollback; owned resources cleaned up.');
  console.log('This is not production authentication, ERP integration, down-migration, or backup/restore evidence.');
}
