'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import type { IncidentDetailViewModel } from '../../../src/ui/view-models/incident-detail';
import { ConfirmDialog } from '../../../src/ui/components/confirm-dialog';
import { Panel } from '../../../src/ui/components/panel';
import { StatusBadge, toneForTerminalState } from '../../../src/ui/components/status-badge';
import { labelPlanState } from '../../../src/ui/lib/status-labels';
import {
  decideRemediationPlanAction,
  executeRemediationPlanAction,
  generateRemediationPlanAction,
  submitRemediationPlanAction,
  writebackRemediationResolutionAction,
  type RemediationActionResult
} from './remediation-actions';

type ActionKey =
  | 'generate'
  | 'submit'
  | 'approve'
  | 'reject'
  | 'keepFrozen'
  | 'execute'
  | 'writeback';

type ConfirmKind = 'approve' | 'reject' | 'keepFrozen' | 'execute' | null;

export function RemediationControls({
  vm,
  surface
}: {
  vm: IncidentDetailViewModel;
  surface: 'remediation' | 'resolution';
}) {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [pending, setPending] = useState<ActionKey | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [isPending, startTransition] = useTransition();
  const lockRef = useRef(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  const busy = !hydrated || isPending || pending !== null || lockRef.current;
  const actions = vm.remediation.availableActions;
  const needsRefresh =
    errorCode === 'OPTIMISTIC_CONCURRENCY' || errorCode === 'INVALID_TRANSITION';

  function finish(result: RemediationActionResult, successFallback: string) {
    lockRef.current = false;
    if (result.ok) {
      setError(null);
      setErrorCode(null);
      setMessage(result.message ?? successFallback);
      router.refresh();
    } else {
      setMessage(null);
      setError(result.error);
      setErrorCode(result.code ?? null);
      if (result.code === 'OPTIMISTIC_CONCURRENCY' || result.code === 'INVALID_TRANSITION') {
        router.refresh();
      }
    }
    setPending(null);
    setConfirm(null);
  }

  function run(key: ActionKey, work: () => Promise<RemediationActionResult>, successFallback: string) {
    if (lockRef.current || isPending || pending !== null) return;
    lockRef.current = true;
    setPending(key);
    setError(null);
    setErrorCode(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await work();
        finish(result, successFallback);
      } catch (err) {
        lockRef.current = false;
        setError(err instanceof Error ? err.message : 'Action failed');
        setErrorCode(null);
        setPending(null);
        setConfirm(null);
      }
    });
  }

  const planId = vm.remediation.planId;
  const expectedVersion = vm.remediation.version;

  function confirmCopy(kind: Exclude<ConfirmKind, null>) {
    switch (kind) {
      case 'approve':
        return {
          title: 'Approve remediation plan?',
          description: `Plan version ${expectedVersion ?? '—'} will move to Approved. Execution still requires a separate confirm.`,
          confirmLabel: 'Approve plan',
          tone: 'warn' as const
        };
      case 'reject':
        return {
          title: 'Reject remediation plan?',
          description: 'Rejected plans cannot be executed. You can generate a new plan later.',
          confirmLabel: 'Reject plan',
          tone: 'danger' as const
        };
      case 'keepFrozen':
        return {
          title: 'Keep reports frozen?',
          description:
            'Acknowledges the incident without executing corrections. DataHub At Risk metadata remains until a later successful remediation.',
          confirmLabel: 'Keep frozen',
          tone: 'warn' as const
        };
      case 'execute':
        return {
          title: 'Execute remediation?',
          description:
            'Corrections apply in one database transaction. Failure or failed verification rolls everything back. Posted journals are never rewritten.',
          confirmLabel: 'Execute now',
          tone: 'danger' as const
        };
    }
  }

  const activeConfirm = confirm ? confirmCopy(confirm) : null;

  return (
    <div className="space-y-4" data-testid="remediation-controls" data-hydrated={hydrated ? 'true' : 'false'}>
      {surface === 'remediation' ? (
        <Panel title="Remediation actions" subtitle={vm.remediation.availableDecision}>
          <p className="mb-3 text-xs text-ink-muted">
            Current plan:{' '}
            <span className="font-semibold text-ink">
              {labelPlanState(vm.remediation.state)} · v{vm.remediation.version ?? '—'}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {actions.canGeneratePlan ? (
              <button
                type="button"
                className="lg-btn-gold"
                disabled={busy}
                aria-busy={pending === 'generate'}
                onClick={() =>
                  run(
                    'generate',
                    () => generateRemediationPlanAction({ investigationId: vm.id }),
                    'Plan generated.'
                  )
                }
              >
                {pending === 'generate' ? 'Generating…' : planId ? 'Generate new plan' : 'Generate remediation plan'}
              </button>
            ) : null}

            {actions.canSubmitForApproval && planId && expectedVersion !== null ? (
              <button
                type="button"
                className="lg-btn"
                disabled={busy}
                aria-busy={pending === 'submit'}
                onClick={() =>
                  run(
                    'submit',
                    () =>
                      submitRemediationPlanAction({
                        investigationId: vm.id,
                        planId,
                        expectedVersion
                      }),
                    'Submitted for approval.'
                  )
                }
              >
                {pending === 'submit' ? 'Submitting…' : 'Submit for approval'}
              </button>
            ) : null}

            {actions.canApprove && planId && expectedVersion !== null ? (
              <button
                type="button"
                className="lg-btn-gold"
                disabled={busy}
                aria-busy={pending === 'approve'}
                onClick={() => setConfirm('approve')}
              >
                {pending === 'approve' ? 'Approving…' : 'Approve'}
              </button>
            ) : null}

            {actions.canReject && planId && expectedVersion !== null ? (
              <button
                type="button"
                className="lg-btn"
                disabled={busy}
                aria-busy={pending === 'reject'}
                onClick={() => setConfirm('reject')}
              >
                {pending === 'reject' ? 'Rejecting…' : 'Reject'}
              </button>
            ) : null}

            {actions.canKeepFrozen && planId && expectedVersion !== null ? (
              <button
                type="button"
                className="lg-btn"
                disabled={busy}
                aria-busy={pending === 'keepFrozen'}
                title="Acknowledge the incident but defer remediation; DataHub At Risk remains"
                onClick={() => setConfirm('keepFrozen')}
              >
                {pending === 'keepFrozen' ? 'Saving…' : 'Keep reports frozen'}
              </button>
            ) : null}
          </div>

          {vm.remediation.actionsDisabledReason ? (
            <p className="mt-3 text-xs text-ink-muted">{vm.remediation.actionsDisabledReason}</p>
          ) : null}
        </Panel>
      ) : (
        <Panel title="Resolution actions" subtitle="Execute only after approval. Write-back never changes ERP RESOLVED state.">
          <p className="mb-3 text-xs text-ink-muted">
            Current plan:{' '}
            <span className="font-semibold text-ink">
              {labelPlanState(vm.remediation.state)} · v{vm.remediation.version ?? '—'}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {actions.canExecute && planId && expectedVersion !== null ? (
              <button
                type="button"
                className="lg-btn-gold"
                disabled={busy}
                aria-busy={pending === 'execute'}
                onClick={() => setConfirm('execute')}
              >
                {pending === 'execute' ? 'Executing…' : 'Execute remediation'}
              </button>
            ) : null}

            {actions.canWriteback && planId ? (
              <button
                type="button"
                className="lg-btn"
                disabled={busy}
                aria-busy={pending === 'writeback'}
                onClick={() =>
                  run(
                    'writeback',
                    () =>
                      writebackRemediationResolutionAction({
                        investigationId: vm.id,
                        planId
                      }),
                    'DataHub write-back synced.'
                  )
                }
              >
                {pending === 'writeback' ? 'Syncing…' : 'Retry DataHub write-back'}
              </button>
            ) : null}
          </div>

          {!actions.canExecute && !actions.canWriteback ? (
            <p className="mt-3 text-xs text-ink-muted">
              {vm.remediation.actionsDisabledReason ??
                'Execute appears after Approve. Write-back appears after RESOLVED when DataHub sync is still pending or failed.'}
            </p>
          ) : null}

          {vm.resolution.remediationState ? (
            <div className="mt-3">
              <StatusBadge
                label={labelPlanState(vm.resolution.remediationState)}
                tone={toneForTerminalState(vm.resolution.remediationState)}
              />
            </div>
          ) : null}
        </Panel>
      )}

      {message ? (
        <p className="text-sm font-semibold text-healthy" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <div className="space-y-2" role="alert">
          <p className="text-sm font-semibold text-risk">{error}</p>
          {needsRefresh ? (
            <button
              type="button"
              className="lg-btn"
              disabled={busy}
              onClick={() => {
                setError(null);
                setErrorCode(null);
                router.refresh();
              }}
            >
              Refresh latest plan
            </button>
          ) : null}
        </div>
      ) : null}

      {activeConfirm && confirm ? (
        <ConfirmDialog
          open
          title={activeConfirm.title}
          description={activeConfirm.description}
          confirmLabel={activeConfirm.confirmLabel}
          tone={activeConfirm.tone}
          busy={busy}
          onCancel={() => {
            if (!busy) setConfirm(null);
          }}
          onConfirm={() => {
            if (!planId || expectedVersion === null) return;
            if (confirm === 'approve') {
              run(
                'approve',
                () =>
                  decideRemediationPlanAction({
                    investigationId: vm.id,
                    planId,
                    expectedVersion,
                    action: 'APPROVE'
                  }),
                'Plan approved.'
              );
            } else if (confirm === 'reject') {
              run(
                'reject',
                () =>
                  decideRemediationPlanAction({
                    investigationId: vm.id,
                    planId,
                    expectedVersion,
                    action: 'REJECT',
                    note: 'Rejected from incident UI'
                  }),
                'Plan rejected.'
              );
            } else if (confirm === 'keepFrozen') {
              run(
                'keepFrozen',
                () =>
                  decideRemediationPlanAction({
                    investigationId: vm.id,
                    planId,
                    expectedVersion,
                    action: 'KEEP_REPORTS_FROZEN',
                    note: 'Keep reports frozen from incident UI'
                  }),
                'Reports kept frozen.'
              );
            } else if (confirm === 'execute') {
              run(
                'execute',
                () =>
                  executeRemediationPlanAction({
                    investigationId: vm.id,
                    planId,
                    expectedVersion
                  }),
                'Execution finished.'
              );
            }
          }}
        />
      ) : null}
    </div>
  );
}
