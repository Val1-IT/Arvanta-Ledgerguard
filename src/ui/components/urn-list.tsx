import { urnDisplayLabel } from '../lib/urn';

export function UrnChip({ urn }: { urn: string }) {
  const label = urnDisplayLabel(urn);
  return (
    <span className="lg-tag border-ink text-ink" title={urn}>
      {label}
    </span>
  );
}

export function UrnList({
  urns,
  empty = '(none)'
}: {
  urns: string[];
  empty?: string;
}) {
  if (urns.length === 0) {
    return <p className="text-sm text-ink-muted">{empty}</p>;
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {urns.map((urn) => (
        <li key={urn}>
          <UrnChip urn={urn} />
        </li>
      ))}
    </ul>
  );
}

export function UrnLineage({ urns }: { urns: string[] }) {
  if (urns.length === 0) {
    return <p className="text-sm text-ink-muted">(no lineage)</p>;
  }
  return (
    <ol className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {urns.map((urn, index) => (
        <li key={`${urn}-${index}`} className="flex items-center gap-2">
          {index > 0 ? (
            <span className="hidden text-ink-muted sm:inline" aria-hidden="true">
              →
            </span>
          ) : null}
          <span className="lg-tag border-ink text-ink" title={urn}>
            {urnDisplayLabel(urn)}
          </span>
        </li>
      ))}
    </ol>
  );
}
