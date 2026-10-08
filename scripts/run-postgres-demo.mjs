#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function runPnpm(args, quiet = false) {
  try {
    execFileSync(PNPM, args, {
      stdio: quiet ? ['inherit', 'pipe', 'pipe'] : 'inherit'
    });
  } catch (error) {
    const err = error;
    if (quiet) {
      if (err.stdout) process.stderr.write(err.stdout);
      if (err.stderr) process.stderr.write(err.stderr);
    }
    process.exit(typeof err.status === 'number' ? err.status : 1);
  }
}

const extra = process.argv.slice(2);
process.stdout.write(
  'Installing dependencies for the Postgres demo (app db layer, not only the in-memory example)…\n'
);
runPnpm(['install', '--frozen-lockfile', '--prod=false', '--reporter', 'silent'], true);
runPnpm(['exec', 'tsx', 'scripts/demo-pg.ts', ...extra]);
