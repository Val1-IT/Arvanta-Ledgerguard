'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger' | 'warn';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onCancel();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const confirmClass =
    tone === 'danger' ? 'lg-btn border-risk bg-risk text-cream-panel' : tone === 'warn' ? 'lg-btn-gold' : 'lg-btn-gold';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center" role="presentation">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Dismiss dialog"
        disabled={busy}
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative z-10 w-full max-w-md rounded-xl border-2 border-ink bg-cream-panel p-5 shadow-brutal"
      >
        <h2 id={titleId} className="text-lg font-bold text-ink">
          {title}
        </h2>
        <div id={descriptionId} className="mt-2 text-sm text-ink-muted">
          {description}
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" className="lg-btn" ref={cancelRef} disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={confirmClass} disabled={busy} aria-busy={busy} onClick={onConfirm}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
