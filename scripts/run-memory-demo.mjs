#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const example = join(root, 'examples', 'inventory-ledger');
const exampleNm = join(example, 'node_modules');

function runPnpm(args, cwd, quiet = false) {
  try {
    execFileSync(PNPM, args, {
      cwd,
      stdio: quiet ? ['inherit', 'pipe', 'pipe'] : 'inherit'
    });
  } catch (error) {
    const err = error;
    if (quiet) {
      if (err.stdout) process.stderr.write(err.stdout);
      if (err.stderr) process.stderr.write(err.stderr);
    } else if (err.message) {
      console.error(err.message);
    }
    process.exit(typeof err.status === 'number' ? err.status : 1);
  }
}

function ensureLink(target, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest) || !existsSync(target)) return;
  try {
    if (lstatSync(dest).isSymbolicLink()) return;
  } catch {
    // dest does not exist
  }
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  symlinkSync(target, dest, type);
}

const extra = process.argv.slice(2);
process.stdout.write('Installing in-memory demo packages (tsx, decimal.js, zod — not the Next.js app)…\n');
runPnpm(
  ['install', '--frozen-lockfile', '--ignore-workspace', '--reporter', 'silent'],
  example,
  true
);

ensureLink(join(exampleNm, 'zod'), join(root, 'packages', 'core', 'node_modules', 'zod'));
ensureLink(join(exampleNm, 'decimal.js'), join(root, 'packages', 'core', 'node_modules', 'decimal.js'));
ensureLink(join(exampleNm, 'zod'), join(root, 'packages', 'policy', 'node_modules', 'zod'));
mkdirSync(join(root, 'packages', 'policy', 'node_modules', '@ledgerguard'), { recursive: true });
ensureLink(join(root, 'packages', 'core'), join(root, 'packages', 'policy', 'node_modules', '@ledgerguard', 'core'));

const tsxBin = process.platform === 'win32' ? join(exampleNm, '.bin', 'tsx.cmd') : join(exampleNm, '.bin', 'tsx');
try {
  execFileSync(tsxBin, ['src/run.ts', ...extra], { cwd: example, stdio: 'inherit' });
} catch (error) {
  process.exit(typeof error.status === 'number' ? error.status : 1);
}
