'use server';

import { redirect } from 'next/navigation';
import { runInvestigation } from '../../src/agent/orchestrator';
import { AnthropicInvestigationModel } from '../../src/agent/model-anthropic';
import { DeterministicTestModel } from '../../src/agent/model-test';
import type { InvestigationModel } from '../../src/agent/model';
import { getServerPool } from '../../src/agent/server-pool';
import { applyConversionError } from '../../demo-data/scenarios/conversion-error';
import { seedDatabase } from '../../src/db/seed';
import { assertDemoMode } from '../../src/ui/lib/demo-mode';
import { persistDemoCompletedInvestigation } from '../../src/ui/server/demo-incident';
import { hasBlockingRemediationPlan } from '../../src/ui/server/queries';

function pickModel(): InvestigationModel {
  return process.env.ANTHROPIC_API_KEY ? new AnthropicInvestigationModel() : new DeterministicTestModel();
}

function isMcpUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('digest' in error) return false;
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  return (
    name.includes('DataHub') ||
    /MCP_UNAVAILABLE|DataHub|bridge|ECONNREFUSED|spawn/i.test(message)
  );
}

export type DemoActionResult =
  | { ok: true; investigationId?: string }
  | { ok: false; error: string };

/**
 * Simulate Conversion Error — thin UI wrapper around existing scenario + investigation.
 * If the full agent cannot finish (MCP unavailable), falls back to a demo engine-backed
 * completed investigation so the remediation UI path remains usable offline.
 */
export async function simulateConversionErrorAction(): Promise<DemoActionResult> {
  try {
    assertDemoMode('Simulate Conversion Error');
    const pool = getServerPool();
    await applyConversionError(pool);

    const incidentId = `incident-ui-${Date.now()}`;
    try {
      const record = await runInvestigation(
        {
          incidentId,
          productId: 'prod-cement-40',
          triggerAsset: 'inventory_valuation',
          requestedBy: 'overview-ui',
          mode: 'TEST'
        },
        { pool, model: pickModel() }
      );

      if (record.finalState === 'INVESTIGATION_COMPLETED' && record.output) {
        redirect(`/incidents/${record.investigationId}`);
      }

      // Agent finished in a failure state — still open the run for inspection.
      if (isMcpUnavailable(record.error) || record.finalState === 'MCP_UNAVAILABLE') {
        const fallback = await persistDemoCompletedInvestigation(pool, {
          incidentId,
          requestedBy: 'overview-ui-demo-fallback'
        });
        redirect(`/incidents/${fallback.investigationId}`);
      }

      redirect(`/incidents/${record.investigationId}`);
    } catch (error) {
      if (error && typeof error === 'object' && 'digest' in error) {
        throw error;
      }
      if (isMcpUnavailable(error)) {
        const fallback = await persistDemoCompletedInvestigation(pool, {
          incidentId,
          requestedBy: 'overview-ui-demo-fallback'
        });
        redirect(`/incidents/${fallback.investigationId}`);
      }
      throw error;
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) {
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Simulate failed';
    return { ok: false, error: message };
  }
}

/**
 * Reset Demo — thin wrapper around existing seed/reset. Does not rewrite reset logic.
 */
export async function resetDemoAction(): Promise<DemoActionResult> {
  try {
    assertDemoMode('Reset Demo');
    const pool = getServerPool();
    if (await hasBlockingRemediationPlan(pool)) {
      return {
        ok: false,
        error: 'Reset is disabled while a remediation plan is EXECUTING or VERIFYING.'
      };
    }
    await seedDatabase(pool);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Reset failed';
    return { ok: false, error: message };
  }
}
