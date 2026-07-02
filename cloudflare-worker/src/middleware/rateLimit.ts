import { MiddlewareHandler } from 'hono';
import type { Env } from '../types';
import { getCurrentUser } from '../auth';

// Rate limit buckets — sliding-ish window via KV with per-window counter keys
type Bucket = {
  name: string;
  limit: number;
  windowSec: number;
  test: (path: string, method: string, role?: string) => boolean;
  scope: 'user' | 'global' | 'ip';
  // When true, a KV outage REJECTS the request with 503 instead of failing
  // open. Reserved for abuse-prone / money-adjacent buckets so the limiter
  // can't be bypassed by knocking out KV.
  failClosed?: boolean;
};

const BUCKETS: Bucket[] = [
  // 5 spin-out executions / hour, admin/partner only
  {
    name: 'spinout',
    limit: 5,
    windowSec: 3600,
    test: (p, m, r) => p.startsWith('/api/spinout/') && m !== 'GET' && (r === 'admin' || r === 'partner' || r === 'investor'),
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
    failClosed: true,
  },
  // Task #9 — promo-code validation. Stricter than the default user bucket so
  // the redeemable-code space can't be enumerated at checkout. 20/min/user is
  // ample for a shopper typing and re-typing a code.
  {
    name: 'promo_validate',
    limit: 20,
    windowSec: 60,
    test: (p, m) => m === 'POST' && p === '/api/payments/promo/validate',
    scope: 'user',
    failClosed: true,
  },
  // Task #16 — admin catalog + stripe-config writes. Mutations here are
  // money-adjacent (creating products, registering webhooks, pushing secrets)
  // so a tighter limit than the default 60/min/user is warranted. 20/min is
  // ample for any legitimate admin workflow and prevents any tool misuse.
  {
    name: 'admin_catalog_writes',
    limit: 20,
    windowSec: 60,
    test: (p, m) =>
      (m === 'POST' || m === 'PATCH' || m === 'PUT') &&
      (p.startsWith('/api/admin/catalog/') || p.startsWith('/api/admin/stripe/')),
    scope: 'user',
    failClosed: true,
  },
  // 60 requests/min per user — default
  {
    name: 'user',
    limit: 60,
    windowSec: 60,
    test: (p) => p.startsWith('/api/'),
    scope: 'user',
  },
  // Epic 11 — per-IP sliding window. Applies to EVERY /api/* request,
  // authenticated or not, so a single source IP cannot DoS the API by
  // cycling through many anonymous requests (which would otherwise only
  // hit the global 1000/min cap and starve real users). 200/min/IP is
  // generous enough that legitimate dashboard polling never trips it.
  {
    name: 'ip',
    limit: 200,
    windowSec: 60,
    test: (p) => p.startsWith('/api/'),
    scope: 'ip',
  },
  // Epic 11 — abuse cap on the unauthenticated registration endpoint.
  // Without this an attacker can churn through email signups (each one
  // costs us a Turnstile verify + a D1 INSERT + an outbound verification
  // email). 10/min/IP lets a real user retry after a typo without
  // letting a script create thousands of accounts. This bucket co-exists
  // with the 200/min general IP bucket above; the stricter limit wins.
  {
    name: 'register',
    limit: 10,
    windowSec: 60,
    test: (p, m) => m === 'POST' && p === '/api/auth/register',
    scope: 'ip',
    failClosed: true,
  },
  // Task #10 — unauthenticated client-error telemetry sink. Bounded per-IP so a
  // runaway error loop in one browser tab can't flood the Worker logs. 60/min/IP
  // is far above any legitimate client (the frontend self-throttles + dedupes).
  // Fail-open: telemetry must never be the reason a request is rejected.
  {
    name: 'client_error',
    limit: 60,
    windowSec: 60,
    test: (p, m) => m === 'POST' && p === '/api/client-error',
    scope: 'ip',
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

// Skip rate limiting on health and the monitoring read endpoints (admins
// hit these frequently from the dashboard).
//
// Epic 11 — `/api/auth/register` was REMOVED from this list. It's now
// covered by the dedicated 10/min/IP `register` bucket above so an
// unauthenticated client cannot flood the signup endpoint. Other auth
// routes (login, verify, me) stay exempt because the 200/min/IP general
// bucket already covers them and they have their own brute-force
// protections (Turnstile on login + JWT verification cost on me).
const RATE_LIMIT_EXEMPT = [
  '/api/health',
  '/api/auth/login',
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
// Fail-open is the DEFAULT: a KV outage should not lock out admins/partners
// from running spinouts, and most buckets have their own RBAC checks
// downstream. Buckets marked `failClosed` (abuse-prone / money-adjacent:
// ai, register, promo_validate, admin_catalog_writes) instead REJECT with a
// 503 on a KV outage so a KV failure can't be used to bypass the limiter.
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

    // Epic 11 — resolve the source IP once per request. Cloudflare always
    // sets `cf-connecting-ip`; we fall back to the first hop of
    // `x-forwarded-for` if the worker is reached via a non-CF proxy in
    // testing. If neither is set we still rate-limit (using the literal
    // string 'unknown' as the scope key) so a missing-IP path can't
    // unilaterally bypass the IP bucket.
    const clientIp =
      c.req.header('cf-connecting-ip') ||
      (c.req.header('x-forwarded-for') || '').split(',')[0].trim() ||
      'unknown';

    for (const b of BUCKETS) {
      if (!b.test(path, method, role)) continue;
      // userId required for per-user buckets — skip if anonymous
      if (b.scope === 'user' && !userId) continue;

      const windowKey = b.windowSec >= 3600 ? windowHour : windowMinute;
      let key: string;
      if (b.scope === 'global') {
        key = `rl:g:${b.name}:${windowKey}`;
      } else if (b.scope === 'ip') {
        key = `rl:i:${clientIp}:${b.name}:${windowKey}`;
      } else {
        key = `rl:u:${userId}:${b.name}:${windowKey}`;
      }

      let count = 0;
      try {
        count = await bumpCounter(env.RATE_LIMITS, key, b.windowSec);
      } catch (e) {
        // KV outage. Default = fail-open (continue); buckets marked
        // `failClosed` instead reject with 503 so a KV failure can't be used
        // to bypass an abuse-prone limiter. Either way it is observable.
        console.error(`[ratelimit] KV bumpCounter failed bucket=${b.name} failClosed=${!!b.failClosed}`, e);
        if (b.failClosed) {
          await logBlock(env, ctx, {
            user_id: userId, endpoint: path, bucket: b.name, count: -1, blocked: true,
          });
          c.header('Retry-After', '30');
          c.header('X-RateLimit-Bucket', b.name);
          return c.json({
            detail: 'Rate limiting is temporarily unavailable; this request was rejected for safety. Try again shortly.',
            bucket: b.name,
            code: 'rate_limit_unavailable',
            retry_after: 30,
          }, 503);
        }
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
