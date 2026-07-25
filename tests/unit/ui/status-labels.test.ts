import { describe, expect, it } from 'vitest';
import {
  labelApprovalAction,
  labelPlanState,
  labelVerification,
  labelWriteback
} from '../../../src/ui/lib/status-labels';

describe('status labels', () => {
  it('maps plan and approval enums to friendly labels', () => {
    expect(labelPlanState('PENDING_APPROVAL')).toBe('Pending approval');
    expect(labelApprovalAction('KEEP_REPORTS_FROZEN')).toBe('Keep reports frozen');
    expect(labelVerification('PASS')).toBe('Pass');
    expect(labelWriteback('FAILED')).toBe('Failed');
  });
});
