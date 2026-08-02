import { labelLineageStep } from '../lib/status-labels';

function wrapLabel(label: string, maxLen = 18): string[] {
  if (label.length <= maxLen) return [label];
  const parts = label.split(' · ');
  if (parts.length > 1) {
    return parts.map((part) => (part.length > maxLen ? `${part.slice(0, maxLen - 1)}…` : part));
  }
  return [`${label.slice(0, maxLen - 1)}…`];
}

export function ImpactGraph({ nodes }: { nodes: string[] }) {
  const labels = nodes.map((node) => labelLineageStep(node));

  return (
    <div className="w-full overflow-x-auto">
      {/* Desktop / tablet horizontal flow */}
      <svg
        className="hidden min-w-[640px] sm:block"
        viewBox="0 0 920 140"
        role="img"
        aria-label={`Impact lineage: ${labels.join(' to ')}`}
      >
        {labels.map((label, index) => {
          const x = 20 + index * 180;
          const lines = wrapLabel(label);
          return (
            <g key={`${label}-${index}`}>
              {index > 0 ? (
                <line
                  x1={x - 40}
                  y1={60}
                  x2={x}
                  y2={60}
                  stroke="#1A1D24"
                  strokeWidth="2"
                  markerEnd="url(#arrow)"
                />
              ) : null}
              <rect
                x={x}
                y={28}
                width={140}
                height={64}
                rx="10"
                fill="#FFFCF5"
                stroke="#1A1D24"
                strokeWidth="2"
              />
              {lines.map((line, lineIndex) => (
                <text
                  key={`${line}-${lineIndex}`}
                  x={x + 70}
                  y={54 + lineIndex * 14}
                  textAnchor="middle"
                  fontSize="11"
                  fontFamily="ui-sans-serif, system-ui, Segoe UI, sans-serif"
                  fill="#1A1D24"
                >
                  {line}
                </text>
              ))}
              <title>{label}</title>
            </g>
          );
        })}
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#1A1D24" />
          </marker>
        </defs>
      </svg>

      {/* Mobile vertical flow */}
      <ol className="space-y-2 sm:hidden" aria-label="Impact lineage">
        {labels.map((label, index) => (
          <li key={`${label}-${index}`} className="flex flex-col items-stretch gap-2">
            <div className="lg-panel-sm px-3 py-2 text-xs text-ink">{label}</div>
            {index < labels.length - 1 ? (
              <div className="flex justify-center text-ink-muted" aria-hidden="true">
                ↓
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
