import { quantitiesEqual } from './fingerprint';
import type { OdooInventoryAdjustmentAction } from './types';

/** v2 adds the execution fence (execution_key + fence_generation; both null when unfenced). */
export const ATOMIC_PROTOCOL = 'ledgerguard.inventory.v2';

export interface OdooExecutionFence {
  executionKey: string;
  generation: number;
}

export const MAX_EXECUTION_KEY_LENGTH = 200;

export function isValidExecutionFence(fence: OdooExecutionFence): boolean {
  return typeof fence.executionKey === 'string' && /^[\x21-\x7e]{1,200}$/.test(fence.executionKey) &&
    Number.isSafeInteger(fence.generation) && fence.generation > 0;
}

export function atomicRequest(action: OdooInventoryAdjustmentAction, fence?: OdooExecutionFence) {
  return {
    quant_id: action.quantId,
    product_id: action.productId,
    location_id: action.locationId,
    company_id: action.companyId,
    expected_quantity: action.expectedQuantity,
    target_quantity: action.targetQuantity,
    expected_write_date: action.expectedWriteDate,
    execution_key: fence?.executionKey ?? null,
    fence_generation: fence?.generation ?? null
  };
}

export function isCanonicalOdooDatetime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return false;
  const parsed = new Date(value.replace(' ', 'T') + 'Z');
  return parsed.getUTCFullYear() >= 1 && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19).replace('T', ' ') === value;
}

export function isAtomicResponse(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
    (value as Record<string, unknown>).protocol === ATOMIC_PROTOCOL);
}

export function isBoundAtomicResponse(value: unknown, action: OdooInventoryAdjustmentAction, fence?: OdooExecutionFence): value is Record<string, unknown> {
  if (!isAtomicResponse(value) || !value.request || typeof value.request !== 'object') return false;
  const expected = atomicRequest(action, fence);
  const actual = value.request as Record<string, unknown>;
  return Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, field]) => actual[key] === field);
}

export function isVerifiedAtomicReceipt(value: unknown, action: OdooInventoryAdjustmentAction, fence?: OdooExecutionFence): value is Record<string, unknown> & { replayed: boolean } {
  if (!isBoundAtomicResponse(value, action, fence) || value.status !== 'applied' || typeof value.replayed !== 'boolean') return false;
  if (!value.snapshot || typeof value.snapshot !== 'object') return false;
  const snapshot = value.snapshot as Record<string, unknown>;
  return snapshot.id === action.quantId && snapshot.product_id === action.productId &&
    snapshot.location_id === action.locationId && snapshot.company_id === action.companyId &&
    typeof snapshot.quantity === 'number' && Number.isFinite(snapshot.quantity) &&
    quantitiesEqual(snapshot.quantity, action.targetQuantity) && isCanonicalOdooDatetime(snapshot.write_date);
}
