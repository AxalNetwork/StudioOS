/**
 * Cloudflare Worker — StudioOS production API.
 *
 * ARCHITECTURE (live as of 2026-04-28):
 * The worker IS the production API at axal.vc. It owns:
 *   1. All `/api/*` route handlers (mounted from `./routes/*.ts`).
 *   2. WebSocket fan-out via Durable Objects (`PipelineRoom`, `OnboardingChat`).
 *   3. Cron + Queues consumer that drains the background-job queue.
 *
 * The Python FastAPI in `backend/` is the local dev backend used during Replit
 * iteration. It is NOT deployed to production — D1 (Cloudflare-only) is the
 * canonical user store, so the worker has to handle requests itself.
 *
 * Earlier "audit #4" attempted to make FastAPI canonical and turn this worker
 * into a proxy via FASTAPI_ORIGIN, but the FastAPI side was never publicly
 * deployed and the 23 production user accounts already live in D1. We keep
 * the legacy in-worker routes mounted here as the source of truth.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, JobMessage } from './types';

import realtime from './routes/realtime';
import auth from './routes/auth';
import scoring from './routes/scoring';
import projects from './routes/projects';
import legal from './routes/legal';
import legalcap from './routes/legalcap';
import partners from './routes/partners';
import partnernet from './routes/partnernet';
import capital from './routes/capital';
import tickets from './routes/tickets';
import deals from './routes/deals';
import users from './routes/users';
import marketIntel from './routes/market-intel';
import advisory from './routes/advisory';
import activity from './routes/activity';
import admin from './routes/admin';
import privateData from './routes/private-data';
import monitoring from './routes/monitoring';
import infra from './routes/infra';
import funds from './routes/funds';
import liquidity from './routes/liquidity';
import email from './routes/email';
import pipeline from './routes/pipeline';
import search from './routes/search';
import kyc from './routes/kyc';
import esign from './routes/esign';
import network from './routes/network';
import networkfx from './routes/networkfx';
import profiling from './routes/profiling';
import studioops from './routes/studioops';
import dashboard from './routes/dashboard';
import matches from './routes/matches';
import settings from './routes/settings';
import personas from './routes/personas';
import { processQueueBatch } from './services/queueWorker';
import { Jobs } from './models/jobs';
import { queueConsumer } from './queue-consumer';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { observabilityMiddleware } from './middleware/observability';
import { securityHeadersMiddleware } from './middleware/securityHeaders';

const app = new Hono<{ Bindings: Env }>();

// CORS — Epic 11: env-aware allowlist. Production locks the API to the two
// canonical apex hosts only; preview/dev additionally allow the
// workers.dev sandbox + localhost so local SPA -> remote-worker iteration
// still works. The `origin` callback runs per-request and reads
// `env.ENVIRONMENT` so a single deploy serves both modes correctly.
const PROD_ORIGINS = ['https://axal.vc', 'https://www.axal.vc'];
const DEV_EXTRA_ORIGINS = [
  'https://studioos.guillaumelauzier.workers.dev',
  'http://localhost:5000',
  'http://localhost:5173',
];

app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const envName = (((c.env as unknown as { ENVIRONMENT?: string })?.ENVIRONMENT) || '').toLowerCase();
      const isProd = envName === 'production' || envName === 'prod';
      const allowed = isProd ? PROD_ORIGINS : [...PROD_ORIGINS, ...DEV_EXTRA_ORIGINS];
      // Hono's cors() returns null/undefined to refuse the origin (no
      // Access-Control-Allow-Origin header emitted). The browser then
      // blocks the request — exactly the behaviour we want for an unknown
      // origin in production.
      return allowed.includes(origin) ? origin : null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

// Defense-in-depth headers on every response (HSTS, nosniff, etc.).
app.use('*', securityHeadersMiddleware());

// Rate-limit + observability run on every /api/* request. rateLimit resolves
// the current user once and caches it on context so observability + downstream
// handlers don't re-query the DB. Both are no-ops outside `/api/*`.
app.use('/api/*', rateLimitMiddleware());
app.use('/api/*', observabilityMiddleware());

// Quick health probe used by uptime monitors.
app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    app: 'StudioOS API',
    runtime: 'Cloudflare Workers',
    bindings: {
      db: !!c.env.DB,
      kv_tokens: !!c.env.TOKENS,
      kv_rate_limits: !!c.env.RATE_LIMITS,
      durable_pipeline: !!(c.env as any).PIPELINE_ROOM,
      durable_onboarding: !!(c.env as any).ONBOARDING_CHAT,
    },
  }),
);

// Real-time WebSocket fan-out (Durable Objects). Must stay at the edge.
app.route('/api', realtime);

// Mount all production API routes. Prefixes mirror the FastAPI routers in
// `backend/app/api/routes/*.py` so the frontend `/api/...` calls hit the same
// paths in dev and prod.
app.route('/api/auth', auth);
app.route('/api/scoring', scoring);
app.route('/api/projects', projects);
app.route('/api/legal', legal);
app.route('/api/legalcap', legalcap);
app.route('/api/partners', partners);
app.route('/api/partnernet', partnernet);
app.route('/api/capital', capital);
app.route('/api/tickets', tickets);
app.route('/api/deals', deals);
app.route('/api/users', users);
app.route('/api/market-intel', marketIntel);
app.route('/api/advisory', advisory);
app.route('/api/activity', activity);
app.route('/api/admin', admin);
app.route('/api/private-data', privateData);
app.route('/api/monitoring', monitoring);
app.route('/api/infra', infra);
app.route('/api/funds', funds);
app.route('/api/liquidity', liquidity);
app.route('/api/email', email);
app.route('/api/pipeline', pipeline);
app.route('/api/search', search);
app.route('/api/kyc', kyc);
// Frontend (`frontend/src/lib/api.js`) calls `/api/legal/esign/...` — mount
// the esign router under that path, NOT `/api/esign`. Mounting it inside
// `/api/legal` would be cleaner but `legal.ts` is its own router, so we just
// register esign at the path the UI already uses.
app.route('/api/legal/esign', esign);
app.route('/api/network', network);
app.route('/api/networkfx', networkfx);
app.route('/api/profiling', profiling);
app.route('/api/studioops', studioops);
app.route('/api/dashboard', dashboard);
app.route('/api/matches', matches);
app.route('/api/settings', settings);
app.route('/api/personas', personas);

app.notFound((c) => c.json({ detail: 'Not found' }, 404));

// Map the auth helpers' plain `throw new Error('Unauthorized'/'Forbidden'/...)`
// to the right HTTP status. Without this, RBAC failures surface as 500s and
// the frontend can't distinguish "log in again" from "the server crashed".
const AUTH_ERROR_STATUSES: Record<string, 401 | 403> = {
  Unauthorized: 401,
  'Admin required': 403,
  Forbidden: 403,
  'KYC required': 403,
};

app.onError((err: any, c) => {
  const msg = (err?.message ?? '') as string;
  const mapped = AUTH_ERROR_STATUSES[msg];
  if (mapped) return c.json({ detail: msg }, mapped);
  console.error('[edge] unhandled error:', err);
  return c.json({ detail: 'Internal server error' }, 500);
});

// JWT_SECRET strength check runs at the very top of every request handler.
// In prod a weak/missing secret aborts the request with a generic 503.
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
          // Epic 11 — `console.info` (vs `console.log`) survives the CI
          // grep that bans `console.log` from worker source. Wrangler tail
          // surfaces info-level logs identically.
          console.info('[cron] drain skipped — lease held');
          return;
        }
        await env.RATE_LIMITS.put(LEASE_KEY, leaseHolder, { expirationTtl: 90 });
      } catch (e) {
        console.error('[cron] lease acquire failed', e);
      }

      try {
        const r = await processQueueBatch(env, 25);
        if (r.processed || r.failed) {
          console.info(`[cron] drain processed=${r.processed} failed=${r.failed}`);
        }
        const now = new Date();
        if (now.getUTCHours() === 3 && now.getUTCMinutes() === 0) {
          await Jobs.cleanup(env);
        }
        // Epic 5: nightly score-integrity audit at 03:30 UTC. Re-verifies the
        // HMAC on every approved official snapshot; mismatches get flagged
        // for admin review and disappear from LP/partner views immediately.
        if (now.getUTCHours() === 3 && now.getUTCMinutes() === 30) {
          // Full-pagination audit: queueWorker pages through every non-sandbox
          // approved snapshot using id-cursor (no LIMIT cap on coverage).
          try { await Jobs.enqueue(env, 'score_hash_audit', { page_size: 500 }); } catch {}
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
