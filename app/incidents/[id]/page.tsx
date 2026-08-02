import Link from 'next/link';
import { getServerPool } from '../../../src/agent/server-pool';
import { CopyIdButton } from '../../../src/ui/components/copy-id-button';
import { ErrorState } from '../../../src/ui/components/error-state';
import { PageHeader } from '../../../src/ui/components/page-header';
import { StatusBadge, toneForHealth, toneForTerminalState } from '../../../src/ui/components/status-badge';
import { formatIdrDisplay, formatIsoDateTime } from '../../../src/ui/lib/format-display';
import {
  labelHealth,
  labelInvestigationState,
  labelNextStep
} from '../../../src/ui/lib/status-labels';
import { loadIncidentDetailViewModel } from '../../../src/ui/server/incident-detail';
import { IncidentTabs } from './incident-tabs';

export const dynamic = 'force-dynamic';

export default async function IncidentPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const vm = await loadIncidentDetailViewModel(getServerPool(), id);

  if (!vm) {
    return (
      <div className="space-y-6">
        <PageHeader title="Incident not found" />
        <ErrorState
          title="Investigation run not found"
          message={`No investigation run with id ${id} exists.`}
          action={
            <Link href="/incidents" className="lg-btn">
              Back to incidents
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={vm.title}
        description={`Detected ${formatIsoDateTime(vm.detectedAt)}. Owners: ${
          vm.ownerLabels.length > 0 ? vm.ownerLabels.join(', ') : '—'
        }.`}
        meta={
          <>
            <StatusBadge
              label={labelHealth(vm.severity)}
              tone={toneForHealth(vm.severity === 'UNKNOWN' ? 'DEGRADED' : vm.severity)}
            />
            <StatusBadge
              label={labelInvestigationState(vm.status)}
              tone={toneForTerminalState(vm.status)}
            />
            {vm.recommendedNextStep ? (
              <StatusBadge label={labelNextStep(vm.recommendedNextStep)} tone="gold" />
            ) : null}
            {vm.primaryExposure ? (
              <StatusBadge
                label={formatIdrDisplay(vm.primaryExposure)}
                tone="warn"
                title="Primary exposure from backend"
              />
            ) : null}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <CopyIdButton value={vm.id} label="Copy investigation ID" />
            <CopyIdButton value={vm.incidentId} label="Copy incident ID" />
          </div>
        }
      />

      <IncidentTabs vm={vm} />
    </div>
  );
}
