export function ImpactGraph({ nodes }: { nodes: string[] }) {
  return (
    <div className="w-full overflow-x-auto">
      {/* Desktop / tablet horizontal flow */}
      <svg
        className="hidden min-w-[640px] sm:block"
        viewBox="0 0 920 120"
        role="img"
        aria-label={`Impact lineage: ${nodes.join(' to ')}`}
      >
        {nodes.map((node, index) => {
          const x = 20 + index * 180;
          return (
            <g key={node}>
              {index > 0 ? (
                <line
                  x1={x - 40}
                  y1={50}
                  x2={x}
                  y2={50}
                  stroke="#1A1D24"
                  strokeWidth="2"
                  markerEnd="url(#arrow)"
                />
              ) : null}
              <rect
                x={x}
                y={22}
                width={140}
                height={56}
                rx="10"
                fill="#FFFCF5"
                stroke="#1A1D24"
                strokeWidth="2"
              />
              <text
                x={x + 70}
                y={54}
                textAnchor="middle"
                fontSize="11"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fill="#1A1D24"
              >
                {node.length > 22 ? `${node.slice(0, 20)}…` : node}
              </text>
              <title>{node}</title>
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
        {nodes.map((node, index) => (
          <li key={node} className="flex flex-col items-stretch gap-2">
            <div className="lg-panel-sm px-3 py-2 font-mono text-xs text-ink">{node}</div>
            {index < nodes.length - 1 ? (
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
