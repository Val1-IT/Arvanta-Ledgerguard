import { describe, expect, it } from 'vitest';
import {
  humanizeToken,
  labelApprovalAction,
  labelCorrectionAction,
  labelInvestigationState,
  labelLineageStep,
  labelNextStep,
  labelPlanState,
  labelVerification,
  labelWriteback
} from '../../../src/ui/lib/status-labels';

describe('status labels', () => {
  it('maps plan and approval enums to friendly labels', () => {
    expect(labelPlanState('PENDING_APPROVAL')).toBe('Pending approval');
    expect(labelApprovalAction('KEEP_REPORTS_FROZEN')).toBe('Keep reports frozen');
    expect(labelVerification('PASS')).toBe('Passed');
    expect(labelWriteback('FAILED')).toBe('Failed');
    expect(labelInvestigationState('INVESTIGATION_COMPLETED')).toBe('Investigation completed');
    expect(labelNextStep('REQUEST_APPROVAL')).toBe('Request approval');
    expect(labelCorrectionAction('RESTORE_CONVERSION_FACTOR')).toBe('Restore conversion factor');
    expect(labelLineageStep('product_units.conversion_factor')).toBe('Product units · Conversion factor');
    expect(humanizeToken('SOME_RAW_TOKEN')).toBe('Some Raw Token');
  });
});
