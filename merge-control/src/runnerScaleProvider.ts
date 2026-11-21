/** D7889: a narrow provider boundary; no verified live Jelastic adapter is shipped. */
import { validInventoryInstance, type ScaleOperation } from './lib/runnerScalePolicy.ts';

export interface ProviderInstance { providerId: string; reservation: string | null; owned: boolean }
export type ProviderInspection =
  | { presence: 'present'; providerId: string; healthy: boolean | null; assignment: 'none' | 'owned' | 'unowned' | 'unknown' }
  | { presence: 'absent'; providerId: string | null; healthy: null; assignment: 'none' }
  | { presence: 'unavailable'; providerId: null; healthy: null; assignment: 'unknown' };
export interface RunnerScaleProvider {
  readonly provider: 'jelastic';
  readonly apiVerified: boolean;
  create(operation: ScaleOperation): Promise<ProviderInstance>;
  inspect(target: { providerId: string | null; reservation: string }): Promise<ProviderInspection>;
  drain(providerId: string): Promise<{ eligibilityRemoved: boolean }>;
  stopDelete(providerId: string): Promise<{ deleted: boolean }>;
  reconcile(cursor: string | null): Promise<{ instances: ProviderInstance[]; next: string | null }>;
}

/** Missing provider API/account review is a hard stop, never a pretend console API. */
export class UnavailableRunnerProvider implements RunnerScaleProvider {
  readonly provider = 'jelastic' as const;
  readonly apiVerified = false;
  async create(_operation: ScaleOperation): Promise<ProviderInstance> { throw Error('provider_api_unverified'); }
  async inspect(_target: { providerId: string | null; reservation: string }): Promise<ProviderInspection> { throw Error('provider_api_unverified'); }
  async drain(_providerId: string): Promise<{ eligibilityRemoved: boolean }> { throw Error('provider_api_unverified'); }
  async stopDelete(_providerId: string): Promise<{ deleted: boolean }> { throw Error('provider_api_unverified'); }
  async reconcile(_cursor: string | null): Promise<{ instances: ProviderInstance[]; next: string | null }> { throw Error('provider_api_unverified'); }
}

/** A durable scan prefix, including attempts made before a failed provider response. */
export interface ProviderInventoryCheckpoint {
  cursor: string | null; instances: ProviderInstance[]; complete: boolean;
  requestsUsed: number; pages: number; seen: string[];
}

/** One shared request budget; partial, repeated or rate-limited pages are unavailable capacity. */
export async function collectProviderInventory(provider: RunnerScaleProvider, budget: { remaining: number }, cursor: string | null = null,
  checkpoint?: { snapshot: ProviderInventoryCheckpoint; persist: (snapshot: ProviderInventoryCheckpoint) => Promise<void> }) {
  if (!provider.apiVerified || !Number.isSafeInteger(budget.remaining) || budget.remaining < 1 || budget.remaining > 100) throw Error('provider_api_unverified');
  if (cursor !== null && !checkpoint) throw Error('provider_checkpoint_invalid');
  const scan = structuredClone(checkpoint?.snapshot ?? { cursor: null, instances: [], complete: false, requestsUsed: 0, pages: 0, seen: [] });
  if (scan.complete !== false || scan.cursor !== cursor || !Array.isArray(scan.instances) || scan.instances.length > 1000
      || !scan.instances.every(validInventoryInstance) || new Set(scan.instances.map((i) => i.providerId)).size !== scan.instances.length
      || !Number.isSafeInteger(scan.pages) || scan.pages < 0 || scan.pages > 20
      || !Number.isSafeInteger(scan.requestsUsed) || scan.requestsUsed < scan.pages || scan.requestsUsed > 100
      || !Array.isArray(scan.seen) || scan.seen.length !== scan.pages || new Set(scan.seen).size !== scan.seen.length
      || scan.seen.some((c) => typeof c !== 'string' || !c || c.length > 1024)
      || (scan.pages === 0 ? cursor !== null || scan.instances.length !== 0 : scan.seen.at(-1) !== cursor)) throw Error('provider_checkpoint_invalid');
  const ids = new Set(scan.instances.map((i) => i.providerId));
  const persist = async () => { if (checkpoint) await checkpoint.persist(structuredClone(scan)); };
  while (true) {
    if (scan.pages >= 20) throw Error('provider_page_cap');
    if (budget.remaining <= 0 || scan.requestsUsed >= 100) throw Error('provider_request_cap');
    budget.remaining--; scan.requestsUsed++;
    // Persist the attempt before the effect; a crash/failure must not reset the request ceiling.
    await persist();
    let result;
    try { result = await provider.reconcile(scan.cursor); } catch { throw Error('provider_inventory_unavailable'); }
    if (!result || typeof result !== 'object') throw Error('provider_inventory_unavailable');
    if (!Array.isArray(result.instances) || result.instances.length > 100 || scan.instances.length + result.instances.length > 1000) throw Error('provider_inventory_bound');
    for (const instance of result.instances) {
      if (!validInventoryInstance(instance)) throw Error('provider_inventory_invalid');
      if (ids.has(instance.providerId)) throw Error('provider_inventory_duplicate');
      ids.add(instance.providerId);
    }
    if (result.next !== null && (typeof result.next !== 'string' || !result.next || result.next.length > 1024 || scan.seen.includes(result.next))) throw Error('provider_cursor_invalid');
    scan.instances.push(...structuredClone(result.instances)); scan.pages++;
    scan.cursor = result.next; scan.complete = result.next === null;
    if (result.next !== null) scan.seen.push(result.next);
    await persist();
    if (scan.complete) return { complete: true as const, instances: scan.instances, cursor: null };
  }
}
