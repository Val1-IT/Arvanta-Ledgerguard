/**
 * Single source of truth for runtime modes. Values deliberately use strict
 * equality so an accidental value such as "1" never enables a privileged
 * judging or fallback path.
 */
export type RuntimePolicy = {
  judgeMode: boolean;
  allowDemoFallback: boolean;
  requireLiveModel: boolean;
};

export function getRuntimePolicy(): RuntimePolicy {
  const judgeMode = process.env.JUDGE_MODE === 'true';
  return {
    judgeMode,
    allowDemoFallback: process.env.ALLOW_DEMO_FALLBACK === 'true' && !judgeMode,
    requireLiveModel: process.env.REQUIRE_LIVE_MODEL === 'true'
  };
}
