import { isDemoModeEnabled } from '../lib/demo-mode';

export function DemoBanner() {
  const demoMode = isDemoModeEnabled();

  return (
    <div
      className={`border-b-2 border-ink px-4 py-2 text-center text-xs font-semibold sm:text-sm ${
        demoMode ? 'bg-gold/40 text-ink' : 'bg-cream-panel text-ink-muted'
      }`}
      role="note"
    >
      {demoMode ? (
        <span>Demo environment — synthetic ERP data only.</span>
      ) : (
        <span>
          Demo environment — synthetic ERP data only. Mutating controls are disabled because{' '}
          <span className="font-mono">DEMO_MODE</span> is not active.
        </span>
      )}
    </div>
  );
}
