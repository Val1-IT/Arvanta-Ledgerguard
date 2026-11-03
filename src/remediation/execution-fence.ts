import type { ConstrainedAction, ConstrainedActionAdapter, StaleReservationClassification } from '@ledgerguard/core';

/** The execution key plus the lease generation that is allowed to act on it. */
export interface ExecutionFence {
  executionKey: string;
  generation: number;
}

/**
 * A remote adapter that enforces fencing on the remote side: every mutation
 * carries an ExecutionFence, and the remote system rejects a generation lower
 * than the highest one it has seen for that key, in the same transaction as
 * the write. Only adapters declaring `capabilities.executionFencing === true`
 * are treated as fenced.
 */
export interface FencedRemoteAdapter extends ConstrainedActionAdapter {
  /** Same adapter, but every mutation it sends carries this fence. */
  withExecutionFence(fence: ExecutionFence): ConstrainedActionAdapter;
  /**
   * Raise the remote fence to `fence.generation`, waiting for any in-flight
   * call holding the same remote lock, then report what earlier generations did.
   * After this returns, no lower generation can write.
   */
  raiseExecutionFence(action: ConstrainedAction, fence: ExecutionFence): Promise<StaleReservationClassification>;
}

export function supportsExecutionFencing(adapter: ConstrainedActionAdapter): adapter is FencedRemoteAdapter {
  const capabilities = adapter.meta.capabilities as { executionFencing?: unknown } | undefined;
  const candidate = adapter as Partial<FencedRemoteAdapter>;
  return capabilities?.executionFencing === true &&
    typeof candidate.withExecutionFence === 'function' &&
    typeof candidate.raiseExecutionFence === 'function';
}
