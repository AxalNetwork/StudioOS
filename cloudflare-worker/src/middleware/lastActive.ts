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
import { withDeadline } from '../util/deadline';
import { bindingKey, runSchemaBootstrap } from '../util/schemaBootstrap';

const SKIP_PREFIXES = ['/api/health', '/api/monitoring/'];
const STAMP_DEADLINE_MS = 2_000;
const TTL_SECONDS = 300; // 5 min — matches the cookie/session refresh cadence

// Lazy bootstrap — guarantees `users.last_active_at` exists before the
// middleware ever issues an UPDATE. Mirrors ensureProfileColumns() so a
// stale dev D1 self-heals on the first authenticated request.
const LAST_ACTIVE_COLUMN_READY = new WeakMap<object, boolean>();
// Exported for `routes/admin_hq.ts`'s Team read (D138), which SELECTs
// `last_active_at` and would otherwise be the one caller depending on this
// middleware having already run. It is idempotent and cached per binding in a
// WeakMap rather than a module-level boolean — the D95/#204 shape — so a second
// caller costs one map lookup.
//
// #5343 (#4568 R2-04): the statements go through `runSchemaBootstrap`, which
// reads `users`' columns once per binding and issues no ALTER when the column
// is there (production: migration 049). `users` is at D1's 100-column limit,
// where a blind ALTER of an existing column fails "too many columns" on every
// fresh isolate. A genuine failure (no `users` table) throws
// `last_active_schema_not_ready` and is not remembered, so the next call tries
// again: the middleware logs and skips the stamp; HQ's Team read answers 503.
export const LAST_ACTIVE_SCHEMA: readonly string[] = Object.freeze([
  'ALTER TABLE users ADD COLUMN last_active_at TIMESTAMP',
  'CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active_at)',
]);
export const LAST_ACTIVE_NOT_READY = 'last_active_schema_not_ready';
export async function ensureLastActiveColumn(env: Env): Promise<void> {
  if (LAST_ACTIVE_COLUMN_READY.get(bindingKey(env))) return;
  try {
    await runSchemaBootstrap(env, LAST_ACTIVE_SCHEMA);
  } catch {
    console.error('[lastActive] schema_not_ready');
    throw new Error(LAST_ACTIVE_NOT_READY);
  }
  LAST_ACTIVE_COLUMN_READY.set(bindingKey(env), true);
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
          // Bounded even though this runs after the response: a `waitUntil`
          // promise that never settles keeps the invocation alive on the
          // runtime's clock, and a throttle stamp is not worth that.
          const seen = env.RATE_LIMITS
            ? await withDeadline(env.RATE_LIMITS.get(key), STAMP_DEADLINE_MS, 'lastActive-get')
            : null;
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
            await withDeadline(
              env.RATE_LIMITS.put(key, '1', { expirationTtl: TTL_SECONDS }),
              STAMP_DEADLINE_MS, 'lastActive-put',
            );
          }
        } catch {}
      })();

      // In production there is always an executionCtx, so the stamp runs after
      // the response. The fallback exists for tests and `wrangler dev`, where
      // awaiting it would put two unbounded remote calls (a KV read, a D1
      // UPDATE) in front of every response — so it is bounded too.
      if (ctx?.waitUntil) ctx.waitUntil(work);
      else await withDeadline(work, STAMP_DEADLINE_MS, 'lastActive');
    } catch (e) {
      console.error('[lastActive] middleware crashed', (e as Error).message);
    }
  };
};
