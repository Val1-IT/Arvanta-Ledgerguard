import { createHash } from 'node:crypto';
import type { OdooQuantSnapshot } from './types';

function many2oneId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'number') {
    return value[0];
  }
  if (value === false || value === null || value === undefined) {
    return null;
  }
  return null;
}

export function parseQuantRecord(record: Record<string, unknown>): OdooQuantSnapshot {
  const id = Number(record.id);
  const productId = many2oneId(record.product_id);
  const locationId = many2oneId(record.location_id);
  if (!Number.isInteger(id) || productId === null || locationId === null) {
    throw new Error('Odoo stock.quant record is missing identity fields');
  }
  return {
    id,
    productId,
    locationId,
    companyId: many2oneId(record.company_id),
    quantity: Number(record.quantity),
    writeDate: String(record.write_date ?? '')
  };
}

export function odooQuantFingerprint(quant: OdooQuantSnapshot): string {
  const material = [
    `quantId=${quant.id}`,
    `productId=${quant.productId}`,
    `locationId=${quant.locationId}`,
    `companyId=${quant.companyId ?? 'null'}`,
    `quantity=${quant.quantity}`,
    `writeDate=${quant.writeDate}`
  ].join('|');
  return createHash('sha256').update(material).digest('hex');
}

export function quantitiesEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 1e-6;
}
