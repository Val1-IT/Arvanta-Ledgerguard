const TONE_CLASS = {
  healthy: 'border-healthy bg-healthy/10 text-healthy',
  risk: 'border-risk bg-risk/10 text-risk',
  warn: 'border-warn bg-warn/10 text-warn',
  neutral: 'border-ink bg-cream-soft text-ink-muted',
  gold: 'border-gold-strong bg-gold-soft text-gold-strong'
} as const;

export type StatusTone = keyof typeof TONE_CLASS;

export function StatusBadge({
  label,
  tone = 'neutral',
  title
}: {
  label: string;
  tone?: StatusTone;
  title?: string;
}) {
  return (
    <span
      className={`lg-tag ${TONE_CLASS[tone]}`}
      title={title}
      aria-label={`Status: ${label}`}
    >
      {label}
    </span>
  );
}

export function toneForHealth(status: string): StatusTone {
  if (status === 'HEALTHY') return 'healthy';
  if (status === 'DEGRADED') return 'warn';
  if (status === 'CRITICAL') return 'risk';
  return 'neutral';
}

export function toneForTerminalState(state: string): StatusTone {
  if (state === 'INVESTIGATION_COMPLETED' || state === 'RESOLVED' || state === 'HEALTHY') return 'healthy';
  if (
    state.includes('FAIL') ||
    state.includes('INVALID') ||
    state.includes('UNAVAILABLE') ||
    state.includes('NOT_FOUND') ||
    state.includes('INCOMPLETE') ||
    state.includes('INSUFFICIENT') ||
    state === 'CRITICAL' ||
    state === 'REJECTED'
  ) {
    return 'risk';
  }
  if (state.includes('PENDING') || state.includes('EXECUTING') || state.includes('VERIFYING') || state === 'DEGRADED') {
    return 'warn';
  }
  return 'neutral';
}
