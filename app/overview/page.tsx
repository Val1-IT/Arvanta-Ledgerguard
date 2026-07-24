// Overview route. Full UI (health tiles, Simulate Conversion Error, active
// incidents) is built in FASE 7. This scaffold renders a valid, styled shell.
export default function OverviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="mt-1 text-ink-muted">
          Financial-integrity health of the demo ERP dataset.
        </p>
      </div>
      <div className="lg-panel p-6">
        <p className="text-ink-muted">
          Dashboard tiles, the <span className="font-semibold">Simulate Conversion Error</span>{' '}
          trigger, and the active-incidents list are implemented in FASE 7.
        </p>
      </div>
    </div>
  );
}
