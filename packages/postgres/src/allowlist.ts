import { existsSync, readFileSync } from 'node:fs';

export type WritableColumnMap = Readonly<Record<string, ReadonlySet<string>>>;
export type TouchTimestampMap = Readonly<Record<string, string>>;

/**
 * Demo inventory-ledger defaults. Used when callers omit an allowlist so
 * existing tests and the synthetic Postgres path keep working.
 */
export const DEMO_WRITABLE_COLUMNS: WritableColumnMap = Object.freeze({
  product_units: new Set(['conversion_factor']),
  inventory_movements: new Set(['base_quantity', 'reversed_at']),
  inventory_valuation: new Set(['quantity_on_hand', 'average_cost', 'inventory_value']),
  gross_margin_report: new Set(['cost_of_goods_sold', 'gross_profit', 'gross_margin_percentage'])
});

export const DEMO_TOUCH_TIMESTAMP_COLUMNS: TouchTimestampMap = Object.freeze({
  product_units: 'updated_at',
  inventory_valuation: 'calculated_at',
  gross_margin_report: 'generated_at'
});

/** @deprecated Prefer DEMO_WRITABLE_COLUMNS or resolveAllowlist(). Alias of the demo defaults. */
export const WRITABLE_COLUMNS: WritableColumnMap = DEMO_WRITABLE_COLUMNS;

/** @deprecated Prefer DEMO_TOUCH_TIMESTAMP_COLUMNS or resolveAllowlist(). Alias of the demo defaults. */
export const TOUCH_TIMESTAMP_COLUMN: TouchTimestampMap = DEMO_TOUCH_TIMESTAMP_COLUMNS;

export interface AllowlistConfig {
  /** Exact-case, simple ASCII SQL identifiers, each at most 63 bytes. */
  writableColumns: Readonly<Record<string, readonly string[]>>;
  touchTimestamps?: Readonly<Record<string, string>>;
}

export interface ResolvedAllowlist {
  writableColumns: WritableColumnMap;
  touchTimestamps: TouchTimestampMap;
}

const EMPTY_ALLOWLIST: ResolvedAllowlist = Object.freeze({
  writableColumns: Object.freeze({}),
  touchTimestamps: Object.freeze({})
});

function normalizeColumns(
  input: Readonly<Record<string, readonly string[]>>
): WritableColumnMap {
  const out: Record<string, ReadonlySet<string>> = Object.create(null);
  for (const [table, cols] of Object.entries(input)) {
    out[table] = new Set(cols);
  }
  return Object.freeze(out);
}

function assertIdentifier(value: unknown, location: string): asserts value is string {
  // Restrict to one identifier, not a schema/path or SQL fragment. The byte cap
  // avoids PostgreSQL silently truncating names and targeting another object.
  if (typeof value !== 'string' || value.length > 63 ||
      !/^[A-Za-z_]/.test(value) || /[^A-Za-z0-9_]/.test(value)) {
    throw new Error(
      `${location} must be a simple SQL identifier (ASCII letter or underscore, then letters, digits or underscores; maximum 63 bytes). Fail-closed.`
    );
  }
}

/** Validate at the SQL boundary as well as when loading caller configuration. */
export function quoteIdentifier(identifier: string): string {
  assertIdentifier(identifier, 'SQL identifier');
  return `"${identifier}"`;
}

/**
 * Resolve an allowlist.
 *
 * - `undefined` (omitted) → demo inventory tables (backwards compatible).
 * - `null` or empty `writableColumns` → fail-closed (no writable columns).
 * - a non-empty config → exactly those tables/columns; demo tables are not merged in.
 */
export function resolveAllowlist(config?: AllowlistConfig | null): ResolvedAllowlist {
  if (config === undefined) {
    return {
      writableColumns: DEMO_WRITABLE_COLUMNS,
      touchTimestamps: DEMO_TOUCH_TIMESTAMP_COLUMNS
    };
  }
  if (config === null) {
    return EMPTY_ALLOWLIST;
  }
  // Code-supplied configs must pass the same validation and snapshotting as JSON.
  const parsed = parseAllowlistConfig(config);
  if (Object.keys(parsed.writableColumns).length === 0) {
    return EMPTY_ALLOWLIST;
  }
  return {
    writableColumns: normalizeColumns(parsed.writableColumns),
    touchTimestamps: parsed.touchTimestamps ?? Object.freeze(Object.create(null))
  };
}

export function isWritableColumn(
  table: string,
  field: string,
  config?: AllowlistConfig | null
): boolean {
  const columns = resolveAllowlist(config).writableColumns;
  return Object.hasOwn(columns, table) && columns[table]?.has(field) === true;
}

export function parseAllowlistConfig(raw: unknown): AllowlistConfig {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      'Allowlist config must be a JSON object with writableColumns. Refusing to open a writable surface (fail-closed).'
    );
  }
  const obj = raw as Record<string, unknown>;
  const writableRaw = obj.writableColumns ?? {};
  if (typeof writableRaw !== 'object' || Array.isArray(writableRaw)) {
    throw new Error('writableColumns must be an object of table → string[]. Fail-closed.');
  }
  const writableColumns: Record<string, readonly string[]> = Object.create(null);
  for (const [table, cols] of Object.entries(writableRaw as Record<string, unknown>)) {
    assertIdentifier(table, 'writableColumns table');
    if (!Array.isArray(cols)) {
      throw new Error(`writableColumns.${table} must be an array of column name strings. Fail-closed.`);
    }
    // Capture once before validating; caller-owned arrays/accessors must not be
    // re-read later and replace a validated name with an unchecked SQL fragment.
    const columnNames: unknown[] = Array.from(cols);
    for (const col of columnNames) {
      assertIdentifier(col, `writableColumns.${table} column`);
    }
    writableColumns[table] = Object.freeze(columnNames as string[]);
  }
  let touchTimestamps: Record<string, string> | undefined;
  const touchRaw = obj.touchTimestamps;
  if (touchRaw != null) {
    if (typeof touchRaw !== 'object' || Array.isArray(touchRaw)) {
      throw new Error('touchTimestamps must be an object of table → column name. Fail-closed.');
    }
    touchTimestamps = Object.create(null) as Record<string, string>;
    for (const [table, col] of Object.entries(touchRaw as Record<string, unknown>)) {
      assertIdentifier(table, 'touchTimestamps table');
      assertIdentifier(col, `touchTimestamps.${table} column`);
      touchTimestamps[table] = col;
    }
    Object.freeze(touchTimestamps);
  }
  return Object.freeze({ writableColumns: Object.freeze(writableColumns), touchTimestamps });
}

export function loadAllowlistConfig(filePath: string): AllowlistConfig {
  if (!existsSync(filePath)) {
    throw new Error(
      `Allowlist config not found: ${filePath}. Refusing to open a writable surface (fail-closed).`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Allowlist config is not valid JSON (${filePath}): ${detail}. Fail-closed.`);
  }
  return parseAllowlistConfig(parsed);
}
