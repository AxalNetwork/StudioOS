/** D7889: a narrow provider boundary; no verified live Jelastic adapter is shipped. */
import type { ScaleOperation } from './lib/runnerScalePolicy.ts';

export interface ProviderInstance { providerId: string; reservation: string | null; owned: boolean }
export interface RunnerScaleProvider {
  readonly provider: 'jelastic';
  readonly apiVerified: boolean;
  create(operation: ScaleOperation): Promise<ProviderInstance>;
  inspect(providerId: string): Promise<{ healthy: boolean | null; assignment: 'none' | 'owned' | 'unowned' | 'unknown' }>;
  drain(providerId: string): Promise<{ eligibilityRemoved: boolean }>;
  stopDelete(providerId: string): Promise<{ deleted: boolean }>;
  reconcile(cursor: string | null): Promise<{ instances: ProviderInstance[]; next: string | null }>;
}

/** Missing provider API/account review is a hard stop, never a pretend console API. */
export class UnavailableRunnerProvider implements RunnerScaleProvider {
  readonly provider = 'jelastic' as const;
  readonly apiVerified = false;
  async create(_operation: ScaleOperation): Promise<ProviderInstance> { throw Error('provider_api_unverified'); }
  async inspect(_providerId: string): Promise<{ healthy: boolean | null; assignment: 'unknown' }> { throw Error('provider_api_unverified'); }
  async drain(_providerId: string): Promise<{ eligibilityRemoved: boolean }> { throw Error('provider_api_unverified'); }
  async stopDelete(_providerId: string): Promise<{ deleted: boolean }> { throw Error('provider_api_unverified'); }
  async reconcile(_cursor: string | null): Promise<{ instances: ProviderInstance[]; next: string | null }> { throw Error('provider_api_unverified'); }
}

/** One shared request budget; partial, repeated or rate-limited pages are unavailable capacity. */
export async function collectProviderInventory(provider: RunnerScaleProvider, budget: { remaining: number }, cursor: string | null = null,
  checkpoint?: { staged: ProviderInstance[]; persist: (snapshot: { cursor: string | null; instances: ProviderInstance[]; complete: boolean }) => Promise<void> }) {
  if (!provider.apiVerified || !Number.isSafeInteger(budget.remaining) || budget.remaining < 1 || budget.remaining > 100) throw Error('provider_api_unverified');
  const seen = new Set<string>(cursor == null ? [] : [cursor]); const instances = structuredClone(checkpoint?.staged ?? []);
  const ids = new Set<string>(instances.map((i) => i.providerId));
  if (instances.length > 1000 || ids.size !== instances.length || (instances.length && cursor == null)) throw Error('provider_checkpoint_invalid');
  for (let page = 0; page < 20; page++) {
    if (budget.remaining <= 0) throw Error('provider_request_cap');
    budget.remaining--;
    let result;
    try { result = await provider.reconcile(cursor); } catch { throw Error('provider_inventory_unavailable'); }
    if (!Array.isArray(result.instances) || result.instances.length > 100 || instances.length + result.instances.length > 1000) throw Error('provider_inventory_bound');
    for (const instance of result.instances) {
      if (typeof instance.providerId !== 'string' || !instance.providerId || ids.has(instance.providerId)) throw Error('provider_inventory_duplicate');
      ids.add(instance.providerId); instances.push(instance);
    }
    if (result.next === null) {
      if (checkpoint) await checkpoint.persist({ cursor: null, instances: structuredClone(instances), complete: true });
      return { complete: true as const, instances, cursor: null };
    }
    if (typeof result.next !== 'string' || !result.next || result.next.length > 1024 || seen.has(result.next)) throw Error('provider_cursor_invalid');
    seen.add(result.next); cursor = result.next;
    if (checkpoint) await checkpoint.persist({ cursor, instances: structuredClone(instances), complete: false });
  }
  throw Error('provider_page_cap');
}
