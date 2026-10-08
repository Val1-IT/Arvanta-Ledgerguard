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
    if (!quiet && err.message) {
      console.error(err.message);
    }
    process.exit(typeof err.status === 'number' ? err.status : 1);
  }
}

const extra = process.argv.slice(2);
process.stdout.write('Installing in-memory demo packages (core, policy, example — not the Next.js app)…\n');
runPnpm(
  [
    'install',
    '--frozen-lockfile',
    '--prod=false',
    '--filter',
    '@ledgerguard/example-inventory-ledger...',
    '--reporter',
    'silent'
  ],
  true
);
runPnpm(['--filter', '@ledgerguard/example-inventory-ledger', 'run', 'demo', ...extra]);
