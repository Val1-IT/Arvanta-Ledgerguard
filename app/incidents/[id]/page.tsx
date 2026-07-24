// Incident detail route. In FASE 7 this becomes a tabbed view:
// Investigation | Impact | Remediation | Resolution.
export default async function IncidentPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">
        Incident <span className="font-mono text-gold-strong">{id}</span>
      </h1>
      <div className="lg-panel p-6">
        <p className="text-ink-muted">
          Tabs (Investigation, Impact, Remediation, Resolution) are implemented in
          FASE 7.
        </p>
      </div>
    </div>
  );
}
