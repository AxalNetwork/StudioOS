/**
 * D5338 (#5338): an `AI_GOVERNOR` namespace for tests, backed by the real
 * `AiGovernor` class. Each object name has its own storage map, which outlives
 * the instance: `restart(name)` drops the instance (an eviction, a restart or
 * a deploy) and the next call builds a new one over the same storage, the way
 * the platform does. `storage` is exposed so a test can read what is durable.
 */
import { AiGovernor } from '../src/durable-objects/ai-governor.ts';

export function governorNamespace() {
  const stores = new Map<string, Map<string, unknown>>();
  const instances = new Map<string, AiGovernor>();
  const calls: string[] = [];
  const storageFor = (name: string) => {
    let m = stores.get(name);
    if (!m) { m = new Map(); stores.set(name, m); }
    // A structured clone on the way in and out, as Durable Object storage does: no shared references survive.
    return {
      get: async (k: string) => (m!.has(k) ? structuredClone(m!.get(k)) : undefined),
      put: async (k: string, v: unknown) => { m!.set(k, structuredClone(v)); },
    };
  };
  const instance = (name: string) => {
    let g = instances.get(name);
    if (!g) { g = new AiGovernor({ storage: storageFor(name) } as any, {} as any); instances.set(name, g); }
    return g;
  };
  const ns: any = {
    idFromName: (name: string) => ({ name, toString: () => name }),
    get: (id: { name: string }) => ({
      fetch: async (url: string, init?: RequestInit) => {
        calls.push(`${id.name} ${new URL(url).pathname}`);
        return instance(id.name).fetch(new Request(url, init));
      },
    }),
  };
  return {
    ns, calls, stores,
    restart: (name?: string) => { if (name) instances.delete(name); else instances.clear(); },
    /** The upstream state as stored, for one object. */
    stored: (name: string) => stores.get(name)?.get('upstream') as any,
  };
}
