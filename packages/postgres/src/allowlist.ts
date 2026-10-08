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

function freezeColumnMap(input: Record<string, ReadonlySet<string>>): WritableColumnMap {
  return Object.freeze(input);
}

function normalizeColumns(
  input?: Readonly<Record<string, readonly string[] | ReadonlySet<string>>>
): WritableColumnMap {
  if (!input) return Object.freeze({});
  const out: Record<string, ReadonlySet<string>> = {};
  for (const [table, cols] of Object.entries(input)) {
    out[table] = cols instanceof Set ? cols : new Set(cols);
  }
  return freezeColumnMap(out);
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
  if (config === null || Object.keys(config.writableColumns ?? {}).length === 0) {
    return EMPTY_ALLOWLIST;
  }
  return {
    writableColumns: normalizeColumns(config.writableColumns),
    touchTimestamps: Object.freeze({ ...(config.touchTimestamps ?? {}) })
  };
}

export function isWritableColumn(
  table: string,
  field: string,
  config?: AllowlistConfig | null
): boolean {
  return resolveAllowlist(config).writableColumns[table]?.has(field) === true;
}

export function parseAllowlistConfig(raw: unknown): AllowlistConfig {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      'Allowlist config must be a JSON object with writableColumns. Refusing to open a writable surface (fail-closed).'
    );
  }
  const obj = raw as Record<string, unknown>;
  const writableRaw = obj.writableColumns;
  if (writableRaw == null) {
    return { writableColumns: {} };
  }
  if (typeof writableRaw !== 'object' || Array.isArray(writableRaw)) {
    throw new Error('writableColumns must be an object of table → string[]. Fail-closed.');
  }
  const writableColumns: Record<string, string[]> = {};
  for (const [table, cols] of Object.entries(writableRaw as Record<string, unknown>)) {
    if (!Array.isArray(cols) || cols.some((col) => typeof col !== 'string' || col.length === 0)) {
      throw new Error(`writableColumns.${table} must be a non-empty array of column name strings. Fail-closed.`);
    }
    writableColumns[table] = cols as string[];
  }
  let touchTimestamps: Record<string, string> | undefined;
  if (obj.touchTimestamps != null) {
    if (typeof obj.touchTimestamps !== 'object' || Array.isArray(obj.touchTimestamps)) {
      throw new Error('touchTimestamps must be an object of table → column name. Fail-closed.');
    }
    touchTimestamps = {};
    for (const [table, col] of Object.entries(obj.touchTimestamps as Record<string, unknown>)) {
      if (typeof col !== 'string' || col.length === 0) {
        throw new Error(`touchTimestamps.${table} must be a column name string. Fail-closed.`);
      }
      touchTimestamps[table] = col;
    }
  }
  return { writableColumns, touchTimestamps };
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
