/**
 * Display-only formatters. Do not use for financial arithmetic.
 * Decimal money/quantity strings from the engine are formatted by splitting
 * the string — never by recomputing exposure.
 */

export function formatIdrDisplay(decimalString: string): string {
  const raw = String(decimalString ?? '').trim();
  if (!raw) return 'Rp —';

  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [intPartRaw, fracRaw = '00'] = unsigned.split('.');
  const intPart = intPartRaw.replace(/\D/g, '') || '0';
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const frac = (fracRaw.replace(/\D/g, '') + '00').slice(0, 2);
  return `${negative ? '-' : ''}Rp ${grouped},${frac}`;
}

export function formatDecimalDisplay(decimalString: string, fractionDigits = 4): string {
  const raw = String(decimalString ?? '').trim();
  if (!raw) return '—';
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [intPartRaw, fracRaw = ''] = unsigned.split('.');
  const intPart = intPartRaw.replace(/\D/g, '') || '0';
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (fractionDigits <= 0) return `${negative ? '-' : ''}${grouped}`;
  const frac = (fracRaw.replace(/\D/g, '') + '0'.repeat(fractionDigits)).slice(0, fractionDigits);
  return `${negative ? '-' : ''}${grouped},${frac}`;
}

export function formatPercentDisplay(decimalString: string): string {
  return `${formatDecimalDisplay(decimalString, 4)}%`;
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
