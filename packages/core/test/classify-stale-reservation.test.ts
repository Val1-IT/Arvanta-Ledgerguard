import { describe, expect, it } from 'vitest';
import { classifyStaleReservation, investigate } from '@ledgerguard/core';
import { duplicateIncidentInput } from './duplicate-fixtures';

describe('classifyStaleReservation', () => {
  it('treats an unchanged duplicate incident as not_applied', () => {
    const snapshot = duplicateIncidentInput();
    const approved = investigate(snapshot).proposedCorrections;
    expect(classifyStaleReservation({ snapshot, approvedCorrections: approved })).toBe('not_applied');
  });

  it('treats a fully repaired ledger with no remaining incident as applied', () => {
    const snapshot = duplicateIncidentInput();
    snapshot.movements = snapshot.movements.map((movement) =>
      movement.id === 'MOV-002' ? { ...movement, reversedAt: new Date('2026-03-02T16:00:00.000Z') } : movement
    );
    snapshot.valuations = snapshot.valuations.map((row) => ({
      ...row,
      quantityOnHand: '10.000',
      inventoryValue: '850000.00'
    }));
    const approved = investigate(duplicateIncidentInput()).proposedCorrections;
    expect(classifyStaleReservation({ snapshot, approvedCorrections: approved })).toBe('applied');
  });

  it('treats unrelated live drift as ambiguous rather than silently completing', () => {
    const snapshot = duplicateIncidentInput();
    snapshot.movements = snapshot.movements.map((movement) =>
      movement.id === 'MOV-002' ? { ...movement, id: 'MOV-009' } : movement
    );
    const approved = investigate(duplicateIncidentInput()).proposedCorrections;
    expect(classifyStaleReservation({ snapshot, approvedCorrections: approved })).toBe('ambiguous');
  });
});
