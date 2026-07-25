import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { DemoBanner } from './demo-banner';

export function AppShell({
  children,
  showIncidentsNav = false
}: {
  children: ReactNode;
  showIncidentsNav?: boolean;
}) {
  return (
    <div className="min-h-screen bg-cream text-ink">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:border-2 focus:border-ink focus:bg-cream-panel focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <DemoBanner />
      <header className="border-b-2 border-ink bg-cream-panel">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/overview" className="flex min-w-0 items-center gap-2 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
            <span className="grid h-9 w-9 place-items-center rounded-lg border-2 border-ink bg-gold shadow-brutal-sm">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="truncate text-lg tracking-tight">
              Arvanta <span className="text-gold-strong">LedgerGuard</span>
            </span>
          </Link>
          <nav className="flex items-center gap-3 sm:gap-4" aria-label="Primary">
            <Link
              href="/overview"
              className="text-sm font-semibold text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              Overview
            </Link>
            {showIncidentsNav ? (
              <Link
                href="/incidents"
                className="text-sm font-semibold text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                Incidents
              </Link>
            ) : null}
            <span className="lg-tag border-ink text-ink-muted">Demo</span>
          </nav>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
