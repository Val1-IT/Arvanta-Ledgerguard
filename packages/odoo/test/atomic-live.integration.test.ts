import { describe, expect, it } from 'vitest';
import { inventoryAdjustmentAction, OdooInventoryAdapter } from '@ledgerguard/odoo';
import { liveConfig, seedDemoQuant, json2 } from './live-bootstrap';

const config = liveConfig();
function actionFor(seeded: Awaited<ReturnType<typeof seedDemoQuant>>, targetQuantity: number) {
  return inventoryAdjustmentAction({
    quantId: seeded.quantId, productId: seeded.productId, locationId: seeded.locationId,
    companyId: seeded.companyId, expectedQuantity: seeded.quantity,
    targetQuantity, expectedWriteDate: seeded.writeDate
  });
}

describe.skipIf(!config)('Odoo 19 atomic addon JSON-2', () => {
  it('applies once and replays a durable action-bound receipt', async () => {
    const seeded = await seedDemoQuant(config!, 20);
    const adapter = new OdooInventoryAdapter(config!, { executionMode: 'atomic-addon' });
    const action = actionFor(seeded, 7);
    expect(await adapter.execute(action)).toMatchObject({ httpSucceeded: true, remoteWriteAttempted: true });
    expect(await adapter.verify(action)).toMatchObject({ pass: true });
    expect(await adapter.execute(action)).toMatchObject({ httpSucceeded: true, remoteWriteAttempted: false });
    expect(await adapter.classifyRecovery(action)).toBe('applied');
  });

  it('serializes duplicate concurrent submissions into one inventory adjustment', async () => {
    const seeded = await seedDemoQuant(config!, 20);
    const adapter = new OdooInventoryAdapter(config!, { executionMode: 'atomic-addon' });
    const action = actionFor(seeded, 8);
    const [left, right] = await Promise.all([adapter.execute(action), adapter.execute(action)]);
    expect(left.httpSucceeded).toBe(true);
    expect(right.httpSucceeded).toBe(true);
    expect([left.remoteWriteAttempted, right.remoteWriteAttempted].filter(Boolean)).toHaveLength(1);
    expect(await adapter.verify(action)).toMatchObject({ pass: true });
    expect(await adapter.classifyRecovery(action)).toBe('applied');
  });

  it('allows only one of two different targets approved from the same state', async () => {
    const seeded = await seedDemoQuant(config!, 20);
    const adapter = new OdooInventoryAdapter(config!, { executionMode: 'atomic-addon' });
    const actions = [actionFor(seeded, 5), actionFor(seeded, 6)];
    const results = await Promise.all(actions.map((action) => adapter.execute(action)));
    expect(results.filter((result) => result.httpSucceeded)).toHaveLength(1);
    expect(results.filter((result) => result.stale && !result.remoteWriteAttempted)).toHaveLength(1);
    const winner = results.findIndex((result) => result.httpSucceeded);
    const loser = winner === 0 ? 1 : 0;
    expect((await adapter.readQuant(seeded.quantId)).quantity).toBe(actions[winner].targetQuantity);
    expect(await adapter.verify(actions[winner])).toMatchObject({ pass: true });
    expect(await adapter.classifyRecovery(actions[winner])).toBe('applied');
    expect(await adapter.classifyRecovery(actions[loser])).toBe('not_applied');
  });

  it('rechecks drift in the same server transaction and leaves no receipt', async () => {
    const seeded = await seedDemoQuant(config!, 20);
    const adapter = new OdooInventoryAdapter(config!, { executionMode: 'atomic-addon' });
    const action = actionFor(seeded, 9);
    await json2(config!, 'stock.quant', 'write', {
      ids: [seeded.quantId], vals: { inventory_quantity: 19 }, context: { inventory_mode: true }
    });
    await json2(config!, 'stock.quant', 'action_apply_inventory', {
      ids: [seeded.quantId], context: { inventory_mode: true }
    });
    expect(await adapter.execute(action)).toMatchObject({ httpSucceeded: false, stale: true, remoteWriteAttempted: false });
    expect(await adapter.classifyRecovery(action)).toBe('not_applied');
    expect((await adapter.readQuant(seeded.quantId)).quantity).toBe(19);
  });
});
