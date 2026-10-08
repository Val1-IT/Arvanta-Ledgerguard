import type { OdooJson2Transport, OdooQuantSnapshot } from '../src/types';

export interface FakeQuant extends OdooQuantSnapshot {
  inventoryQuantity?: number;
}

export class FakeOdoo {
  readonly calls: Array<{ model: string; method: string; body: Record<string, unknown> }> = [];
  lieOnApply = false;
  returnConflictWizard = false;
  quant: FakeQuant;

  constructor(quant: FakeQuant) {
    this.quant = { ...quant };
  }

  transport: OdooJson2Transport = async (model, method, body) => {
    this.calls.push({ model, method, body });
    if (method === 'search_read') {
      return [
        {
          id: this.quant.id,
          product_id: [this.quant.productId, 'LEDGERGUARD-DEMO-001'],
          location_id: [this.quant.locationId, 'WH/Stock'],
          company_id: this.quant.companyId ? [this.quant.companyId, 'My Company'] : false,
          quantity: this.quant.quantity,
          write_date: this.quant.writeDate
        }
      ];
    }
    if (method === 'write') {
      const vals = body.vals as { inventory_quantity?: number };
      this.quant.inventoryQuantity = vals.inventory_quantity;
      return true;
    }
    if (method === 'action_apply_inventory') {
      if (this.returnConflictWizard) {
        return { type: 'ir.actions.act_window', res_model: 'stock.inventory.conflict' };
      }
      if (!this.lieOnApply && this.quant.inventoryQuantity !== undefined) {
        this.quant.quantity = this.quant.inventoryQuantity;
        this.quant.writeDate = '2026-09-26 12:00:00';
      }
      return true;
    }
    throw new Error(`unexpected ${model}.${method}`);
  };
}

export const DEMO_QUANT: FakeQuant = {
  id: 42,
  productId: 7,
  locationId: 8,
  companyId: 1,
  quantity: 20,
  writeDate: '2026-09-26 10:00:00'
};
