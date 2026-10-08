#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function runNode(args, quiet = false) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    stdio: quiet ? ['inherit', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error || result.status !== 0) {
    // Install/launch diagnostics may contain environment credentials. Keep the
    // public error bounded; users can diagnose installation separately.
    if (quiet || result.error) {
      console.error('Postgres demo setup or launch failed. Check Node/pnpm and run pnpm install --frozen-lockfile --prod=false separately.');
    }
    process.exit(result.status ?? 1);
  }
}

if (process.argv.length > 2) {
  console.error('Unknown arguments. This demo accepts no flags.');
  process.exit(1);
}
const pnpmEntry = process.env.npm_execpath;
if (!pnpmEntry || !/pnpm\.(?:c?js|mjs)$/i.test(pnpmEntry)) {
  console.error('Run this command through the pinned pnpm version: pnpm demo:pg');
  process.exit(1);
}
process.stdout.write('Installing locked dependencies for the Postgres demo…\n');
runNode([pnpmEntry, 'install', '--frozen-lockfile', '--prod=false', '--reporter', 'silent'], true);
runNode(['--import', 'tsx', join(root, 'scripts', 'demo-pg.ts')]);
