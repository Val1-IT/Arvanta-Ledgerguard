import { quantitiesEqual } from './fingerprint';
import type { OdooInventoryAdjustmentAction } from './types';

export const ATOMIC_PROTOCOL = 'ledgerguard.inventory.v1';
export function atomicRequest(action: OdooInventoryAdjustmentAction) {
  return {
    quant_id: action.quantId,
    product_id: action.productId,
    location_id: action.locationId,
    company_id: action.companyId,
    expected_quantity: action.expectedQuantity,
    target_quantity: action.targetQuantity,
    expected_write_date: action.expectedWriteDate
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

export function isBoundAtomicResponse(value: unknown, action: OdooInventoryAdjustmentAction): value is Record<string, unknown> {
  if (!isAtomicResponse(value) || !value.request || typeof value.request !== 'object') return false;
  const expected = atomicRequest(action);
  const actual = value.request as Record<string, unknown>;
  return Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, field]) => actual[key] === field);
}

export function isVerifiedAtomicReceipt(value: unknown, action: OdooInventoryAdjustmentAction): value is Record<string, unknown> & { replayed: boolean } {
  if (!isBoundAtomicResponse(value, action) || value.status !== 'applied' || typeof value.replayed !== 'boolean') return false;
  if (!value.snapshot || typeof value.snapshot !== 'object') return false;
  const snapshot = value.snapshot as Record<string, unknown>;
  return snapshot.id === action.quantId && snapshot.product_id === action.productId &&
    snapshot.location_id === action.locationId && snapshot.company_id === action.companyId &&
    typeof snapshot.quantity === 'number' && Number.isFinite(snapshot.quantity) &&
    quantitiesEqual(snapshot.quantity, action.targetQuantity) && isCanonicalOdooDatetime(snapshot.write_date);
}
