import { describe, expect, it } from 'vitest';
import { investigate, sourceStateFingerprint } from '@ledgerguard/core';
import { duplicateIncidentInput } from './duplicate-fixtures';

describe('sourceStateFingerprint', () => {
  it('is stable for the same approved correction set regardless of array order', () => {
    const corrections = investigate(duplicateIncidentInput()).proposedCorrections;
    const reversed = [...corrections].reverse();
    expect(sourceStateFingerprint(corrections)).toBe(sourceStateFingerprint(reversed));
    expect(sourceStateFingerprint(corrections)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes when an approved after-value changes', () => {
    const corrections = investigate(duplicateIncidentInput()).proposedCorrections;
    const tampered = corrections.map((correction, index) =>
      index === 0 ? { ...correction, afterValue: 'tampered' } : correction
    );
    expect(sourceStateFingerprint(tampered)).not.toBe(sourceStateFingerprint(corrections));
  });
});
