/**
 * Task #1 (DB) — Last Active stamping middleware.
 *
 * Stamps `users.last_active_at = now()` on every authenticated
 * /api/* request, throttled to once per 5 minutes per user via the
 * existing RATE_LIMITS KV binding so the hot path stays cheap.
 *
 * Mounted AFTER `observabilityMiddleware()` in index.ts so the
 * cached `currentUser` resolved by the rate-limit middleware is
 * available — we never re-decode the JWT here.
 *
 * Skips:
 *   • unauthenticated requests (no user)
 *   • /api/health (used by uptime probes)
 *   • /api/monitoring/* (admin polling would self-bias the value)
 */
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types';

const SKIP_PREFIXES = ['/api/health', '/api/monitoring/'];
const TTL_SECONDS = 300; // 5 min — matches the cookie/session refresh cadence

// Lazy bootstrap — guarantees `users.last_active_at` exists before the
// middleware ever issues an UPDATE. Mirrors ensureProfileColumns() so a
// stale dev D1 self-heals on the first authenticated request.
let lastActiveColumnReady = false;
async function ensureLastActiveColumn(env: Env): Promise<void> {
  if (lastActiveColumnReady) return;
  try { await env.DB.prepare(`ALTER TABLE users ADD COLUMN last_active_at TIMESTAMP`).run(); } catch {}
  try { await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active_at)`).run(); } catch {}
  lastActiveColumnReady = true;
}

export const lastActiveMiddleware = (): MiddlewareHandler<{ Bindings: Env }> => {
  return async (c, next) => {
    await next();
    try {
      const path = new URL(c.req.url).pathname;
      if (!path.startsWith('/api/')) return;
      if (SKIP_PREFIXES.some((p) => path === p || path.startsWith(p))) return;
      const cached: any = (c as any).get('currentUser');
      const userId: number | null = cached?.id ?? null;
      if (!userId) return;

      const env = c.env;
      const ctx = c.executionCtx as any;
      const work = (async () => {
        const key = `last_active:${userId}`;
        try {
          const seen = env.RATE_LIMITS ? await env.RATE_LIMITS.get(key) : null;
          if (seen) return; // throttled — already stamped within last 5 min
        } catch {}
        try {
          await ensureLastActiveColumn(env);
          await env.DB.prepare(
            `UPDATE users SET last_active_at = datetime('now') WHERE id = ?`,
          ).bind(userId).run();
        } catch (e) {
          console.error('[lastActive] update failed', userId, (e as Error).message);
          return;
        }
        try {
          if (env.RATE_LIMITS) {
            await env.RATE_LIMITS.put(key, '1', { expirationTtl: TTL_SECONDS });
          }
        } catch {}
      })();

      if (ctx?.waitUntil) ctx.waitUntil(work);
      else await work;
    } catch (e) {
      console.error('[lastActive] middleware crashed', (e as Error).message);
    }
  };
};
