import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const ARTIFACTS = {
  bootstrapRun1: path.join(REPO_ROOT, 'examples', 'datahub', 'bootstrap-report.run1.json'),
  bootstrapRun2: path.join(REPO_ROOT, 'examples', 'datahub', 'bootstrap-report.json'),
  mcpProof: path.join(REPO_ROOT, 'examples', 'mcp', 'proof-report.json'),
  mcpActivityLog: path.join(REPO_ROOT, 'examples', 'mcp', 'activity-log.jsonl'),
  writeback: path.join(REPO_ROOT, 'examples', 'mcp', 'writeback-report.json')
};

/** Run one of the project's Python entry points through the venv launcher. */
export async function runPython(args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts', 'py.mjs'), ...args],
    { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 }
  );
  return `${stdout}\n${stderr}`;
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export function readJsonl<T>(file: string): T[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

export const GMS_URL = process.env.DATAHUB_GMS_URL?.trim() || 'http://localhost:8080';

export function datasetUrn(table: string): string {
  return `urn:li:dataset:(urn:li:dataPlatform:postgres,ledgerguard.public.${table},PROD)`;
}

export const DEMO_TABLES = [
  'products',
  'product_units',
  'inventory_movements',
  'inventory_valuation',
  'journal_entries',
  'gross_margin_report'
] as const;

/** Minimal GraphQL call against DataHub GMS, used to verify persistence independently. */
export async function gmsGraphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = process.env.DATAHUB_GMS_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${GMS_URL}/api/graphql`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    throw new Error(`GMS GraphQL ${response.status}: ${await response.text()}`);
  }
  const payload = (await response.json()) as { data?: T; errors?: unknown };
  if (payload.errors) {
    throw new Error(`GMS GraphQL errors: ${JSON.stringify(payload.errors)}`);
  }
  return payload.data as T;
}
