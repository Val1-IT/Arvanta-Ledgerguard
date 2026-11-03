import { describe, expect, it } from 'vitest';
import { inventoryAdjustmentAction } from '@ledgerguard/odoo';
import { adapterFromTransport } from '../src/adapter';
import { assertAllowlistedCall } from '../src/allowlist';
import type { OdooJson2Transport } from '../src/types';

const action = inventoryAdjustmentAction({
  quantId: 17, productId: 3, locationId: 8, companyId: 1,
  expectedQuantity: 20, targetQuantity: 10, expectedWriteDate: '2026-10-08 01:00:00'
});
const request = {
  quant_id: 17, product_id: 3, location_id: 8, company_id: 1,
  expected_quantity: 20, target_quantity: 10, expected_write_date: '2026-10-08 01:00:00',
  execution_key: null, fence_generation: null
};
const receipt = {
  protocol: 'ledgerguard.inventory.v2', status: 'applied', replayed: false,
  request, snapshot: {
    id: 17, product_id: 3, location_id: 8, company_id: 1,
    quantity: 10, write_date: '2026-10-08 01:00:01'
  }
};
function fake(response: unknown) {
  const calls: { model: string; method: string; body: Record<string, unknown> }[] = [];
  const transport: OdooJson2Transport = async (model, method, body) => {
    calls.push({ model, method, body });
    return response;
  };
  return { calls, transport };
}

describe('opt-in atomic Odoo inventory boundary', () => {
  it('uses exactly one fixed atomic RPC with the complete approved precondition', async () => {
    const server = fake(receipt);
    const adapter = adapterFromTransport(server.transport, 'odoo-19', { executionMode: 'atomic-addon' });
    expect(await adapter.execute(action)).toMatchObject({ httpSucceeded: true, remoteWriteAttempted: true });
    expect(server.calls).toEqual([{ model: 'stock.quant', method: 'ledgerguard_apply_inventory', body: { request } }]);
    expect(adapter.meta.capabilities).toMatchObject({ atomicInventoryAction: true, durableActionReceipts: true, executionFencing: true, nativeTransactions: false, idempotencyInNativeTransaction: false });
  });

  it('keeps the atomic endpoints disabled in the default transport allowlist', () => {
    expect(() => assertAllowlistedCall('stock.quant', 'ledgerguard_apply_inventory')).toThrow('rejected method');
    expect(() => assertAllowlistedCall('stock.quant', 'ledgerguard_inventory_status')).toThrow('rejected method');
    expect(() => assertAllowlistedCall('stock.quant', 'write', 'atomic-addon')).toThrow('rejected method');
    expect(() => assertAllowlistedCall('stock.quant', 'action_apply_inventory', 'atomic-addon')).toThrow('rejected method');
  });

  it('reports server precondition failure without attempting legacy fallback', async () => {
    const server = fake({ protocol: receipt.protocol, status: 'stale', request, detail: 'quantity changed' });
    const adapter = adapterFromTransport(server.transport, 'odoo-19', { executionMode: 'atomic-addon' });
    expect(await adapter.execute(action)).toMatchObject({ httpSucceeded: false, stale: true, remoteWriteAttempted: false });
    expect(server.calls).toHaveLength(1);
  });

  it('accepts a verified durable replay without another adjustment', async () => {
    const server = fake({ ...receipt, replayed: true });
    const adapter = adapterFromTransport(server.transport, 'odoo-19', { executionMode: 'atomic-addon' });
    expect(await adapter.execute(action)).toMatchObject({ httpSucceeded: true, remoteWriteAttempted: false });
  });

  it.each([
    null,
    { protocol: receipt.protocol, status: 'stale' },
    { protocol: receipt.protocol, status: 'stale', request: { ...request, quant_id: 18 } },
    { ...receipt, protocol: 'other' },
    { ...receipt, snapshot: { ...receipt.snapshot, quantity: 9 } },
    { ...receipt, snapshot: { ...receipt.snapshot, company_id: 2 } },
    { ...receipt, snapshot: { ...receipt.snapshot, id: 18 } },
    { ...receipt, request: { ...request, expected_quantity: 19 } },
    { ...receipt, replayed: 'yes' }
  ])('fails closed on an unbound or malformed response %j', async (response) => {
    const server = fake(response);
    const adapter = adapterFromTransport(server.transport, 'odoo-19', { executionMode: 'atomic-addon' });
    expect(await adapter.execute(action)).toMatchObject({ httpSucceeded: false, recoveryRequired: true, remoteWriteAttempted: true });
    expect(server.calls).toHaveLength(1);
  });

  it.each([{ quantId: Number.MAX_SAFE_INTEGER + 1 }, { targetQuantity: Number.MAX_SAFE_INTEGER + 1 }, { expectedQuantity: -Number.MAX_SAFE_INTEGER - 1 }])('rejects unsafe numbers before atomic RPC %j', async (overrides) => {
    const server = fake(receipt);
    const adapter = adapterFromTransport(server.transport, 'odoo-19', { executionMode: 'atomic-addon' });
    expect(await adapter.execute({ ...action, ...overrides, target: { ...action.target, resourceId: String(overrides.quantId ?? action.quantId) } })).toMatchObject({ httpSucceeded: false });
    expect(server.calls).toHaveLength(0);
  });

  it('does not fall back when the addon is absent or the network fails', async () => {
    let calls = 0;
    const adapter = adapterFromTransport(async () => { calls++; throw new Error('missing endpoint'); }, 'odoo-19', { executionMode: 'atomic-addon' });
    await expect(adapter.execute(action)).rejects.toThrow('missing endpoint');
    expect(calls).toBe(1);
  });

  it('uses an action-bound durable receipt for recovery', async () => {
    const server = fake({ ...receipt, replayed: true });
    const adapter = adapterFromTransport(server.transport, 'odoo-19', { executionMode: 'atomic-addon' });
    expect(await adapter.classifyRecovery(action)).toBe('applied');
    expect(server.calls[0]).toEqual({ model: 'stock.quant', method: 'ledgerguard_inventory_status', body: { request } });
  });

  it('does not infer applied solely because the remote quantity equals the target', async () => {
    const server = fake({ protocol: receipt.protocol, status: 'not_applied', request });
    const adapter = adapterFromTransport(server.transport, 'odoo-19', { executionMode: 'atomic-addon' });
    expect(await adapter.classifyRecovery(action)).toBe('not_applied');
  });

  it('keeps recovery ambiguous when a receipt exists but its current postcondition has drifted', async () => {
    const server = fake({ protocol: receipt.protocol, status: 'ambiguous', request });
    const adapter = adapterFromTransport(server.transport, 'odoo-19', { executionMode: 'atomic-addon' });
    expect(await adapter.classifyRecovery(action)).toBe('ambiguous');
  });

  it.each(['2026-02-31 00:00:00', '2026-10-08 01:00:00 extra', '2026-10-08T01:00:00Z'])('rejects a noncanonical timestamp before atomic RPC %s', async (expectedWriteDate) => {
    const server = fake(receipt);
    const adapter = adapterFromTransport(server.transport, 'odoo-19', { executionMode: 'atomic-addon' });
    expect(await adapter.execute({ ...action, expectedWriteDate })).toMatchObject({ httpSucceeded: false });
    expect(server.calls).toHaveLength(0);
  });
});

describe('Odoo execution fence (protocol v2)', () => {
  const fence = { executionKey: 'remediation:plan-odoo-1:2', generation: 3 };
  const fencedRequest = { ...request, execution_key: fence.executionKey, fence_generation: 3 };
  const fencedReceipt = { ...receipt, request: fencedRequest };

  it('sends the execution key and lease generation with every fenced apply', async () => {
    const server = fake(fencedReceipt);
    const adapter = adapterFromTransport(server.transport, 'odoo-19', { executionMode: 'atomic-addon' }).withExecutionFence(fence);
    expect(await adapter.execute(action)).toMatchObject({ httpSucceeded: true });
    expect(server.calls).toEqual([{ model: 'stock.quant', method: 'ledgerguard_apply_inventory', body: { request: fencedRequest } }]);
  });

  it('maps a server-side fence rejection to a no-write stale result', async () => {
    const server = fake({ protocol: receipt.protocol, status: 'fenced', request: fencedRequest, fence_generation: 4 });
    const adapter = adapterFromTransport(server.transport, 'odoo-19', { executionMode: 'atomic-addon' }).withExecutionFence(fence);
    expect(await adapter.execute(action)).toMatchObject({ httpSucceeded: false, stale: true, remoteWriteAttempted: false });
  });

  it('fails closed when a fenced response is bound to another generation', async () => {
    const server = fake({ ...fencedReceipt, request: { ...fencedRequest, fence_generation: 2 } });
    const adapter = adapterFromTransport(server.transport, 'odoo-19', { executionMode: 'atomic-addon' }).withExecutionFence(fence);
    expect(await adapter.execute(action)).toMatchObject({ httpSucceeded: false, recoveryRequired: true });
  });

  it('raises the fence and classifies from the bound response', async () => {
    for (const [response, expected] of [
      [{ protocol: receipt.protocol, status: 'not_applied', request: fencedRequest, fence_generation: 3 }, 'not_applied'],
      [{ ...fencedReceipt, replayed: true, fence_generation: 3 }, 'applied'],
      [{ protocol: receipt.protocol, status: 'ambiguous', request: fencedRequest, fence_generation: 3 }, 'ambiguous'],
      [{ protocol: receipt.protocol, status: 'not_applied', request: fencedRequest, fence_generation: 2 }, 'ambiguous'],
      [{ protocol: receipt.protocol, status: 'not_applied', request }, 'ambiguous']
    ] as const) {
      const server = fake(response);
      const adapter = adapterFromTransport(server.transport, 'odoo-19', { executionMode: 'atomic-addon' });
      expect(await adapter.raiseExecutionFence(action, fence)).toBe(expected);
      expect(server.calls).toEqual([{ model: 'stock.quant', method: 'ledgerguard_raise_fence', body: { request: fencedRequest } }]);
    }
  });

  it('refuses fencing in JSON-2 mode and invalid fences', () => {
    const json2 = adapterFromTransport(async () => null);
    expect(json2.meta.capabilities.executionFencing).toBe(false);
    expect(() => json2.withExecutionFence(fence)).toThrow('atomic-addon');
    const atomic = adapterFromTransport(async () => null, 'odoo-19', { executionMode: 'atomic-addon' });
    for (const bad of [{ ...fence, generation: 0 }, { ...fence, generation: 1.5 }, { ...fence, executionKey: '' }, { ...fence, executionKey: 'has space' }, { ...fence, executionKey: 'x'.repeat(201) }]) {
      expect(() => atomic.withExecutionFence(bad)).toThrow('Invalid execution fence');
    }
  });

  it('keeps the raise-fence endpoint out of the JSON-2 allowlist', () => {
    expect(() => assertAllowlistedCall('stock.quant', 'ledgerguard_raise_fence')).toThrow('rejected method');
    expect(() => assertAllowlistedCall('stock.quant', 'ledgerguard_raise_fence', 'atomic-addon')).not.toThrow();
  });
});
