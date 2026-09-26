import { describe, expect, it } from 'vitest';
import { classifyStaleReservation, investigate } from '@ledgerguard/core';
import { duplicateIncidentInput } from './duplicate-fixtures';

function repairedDuplicate() {
  const snapshot = duplicateIncidentInput();
  snapshot.movements = snapshot.movements.map((movement) =>
    movement.id === 'MOV-002' ? { ...movement, reversedAt: new Date('2026-03-02T16:00:00.000Z') } : movement
  );
  snapshot.valuations = snapshot.valuations.map((row) => ({
    ...row,
    quantityOnHand: '10.000',
    inventoryValue: '850000.00'
  }));
  return snapshot;
}

describe('classifyStaleReservation', () => {
  it('treats an unchanged duplicate incident as not_applied', () => {
    const snapshot = duplicateIncidentInput();
    const report = investigate(snapshot);
    expect(
      classifyStaleReservation({
        snapshot,
        approvedCorrections: report.proposedCorrections,
        verificationExpectations: report.verificationExpectations
      })
    ).toBe('not_applied');
  });

  it('requires verification PASS, expectations, and applied after-values before calling a repair applied', () => {
    const original = duplicateIncidentInput();
    const report = investigate(original);
    expect(
      classifyStaleReservation({
        snapshot: repairedDuplicate(),
        approvedCorrections: report.proposedCorrections,
        verificationExpectations: report.verificationExpectations
      })
    ).toBe('applied');
  });

  it('does not treat a vanished incident as applied when postconditions fail', () => {
    const original = duplicateIncidentInput();
    const report = investigate(original);
    const partial = duplicateIncidentInput();
    partial.movements = partial.movements.map((movement) =>
      movement.id === 'MOV-002' ? { ...movement, reversedAt: new Date('2026-03-02T16:00:00.000Z') } : movement
    );
    expect(
      classifyStaleReservation({
        snapshot: partial,
        approvedCorrections: report.proposedCorrections,
        verificationExpectations: report.verificationExpectations
      })
    ).toBe('ambiguous');
  });

  it('treats unrelated live drift as ambiguous rather than silently completing', () => {
    const snapshot = duplicateIncidentInput();
    snapshot.movements = snapshot.movements.map((movement) =>
      movement.id === 'MOV-002' ? { ...movement, id: 'MOV-009' } : movement
    );
    const report = investigate(duplicateIncidentInput());
    expect(
      classifyStaleReservation({
        snapshot,
        approvedCorrections: report.proposedCorrections,
        verificationExpectations: report.verificationExpectations
      })
    ).toBe('ambiguous');
  });
});
