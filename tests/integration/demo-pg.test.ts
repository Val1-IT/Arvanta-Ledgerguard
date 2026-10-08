import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { getDatabaseUrl } from '../../src/db/client';
import { initializeDemoDatabase } from '../../scripts/postgres-demo-safety';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';

const databases: string[] = [];
const adminUrl = process.env.DEMO_PG_TEST_ADMIN_URL ?? getDatabaseUrl();

async function freshDatabase(): Promise<{ pool: Pool; url: string }> {
  const name = `ledgerguard_demo_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: adminUrl });
  try {
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    databases.push(name);
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return { pool: new Pool({ connectionString: url.href }), url: url.href };
}

async function demo(url: string, answers: string[], args: string[] = []) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/demo-pg.ts', ...args], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: url },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let output = '';
    let prompts = 0;
    const timeout = setTimeout(() => { child.kill('SIGKILL'); }, 20_000);
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const count = (output.match(/\(anything else aborts\): /g) ?? []).length;
      while (prompts < count) {
        const answer = answers[prompts++];
        if (answer === undefined) child.stdin.end();
        else child.stdin.write(`${answer}\n`);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => { clearTimeout(timeout); resolve({ code, output }); });
  });
}

async function userObjects(pool: Pool) {
  return (await pool.query(`
    SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    ORDER BY 1, 2
  `)).rows;
}

// Runs real queries and transaction boundaries, with one controlled fault or
// competing writer at the relevant boundary. No production test hooks needed.
function interceptQueries(pool: Pool, intercept: (sql: string, run: () => Promise<unknown>) => Promise<unknown>): Pool {
  return new Proxy(pool, {
    get(target, property) {
      if (property !== 'connect') return Reflect.get(target, property);
      return async () => {
        const client = await target.connect();
        return new Proxy(client, {
          get(connection, key) {
            if (key !== 'query') return Reflect.get(connection, key);
            return (sql: string, values?: unknown[]) => intercept(sql, () => connection.query(sql, values));
          }
        });
      };
    }
  });
}

afterEach(async () => {
  const admin = new Pool({ connectionString: adminUrl });
  try {
    for (const name of databases.splice(0)) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
});

describe('Postgres demo initialization and approval safety', () => {
  it('declining initial consent preserves existing sentinel data and schema exactly', async () => {
    const { pool, url } = await freshDatabase();
    try {
      await pool.query("CREATE TABLE sentinel (value text); INSERT INTO sentinel VALUES ('keep-me')");
      const before = await userObjects(pool);
      const result = await demo(url, ['no']);
      expect(result.code).toBe(1);
      expect(result.output).toContain('Initialization declined. No database changes were made.');
      expect(await userObjects(pool)).toEqual(before);
      expect((await pool.query('SELECT * FROM sentinel')).rows).toEqual([{ value: 'keep-me' }]);
    } finally { await pool.end(); }
  });

  it('refuses an occupied database after consent without changing sentinel data or schema', async () => {
    const { pool, url } = await freshDatabase();
    try {
      await pool.query("CREATE TABLE sentinel (value text); INSERT INTO sentinel VALUES ('keep-me')");
      const before = await userObjects(pool);
      const result = await demo(url, ['yes']);
      expect(result.code).toBe(1);
      expect(result.output).toContain('Target is not an empty disposable database');
      expect(await userObjects(pool)).toEqual(before);
      expect((await pool.query('SELECT * FROM sentinel')).rows).toEqual([{ value: 'keep-me' }]);
    } finally { await pool.end(); }
  });

  it('refuses a target with a custom schema even when it has no tables', async () => {
    const { pool, url } = await freshDatabase();
    try {
      await pool.query('CREATE SCHEMA sentinel_schema');
      const result = await demo(url, ['yes']);
      expect(result.code).toBe(1);
      expect(result.output).toContain('Target is not an empty disposable database');
      expect(await userObjects(pool)).toEqual([]);
      expect((await pool.query("SELECT nspname FROM pg_namespace WHERE nspname = 'sentinel_schema'")).rowCount).toBe(1);
    } finally { await pool.end(); }
  });

  it('treats closed input as declined initial consent without mutation', async () => {
    const { pool, url } = await freshDatabase();
    try {
      const result = await demo(url, []);
      expect(result.code).toBe(1);
      expect(result.output).toContain('Initialization declined. No database changes were made.');
      expect(await userObjects(pool)).toEqual([]);
    } finally { await pool.end(); }
  });

  it('prints the persisted pending plan before remediation consent and retains authorized initialization on decline', async () => {
    const { pool, url } = await freshDatabase();
    try {
      const result = await demo(url, ['yes', 'no']);
      expect(result.code).toBe(1);
      expect(result.output).toContain('Authorized initialization and the pending plan remain; no remediation was executed.');
      const { rows: [plan] } = await pool.query('SELECT id, version, state, proposed_corrections_json FROM remediation_plans');
      expect(plan.state).toBe('PENDING_APPROVAL');
      expect(result.output).toContain(`Pending plan: ${plan.id} | version: ${plan.version}`);
      expect(result.output.indexOf(`Pending plan: ${plan.id}`)).toBeLessThan(result.output.indexOf('Type yes to approve this exact plan version'));
      for (const correction of JSON.parse(plan.proposed_corrections_json)) {
        expect(result.output).toContain(`${correction.action} ${correction.table}.${correction.field} ${correction.recordId}: ${correction.beforeValue} → ${correction.afterValue}`);
      }
      expect((await pool.query("SELECT quantity_on_hand FROM inventory_valuation WHERE id = 'val-item-001'")).rows[0].quantity_on_hand).toBe('20.000');
      expect((await pool.query('SELECT * FROM ledgerguard_execution_journal')).rowCount).toBe(0);
      expect((await pool.query('SELECT * FROM drizzle.__drizzle_migrations')).rowCount).toBeGreaterThan(0);
    } finally { await pool.end(); }
  });

  it('concurrent initializers never reset each other’s committed fixture', async () => {
    const { pool, url } = await freshDatabase();
    try {
      const results = await Promise.all([demo(url, ['yes', 'no']), demo(url, ['yes', 'no'])]);
      expect(results.filter((result) => result.output.includes('Authorized initialization and the pending plan remain'))).toHaveLength(1);
      expect(results.filter((result) => result.output.includes('Target is not an empty disposable database'))).toHaveLength(1);
      expect((await pool.query('SELECT * FROM remediation_plans')).rowCount).toBe(1);
      expect((await pool.query("SELECT quantity_on_hand FROM inventory_valuation WHERE id = 'val-item-001'")).rows[0].quantity_on_hand).toBe('20.000');
    } finally { await pool.end(); }
  });

  it('refuses an existing public collation without changing it or creating schema', async () => {
    const { pool, url } = await freshDatabase();
    try {
      await pool.query('CREATE COLLATION public.demo_sentinel FROM pg_catalog."C"');
      const before = (await pool.query("SELECT oid, collname, collprovider, collencoding FROM pg_collation WHERE collname = 'demo_sentinel'")).rows;
      await expect(initializeDemoDatabase(pool, new URL(url).pathname.slice(1))).rejects.toThrow('Target is not an empty disposable database');
      expect(await userObjects(pool)).toEqual([]);
      expect((await pool.query("SELECT oid, collname, collprovider, collencoding FROM pg_collation WHERE collname = 'demo_sentinel'")).rows).toEqual(before);
      expect((await pool.query("SELECT nspname FROM pg_namespace WHERE nspname = 'drizzle'")).rowCount).toBe(0);
    } finally { await pool.end(); }
  });

  it('never invokes an existing public function that shadows a builtin during preflight', async () => {
    const { pool, url } = await freshDatabase();
    try {
      await pool.query(`CREATE FUNCTION public.current_database() RETURNS name LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Untrusted builtin shadow was executed'; END $$`);
      await expect(initializeDemoDatabase(pool, new URL(url).pathname.slice(1))).rejects.toThrow('Target is not an empty disposable database');
      expect(await userObjects(pool)).toEqual([]);
      expect((await pool.query("SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'")).rows).toEqual([{ proname: 'current_database' }]);
    } finally { await pool.end(); }
  });

  it('rolls back migrations, journal, and inserted seed rows when initialization fails', async () => {
    const { pool, url } = await freshDatabase();
    try {
      const failing = interceptQueries(pool, async (sql, run) => {
        if (sql.includes('insert into product_units')) throw new Error('Injected fixture insertion failure');
        return run();
      });
      await expect(initializeDemoDatabase(failing, new URL(url).pathname.slice(1))).rejects.toThrow('Injected fixture insertion failure');
      expect(await userObjects(pool)).toEqual([]);
      expect((await pool.query("SELECT nspname FROM pg_namespace WHERE nspname = 'drizzle'")).rowCount).toBe(0);
    } finally { await pool.end(); }
  });

  it('fails closed and preserves a foreign writer’s sentinel table racing the emptiness check', async () => {
    const { pool, url } = await freshDatabase();
    try {
      let raced = false;
      const racing = interceptQueries(pool, async (sql, run) => {
        const result = await run();
        if (sql.includes('AS safe') && !raced) {
          raced = true;
          await pool.query("CREATE TABLE products (id text, name text); INSERT INTO products VALUES ('sentinel', 'keep-me')");
        }
        return result;
      });
      await expect(initializeDemoDatabase(racing, new URL(url).pathname.slice(1))).rejects.toThrow();
      expect((await pool.query('SELECT * FROM products')).rows).toEqual([{ id: 'sentinel', name: 'keep-me' }]);
      expect(await userObjects(pool)).toEqual([{ schema: 'public', name: 'products', kind: 'r' }]);
      expect((await pool.query("SELECT nspname FROM pg_namespace WHERE nspname = 'drizzle'")).rowCount).toBe(0);
    } finally { await pool.end(); }
  });

  it('fails closed when catalog inspection cannot prove emptiness', async () => {
    const { pool, url } = await freshDatabase();
    try {
      const blocked = interceptQueries(pool, async (sql, run) => {
        if (sql.includes('AS safe')) throw new Error('Injected catalog permission denial');
        return run();
      });
      await expect(initializeDemoDatabase(blocked, new URL(url).pathname.slice(1))).rejects.toThrow('Injected catalog permission denial');
      expect(await userObjects(pool)).toEqual([]);
    } finally { await pool.end(); }
  });

  it('records compatible migration hashes so a normal migration replay is a no-op', async () => {
    const { pool, url } = await freshDatabase();
    try {
      await initializeDemoDatabase(pool, new URL(url).pathname.slice(1));
      await pool.query("UPDATE products SET name = 'sentinel after initialization' WHERE id = 'ITEM-001'");
      const beforeObjects = await userObjects(pool);
      const beforeJournal = (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows;
      await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
      expect(await userObjects(pool)).toEqual(beforeObjects);
      expect((await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows).toEqual(beforeJournal);
      expect((await pool.query("SELECT name FROM products WHERE id = 'ITEM-001'")).rows[0].name).toBe('sentinel after initialization');
    } finally { await pool.end(); }
  });

  it('executes and verifies the displayed approved plan, then safely replays', async () => {
    const { pool, url } = await freshDatabase();
    try {
      const result = await demo(url, ['yes', 'yes']);
      expect(result.code, result.output).toBe(0);
      expect(result.output).toContain('Execute: EXECUTED, verification PASS');
      expect(result.output).toContain('Replay: ALREADY_EXECUTED');
      expect((await pool.query("SELECT quantity_on_hand FROM inventory_valuation WHERE id = 'val-item-001'")).rows[0].quantity_on_hand).toBe('10.000');
    } finally { await pool.end(); }
  });
});
