/**
 * Task #14 (AA-1) — Market Intelligence read-side cache.
 *
 * Layered cache:
 *   1. Cloudflare Cache API (`caches.default`) — keyed by request URL.
 *      6-hour TTL on identical authenticated reads. The cache key folds
 *      in the caller's tier so a Free response can't leak Pro lens data.
 *   2. KV (`RATE_LIMITS` namespace, `cache:mi:` prefix) — 24-hour TTL
 *      for the last computed composite indexes. Survives isolate
 *      restarts and powers the cron-warm cold start.
 *
 * The cache is read-through; writers in the aggregator call `bustKv` to
 * invalidate the KV layer after a fresh nightly compute.
 */
import type { Env } from '../../types';

export const CACHE_TTL_SECONDS = 6 * 60 * 60;
export const KV_TTL_SECONDS = 24 * 60 * 60;
const KV_PREFIX = 'cache:mi:';

/** Build a Cache API key from the incoming Request + tier. */
export function cacheKey(req: Request, tier: string): Request {
  const url = new URL(req.url);
  // Fold tier into the key so per-tier projections can't cross-pollute.
  url.searchParams.set('__tier', tier);
  return new Request(url.toString(), { method: 'GET' });
}

/** Edge-cache lookup. Returns null on miss or when caches API is absent (test envs). */
export async function readEdgeCache(req: Request, tier: string): Promise<Response | null> {
  try {
    const c = (caches as unknown as { default?: Cache }).default;
    if (!c) return null;
    const hit = await c.match(cacheKey(req, tier));
    return hit || null;
  } catch {
    return null;
  }
}

/** Wrap a JSON body in a cacheable Response and store it. */
export async function writeEdgeCache(
  req: Request,
  tier: string,
  body: unknown,
  ttl: number = CACHE_TTL_SECONDS,
): Promise<Response> {
  const res = new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${ttl}`,
    },
  });
  try {
    const c = (caches as unknown as { default?: Cache }).default;
    if (c) await c.put(cacheKey(req, tier), res.clone());
  } catch {
    /* cache write best-effort */
  }
  return res;
}

export async function readKv<T>(env: Env, key: string): Promise<T | null> {
  try {
    const raw = await env.RATE_LIMITS.get(`${KV_PREFIX}${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeKv(env: Env, key: string, value: unknown, ttl = KV_TTL_SECONDS): Promise<void> {
  try {
    await env.RATE_LIMITS.put(`${KV_PREFIX}${key}`, JSON.stringify(value), { expirationTtl: ttl });
  } catch {
    /* best-effort */
  }
}

export async function bustKv(env: Env, key: string): Promise<void> {
  try { await env.RATE_LIMITS.delete(`${KV_PREFIX}${key}`); } catch {}
}
