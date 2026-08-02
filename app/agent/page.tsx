import { PRODUCT } from '../../src/domain/constants';
import { createInvestigationModel } from '../../src/agent/model-factory';
import { labelModelSource } from '../../src/ui/lib/status-labels';
import { triggerInvestigation } from './actions';
import { LookupForm } from './lookup-form';

// ---------------------------------------------------------------------------
// FASE 5 minimum test UI: trigger one investigation run and look up a prior
// run's activity log. This is deliberately not the FASE 7 incident dashboard
// (app/overview, app/incidents) — it exists only so the DataHub-aware
// investigation agent can be exercised and its activity log inspected without
// a script, per the FASE 5 scope ("komponen minimum yang diperlukan untuk
// menguji activity log agent"). It does not execute remediation.
// ---------------------------------------------------------------------------

export default function AgentPage() {
  let modelLabel = 'Deterministic test provider';
  try {
    const selection = createInvestigationModel();
    modelLabel =
      selection.modelSource === 'DETERMINISTIC_TEMPLATE'
        ? 'Deterministic test provider'
        : `${labelModelSource(selection.modelSource)} (live)`;
  } catch {
    modelLabel = 'Misconfigured live model';
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Investigation Agent</h1>
        <p className="mt-1 text-ink-muted">
          Run the DataHub-aware investigation agent and inspect its activity log. Investigation only —
          no remediation is executed here.
        </p>
      </div>

      <div className="lg-panel space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Run a new investigation</h2>
          <span className="lg-tag border-ink text-ink-muted">Model: {modelLabel}</span>
        </div>
        <form action={triggerInvestigation} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-semibold">Incident ID</span>
            <input
              name="incidentId"
              required
              defaultValue="incident-manual-test-0001"
              className="w-full rounded-lg border-2 border-ink bg-cream-panel px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold">Product ID</span>
            <input
              name="productId"
              required
              defaultValue={PRODUCT.id}
              className="w-full rounded-lg border-2 border-ink bg-cream-panel px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold">Trigger asset</span>
            <input
              name="triggerAsset"
              required
              defaultValue="product_units"
              className="w-full rounded-lg border-2 border-ink bg-cream-panel px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold">Requested by</span>
            <input
              name="requestedBy"
              required
              defaultValue="manual-test"
              className="w-full rounded-lg border-2 border-ink bg-cream-panel px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold">Mode</span>
            <select
              name="mode"
              defaultValue="TEST"
              className="w-full rounded-lg border-2 border-ink bg-cream-panel px-3 py-2 text-sm"
            >
              <option value="TEST">TEST</option>
              <option value="LIVE">LIVE</option>
            </select>
          </label>
          <div className="flex items-end">
            <button type="submit" className="lg-btn-gold w-full sm:w-auto">
              Run investigation
            </button>
          </div>
        </form>
        <p className="text-xs text-ink-muted">
          Requires the demo Postgres (<code>npm run db:up</code>) and DataHub (<code>npm run datahub:up</code>) to be
          running — the agent performs a real MCP read/write, it never fabricates DataHub context.
        </p>
      </div>

      <div className="lg-panel space-y-4 p-6">
        <h2 className="font-bold">Look up a prior run</h2>
        <LookupForm />
      </div>
    </div>
  );
}
