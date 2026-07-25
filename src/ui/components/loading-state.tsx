export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="lg-panel-sm flex items-center gap-3 p-4" role="status" aria-live="polite">
      <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-gold" aria-hidden="true" />
      <span className="text-sm font-semibold text-ink-muted">{label}</span>
    </div>
  );
}
