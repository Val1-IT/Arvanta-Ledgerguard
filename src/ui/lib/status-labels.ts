/**
 * Friendly display labels for backend enums / tokens.
 * Raw SCREAMING_SNAKE values stay in data; UI should prefer these helpers.
 */

const PLAN_STATE_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  EXECUTING: 'Executing',
  VERIFYING: 'Verifying',
  EXECUTION_FAILED: 'Execution failed',
  VERIFICATION_FAILED: 'Verification failed',
  RESOLVED: 'Resolved',
  NO_PLAN: 'No plan',
  NONE: 'None'
};

const APPROVAL_LABELS: Record<string, string> = {
  APPROVE: 'Approved',
  REJECT: 'Rejected',
  KEEP_REPORTS_FROZEN: 'Keep reports frozen'
};

const WRITEBACK_LABELS: Record<string, string> = {
  SYNCED: 'Synced',
  FAILED: 'Failed',
  NOT_ATTEMPTED: 'Not attempted'
};

const VERIFICATION_LABELS: Record<string, string> = {
  PASS: 'Passed',
  FAIL: 'Failed',
  NOT_RUN: 'Not run'
};

const HEALTH_LABELS: Record<string, string> = {
  HEALTHY: 'Healthy',
  DEGRADED: 'Degraded',
  CRITICAL: 'Critical',
  UNKNOWN: 'Unknown'
};

const DATAHUB_STATUS_LABELS: Record<string, string> = {
  CONNECTED: 'Connected',
  UNAVAILABLE: 'Unavailable',
  NOT_CONFIGURED: 'Not configured'
};

const NEXT_STEP_LABELS: Record<string, string> = {
  REQUEST_APPROVAL: 'Request approval',
  ESCALATE_TO_OWNER: 'Escalate to owner',
  NO_ACTION_REQUIRED: 'No action required',
  COLLECT_MORE_EVIDENCE: 'Collect more evidence'
};

const INVESTIGATION_STATE_LABELS: Record<string, string> = {
  INVESTIGATION_COMPLETED: 'Investigation completed',
  MCP_UNAVAILABLE: 'DataHub unavailable',
  ENGINE_FAILED: 'Engine failed',
  MODEL_FAILED: 'Model failed',
  RECONCILIATION_FAILED: 'Reconciliation failed',
  EVIDENCE_INSUFFICIENT: 'Evidence insufficient',
  INVALID_MODEL_OUTPUT: 'Invalid model output',
  WRITEBACK_FAILED: 'Write-back failed',
  DATAHUB_ASSET_SEARCH: 'Searching DataHub assets',
  DATAHUB_SCHEMA_READ: 'Reading schema',
  DATAHUB_OWNER_READ: 'Reading owners',
  DATAHUB_GLOSSARY_READ: 'Reading glossary',
  DATAHUB_LINEAGE_TRAVERSED: 'Traversing lineage',
  ENGINE_ANALYSIS_COMPLETED: 'Engine analysis completed',
  EVIDENCE_RECONCILED: 'Evidence reconciled',
  MODEL_EXPLANATION_GENERATED: 'Explanation generated'
};

const CORRECTION_ACTION_LABELS: Record<string, string> = {
  RESTORE_CONVERSION_FACTOR: 'Restore conversion factor',
  RECOMPUTE_INVENTORY_MOVEMENT: 'Recompute inventory movement',
  REGENERATE_INVENTORY_VALUATION: 'Regenerate inventory valuation',
  REGENERATE_GROSS_MARGIN_REPORT: 'Regenerate gross margin report',
  RECONCILE_JOURNAL_ENTRIES: 'Reconcile journal entries'
};

const EXPOSURE_METHOD_LABELS: Record<string, string> = {
  DISJOINT_INVENTORY_AND_REALIZED_COGS: 'Inventory and realized COGS (disjoint)'
};

const PROVENANCE_TYPE_LABELS: Record<string, string> = {
  baseline_snapshot: 'Baseline snapshot'
};

const EXECUTION_FAILURE_LABELS: Record<string, string> = {
  SQL_ERROR: 'Database error',
  DRIFT_DETECTED: 'Data drift detected',
  VERIFICATION_FAILED: 'Verification failed'
};

const LINEAGE_LABELS: Record<string, string> = {
  'product_units.conversion_factor': 'Product units · Conversion factor',
  'inventory_movements.base_quantity': 'Inventory movements · Base quantity',
  'inventory_valuation.inventory_value': 'Inventory valuation · Inventory value',
  journal_entries: 'Journal entries',
  gross_margin_report: 'Gross margin report'
};

const TABLE_LABELS: Record<string, string> = {
  product_units: 'Product units',
  inventory_movements: 'Inventory movements',
  inventory_valuation: 'Inventory valuation',
  journal_entries: 'Journal entries',
  gross_margin_report: 'Gross margin report'
};

const FIELD_LABELS: Record<string, string> = {
  conversion_factor: 'Conversion factor',
  base_quantity: 'Base quantity',
  quantity_on_hand: 'Quantity on hand',
  average_cost: 'Average cost',
  inventory_value: 'Inventory value',
  cost_of_goods_sold: 'Cost of goods sold',
  gross_profit: 'Gross profit',
  gross_margin_percentage: 'Gross margin percentage',
  cost_of_goods_sold_reconciliation: 'COGS reconciliation'
};

/** Title-case a token that may contain underscores, dots, or spaces. */
export function humanizeToken(value: string | null | undefined): string {
  if (!value) return '—';
  const known =
    PLAN_STATE_LABELS[value] ??
    APPROVAL_LABELS[value] ??
    WRITEBACK_LABELS[value] ??
    VERIFICATION_LABELS[value] ??
    HEALTH_LABELS[value] ??
    DATAHUB_STATUS_LABELS[value] ??
    NEXT_STEP_LABELS[value] ??
    INVESTIGATION_STATE_LABELS[value] ??
    CORRECTION_ACTION_LABELS[value] ??
    EXPOSURE_METHOD_LABELS[value] ??
    PROVENANCE_TYPE_LABELS[value] ??
    EXECUTION_FAILURE_LABELS[value] ??
    LINEAGE_LABELS[value] ??
    TABLE_LABELS[value] ??
    FIELD_LABELS[value];
  if (known) return known;

  return value
    .replaceAll('.', ' · ')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => {
      if (word === '·') return word;
      const lower = word.toLowerCase();
      if (lower === 'cogs' || lower === 'erp' || lower === 'id' || lower === 'mcp') return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ')
    .replace(/\s·\s/g, ' · ');
}

export function labelPlanState(state: string | null | undefined): string {
  if (!state) return PLAN_STATE_LABELS.NO_PLAN;
  return PLAN_STATE_LABELS[state] ?? humanizeToken(state);
}

export function labelApprovalAction(action: string | null | undefined): string {
  if (!action) return '—';
  return APPROVAL_LABELS[action] ?? humanizeToken(action);
}

export function labelWriteback(outcome: string | null | undefined): string {
  if (!outcome) return WRITEBACK_LABELS.NOT_ATTEMPTED;
  return WRITEBACK_LABELS[outcome] ?? humanizeToken(outcome);
}

export function labelVerification(status: string | null | undefined): string {
  if (!status) return VERIFICATION_LABELS.NOT_RUN;
  return VERIFICATION_LABELS[status] ?? humanizeToken(status);
}

export function labelHealth(status: string | null | undefined): string {
  if (!status) return HEALTH_LABELS.UNKNOWN;
  return HEALTH_LABELS[status] ?? humanizeToken(status);
}

export function labelDatahubStatus(status: string | null | undefined): string {
  if (!status) return DATAHUB_STATUS_LABELS.NOT_CONFIGURED;
  return DATAHUB_STATUS_LABELS[status] ?? humanizeToken(status);
}

export function labelNextStep(step: string | null | undefined): string {
  if (!step) return '—';
  return NEXT_STEP_LABELS[step] ?? humanizeToken(step);
}

export function labelInvestigationState(state: string | null | undefined): string {
  if (!state) return '—';
  return INVESTIGATION_STATE_LABELS[state] ?? humanizeToken(state);
}

export function labelCorrectionAction(action: string | null | undefined): string {
  if (!action) return '—';
  return CORRECTION_ACTION_LABELS[action] ?? humanizeToken(action);
}

export function labelExposureMethod(method: string | null | undefined): string {
  if (!method) return '—';
  return EXPOSURE_METHOD_LABELS[method] ?? humanizeToken(method);
}

export function labelProvenanceType(type: string | null | undefined): string {
  if (!type) return '—';
  return PROVENANCE_TYPE_LABELS[type] ?? humanizeToken(type);
}

export function labelExecutionFailure(reason: string | null | undefined): string {
  if (!reason) return '—';
  return EXECUTION_FAILURE_LABELS[reason] ?? humanizeToken(reason);
}

export function labelLineageStep(step: string | null | undefined): string {
  if (!step) return '—';
  return LINEAGE_LABELS[step] ?? humanizeToken(step);
}

export function labelTable(table: string | null | undefined): string {
  if (!table) return '—';
  return TABLE_LABELS[table] ?? humanizeToken(table);
}

export function labelField(field: string | null | undefined): string {
  if (!field) return '—';
  return FIELD_LABELS[field] ?? humanizeToken(field);
}
