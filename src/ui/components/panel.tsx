import type { ReactNode } from 'react';

export function Panel({
  title,
  subtitle,
  children,
  className = '',
  tone = 'default',
  actions
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'risk' | 'healthy' | 'warn';
  actions?: ReactNode;
}) {
  const toneClass =
    tone === 'risk'
      ? 'border-risk'
      : tone === 'healthy'
        ? 'border-healthy'
        : tone === 'warn'
          ? 'border-warn'
          : 'border-ink';

  return (
    <section className={`lg-panel space-y-4 p-5 sm:p-6 ${toneClass} ${className}`.trim()}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <h2 className="text-base font-bold tracking-tight text-ink">{title}</h2> : null}
            {subtitle ? <p className="mt-1 text-sm text-ink-muted">{subtitle}</p> : null}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
