import type { Metadata } from 'next';
import { AppShell } from '../src/ui/components/app-shell';
import { listInvestigationRuns } from '../src/ui/server/queries';
import { getServerPool } from '../src/agent/server-pool';
import './globals.css';

export const metadata: Metadata = {
  title: 'Arvanta LedgerGuard',
  description: 'Autonomous ERP financial-integrity agent powered by DataHub context.'
};

export const dynamic = 'force-dynamic';

async function incidentsNavAvailable(): Promise<boolean> {
  try {
    const runs = await listInvestigationRuns(getServerPool(), 1);
    return runs.length > 0;
  } catch {
    return false;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const showIncidentsNav = await incidentsNavAvailable();
  return (
    <html lang="en">
      <body>
        <AppShell showIncidentsNav={showIncidentsNav}>{children}</AppShell>
      </body>
    </html>
  );
}
