import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Arvanta LedgerGuard',
  description:
    'Autonomous ERP financial-integrity agent powered by DataHub context.'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-cream text-ink">
        <header className="border-b-2 border-ink bg-cream-panel">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/overview" className="flex items-center gap-2 font-bold">
              <span className="grid h-9 w-9 place-items-center rounded-lg border-2 border-ink bg-gold shadow-brutal-sm">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <span className="text-lg tracking-tight">
                Arvanta <span className="text-gold-strong">LedgerGuard</span>
              </span>
            </Link>
            <span className="lg-tag border-ink text-ink-muted">Demo</span>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
