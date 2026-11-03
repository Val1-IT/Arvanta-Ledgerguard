import type { OdooJson2Transport } from '../src/types';
import type { FakeQuant } from './fake-odoo';

type AtomicRequest = Record<string, unknown> & {
  quant_id: number; expected_quantity: number; target_quantity: number; expected_write_date: string;
  execution_key: string | null; fence_generation: number | null;
};

const PROTOCOL = 'ledgerguard.inventory.v2';
const withoutGeneration = (request: AtomicRequest) => JSON.stringify({ ...request, fence_generation: undefined });

/**
 * In-process model of the ledgerguard_inventory addon (protocol v2) for tests:
 * one row lock per quant, durable receipts, and the per-key execution fence.
 * `holdNextApply()` keeps the next apply "on the wire" (sent, not yet
 * delivered to Odoo) until released, to model a stale worker's in-flight call.
 */
export class FakeAtomicOdoo {
  readonly calls: Array<{ method: string; request?: AtomicRequest }> = [];
  readonly receipts: Array<{ request: AtomicRequest; snapshot: Record<string, unknown> }> = [];
  readonly fences = new Map<string, number>();
  writes = 0;
  quant: FakeQuant;
  private lock: Promise<unknown> = Promise.resolve();
  private held: { release: () => void; delivered: Promise<void> } | null = null;
  private holdRequested = false;

  constructor(quant: FakeQuant) {
    this.quant = { ...quant };
  }

  /** The next apply waits before reaching Odoo; resolve the returned release() to deliver it. */
  holdNextApply(): void {
    this.holdRequested = true;
  }

  release(): void {
    this.held?.release();
  }

  get applyInFlight(): boolean {
    return this.held !== null;
  }

  private serialized<T>(work: () => T): Promise<T> {
    const next = this.lock.then(work);
    this.lock = next.catch(() => undefined);
    return next;
  }

  private snapshot() {
    return { id: this.quant.id, product_id: this.quant.productId, location_id: this.quant.locationId,
      company_id: this.quant.companyId, quantity: this.quant.quantity, write_date: this.quant.writeDate };
  }

  private keyReceipt(request: AtomicRequest) {
    const found = [...this.receipts].reverse().find((r) => r.request.execution_key === request.execution_key);
    if (found && withoutGeneration(found.request) !== withoutGeneration(request)) throw new Error('execution key bound to a different action');
    return found;
  }

  private replay(request: AtomicRequest, prior: { snapshot: Record<string, unknown> }) {
    const current = this.snapshot();
    if (JSON.stringify(current) !== JSON.stringify(prior.snapshot)) return { protocol: PROTOCOL, status: 'ambiguous', request };
    return { protocol: PROTOCOL, status: 'applied', replayed: true, request, snapshot: prior.snapshot };
  }

  transport: OdooJson2Transport = async (_model, method, body) => {
    const request = (body as { request?: AtomicRequest }).request;
    this.calls.push({ method, request });
    if (method === 'search_read') {
      return [{
        id: this.quant.id, product_id: [this.quant.productId, 'P'], location_id: [this.quant.locationId, 'L'],
        company_id: this.quant.companyId ? [this.quant.companyId, 'C'] : false,
        quantity: this.quant.quantity, write_date: this.quant.writeDate
      }];
    }
    if (!request) throw new Error('request required');
    if (method === 'ledgerguard_apply_inventory') {
      if (this.holdRequested) {
        this.holdRequested = false;
        let release!: () => void;
        const delivered = new Promise<void>((resolve) => { release = resolve; });
        this.held = { release, delivered };
        await delivered;
        this.held = null;
      }
      return this.serialized(() => {
        const key = request.execution_key;
        if (key !== null) {
          const fence = this.fences.get(key);
          if (fence !== undefined && Number(request.fence_generation) < fence) {
            return { protocol: PROTOCOL, status: 'fenced', request, fence_generation: fence };
          }
          this.fences.set(key, Math.max(fence ?? 0, Number(request.fence_generation)));
        }
        const exact = this.receipts.find((r) => JSON.stringify(r.request) === JSON.stringify(request));
        if (exact) return this.replay(request, exact);
        if (this.quant.quantity !== request.expected_quantity || this.quant.writeDate !== request.expected_write_date) {
          return { protocol: PROTOCOL, status: 'stale', request, detail: 'precondition changed' };
        }
        this.writes += 1;
        this.quant.quantity = request.target_quantity;
        this.quant.writeDate = '2026-09-26 12:00:00';
        const snapshot = this.snapshot();
        this.receipts.push({ request, snapshot });
        return { protocol: PROTOCOL, status: 'applied', replayed: false, request, snapshot };
      });
    }
    if (method === 'ledgerguard_raise_fence') {
      return this.serialized(() => {
        const key = String(request.execution_key);
        const generation = Number(request.fence_generation);
        this.fences.set(key, Math.max(this.fences.get(key) ?? 0, generation));
        const prior = this.keyReceipt(request);
        if (prior) return { ...this.replay(request, prior), fence_generation: generation };
        return { protocol: PROTOCOL, status: 'not_applied', request, fence_generation: generation };
      });
    }
    if (method === 'ledgerguard_inventory_status') {
      return this.serialized(() => {
        const prior = request.execution_key === null
          ? this.receipts.find((r) => JSON.stringify(r.request) === JSON.stringify(request))
          : this.keyReceipt(request);
        return prior ? this.replay(request, prior) : { protocol: PROTOCOL, status: 'not_applied', request };
      });
    }
    throw new Error(`unexpected ${method}`);
  };
}
