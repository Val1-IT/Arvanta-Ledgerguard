import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function findRepoRoot(startDir = path.dirname(fileURLToPath(import.meta.url))): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate LedgerGuard repository root (pnpm-workspace.yaml).');
}

export function datahubPythonRoot(repoRoot: string): string {
  return path.join(repoRoot, 'packages', 'datahub', 'python');
}

export function isDataHubConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DATAHUB_GMS_URL?.trim());
}
