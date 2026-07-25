import { describe, expect, it } from 'vitest';
import { formatIdrDisplay, formatPercentDisplay } from '../../../src/ui/lib/format-display';

describe('formatIdrDisplay', () => {
  it('formats engine decimal strings without inventing new totals', () => {
    expect(formatIdrDisplay('28800000.00')).toBe('Rp 28.800.000,00');
    expect(formatIdrDisplay('-14400000.00')).toBe('-Rp 14.400.000,00');
  });

  it('formats percentages for display only', () => {
    expect(formatPercentDisplay('13.3333')).toBe('13,3333%');
  });
});
