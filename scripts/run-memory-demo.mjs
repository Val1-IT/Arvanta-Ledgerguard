#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const example = join(root, 'examples', 'inventory-ledger');
const exampleNm = join(example, 'node_modules');

function runPnpm(args, cwd, quiet = false) {
  const result = spawnSync('pnpm', args, {
    cwd,
    encoding: 'utf8',
    shell: true,
    stdio: quiet ? ['inherit', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}

function ensureLink(target, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest) || !existsSync(target)) return;
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

const tsxBin = join(exampleNm, '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
const run = spawnSync(tsxBin, ['src/run.ts', ...extra], {
  cwd: example,
  encoding: 'utf8',
  shell: true,
  stdio: 'inherit'
});
if (run.error) {
  console.error(run.error.message);
  process.exit(1);
}
if (run.status !== 0) process.exit(run.status ?? 1);
