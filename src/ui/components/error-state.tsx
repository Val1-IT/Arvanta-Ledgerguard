import type { ReactNode } from 'react';

export function ErrorState({
  title,
  message,
  action
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="lg-panel space-y-3 border-risk p-6" role="alert">
      <h2 className="font-bold text-risk">{title}</h2>
      {message ? <p className="text-sm text-ink-muted">{message}</p> : null}
      {action}
    </div>
  );
}
