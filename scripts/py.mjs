#!/usr/bin/env node
// Launches the project's Python tooling (DataHub bootstrap, MCP proofs) with the
// repository virtualenv when one exists, so the npm scripts work the same on
// Windows and POSIX without asking the user to activate anything first.
//
// Usage: node scripts/py.mjs -m src.datahub.bootstrap [args...]

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const candidates = [
  path.join(repoRoot, '.venv', 'Scripts', 'python.exe'),
  path.join(repoRoot, '.venv', 'bin', 'python'),
];

const interpreter =
  candidates.find((candidate) => existsSync(candidate)) ??
  (process.platform === 'win32' ? 'python' : 'python3');

const child = spawn(interpreter, process.argv.slice(2), {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
});

child.on('error', (err) => {
  console.error(
    `Could not run Python (${interpreter}). Create the virtualenv first:\n` +
      '  python -m venv .venv\n' +
      '  ./.venv/Scripts/pip install -r src/datahub/requirements.txt   # Windows\n' +
      '  ./.venv/bin/pip install -r src/datahub/requirements.txt       # macOS / Linux\n\n' +
      String(err)
  );
  process.exit(1);
});

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
