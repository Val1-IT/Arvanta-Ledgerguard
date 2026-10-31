// Spawns pnpm and tsx without `shell: true` (Node DEP0190) and works on
// Windows, where `.cmd` shims cannot be spawned without a shell. Everything
// runs through `process.execPath` with a JavaScript entry point.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const PINNED_PNPM = 'pnpm@9.15.9';

export const COREPACK_HINT = [
  'Corepack could not write its cache directory. Point it at a writable directory and retry:',
  '  macOS/Linux:  export COREPACK_HOME=/tmp/corepack',
  '  PowerShell:   $env:COREPACK_HOME = "$env:TEMP\\corepack"',
  `Or install pnpm directly: npm install --global ${PINNED_PNPM}`
].join('\n');

/** True when output looks like Corepack failing on an unwritable cache (EACCES/EPERM, or its "Failed to create cache directory" message). */
export function isCorepackCacheError(text) {
  if (!text) return false;
  return /failed to create cache directory/i.test(text) ||
    (/corepack/i.test(text) && /\b(EACCES|EPERM|EROFS)\b|permission denied/i.test(text));
}

/** Locates npm's bundled npx entry next to the running Node, or null. */
export function findNpxCli(execPath = process.execPath, platform = process.platform, exists = existsSync) {
  const base = dirname(execPath);
  const candidates = platform === 'win32'
    ? [join(base, 'node_modules', 'npm', 'bin', 'npx-cli.js')]
    : [join(base, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js')];
  return candidates.find((p) => exists(p)) ?? null;
}

/**
 * Returns [command, prefixArgs] that run pnpm with no shell, or null.
 * Prefers the pnpm entry that launched us (`pnpm demo` sets npm_execpath),
 * then a plain `pnpm` binary on POSIX, then `npx pnpm@9.15.9`.
 */
export function resolvePnpm({ env = process.env, platform = process.platform, execPath = process.execPath, npxCli = findNpxCli(execPath, platform) } = {}) {
  const entry = env.npm_execpath;
  if (entry && /pnpm\.(?:c?js|mjs)$/i.test(entry)) return [execPath, [entry]];
  if (platform !== 'win32') return ['pnpm', []];
  return npxCli ? [execPath, [npxCli, '--yes', PINNED_PNPM]] : null;
}

function spawnQuiet(command, args, cwd, quiet) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', shell: false, stdio: quiet ? ['inherit', 'pipe', 'pipe'] : 'inherit' });
}

function fail(result) {
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(result.error.message);
  process.exit(result.status || 1);
}

export function runPnpm(args, cwd, quiet = false) {
  const resolved = resolvePnpm();
  if (!resolved) {
    console.error(`Could not find pnpm. Run this through pnpm (e.g. \`pnpm demo\`) or install it: npm install --global ${PINNED_PNPM}`);
    process.exit(1);
  }
  const [command, prefix] = resolved;
  const result = spawnQuiet(command, [...prefix, ...args], cwd, quiet);
  if (!result.error && result.status === 0) return;

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`;
  if (isCorepackCacheError(output)) {
    const npxCli = findNpxCli();
    if (npxCli) {
      process.stderr.write(`Corepack cache is not writable; retrying with npx ${PINNED_PNPM}…\n`);
      const retry = spawnQuiet(process.execPath, [npxCli, '--yes', PINNED_PNPM, ...args], cwd, quiet);
      if (!retry.error && retry.status === 0) return;
    }
    console.error(COREPACK_HINT);
    process.exit(1);
  }
  fail(result);
}

/** Runs a TypeScript entry with the example's own tsx, via Node (no .cmd shim). */
export function runTsx(entry, args, cwd) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', entry, ...args], { cwd, encoding: 'utf8', shell: false, stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
