import Decimal from 'decimal.js';

// ---------------------------------------------------------------------------
// Decimal safety strategy (documented per FASE 4 requirement).
//
// Chosen approach: **decimal.js**, not native JavaScript floating point.
// Rationale: Postgres `numeric` columns already round-trip as strings via
// node-postgres (see src/db/schema.ts), and the demo's money/quantity/factor
// values (up to 18 significant digits) exceed what a naive `number` can carry
// without silent precision loss during multiplication/division chains
// (average cost, gross margin percentage). decimal.js operates on those
// strings directly and only converts to a fixed-precision decimal string at
// the boundary (schema output), never through a JS `number` in between.
//
// Precision: internal working precision is set high (40 significant digits)
// so intermediate division (e.g. average cost, gross margin %) does not
// truncate before final rounding. Values are only rounded to their column's
// documented scale when they cross the engine boundary (returned in a
// report, evidence item, or correction).
// ---------------------------------------------------------------------------

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Money = Decimal;

export const SCALE = {
  money: 2, // matches numeric(18,2) columns
  quantity: 3, // matches numeric(18,3) columns
  factor: 4, // matches numeric(12,4) columns
  percentage: 4 // matches numeric(7,4) columns
} as const;

/** Parse a Postgres numeric string (or number) into a Decimal. Never routes through JS number arithmetic. */
export function toDecimal(value: string | number | Decimal): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(value);
}

function round(value: Decimal, dp: number): Decimal {
  return value.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
}

/** Format a Decimal as a fixed-scale decimal string at an engine output boundary. */
export function formatMoney(value: Decimal): string {
  return round(value, SCALE.money).toFixed(SCALE.money);
}

export function formatQuantity(value: Decimal): string {
  return round(value, SCALE.quantity).toFixed(SCALE.quantity);
}

export function formatFactor(value: Decimal): string {
  return round(value, SCALE.factor).toFixed(SCALE.factor);
}

export function formatPercentage(value: Decimal): string {
  return round(value, SCALE.percentage).toFixed(SCALE.percentage);
}

/** Division with no throw on a zero denominator; callers decide the safe fallback and must record why via evidence. */
export function safeDiv(numerator: Decimal, denominator: Decimal, fallback: Decimal = new Decimal(0)): Decimal {
  if (denominator.isZero()) return fallback;
  return numerator.div(denominator);
}

export function isZero(value: Decimal): boolean {
  return value.isZero();
}

export const ZERO = new Decimal(0);

export { Decimal };
