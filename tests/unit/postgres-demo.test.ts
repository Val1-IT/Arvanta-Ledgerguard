import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { Client } from 'pg';
import { validateDemoTarget } from '../../scripts/postgres-demo-safety';
import { describe, expect, it } from 'vitest';

function run(script: string, args: string[] = [], url = 'postgresql://demo:secret-canary@127.0.0.1:1/ledgerguard_demo_test', input = 'no\n') {
  return spawnSync(process.execPath, [...(script.endsWith('.ts') ? ['--import', 'tsx'] : []), script, ...args], {
    env: { ...process.env, DATABASE_URL: url },
    input,
    encoding: 'utf8',
    timeout: 3000
  });
}

describe('Postgres demo CLI safeguards', () => {
  it('rejects unknown flags before attempting database access', () => {
    const result = run('scripts/demo-pg.ts', ['--approve']);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain('Unknown arguments. This demo accepts no flags.');
    expect(result.stdout + result.stderr).not.toContain('secret-canary');
  });

  it('declines initialization before connecting to an unreachable database', () => {
    const result = run('scripts/demo-pg.ts');
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain('Initialization declined. No database changes were made.');
    expect(result.stdout + result.stderr).not.toContain('secret-canary');
  });

  it.each([
    'postgresql://demo:secret-canary@prod.example.com/ledgerguard_demo_test',
    'postgresql://demo:secret-canary@127.0.0.1/production',
    'postgresql://demo:secret-canary@127.0.0.1/ledgerguard_demo_test?host=prod.example.com',
    'postgresql://demo:secret-canary@127.0.0.1/ledgerguard_demo_test?options=-csearch_path%3Dprivate',
    'postgresql://demo:secret-canary@127.0.0.1/ledgerguard_demo_test#fragment',
    'not-a-url-secret-canary',
    'postgresql://demo:secret-canary@[::1]/ledgerguard_demo_test'
  ])('rejects remote, ambiguous, or non-disposable targets without disclosing credentials (%#)', (url) => {
    const result = run('scripts/demo-pg.ts', [], url);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain('DATABASE_URL must identify a local, dedicated ledgerguard_demo_ database');
    expect(result.stdout + result.stderr).not.toContain('secret-canary');
  });

  it('bounds connection acquisition when a local endpoint accepts TCP but never answers', async () => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => { sockets.add(socket); socket.on('data', () => undefined); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP test listener');
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/demo-pg.ts'], {
      env: { ...process.env, DATABASE_URL: `postgresql://demo:secret-canary@127.0.0.1:${address.port}/ledgerguard_demo_timeout` },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stdin.end('yes\n');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 9000);
    try {
      const [code] = await once(child, 'close');
      expect(code).toBe(1);
      expect(output).toContain('Database initialization could not complete.');
      expect(output).not.toContain('secret-canary');
    } finally {
      clearTimeout(timeout);
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  }, 12_000);

  it('uses Node with an argument array for a pnpm entry path containing spaces, then preserves a declined exit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledgerguard demo runner '));
    const entry = join(dir, 'pnpm.cjs');
    const trace = join(dir, 'arguments.json');
    writeFileSync(entry, `require('node:fs').writeFileSync(${JSON.stringify(trace)}, JSON.stringify(process.argv.slice(2)));`);
    try {
      const result = spawnSync(process.execPath, ['scripts/run-postgres-demo.mjs'], {
        env: { ...process.env, npm_execpath: entry, DATABASE_URL: 'postgresql://demo:secret-canary@127.0.0.1:1/ledgerguard_demo_test' },
        input: 'no\n', encoding: 'utf8', timeout: 5000
      });
      expect(JSON.parse(readFileSync(trace, 'utf8'))).toEqual(['install', '--frozen-lockfile', '--prod=false', '--reporter', 'silent']);
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain('Initialization declined. No database changes were made.');
      expect(result.stdout + result.stderr).not.toContain('setup or launch failed');
      expect(result.stdout + result.stderr).not.toContain('secret-canary');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('normalizes the displayed default port so PGPORT cannot silently redirect the connection', () => {
    const previous = process.env.PGPORT;
    process.env.PGPORT = '6543';
    try {
      const target = validateDemoTarget('postgresql://demo@127.0.0.1/ledgerguard_demo_target');
      const client = new Client({ connectionString: target.url });
      const parameters = (client as unknown as { connectionParameters: { port: number } }).connectionParameters;
      expect(target.label).toContain('127.0.0.1:5432/');
      expect(parameters.port).toBe(5432);
    } finally {
      if (previous === undefined) delete process.env.PGPORT;
      else process.env.PGPORT = previous;
    }
  });

  it('wrapper rejects arguments before install and never expands shell syntax', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledgerguard-demo-args-'));
    const marker = join(dir, 'must-not-exist');
    try {
      const result = run('scripts/run-postgres-demo.mjs', [`--unknown; touch ${marker}`]);
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain('Unknown arguments. This demo accepts no flags.');
      expect(result.stdout + result.stderr).not.toContain('Installing');
      expect(existsSync(marker)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
