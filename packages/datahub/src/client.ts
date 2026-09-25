import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  DataHubBridgeError,
  type CatalogActivityEntry,
  type CatalogContext,
  type DataHubFailureCode
} from './types';
import { datahubPythonRoot, findRepoRoot } from './config';

const repoRoot = findRepoRoot();
const pythonRoot = datahubPythonRoot(repoRoot);

function resolveInterpreter(): string {
  const candidates = [
    path.join(repoRoot, '.venv', 'Scripts', 'python.exe'),
    path.join(repoRoot, '.venv', 'bin', 'python')
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return found;
  return process.platform === 'win32' ? 'python' : 'python3';
}

interface PythonActivityEntry {
  seq: number;
  timestamp: string;
  tool: string;
  input: unknown;
  result: unknown;
  ok: boolean;
  duration_ms: number;
}

function truncate(value: string, max = 600): string {
  return value.length > max ? `${value.slice(0, max)}…(truncated)` : value;
}

function summarize(value: unknown, max = 600): string {
  if (typeof value === 'string') return truncate(value, max);
  try {
    return truncate(JSON.stringify(value), max);
  } catch {
    return truncate(String(value), max);
  }
}

function mapActivityEntry(entry: PythonActivityEntry): CatalogActivityEntry {
  const finishedAt = new Date(entry.timestamp);
  const startedAt = new Date(finishedAt.getTime() - entry.duration_ms);
  return {
    seq: entry.seq,
    tool: entry.tool,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: entry.duration_ms,
    inputSummary: summarize(entry.input),
    outputSummary: summarize(entry.result),
    status: entry.ok ? 'OK' : 'ERROR',
    errorSanitized: entry.ok ? null : summarize(entry.result, 300)
  };
}

interface BridgeRawResult {
  ok: boolean;
  failureState?: DataHubFailureCode;
  message?: string;
  activityLog?: PythonActivityEntry[];
  datahubContext?: CatalogContext;
  writePath?: 'mcp' | 'sdk';
  tagWritten?: boolean;
  noteWritten?: boolean;
  atRiskTagRemoved?: boolean;
  trustedTagAdded?: boolean;
}

export interface DataHubReadResult {
  datahubContext: CatalogContext;
  activityLog: CatalogActivityEntry[];
}

export interface DataHubWritebackResult {
  writePath: 'mcp' | 'sdk';
  tagWritten: boolean;
  noteWritten: boolean;
  activityLog: CatalogActivityEntry[];
}

export interface DataHubResolutionResult {
  writePath: 'mcp' | 'sdk';
  atRiskTagRemoved: boolean;
  trustedTagAdded: boolean;
  noteWritten: boolean;
  activityLog: CatalogActivityEntry[];
}

function runBridge(command: 'read' | 'writeback' | 'resolve', payload: Record<string, unknown>): Promise<BridgeRawResult> {
  return new Promise((resolve, reject) => {
    const pythonPath = [pythonRoot, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
    const child = spawn(resolveInterpreter(), ['-m', 'src.datahub.mcp.agent_bridge', command], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONPATH: pythonPath }
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));

    child.on('error', (err) => {
      reject(new DataHubBridgeError('MCP_UNAVAILABLE', `Could not launch the DataHub MCP bridge: ${err.message}`, []));
    });

    child.on('close', () => {
      const lastLine = stdout.trim().split('\n').filter(Boolean).pop();
      if (!lastLine) {
        reject(
          new DataHubBridgeError(
            'MCP_UNAVAILABLE',
            `The DataHub MCP bridge produced no output. stderr: ${truncate(stderr, 500)}`,
            []
          )
        );
        return;
      }
      try {
        resolve(JSON.parse(lastLine) as BridgeRawResult);
      } catch (err) {
        reject(
          new DataHubBridgeError(
            'MCP_UNAVAILABLE',
            `The DataHub MCP bridge returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
            []
          )
        );
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export async function readDataHubContext(triggerAsset: string): Promise<DataHubReadResult> {
  const raw = await runBridge('read', { triggerAsset });
  const activityLog = (raw.activityLog ?? []).map(mapActivityEntry);
  if (!raw.ok || !raw.datahubContext) {
    throw new DataHubBridgeError(raw.failureState ?? 'MCP_UNAVAILABLE', raw.message ?? 'Unknown DataHub read failure.', activityLog);
  }
  return { datahubContext: raw.datahubContext, activityLog };
}

export async function writeInvestigationSummary(targetAsset: string, summaryText: string): Promise<DataHubWritebackResult> {
  const raw = await runBridge('writeback', { targetAsset, summaryText });
  const activityLog = (raw.activityLog ?? []).map(mapActivityEntry);
  if (!raw.ok || raw.writePath === undefined) {
    throw new DataHubBridgeError('WRITEBACK_FAILED', raw.message ?? 'Unknown DataHub write-back failure.', activityLog);
  }
  return {
    writePath: raw.writePath,
    tagWritten: raw.tagWritten ?? false,
    noteWritten: raw.noteWritten ?? false,
    activityLog
  };
}

export async function resolveDataHubIncident(
  targetAsset: string,
  addTrustedTag: boolean,
  summaryText: string
): Promise<DataHubResolutionResult> {
  const raw = await runBridge('resolve', { targetAsset, addTrustedTag, summaryText });
  const activityLog = (raw.activityLog ?? []).map(mapActivityEntry);
  if (!raw.ok || raw.writePath === undefined) {
    throw new DataHubBridgeError('WRITEBACK_FAILED', raw.message ?? 'Unknown DataHub resolution write-back failure.', activityLog);
  }
  return {
    writePath: raw.writePath,
    atRiskTagRemoved: raw.atRiskTagRemoved ?? false,
    trustedTagAdded: raw.trustedTagAdded ?? false,
    noteWritten: raw.noteWritten ?? false,
    activityLog
  };
}
