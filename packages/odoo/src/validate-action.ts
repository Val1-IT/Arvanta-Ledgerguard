import type { ConstrainedAction } from '@ledgerguard/core';
import type { OdooInventoryAdjustmentAction } from './types';

function positiveInteger(value: unknown, field: string): string | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return `${field} must be a positive integer`;
  }
  return null;
}

function finiteNumber(value: unknown, field: string): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `${field} must be a finite number`;
  }
  return null;
}

function isOdooDatetime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(value);
}

export function validateInventoryAdjustmentAction(
  action: ConstrainedAction
): { ok: true; action: OdooInventoryAdjustmentAction } | { ok: false; reason: string } {
  if (action.type !== 'ODOO_INVENTORY_ADJUSTMENT') {
    return { ok: false, reason: `unsupported action ${action.type}` };
  }
  const inventory = action as OdooInventoryAdjustmentAction;
  if (inventory.target?.systemType !== 'odoo' || inventory.target.resourceType !== 'stock.quant') {
    return { ok: false, reason: 'action target is not odoo stock.quant' };
  }
  const quantIdError = positiveInteger(inventory.quantId, 'quantId');
  if (quantIdError) return { ok: false, reason: quantIdError };
  const productError = positiveInteger(inventory.productId, 'productId');
  if (productError) return { ok: false, reason: productError };
  const locationError = positiveInteger(inventory.locationId, 'locationId');
  if (locationError) return { ok: false, reason: locationError };
  if (inventory.companyId !== null) {
    const companyError = positiveInteger(inventory.companyId, 'companyId');
    if (companyError) return { ok: false, reason: companyError };
  }
  const expectedQtyError = finiteNumber(inventory.expectedQuantity, 'expectedQuantity');
  if (expectedQtyError) return { ok: false, reason: expectedQtyError };
  const targetQtyError = finiteNumber(inventory.targetQuantity, 'targetQuantity');
  if (targetQtyError) return { ok: false, reason: targetQtyError };
  if (typeof inventory.expectedWriteDate !== 'string' || inventory.expectedWriteDate.trim() === '') {
    return { ok: false, reason: 'expectedWriteDate must be a non-empty Odoo datetime' };
  }
  if (!isOdooDatetime(inventory.expectedWriteDate)) {
    return { ok: false, reason: 'expectedWriteDate is not a valid Odoo datetime' };
  }
  if (inventory.target.resourceId !== String(inventory.quantId)) {
    return { ok: false, reason: 'action target resourceId does not match quantId' };
  }
  return { ok: true, action: inventory };
}

export function companiesMatch(left: number | null, right: number | null): boolean {
  return left === right;
}
