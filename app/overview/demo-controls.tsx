'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { ConfirmDialog } from '../../src/ui/components/confirm-dialog';
import { resetDemoAction, simulateConversionErrorAction } from './actions';

export function DemoControls({
  simulateDisabledReason,
  resetDisabledReason
}: {
  simulateDisabledReason: string | null;
  resetDisabledReason: string | null;
}) {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [pendingAction, setPendingAction] = useState<'simulate' | 'reset' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [isPending, startTransition] = useTransition();
  const lockRef = useRef(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const busy = !hydrated || isPending || pendingAction !== null || lockRef.current;

  function onSimulate() {
    if (!hydrated || busy || simulateDisabledReason || lockRef.current) return;
    lockRef.current = true;
    setError(null);
    setPendingAction('simulate');
    startTransition(async () => {
      try {
        const result = await simulateConversionErrorAction();
        if (result && result.ok === false) {
          setError(result.error);
          setPendingAction(null);
          lockRef.current = false;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Simulate failed';
        if (!message.includes('NEXT_REDIRECT')) {
          setError(message);
        }
        setPendingAction(null);
        lockRef.current = false;
      }
    });
  }

  function onResetConfirmed() {
    if (!hydrated || busy || resetDisabledReason || lockRef.current) return;
    lockRef.current = true;
    setError(null);
    setPendingAction('reset');
    startTransition(async () => {
      const result = await resetDemoAction();
      if (!result.ok) {
        setError(result.error);
        setPendingAction(null);
        lockRef.current = false;
        setConfirmReset(false);
        return;
      }
      setPendingAction(null);
      lockRef.current = false;
      setConfirmReset(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3" data-testid="demo-controls" data-hydrated={hydrated ? 'true' : 'false'}>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="lg-btn-gold"
          onClick={onSimulate}
          disabled={Boolean(simulateDisabledReason) || busy}
          aria-busy={pendingAction === 'simulate'}
          title={simulateDisabledReason ?? 'Apply conversion-error scenario and open the new investigation'}
        >
          {pendingAction === 'simulate' ? 'Simulating…' : 'Simulate Conversion Error'}
        </button>
        <button
          type="button"
          className="lg-btn"
          data-testid="reset-demo"
          onClick={() => {
            if (hydrated && !resetDisabledReason && !busy) setConfirmReset(true);
          }}
          disabled={Boolean(resetDisabledReason) || busy}
          aria-busy={pendingAction === 'reset'}
          title={resetDisabledReason ?? 'Restore the demo database to the healthy baseline'}
        >
          {pendingAction === 'reset' ? 'Resetting…' : 'Reset Demo'}
        </button>
      </div>
      {simulateDisabledReason ? (
        <p className="text-xs text-ink-muted">Simulate disabled: {simulateDisabledReason}</p>
      ) : null}
      {resetDisabledReason ? (
        <p className="text-xs text-ink-muted">Reset disabled: {resetDisabledReason}</p>
      ) : null}
      {error ? (
        <p className="text-sm font-semibold text-risk" role="alert">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmReset}
        title="Reset demo database?"
        description="This restores the healthy synthetic ERP baseline and clears investigation/remediation demo rows."
        confirmLabel="Reset demo"
        tone="danger"
        busy={pendingAction === 'reset'}
        onCancel={() => {
          if (pendingAction !== 'reset') setConfirmReset(false);
        }}
        onConfirm={onResetConfirmed}
      />
    </div>
  );
}
