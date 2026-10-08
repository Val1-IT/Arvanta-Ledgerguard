import type { ActivityLogEntry, FailureState, InvestigationRunRecord } from './types';
import type { RemediationExecutionResult, RemediationPlanRecord, RemediationWritebackResult } from '../remediation/types';

type SafeErrorCode = FailureState | 'TOOL_FAILED' | 'BACKEND_UNAVAILABLE'
  | 'DEMO_MODE_DISABLED' | 'DEMO_ACTION_FAILED'
  | 'REMEDIATION_WRITEBACK_FAILED' | 'DATAHUB_NOT_CONFIGURED'
  | 'REMEDIATION_ACTION_FAILED' | 'REMEDIATION_SQL_ERROR'
  | 'NO_REMEDIABLE_INCIDENT' | 'OPTIMISTIC_CONCURRENCY' | 'INVALID_TRANSITION'
  | 'REMEDIATION_PLAN_NOT_FOUND' | 'POLICY_DENIED' | 'APPROVAL_REQUIRED';

const SAFE_ERROR_MESSAGES: Record<SafeErrorCode, string> = {
  DEMO_MODE_DISABLED: 'Demo actions are disabled because DEMO_MODE is not exactly "true".',
  DEMO_ACTION_FAILED: 'The demo action failed. Check the server configuration and backend connections.',
  REMEDIATION_WRITEBACK_FAILED: 'DataHub write-back failed. Check the catalog connection and retry DataHub write-back; ERP remediation remains RESOLVED.',
  DATAHUB_NOT_CONFIGURED: 'DataHub is not configured; system-of-record verification is unchanged.',
  REMEDIATION_ACTION_FAILED: 'The remediation action failed. Refresh the page and check the server configuration and backend connections.',
  REMEDIATION_SQL_ERROR: 'The remediation database operation failed. Check the database connection and review the plan before retrying.',
  NO_REMEDIABLE_INCIDENT: 'No remediable incident was found in the current data. Re-investigate before generating a new plan.',
  OPTIMISTIC_CONCURRENCY: 'This plan changed while you were working. Refresh the page and try again with the latest version.',
  INVALID_TRANSITION: 'The requested plan transition is not allowed. Refresh to see the current plan state.',
  REMEDIATION_PLAN_NOT_FOUND: 'The remediation plan was not found. Refresh the incident before trying again.',
  POLICY_DENIED: 'Remediation was denied by policy. Review the plan and policy requirements before retrying.',
  APPROVAL_REQUIRED: 'Human approval is required before remediation can continue. Review and approve the current plan.',
  MCP_UNAVAILABLE: 'Catalog context is unavailable. Check the catalog connection.',
  DATASET_NOT_FOUND: 'The requested dataset was not found in the catalog.',
  LINEAGE_INCOMPLETE: 'The catalog does not provide sufficient lineage for this investigation.',
  ENGINE_FAILED: 'Deterministic analysis failed. Check the investigation data and database connection.',
  MODEL_OUTPUT_INVALID: 'Model analysis failed or its output could not be validated against the evidence.',
  EVIDENCE_INSUFFICIENT: 'There is insufficient evidence to complete the investigation. Review the missing evidence.',
  WRITEBACK_FAILED: 'The investigation note could not be published to the catalog. Check the catalog connection.',
  TOOL_FAILED: 'Tool call failed. Upstream diagnostic details [redacted].',
  BACKEND_UNAVAILABLE: 'Backend unavailable. Check the server configuration and database connection.'
};

// Exceptions can contain credentials, connection URLs, response bodies and
// arbitrary short secrets. Pattern matching cannot reliably identify them.
// Only application-owned messages may cross the persistence/display boundary;
// failure state, tool name and timing retain the useful operational context.
export function formatSafeError(code: SafeErrorCode): string {
  return SAFE_ERROR_MESSAGES[code];
}

export function sanitizeActivityError(entry: ActivityLogEntry): ActivityLogEntry {
  return {
    ...entry,
    outputSummary: entry.status === 'ERROR' ? '' : entry.outputSummary,
    errorSanitized: entry.status === 'ERROR' ? formatSafeError('TOOL_FAILED') : null
  };
}

export function sanitizeInvestigationErrors(record: InvestigationRunRecord): InvestigationRunRecord {
  return {
    ...record,
    error: record.error ? { ...record.error, message: formatSafeError(record.error.failureState) } : null,
    output: record.output ? { ...record.output, activityLog: record.output.activityLog.map(sanitizeActivityError) } : null
  };
}


export function sanitizeRemediationWriteback(result: RemediationWritebackResult): RemediationWritebackResult {
  return {
    ...result,
    message: result.outcome === 'SYNCED' ? null : formatSafeError(
      result.outcome === 'NOT_CONFIGURED' ? 'DATAHUB_NOT_CONFIGURED' : 'REMEDIATION_WRITEBACK_FAILED'
    )
  };
}

export function sanitizeRemediationExecutionErrors(result: RemediationExecutionResult): RemediationExecutionResult {
  return {
    ...result,
    // SQL_ERROR is the path populated from a caught upstream exception.
    // Drift, validation and verification details are deterministic evidence.
    failureDetail: result.failureReason === 'SQL_ERROR' ? formatSafeError('REMEDIATION_SQL_ERROR') : result.failureDetail,
    steps: result.steps.map((step) => step.status === 'FAILED'
      ? { ...step, detail: formatSafeError('REMEDIATION_SQL_ERROR') }
      : step)
  };
}

export function sanitizeRemediationErrors(plan: RemediationPlanRecord): RemediationPlanRecord {
  return {
    ...plan,
    executionResult: plan.executionResult ? sanitizeRemediationExecutionErrors(plan.executionResult) : null,
    datahubWriteback: plan.datahubWriteback ? sanitizeRemediationWriteback(plan.datahubWriteback) : null
  };
}
