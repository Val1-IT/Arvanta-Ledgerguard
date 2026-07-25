import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('remediation action UI guards', () => {
  const actions = readFileSync(resolve(process.cwd(), 'app/incidents/[id]/remediation-actions.ts'), 'utf8');
  const controls = readFileSync(resolve(process.cwd(), 'app/incidents/[id]/remediation-controls.tsx'), 'utf8');

  it('wraps existing remediation workflow functions without reimplementing the state machine', () => {
    expect(actions).toContain('createRemediationPlan');
    expect(actions).toContain('submitRemediationPlanForApproval');
    expect(actions).toContain('decideRemediationPlan');
    expect(actions).toContain('executeRemediationPlan');
    expect(actions).toContain('writebackRemediationResolution');
    expect(actions).toContain('assertDemoMode');
    expect(actions).toContain('OptimisticConcurrencyError');
    expect(actions).toContain('NoRemediableIncidentError');
  });

  it('exposes distinct Approve, Reject, and Keep reports frozen controls', () => {
    expect(controls).toContain("action: 'APPROVE'");
    expect(controls).toContain("action: 'REJECT'");
    expect(controls).toContain("action: 'KEEP_REPORTS_FROZEN'");
    expect(controls).toContain('Keep reports frozen');
    expect(controls).toContain('disabled={busy}');
  });

  it('passes expectedVersion for optimistic concurrency on mutating calls', () => {
    expect(controls).toContain('expectedVersion');
    expect(actions).toContain('expectedVersion: input.expectedVersion');
  });
});
