/**
 * Cloudflare Worker — edge proxy + cache for StudioOS.
 *
 * ARCHITECTURE (audit #4):
 * FastAPI (`backend/`) is the canonical API and source of truth. This worker
 * is a thin edge layer that:
 *   1. Forwards `/api/*` to the FastAPI origin (FASTAPI_ORIGIN secret).
 *   2. Hosts WebSocket fan-out via Durable Objects (must run at the edge).
 *   3. Drains the background-job queue via cron + Cloudflare Queues consumer.
 *
 * The legacy in-worker route handlers under `cloudflare-worker/src/routes/*.ts`
 * (auth, scoring, projects, legal, partners, capital, deals, tickets, users,
 * admin, activity, market-intel, advisory, …) re-implemented FastAPI's surface
 * area and were the source of two-source-of-truth drift. They are intentionally
 * NOT imported here. The files remain in git for history; do not re-mount them.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';

import realtime from './routes/realtime';
import { processQueueBatch } from './services/queueWorker';
import { Jobs } from './models/jobs';
import { queueConsumer } from './queue-consumer';
import type { JobMessage } from './types';

const app = new Hono<{ Bindings: Env }>();

// CORS — preserved from the legacy worker. Origins kept in sync with the
// FastAPI middleware in `backend/app/main.py`.
app.use(
  '*',
  cors({
    origin: [
      'https://axal.vc',
      'https://www.axal.vc',
      'https://studioos.guillaumelauzier.workers.dev',
    ],
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

// Surface a quick health probe at the edge so uptime checks never wait on
// origin. Origin health is reachable at `/api/origin-health` if needed.
app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    app: 'StudioOS edge proxy',
    runtime: 'Cloudflare Workers',
    origin_configured: !!c.env.FASTAPI_ORIGIN,
    bindings: {
      kv_tokens: !!c.env.TOKENS,
      kv_rate_limits: !!c.env.RATE_LIMITS,
      durable_pipeline: !!(c.env as any).PIPELINE_ROOM,
      durable_onboarding: !!(c.env as any).ONBOARDING_CHAT,
    },
  }),
);

// Real-time WebSocket fan-out (Durable Objects). Must stay at the edge —
// FastAPI is request/response only.
app.route('/api', realtime);

// Edge cache for hot read-only endpoints. Tweak the allowlist as needed; we
// intentionally never cache write methods or auth-stamped responses.
const CACHEABLE_GET_PREFIXES: string[] = [
  // Public read-mostly surfaces. Add more after auditing for PII leakage.
  '/api/legal/templates',
  '/api/market-intel/public',
];

function isCacheableGet(method: string, path: string): boolean {
  return method === 'GET' && CACHEABLE_GET_PREFIXES.some((p) => path.startsWith(p));
}

// Catch-all proxy: forward everything else under /api/* to FastAPI. The
// origin enforces auth, RBAC, KYC, rate limits, and security headers — this
// worker's job is just transport.
app.all('/api/*', async (c) => {
  const origin = c.env.FASTAPI_ORIGIN;
  if (!origin) {
    // User-facing message stays generic; operators see the real cause in
    // worker logs. Leaking "wrangler secret put ..." into the login UI was
    // both confusing for end users and an information disclosure.
    console.error(
      '[proxy] FASTAPI_ORIGIN secret is not set. Configure it with ' +
        '`wrangler secret put FASTAPI_ORIGIN` and redeploy.',
    );
    return c.json(
      {
        error: {
          code: 503,
          type: 'service_unavailable',
          message: 'Service is temporarily unavailable. Please try again shortly.',
        },
      },
      503,
    );
  }

  const inUrl = new URL(c.req.url);
  const targetUrl = origin.replace(/\/+$/, '') + inUrl.pathname + inUrl.search;
  const method = c.req.method;

  // Forward the original headers untouched (Authorization, Cookie, etc.) so
  // the origin can do its own auth + RBAC. Drop hop-by-hop headers.
  const headers = new Headers(c.req.raw.headers);
  headers.delete('host');
  headers.delete('cf-connecting-ip');
  headers.delete('cf-ipcountry');
  headers.set('x-forwarded-host', inUrl.host);
  headers.set('x-forwarded-proto', inUrl.protocol.replace(':', ''));

  // Edge-cache opt-in for the allowlist. Bypassed entirely for any request
  // carrying an Authorization header (per-user responses must not be shared).
  const cacheable = isCacheableGet(method, inUrl.pathname) && !headers.has('authorization');
  const cache = (caches as any).default as Cache | undefined;
  const cacheKey = new Request(targetUrl, { method: 'GET' });
  if (cacheable && cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  const init: RequestInit = {
    method,
    headers,
    redirect: 'manual',
  };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = c.req.raw.body;
    // Cloudflare requires duplex:'half' when forwarding a streaming body.
    (init as any).duplex = 'half';
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, init);
  } catch (err: any) {
    console.error('[proxy] origin fetch failed:', err?.message || err);
    return c.json(
      {
        error: {
          code: 502,
          type: 'bad_gateway',
          message: 'Service is temporarily unavailable. Please try again shortly.',
        },
      },
      502,
    );
  }

  // Stream the response straight through, preserving status + headers.
  const respHeaders = new Headers(upstream.headers);
  // Strip Cloudflare/HTTP/2 hop headers that don't survive re-emission.
  respHeaders.delete('content-encoding');
  respHeaders.delete('transfer-encoding');

  const out = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });

  if (cacheable && cache && upstream.ok) {
    const toCache = out.clone();
    // 60s edge TTL; origin can override via Cache-Control.
    if (!toCache.headers.has('cache-control')) {
      toCache.headers.set('cache-control', 'public, max-age=60');
    }
    (c.executionCtx as any)?.waitUntil(cache.put(cacheKey, toCache));
  }

  return out;
});

app.notFound((c) => c.json({ detail: 'Not found' }, 404));
app.onError((err: any, c) => {
  console.error('[edge] unhandled error:', err);
  return c.json({ detail: 'Internal server error' }, 500);
});

// Cloudflare cron + fetch entry point. Cron drains the job queue every minute
// (configured in wrangler.toml). The queue consumer handles the same dispatch
// for Cloudflare Queues batches.
// Phase A5 — wrap `fetch` so the JWT_SECRET strength check runs at the very
// top of every request handler, not lazily inside auth code paths. In
// prod/staging a weak/missing secret aborts the request with a generic 503.
import { assertJwtSecretStrength } from './auth';

export default {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
    try {
      assertJwtSecretStrength(env);
    } catch (err) {
      console.error('[boot] JWT_SECRET assertion failed:', (err as Error).message);
      return new Response(
        JSON.stringify({ ok: false, error: { code: 503, type: 'config_error', message: 'Service misconfigured' } }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      );
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const work = (async () => {
      const LEASE_KEY = 'cron:queue:lease';
      const leaseHolder = crypto.randomUUID();
      try {
        const existing = await env.RATE_LIMITS.get(LEASE_KEY);
        if (existing) {
          console.log('[cron] drain skipped — lease held');
          return;
        }
        await env.RATE_LIMITS.put(LEASE_KEY, leaseHolder, { expirationTtl: 90 });
      } catch (e) {
        console.error('[cron] lease acquire failed', e);
      }

      try {
        const r = await processQueueBatch(env, 25);
        if (r.processed || r.failed) {
          console.log(`[cron] drain processed=${r.processed} failed=${r.failed}`);
        }
        const now = new Date();
        if (now.getUTCHours() === 3 && now.getUTCMinutes() === 0) {
          await Jobs.cleanup(env);
        }
      } finally {
        try {
          const cur = await env.RATE_LIMITS.get(LEASE_KEY);
          if (cur === leaseHolder) await env.RATE_LIMITS.delete(LEASE_KEY);
        } catch {}
      }
    })();

    ctx.waitUntil(work);
    await work;
  },
  async queue(batch: MessageBatch<JobMessage>, env: Env, ctx: ExecutionContext) {
    await queueConsumer(batch, env, ctx);
  },
};

// Durable Object class re-exports — REQUIRED by the Workers runtime so it
// can find the classes named in wrangler.toml's [[durable_objects.bindings]].
export { PipelineRoom } from './durable-objects/pipeline-room';
export { OnboardingChat } from './durable-objects/onboarding-chat';
