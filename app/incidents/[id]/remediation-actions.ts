'use server';

import { revalidatePath } from 'next/cache';
import { getServerPool } from '../../../src/agent/server-pool';
import {
  createRemediationPlan,
  decideRemediationPlan,
  submitRemediationPlanForApproval
} from '../../../src/remediation/approve';
import { executeRemediationPlan } from '../../../src/remediation/execute';
import { incidentUiAuthority } from '../../../src/remediation/trusted-authority';
import { ApprovalRequiredError, PolicyDeniedError } from '@ledgerguard/policy';
import { NoRemediableIncidentError } from '../../../src/remediation/generate-plan';
import {
  InvalidTransitionError,
  OptimisticConcurrencyError,
  RemediationPlanNotFoundError,
  type ApprovalAction
} from '../../../src/remediation/types';
import { writebackRemediationResolution } from '../../../src/remediation/writeback';
import { assertDemoMode } from '../../../src/ui/lib/demo-mode';

export type RemediationActionResult =
  | { ok: true; planId: string; state: string; version: number; message?: string }
  | { ok: false; error: string; code?: string };

function mapError(error: unknown): RemediationActionResult {
  if (error instanceof NoRemediableIncidentError) {
    return { ok: false, error: error.message, code: 'NO_REMEDIABLE_INCIDENT' };
  }
  if (error instanceof OptimisticConcurrencyError) {
    return {
      ok: false,
      error: 'This plan changed while you were working. Refresh the page and try again with the latest version.',
      code: 'OPTIMISTIC_CONCURRENCY'
    };
  }
  if (error instanceof InvalidTransitionError) {
    return {
      ok: false,
      error: `Invalid transition from ${error.from} to ${error.to}. Refresh to see the current plan state.`,
      code: 'INVALID_TRANSITION'
    };
  }
  if (error instanceof RemediationPlanNotFoundError) {
    return { ok: false, error: `Remediation plan not found: ${error.planId}`, code: 'NOT_FOUND' };
  }
  if (error instanceof PolicyDeniedError) {
    return { ok: false, error: error.message, code: 'POLICY_DENIED' };
  }
  if (error instanceof ApprovalRequiredError) {
    return { ok: false, error: error.message, code: 'APPROVAL_REQUIRED' };
  }
  const message = error instanceof Error ? error.message : 'Remediation action failed';
  return { ok: false, error: message, code: 'UNKNOWN' };
}

function revalidateIncident(investigationId: string) {
  revalidatePath(`/incidents/${investigationId}`);
  revalidatePath('/incidents');
  revalidatePath('/overview');
}

export async function generateRemediationPlanAction(input: {
  investigationId: string;
}): Promise<RemediationActionResult> {
  try {
    assertDemoMode('Generate remediation plan');
    const pool = getServerPool();
    const plan = await createRemediationPlan(
      { investigationId: input.investigationId, requestedBy: 'incident-ui' },
      { pool, authority: incidentUiAuthority() }
    );
    revalidateIncident(input.investigationId);
    return {
      ok: true,
      planId: plan.id,
      state: plan.state,
      version: plan.version,
      message: 'Remediation plan generated in DRAFT.'
    };
  } catch (error) {
    return mapError(error);
  }
}

export async function submitRemediationPlanAction(input: {
  investigationId: string;
  planId: string;
  expectedVersion: number;
}): Promise<RemediationActionResult> {
  try {
    assertDemoMode('Submit remediation plan');
    const plan = await submitRemediationPlanForApproval(getServerPool(), {
      planId: input.planId,
      expectedVersion: input.expectedVersion
    });
    revalidateIncident(input.investigationId);
    return { ok: true, planId: plan.id, state: plan.state, version: plan.version };
  } catch (error) {
    return mapError(error);
  }
}

export async function decideRemediationPlanAction(input: {
  investigationId: string;
  planId: string;
  expectedVersion: number;
  action: ApprovalAction;
  note?: string;
}): Promise<RemediationActionResult> {
  try {
    assertDemoMode('Decide remediation plan');
    const plan = await decideRemediationPlan(
      getServerPool(),
      {
        planId: input.planId,
        expectedVersion: input.expectedVersion,
        action: input.action,
        decidedBy: 'incident-ui',
        note: input.note ?? null
      },
      { authority: incidentUiAuthority() }
    );
    revalidateIncident(input.investigationId);
    return { ok: true, planId: plan.id, state: plan.state, version: plan.version };
  } catch (error) {
    return mapError(error);
  }
}

export async function executeRemediationPlanAction(input: {
  investigationId: string;
  planId: string;
  expectedVersion: number;
}): Promise<RemediationActionResult> {
  try {
    assertDemoMode('Execute remediation plan');
    const executed = await executeRemediationPlan(
      { planId: input.planId, expectedVersion: input.expectedVersion },
      { pool: getServerPool(), authority: incidentUiAuthority() }
    );
    let plan = executed.plan;

    if (executed.outcome === 'ALREADY_EXECUTED') {
      revalidateIncident(input.investigationId);
      return {
        ok: true,
        planId: plan.id,
        state: plan.state,
        version: plan.version,
        message: 'This approved execution was already completed. No additional mutation was applied.'
      };
    }

    if (executed.outcome === 'INTERRUPTED') {
      revalidateIncident(input.investigationId);
      return {
        ok: true,
        planId: plan.id,
        state: plan.state,
        version: plan.version,
        message:
          'A previous execution reservation expired before the mutation committed. The plan is interrupted and may be retried with the original approval. No additional mutation was applied.'
      };
    }

    if (executed.outcome === 'RECOVERY_REQUIRED') {
      revalidateIncident(input.investigationId);
      return {
        ok: false,
        error:
          'A previous execution left an ambiguous reserved key. LedgerGuard refused to mutate. Inspect the system of record and retry after recovery.',
        code: 'RECOVERY_REQUIRED'
      };
    }

    // Best-effort DataHub sync immediately after a verified ERP restore so the
    // Resolution tab does not stay on "Not attempted" when GMS/MCP is healthy.
    if (plan.state === 'RESOLVED' && !plan.datahubWriteback) {
      plan = await writebackRemediationResolution({ planId: plan.id }, { pool: getServerPool() });
    }

    revalidateIncident(input.investigationId);
    const writeback = plan.datahubWriteback?.outcome;
    if (plan.state === 'RESOLVED' && writeback === 'SYNCED') {
      return {
        ok: true,
        planId: plan.id,
        state: plan.state,
        version: plan.version,
        message: 'Corrections applied and verified. ERP restored; DataHub metadata synced.'
      };
    }
    if (plan.state === 'RESOLVED' && writeback === 'FAILED') {
      return {
        ok: true,
        planId: plan.id,
        state: plan.state,
        version: plan.version,
        message:
          'Corrections applied and verified. ERP restored, but DataHub write-back failed — use Retry DataHub write-back.'
      };
    }
    return {
      ok: true,
      planId: plan.id,
      state: plan.state,
      version: plan.version,
      message:
        plan.state === 'RESOLVED'
          ? 'Corrections applied and verified. ERP data is restored.'
          : `Execution finished in state ${plan.state}.`
    };
  } catch (error) {
    return mapError(error);
  }
}

export async function writebackRemediationResolutionAction(input: {
  investigationId: string;
  planId: string;
}): Promise<RemediationActionResult> {
  try {
    assertDemoMode('DataHub resolution write-back');
    const plan = await writebackRemediationResolution(
      { planId: input.planId },
      { pool: getServerPool() }
    );
    revalidateIncident(input.investigationId);
    const outcome = plan.datahubWriteback?.outcome ?? 'FAILED';
    if (outcome === 'SYNCED') {
      return {
        ok: true,
        planId: plan.id,
        state: plan.state,
        version: plan.version,
        message: 'DataHub write-back synced (At Risk removed, Trusted added).'
      };
    }
    return {
      ok: false,
      error:
        plan.datahubWriteback?.message ??
        'DataHub write-back failed; ERP remediation remains RESOLVED.',
      code: 'WRITEBACK_FAILED'
    };
  } catch (error) {
    return mapError(error);
  }
}
