#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

function runPnpm(args, quiet = false) {
  const result = spawnSync('pnpm', args, {
    encoding: 'utf8',
    shell: true,
    stdio: quiet ? ['inherit', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (quiet) {
      if (result.stdout) process.stderr.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    process.exit(result.status ?? 1);
  }
}

const extra = process.argv.slice(2);
process.stdout.write(
  'Installing dependencies for the Postgres demo (app db layer, not only the in-memory example)…\n'
);
runPnpm(['install', '--frozen-lockfile', '--prod=false', '--reporter', 'silent'], true);
runPnpm(['exec', 'tsx', 'scripts/demo-pg.ts', ...extra], false);
