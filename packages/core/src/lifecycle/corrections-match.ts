import type { ProposedCorrection } from '../types';

export function correctionKey(correction: ProposedCorrection): string {
  return `${correction.sequence}|${correction.action}|${correction.table}|${correction.recordId}|${correction.field}|${correction.beforeValue}|${correction.afterValue}`;
}

export function correctionsMatch(fresh: ProposedCorrection[], approved: ProposedCorrection[]): boolean {
  if (fresh.length !== approved.length) return false;
  const freshKeys = fresh.map(correctionKey).sort();
  const approvedKeys = approved.map(correctionKey).sort();
  return freshKeys.every((key, i) => key === approvedKeys[i]);
}
