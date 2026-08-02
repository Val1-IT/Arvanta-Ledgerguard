/**
 * Display-only formatters. Do not use for financial arithmetic.
 * Values are rounded to at most 2 decimal places for presentation.
 */

import Decimal from 'decimal.js';

function toRoundedParts(decimalString: string, fractionDigits: number): {
  negative: boolean;
  intGrouped: string;
  frac: string;
} | null {
  const raw = String(decimalString ?? '').trim();
  if (!raw) return null;

  let value: Decimal;
  try {
    value = new Decimal(raw);
  } catch {
    return null;
  }
  if (!value.isFinite()) return null;

  const fixed = value.toFixed(Math.max(0, fractionDigits), Decimal.ROUND_HALF_UP);
  const negative = fixed.startsWith('-');
  const unsigned = negative ? fixed.slice(1) : fixed;
  const [intPartRaw, fracRaw = ''] = unsigned.split('.');
  const intPart = intPartRaw.replace(/\D/g, '') || '0';
  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const frac =
    fractionDigits > 0 ? (fracRaw.replace(/\D/g, '') + '0'.repeat(fractionDigits)).slice(0, fractionDigits) : '';

  return { negative, intGrouped, frac };
}

export function formatIdrDisplay(decimalString: string): string {
  const parts = toRoundedParts(decimalString, 2);
  if (!parts) return 'Rp —';
  return `${parts.negative ? '-' : ''}Rp ${parts.intGrouped},${parts.frac}`;
}

export function formatDecimalDisplay(decimalString: string, fractionDigits = 2): string {
  const raw = String(decimalString ?? '').trim();
  const parts = toRoundedParts(raw, fractionDigits);
  // Keep non-numeric display values as-is (IDs / labels accidentally passed in).
  if (!parts) return raw || '—';
  if (fractionDigits <= 0) return `${parts.negative ? '-' : ''}${parts.intGrouped}`;
  return `${parts.negative ? '-' : ''}${parts.intGrouped},${parts.frac}`;
}

export function formatPercentDisplay(decimalString: string): string {
  return `${formatDecimalDisplay(decimalString, 2)}%`;
}

export function formatIsoDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short'
  }).format(date);
}
