import { describe, expect, it } from 'vitest';
import {
  formatDecimalDisplay,
  formatIdrDisplay,
  formatPercentDisplay
} from '../../../src/ui/lib/format-display';

describe('formatIdrDisplay', () => {
  it('formats engine decimal strings without inventing new totals', () => {
    expect(formatIdrDisplay('28800000.00')).toBe('Rp 28.800.000,00');
    expect(formatIdrDisplay('-14400000.00')).toBe('-Rp 14.400.000,00');
  });

  it('rounds money and percentages to at most two decimals', () => {
    expect(formatIdrDisplay('28800000.005')).toBe('Rp 28.800.000,01');
    expect(formatPercentDisplay('33.3333')).toBe('33,33%');
    expect(formatDecimalDisplay('12.345')).toBe('12,35');
    expect(formatDecimalDisplay('12.344')).toBe('12,34');
  });
});
