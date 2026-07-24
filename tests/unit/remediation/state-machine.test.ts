import { describe, expect, it } from 'vitest';
import { ALLOWED_TRANSITIONS, RemediationPlanStateSchema, TERMINAL_STATES, isTransitionAllowed } from '../../../src/remediation/types';

// ---------------------------------------------------------------------------
// FASE 6 test checklist item 1/14 — pure state-machine logic, no I/O. Every
// other FASE 6 test item exercises this machine indirectly through a real
// Postgres-backed workflow (tests/integration/remediation.test.ts) or a live
// DataHub write-back (tests/datahub/remediation-resolve.test.ts); this file
// is the one place the transition table itself is checked exhaustively.
// ---------------------------------------------------------------------------

const ALL_STATES = RemediationPlanStateSchema.options;

describe('remediation plan state machine — exhaustive transition matrix', () => {
  it('allows exactly the documented edges and rejects every other (from, to) pair', () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const expected = ALLOWED_TRANSITIONS[from].includes(to);
        expect(isTransitionAllowed(from, to)).toBe(expected);
      }
    }
  });

  it('every terminal state has zero outgoing transitions', () => {
    for (const state of TERMINAL_STATES) {
      expect(ALLOWED_TRANSITIONS[state]).toEqual([]);
    }
  });

  it('every non-terminal state has at least one outgoing transition', () => {
    for (const state of ALL_STATES) {
      if (TERMINAL_STATES.has(state)) continue;
      expect(ALLOWED_TRANSITIONS[state].length).toBeGreaterThan(0);
    }
  });

  it('no state can transition to itself (RESOLVED->RESOLVED write-back patch is a documented bypass, not a table entry)', () => {
    for (const state of ALL_STATES) {
      expect(ALLOWED_TRANSITIONS[state]).not.toContain(state);
    }
  });

  it('the happy path DRAFT->PENDING_APPROVAL->APPROVED->EXECUTING->VERIFYING->RESOLVED is fully connected', () => {
    const path: (typeof ALL_STATES)[number][] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'VERIFYING', 'RESOLVED'];
    for (let i = 0; i < path.length - 1; i++) {
      expect(isTransitionAllowed(path[i], path[i + 1])).toBe(true);
    }
  });

  it('rejection paths PENDING_APPROVAL->REJECTED and both failure exits are reachable', () => {
    expect(isTransitionAllowed('PENDING_APPROVAL', 'REJECTED')).toBe(true);
    expect(isTransitionAllowed('EXECUTING', 'EXECUTION_FAILED')).toBe(true);
    expect(isTransitionAllowed('VERIFYING', 'VERIFICATION_FAILED')).toBe(true);
  });
});
