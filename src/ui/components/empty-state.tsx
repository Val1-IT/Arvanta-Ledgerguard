import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="lg-panel-sm flex flex-col items-start gap-3 border-dashed p-6">
      <h3 className="font-bold text-ink">{title}</h3>
      {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
      {action}
    </div>
  );
}
