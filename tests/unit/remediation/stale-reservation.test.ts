import { describe, expect, it } from 'vitest';
import { isRecoveryTransitionAllowed, isTransitionAllowed } from '../../../src/remediation/types';

describe('stale reservation recovery transitions', () => {
  it('does not use the fresh APPROVED→EXECUTING path to reconcile in-flight plans', () => {
    expect(isTransitionAllowed('VERIFYING', 'EXECUTING')).toBe(false);
    expect(isRecoveryTransitionAllowed('VERIFYING', 'RESOLVED')).toBe(true);
  });
});
