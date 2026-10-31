#!/usr/bin/env node
import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPnpm, runTsx } from './lib/run-pnpm.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const example = join(root, 'examples', 'inventory-ledger');
const exampleNm = join(example, 'node_modules');

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

runTsx('src/run.ts', extra, example);
