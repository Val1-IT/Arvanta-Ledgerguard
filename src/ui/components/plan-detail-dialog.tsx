'use client';

import { useEffect, useId, useRef } from 'react';
import type { ProposedCorrection } from '@ledgerguard/core';
import { formatDecimalDisplay, formatIsoDateTime } from '../lib/format-display';
import {
  labelApprovalAction,
  labelCorrectionAction,
  labelField,
  labelPlanState,
  labelTable,
  labelVerification
} from '../lib/status-labels';
import { StatusBadge, toneForTerminalState } from './status-badge';

export type PlanDetailView = {
  planId: string;
  state: string;
  version: number;
  approvalAction: string | null;
  createdAt: string;
  executedAt: string | null;
  verificationStatus: 'PASS' | 'FAIL' | null;
  isActive: boolean;
  proposedCorrections: ProposedCorrection[];
};

export function PlanDetailDialog({
  open,
  plan,
  onClose
}: {
  open: boolean;
  plan: PlanDetailView | null;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !plan) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center" role="presentation">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Dismiss dialog" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="plan-detail-dialog"
        className="relative z-10 flex max-h-[85vh] w-full max-w-4xl flex-col rounded-xl border-2 border-ink bg-cream-panel shadow-brutal"
      >
        <div className="flex items-start justify-between gap-3 border-b-2 border-ink px-5 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-bold text-ink">
              Remediation plan v{plan.version}
            </h2>
            <p className="mt-1 font-mono text-xs text-ink-muted">{plan.planId}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge label={labelPlanState(plan.state)} tone={toneForTerminalState(plan.state)} />
              {plan.isActive ? <StatusBadge label="Active" tone="warn" /> : null}
              <StatusBadge label={labelApprovalAction(plan.approvalAction)} tone="neutral" />
              {plan.verificationStatus ? (
                <StatusBadge
                  label={labelVerification(plan.verificationStatus)}
                  tone={plan.verificationStatus === 'PASS' ? 'healthy' : 'risk'}
                />
              ) : null}
            </div>
          </div>
          <button type="button" className="lg-btn" ref={closeRef} onClick={onClose}>
            Close
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-ink-muted">Created</dt>
              <dd className="font-mono text-xs">{formatIsoDateTime(plan.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Executed</dt>
              <dd className="font-mono text-xs">
                {plan.executedAt ? formatIsoDateTime(plan.executedAt) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Correction steps</dt>
              <dd className="font-mono font-bold">{plan.proposedCorrections.length}</dd>
            </div>
          </dl>

          {plan.proposedCorrections.length === 0 ? (
            <p className="text-sm text-ink-muted">This plan has no proposed corrections.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <caption className="sr-only">Proposed corrections for this remediation plan</caption>
                <thead>
                  <tr className="border-b-2 border-ink">
                    <th className="py-2 pr-3">#</th>
                    <th className="py-2 pr-3">Action</th>
                    <th className="py-2 pr-3">Asset</th>
                    <th className="py-2 pr-3">Record</th>
                    <th className="py-2 pr-3">Field</th>
                    <th className="py-2 pr-3">Before</th>
                    <th className="py-2 pr-3">After</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.proposedCorrections.map((step) => (
                    <tr key={step.sequence} className="border-b border-ink/20 align-top">
                      <td className="py-2 pr-3 font-mono">{step.sequence}</td>
                      <td className="py-2 pr-3 text-xs font-semibold">{labelCorrectionAction(step.action)}</td>
                      <td className="py-2 pr-3 text-xs">{labelTable(step.table)}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{step.recordId}</td>
                      <td className="py-2 pr-3 text-xs">{labelField(step.field)}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{formatDecimalDisplay(step.beforeValue)}</td>
                      <td className="py-2 pr-3 font-mono text-xs font-semibold">
                        {formatDecimalDisplay(step.afterValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
