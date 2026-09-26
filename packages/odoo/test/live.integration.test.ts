import { describe, expect, it } from 'vitest';
import { executeConstrainedAction } from '@ledgerguard/core';
import { inventoryAdjustmentAction, OdooInventoryAdapter, odooQuantFingerprint } from '@ledgerguard/odoo';
import { json2, liveConfig, seedDemoQuant } from './live-bootstrap';

const config = liveConfig();

describe.skipIf(!config)('Odoo 19 live JSON-2', () => {
  it('A/B: reads a real quant and fingerprints it deterministically', async () => {
    const seeded = await seedDemoQuant(config!, 20);
    const adapter = new OdooInventoryAdapter(config!);
    const action = inventoryAdjustmentAction({
      quantId: seeded.quantId,
      productId: seeded.productId,
      locationId: seeded.locationId,
      companyId: seeded.companyId,
      expectedQuantity: seeded.quantity,
      targetQuantity: 10,
      expectedWriteDate: seeded.writeDate
    });
    const first = await adapter.fingerprint(action);
    const second = await adapter.fingerprint(action);
    expect(first).toBe(second);
    expect(first).toBe(
      odooQuantFingerprint({
        id: seeded.quantId,
        productId: seeded.productId,
        locationId: seeded.locationId,
        companyId: seeded.companyId,
        quantity: seeded.quantity,
        writeDate: seeded.writeDate
      })
    );
  });

  it('C: refuses a stale fingerprint without writing', async () => {
    const seeded = await seedDemoQuant(config!, 20);
    const adapter = new OdooInventoryAdapter(config!);
    const action = inventoryAdjustmentAction({
      quantId: seeded.quantId,
      productId: seeded.productId,
      locationId: seeded.locationId,
      companyId: seeded.companyId,
      expectedQuantity: seeded.quantity,
      targetQuantity: 10,
      expectedWriteDate: seeded.writeDate
    });
    const approved = await adapter.fingerprint(action);
    await json2(config!, 'stock.quant', 'write', {
      ids: [seeded.quantId],
      vals: { inventory_quantity: 19 },
      context: { inventory_mode: true }
    });
    await json2(config!, 'stock.quant', 'action_apply_inventory', {
      ids: [seeded.quantId],
      context: { inventory_mode: true }
    });
    const result = await executeConstrainedAction(adapter, action, approved);
    expect(result.outcome).toBe('STALE');
    expect(result.remoteWriteAttempted).toBe(false);
  });

  it('D: adjusts 20 → 10 and independently verifies', async () => {
    const seeded = await seedDemoQuant(config!, 20);
    const adapter = new OdooInventoryAdapter(config!);
    const action = inventoryAdjustmentAction({
      quantId: seeded.quantId,
      productId: seeded.productId,
      locationId: seeded.locationId,
      companyId: seeded.companyId,
      expectedQuantity: seeded.quantity,
      targetQuantity: 10,
      expectedWriteDate: seeded.writeDate
    });
    const result = await executeConstrainedAction(adapter, action, await adapter.fingerprint(action));
    expect(result.outcome).toBe('VERIFIED');
    const quant = await adapter.readQuant(seeded.quantId);
    expect(quant.quantity).toBe(10);
  });

  it('G: classifies an unexpected quantity as ambiguous', async () => {
    const seeded = await seedDemoQuant(config!, 15);
    const adapter = new OdooInventoryAdapter(config!);
    const action = inventoryAdjustmentAction({
      quantId: seeded.quantId,
      productId: seeded.productId,
      locationId: seeded.locationId,
      companyId: seeded.companyId,
      expectedQuantity: 20,
      targetQuantity: 10,
      expectedWriteDate: seeded.writeDate
    });
    expect(await adapter.classifyRecovery(action)).toBe('ambiguous');
  });
});
