import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('demo controls guards', () => {
  const source = readFileSync(resolve(process.cwd(), 'app/overview/demo-controls.tsx'), 'utf8');
  const actions = readFileSync(resolve(process.cwd(), 'app/overview/actions.ts'), 'utf8');

  it('prevents double-click by disabling while a pending action is in flight', () => {
    expect(source).toContain("pendingAction !== null");
    expect(source).toContain('disabled={Boolean(simulateDisabledReason) || busy}');
    expect(source).toContain('disabled={Boolean(resetDisabledReason) || busy}');
    expect(source).toContain("setPendingAction('simulate')");
  });

  it('does not mark simulate success before backend redirect', () => {
    expect(source).not.toContain('Simulate succeeded');
    expect(actions).toContain('redirect(`/incidents/${record.investigationId}`)');
    expect(actions).toContain('applyConversionError');
    expect(actions).toContain('runInvestigation');
  });

  it('reset uses existing seed path and blocks EXECUTING/VERIFYING', () => {
    expect(actions).toContain('seedDatabase');
    expect(actions).toContain('hasBlockingRemediationPlan');
    expect(actions).toContain('assertDemoMode');
  });
});
