import type { ReactNode } from 'react';
import { StatusBadge, type StatusTone } from './status-badge';

export function MetricCard({
  label,
  value,
  hint,
  tone = 'neutral',
  badge,
  footer
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: StatusTone;
  badge?: string;
  footer?: ReactNode;
}) {
  const borderTone =
    tone === 'healthy'
      ? 'border-healthy'
      : tone === 'risk'
        ? 'border-risk'
        : tone === 'warn'
          ? 'border-warn'
          : 'border-ink';

  return (
    <article className={`lg-panel-sm flex h-full flex-col gap-3 p-4 ${borderTone}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">{label}</p>
        {badge ? <StatusBadge label={badge} tone={tone} /> : null}
      </div>
      <div className="text-xl font-bold tracking-tight text-ink sm:text-2xl">{value}</div>
      {hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
      {footer}
    </article>
  );
}
