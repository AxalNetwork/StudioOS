/**
 * Typed KV helpers for the Cloudflare Worker.
 *
 * We deliberately do NOT add a separate `CACHE` namespace — short-lived
 * caches share the existing `TOKENS` binding behind a `cache:` key prefix.
 * That keeps the wrangler.toml footprint small and the per-request KV
 * latency identical (one binding, one namespace).
 *
 * Conventions:
 *  - All values are JSON-encoded on put and JSON-decoded on get. Pass raw
 *    strings via the `*Raw` variants if you need to skip serialization.
 *  - TTLs are clamped to KV's 60s minimum and 24h soft-max for cache use.
 *  - Failures fail-soft: get() returns null, put()/delete() swallow errors
 *    and log. Caching must never take down a request path.
 */

const MIN_TTL = 60;            // CF KV minimum
const DEFAULT_CACHE_TTL = 3600; // 1 hour
const MAX_CACHE_TTL = 86400;    // 24h — anything longer should live in D1

function clampTtl(ttl?: number): number {
  if (!ttl || ttl <= 0) return DEFAULT_CACHE_TTL;
  return Math.min(MAX_CACHE_TTL, Math.max(MIN_TTL, Math.floor(ttl)));
}

export async function kvGetJSON<T = unknown>(
  kv: KVNamespace,
  key: string,
): Promise<T | null> {
  try {
    const v = await kv.get(key, 'json');
    return (v as T) ?? null;
  } catch (e) {
    console.error('[kv] get failed', key, String((e as Error)?.message || e));
    return null;
  }
}

export async function kvPutJSON(
  kv: KVNamespace,
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<boolean> {
  try {
    await kv.put(key, JSON.stringify(value), { expirationTtl: clampTtl(ttlSeconds) });
    return true;
  } catch (e) {
    console.error('[kv] put failed', key, String((e as Error)?.message || e));
    return false;
  }
}

export async function kvGetRaw(kv: KVNamespace, key: string): Promise<string | null> {
  try {
    return await kv.get(key);
  } catch (e) {
    console.error('[kv] getRaw failed', key, String((e as Error)?.message || e));
    return null;
  }
}

export async function kvPutRaw(
  kv: KVNamespace,
  key: string,
  value: string,
  ttlSeconds?: number,
): Promise<boolean> {
  try {
    await kv.put(key, value, { expirationTtl: clampTtl(ttlSeconds) });
    return true;
  } catch (e) {
    console.error('[kv] putRaw failed', key, String((e as Error)?.message || e));
    return false;
  }
}

export async function kvDelete(kv: KVNamespace, key: string): Promise<void> {
  try { await kv.delete(key); } catch (e) {
    console.error('[kv] delete failed', key, String((e as Error)?.message || e));
  }
}

/**
 * List keys under a prefix. Note: KV `list` is eventually consistent; do
 * not rely on it for security-critical enumeration.
 */
export async function kvListKeys(
  kv: KVNamespace,
  prefix: string,
  limit = 100,
): Promise<string[]> {
  try {
    const res = await kv.list({ prefix, limit });
    return res.keys.map(k => k.name);
  } catch (e) {
    console.error('[kv] list failed', prefix, String((e as Error)?.message || e));
    return [];
  }
}

/**
 * Cache-aside helper. Tries KV first; on miss runs `loader`, stores the
 * result with the given TTL, and returns it. Errors from the loader
 * propagate; KV errors fail-soft (loader still runs, request still succeeds
 * with an unset cache).
 *
 * Use the optional `l1` param to layer a per-isolate in-memory cache in
 * front of KV — useful for hot endpoints where even ~150ms of KV latency
 * matters. The L1 entry is invalidated implicitly by its own short TTL.
 */
export interface L1Cache<T> {
  map: Map<string, { v: T; exp: number }>;
  ttlMs: number;
}

export function createL1<T>(ttlMs: number): L1Cache<T> {
  return { map: new Map(), ttlMs };
}

export async function cacheAside<T>(
  kv: KVNamespace,
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
  l1?: L1Cache<T>,
): Promise<{ value: T; source: 'l1' | 'kv' | 'origin' }> {
  const now = Date.now();
  if (l1) {
    const hit = l1.map.get(key);
    if (hit && hit.exp > now) return { value: hit.v, source: 'l1' };
  }
  const kvHit = await kvGetJSON<T>(kv, key);
  if (kvHit !== null) {
    if (l1) l1.map.set(key, { v: kvHit, exp: now + l1.ttlMs });
    return { value: kvHit, source: 'kv' };
  }
  const fresh = await loader();
  // Don't await — write-behind keeps the response path fast. Caller can
  // pass executionCtx.waitUntil if it wants delivery guarantees, but for
  // cache writes "best effort" is correct.
  void kvPutJSON(kv, key, fresh, ttlSeconds);
  if (l1) l1.map.set(key, { v: fresh, exp: now + l1.ttlMs });
  return { value: fresh, source: 'origin' };
}
