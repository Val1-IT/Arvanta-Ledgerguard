import { createHash } from 'node:crypto';
import type { ProposedCorrection } from '../types';
import { correctionKey } from './corrections-match';

export function sourceStateFingerprint(corrections: ProposedCorrection[]): string {
  const material = [...corrections].map(correctionKey).sort().join('\n');
  return createHash('sha256').update(material).digest('hex');
}
