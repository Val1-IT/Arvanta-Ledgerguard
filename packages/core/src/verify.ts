import { ALL_QUALITY_CHECKS } from './quality-checks';
import type { QualityCheckInput, VerificationResult } from './types';

// ---------------------------------------------------------------------------
// Reusable both for the investigation report's embedded expectations and for
// FASE 6's actual post-remediation verification — same evaluators, same
// input shape, no DB/HTTP/UI/LLM dependency. overallStatus is PASS only when
// every check evaluates to PASS.
// ---------------------------------------------------------------------------

export function verifyState(input: QualityCheckInput): VerificationResult {
  const checks = ALL_QUALITY_CHECKS.map((check) => check.evaluate(input));
  const overallStatus = checks.every((c) => c.status === 'PASS') ? 'PASS' : 'FAIL';
  return { overallStatus, checks };
}
