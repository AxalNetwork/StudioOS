import { Context, MiddlewareHandler } from 'hono';
import type { Env } from '../types';
import { getCurrentUser } from '../auth';

// Rate limit buckets — sliding-ish window via KV with per-window counter keys
type Bucket = {
  name: string;
  limit: number;
  windowSec: number;
  test: (path: string, method: string, role?: string) => boolean;
  scope: 'user' | 'global';
};

const BUCKETS: Bucket[] = [
  // 5 spin-out executions / hour, admin/partner only
  {
    name: 'spinout',
    limit: 5,
    windowSec: 3600,
    test: (p, m, r) => p.startsWith('/api/spinout/') && m !== 'GET' && (r === 'admin' || r === 'partner'),
    scope: 'user',
  },
  // 10 AI scoring / matching calls per minute per user
  {
    name: 'ai',
    limit: 10,
    windowSec: 60,
    test: (p) =>
      p.startsWith('/api/scoring/') ||
      p.startsWith('/api/matches/') ||
      p.startsWith('/api/advisory/') ||
      p.startsWith('/api/monitoring/anomalies'),
    scope: 'user',
  },
  // 60 requests/min per user — default
  {
    name: 'user',
    limit: 60,
    windowSec: 60,
    test: (p) => p.startsWith('/api/'),
    scope: 'user',
  },
  // 1000 req/min global burst protection
  {
    name: 'global',
    limit: 1000,
    windowSec: 60,
    test: (p) => p.startsWith('/api/'),
    scope: 'global',
  },
];

// Skip rate limiting on health, auth and the monitoring read endpoints (admins
// hit these frequently from the dashboard).
const RATE_LIMIT_EXEMPT = [
  '/api/health',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/verify',
  '/api/auth/me',
  '/api/monitoring/metrics',
  '/api/monitoring/rate-limits',
];

// NOTE: KV is eventually consistent and the read-modify-write below is not
// strictly atomic. For a venture-studio scale workload (dozens of partners,
// double-digit RPS), the worst case is a small over-allowance at window
// boundaries — acceptable. If/when traffic grows, swap this for a Durable
// Object token-bucket or D1 transactional counter.
// Fail-open is intentional: a KV outage should not lock out admins/partners
// from running spinouts. Sensitive operations have their own RBAC checks
// downstream.
async function bumpCounter(kv: KVNamespace, key: string, windowSec: number): Promise<number> {
  const raw = await kv.get(key);
  const next = (raw ? parseInt(raw, 10) : 0) + 1;
  // expirationTtl must be ≥ 60 in CF KV
  await kv.put(key, String(next), { expirationTtl: Math.max(60, windowSec) });
  return next;
}

async function logBlock(env: Env, ctx: ExecutionContext | undefined, opts: {
  user_id: number | null;
  endpoint: string;
  bucket: string;
  count: number;
  blocked: boolean;
}) {
  const work = (async () => {
    try {
      await env.DB.prepare(
        `INSERT INTO rate_limit_logs (user_id, endpoint, requests_in_window, blocked, bucket)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(opts.user_id, opts.endpoint, opts.count, opts.blocked ? 1 : 0, opts.bucket).run();
    } catch (e) {
      console.error('rate_limit_logs insert failed', e);
    }
  })();
  if (ctx) ctx.waitUntil(work); else await work;
}

export const rateLimitMiddleware = (): MiddlewareHandler<{ Bindings: Env }> => {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (!path.startsWith('/api/')) return next();
    if (RATE_LIMIT_EXEMPT.some(p => path === p || path.startsWith(p + '/'))) return next();

    const method = c.req.method;
    const env = c.env;
    const ctx = c.executionCtx as any;

    // Resolve user (may be null for unauthenticated paths) and cache on the
    // request context so observability + downstream route handlers don't have
    // to re-query the DB.
    let user: any = (c as any).get('currentUser');
    if (user === undefined) {
      try { user = await getCurrentUser(c); } catch { user = null; }
      (c as any).set('currentUser', user);
    }
    const userId: number | null = user?.id ?? null;
    const role: string | undefined = user?.role;

    const windowMinute = Math.floor(Date.now() / 1000 / 60);
    const windowHour = Math.floor(Date.now() / 1000 / 3600);

    for (const b of BUCKETS) {
      if (!b.test(path, method, role)) continue;
      // userId required for per-user buckets — skip if anonymous
      if (b.scope === 'user' && !userId) continue;

      const windowKey = b.windowSec >= 3600 ? windowHour : windowMinute;
      const key = b.scope === 'global'
        ? `rl:g:${b.name}:${windowKey}`
        : `rl:u:${userId}:${b.name}:${windowKey}`;

      let count = 0;
      try {
        count = await bumpCounter(env.RATE_LIMITS, key, b.windowSec);
      } catch (e) {
        // KV failure: fail-open
        console.error('KV bumpCounter failed', e);
        continue;
      }

      if (count > b.limit) {
        await logBlock(env, ctx, {
          user_id: userId, endpoint: path, bucket: b.name, count, blocked: true,
        });
        const retryAfter = b.windowSec >= 3600 ? 3600 : 60;
        c.header('Retry-After', String(retryAfter));
        c.header('X-RateLimit-Bucket', b.name);
        c.header('X-RateLimit-Limit', String(b.limit));
        return c.json({
          detail: `Rate limit exceeded for ${b.name} bucket. Try again in ${retryAfter} seconds.`,
          bucket: b.name,
          limit: b.limit,
          retry_after: retryAfter,
        }, 429);
      }
    }
    return next();
  };
};
