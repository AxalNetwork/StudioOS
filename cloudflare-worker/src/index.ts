import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { getSQL } from './db';
import { requireAuth, requireApprovedKyc } from './auth';

import auth from './routes/auth';
import scoring from './routes/scoring';
import projects from './routes/projects';
import legal from './routes/legal';
import partners from './routes/partners';
import capital from './routes/capital';
import deals from './routes/deals';
import tickets from './routes/tickets';
import users from './routes/users';
import admin from './routes/admin';
import activity from './routes/activity';
import marketIntel from './routes/market-intel';
import advisory from './routes/advisory';
import privateData from './routes/private-data';
import profiling from './routes/profiling';
import kyc from './routes/kyc';
import network from './routes/network';
import matches from './routes/matches';
import studioops from './routes/studioops';
import networkfx from './routes/networkfx';
import dashboard from './routes/dashboard';
import pipeline from './routes/pipeline';
import partnernet from './routes/partnernet';
import legalcap from './routes/legalcap';
import monitoring from './routes/monitoring';
import infra from './routes/infra';
import funds from './routes/funds';
import liquidity from './routes/liquidity';
import realtime from './routes/realtime';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { observabilityMiddleware } from './middleware/observability';
import { securityHeadersMiddleware } from './middleware/securityHeaders';
import { processQueueBatch } from './services/queueWorker';
import { Jobs } from './models/jobs';
import { queueConsumer } from './queue-consumer';
import type { JobMessage } from './types';
const app = new Hono<{ Bindings: Env }>();

app.use('*', securityHeadersMiddleware());

app.use('*', cors({
  origin: ['https://axal.vc', 'https://www.axal.vc', 'https://studioos.guillaumelauzier.workers.dev'],
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.use('*', async (c, next) => {
  try {
    await next();
  } catch (err: any) {
    if (err.message === 'Unauthorized') return c.json({ detail: 'Not authenticated' }, 401);
    if (err.message === 'Admin required') return c.json({ detail: 'Admin access required' }, 403);
    if (err.message === 'Forbidden') return c.json({ detail: 'Forbidden: insufficient role' }, 403);
    console.error('Unhandled error:', err);
    return c.json({ detail: 'Internal server error' }, 500);
  }
});

app.onError((err: any, c) => {
  if (err.message === 'Unauthorized') return c.json({ detail: 'Not authenticated' }, 401);
  if (err.message === 'Admin required') return c.json({ detail: 'Admin access required' }, 403);
  if (err.message === 'Forbidden') return c.json({ detail: 'Forbidden: insufficient role' }, 403);
  if (err.message === 'KYC required') return c.json({ detail: 'KYC verification required to access this resource', kyc_required: true }, 403);
  console.error('Unhandled app error:', err);
  return c.json({ detail: 'Internal server error' }, 500);
});

// Server-side KYC gate: for any authenticated request to a protected API path,
// require kyc_status='approved'. Admins are exempt. The list below is what a
// non-approved user is still allowed to call so they can complete KYC and basic account ops.
const KYC_EXEMPT_PREFIXES = [
  '/api/health',
  '/api/auth/',
  '/api/kyc/',
  '/api/activity',
  '/api/tickets',
  '/api/profiling',
  '/api/dashboard/stats',
  '/api/legal/templates',
  '/api/network/referral/code',
  '/api/network/graph',
  '/api/monitoring/',
];

app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (KYC_EXEMPT_PREFIXES.some(p => path.startsWith(p))) return next();
  const authHeader = c.req.header('Authorization');
  // No auth header → let the route's own requireAuth handle the 401.
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();
  await requireApprovedKyc(c);
  return next();
});

// Observability + rate limiting for all API requests.
// Order: observability OUTERMOST (so it captures rate-limit 429s in metrics),
// then rateLimit, then route handlers.
app.use('/api/*', observabilityMiddleware());
app.use('/api/*', rateLimitMiddleware());

app.get('/api/health', (c) => c.json({
  status: 'ok',
  app: 'StudioOS v1.0',
  tagline: 'The 30-Day Spin-Out Engine',
  runtime: 'Cloudflare Workers',
  bindings: {
    d1: !!c.env.DB,
    kv_tokens: !!c.env.TOKENS,
    kv_rate_limits: !!c.env.RATE_LIMITS,
    gmail: !!(c.env.GMAIL_CLIENT_ID && c.env.GMAIL_CLIENT_SECRET && c.env.GMAIL_REFRESH_TOKEN),
    turnstile: !!c.env.TURNSTILE_SECRET_KEY,
    openai: !!c.env.OPENAI_API_KEY,
  }
}));

app.get('/api/debug/test-email', async (c) => {
  // Admin-only: this endpoint sends a real email via Gmail OAuth and burns
  // quota. It must never be publicly callable.
  const user = await requireAuth(c);
  if (user.role !== 'admin') return c.json({ detail: 'Admin access required' }, 403);
  const env = c.env;
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    return c.json({ error: 'Gmail credentials missing', gmail_client_id: !!env.GMAIL_CLIENT_ID, gmail_client_secret: !!env.GMAIL_CLIENT_SECRET, gmail_refresh_token: !!env.GMAIL_REFRESH_TOKEN }, 500);
  }
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GMAIL_CLIENT_ID,
        client_secret: env.GMAIL_CLIENT_SECRET,
        refresh_token: env.GMAIL_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    const tokenData: any = await tokenRes.json();
    if (!tokenRes.ok) {
      return c.json({ step: 'oauth_token', status: tokenRes.status, error: tokenData }, 500);
    }
    if (!tokenData.access_token) {
      return c.json({ step: 'oauth_token', error: 'No access_token in response', data: tokenData }, 500);
    }
    const boundary = `boundary_test`;
    const rawEmail = [
      `To: guillaume.lauzier@axal.vc`,
      `From: Axal VC <noreply@axal.vc>`,
      `Subject: Debug Test`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      `This is a debug test email.`,
    ].join('\r\n');
    const encoded = btoa(unescape(encodeURIComponent(rawEmail)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: encoded }),
    });
    const sendData: any = await sendRes.json();
    if (!sendRes.ok) {
      return c.json({ step: 'gmail_send', status: sendRes.status, error: sendData }, 500);
    }
    return c.json({ step: 'all_ok', oauth: 'success', gmail_send: 'success', message_id: sendData.id });
  } catch (e: any) {
    return c.json({ step: 'exception', error: e?.message || 'Unknown' }, 500);
  }
});

app.get('/api/dashboard/stats', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const totalProjects = await sql`SELECT COUNT(*) as count FROM projects`;
  const activeProjects = await sql`SELECT COUNT(*) as count FROM projects WHERE status IN ('tier_1', 'tier_2', 'spinout', 'active')`;
  const pendingScoring = await sql`SELECT COUNT(*) as count FROM projects WHERE status IN ('intake', 'scoring')`;
  const totalPartners = await sql`SELECT COUNT(*) as count FROM partners`;
  const totalInvestors = await sql`SELECT COUNT(*) as count FROM limited_partners`;
  const openTickets = await sql`SELECT COUNT(*) as count FROM tickets WHERE status IN ('open', 'in_progress')`;
  const totalDocuments = await sql`SELECT COUNT(*) as count FROM documents`;
  const avgScore = await sql`SELECT AVG(total_score) as avg FROM score_snapshots`;
  const totalDeals = await sql`SELECT COUNT(*) as count FROM deals`;
  const activeDeals = await sql`SELECT COUNT(*) as count FROM deals WHERE status IN ('applied', 'scored', 'active')`;
  const totalUsers = await sql`SELECT COUNT(*) as count FROM users`;
  await sql.end();

  return c.json({
    total_projects: parseInt(totalProjects[0].count),
    active_projects: parseInt(activeProjects[0].count),
    pending_scoring: parseInt(pendingScoring[0].count),
    total_partners: parseInt(totalPartners[0].count),
    total_investors: parseInt(totalInvestors[0].count),
    open_tickets: parseInt(openTickets[0].count),
    total_documents: parseInt(totalDocuments[0].count),
    avg_score: avgScore[0].avg ? Math.round(parseFloat(avgScore[0].avg) * 10) / 10 : null,
    total_deals: parseInt(totalDeals[0].count),
    active_deals: parseInt(activeDeals[0].count),
    total_users: parseInt(totalUsers[0].count),
  });
});

app.route('/api/auth', auth);
app.route('/api/scoring', scoring);
app.route('/api/projects', projects);
app.route('/api/legal', legal);
app.route('/api/partners', partners);
app.route('/api/capital', capital);
app.route('/api/deals', deals);
app.route('/api/tickets', tickets);
app.route('/api/users', users);
app.route('/api/admin', admin);
app.route('/api/activity', activity);
app.route('/api/market-intel', marketIntel);
app.route('/api/advisory', advisory);
app.route('/api/private-data', privateData);
app.route('/api/profiling', profiling);
app.route('/api/kyc', kyc);
app.route('/api/network', network);
app.route('/api/matches', matches);
app.route('/api/studioops', studioops);
app.route('/api/networkfx', networkfx);
app.route('/api/dashboard', dashboard);
app.route('/api/pipeline', pipeline);
app.route('/api/partnernet', partnernet);
app.route('/api/legalcap', legalcap);
app.route('/api/monitoring', monitoring);
app.route('/api/infra', infra);
app.route('/api/funds', funds);
app.route('/api/liquidity', liquidity);
// Real-time WebSocket fan-out (Durable Objects).
// Routes: GET /api/pipeline/ws/:deal_id, GET /api/onboarding/ws/:user_id,
// GET /api/realtime/room/:kind/:id/count. Auth via ?token= query param
// because browsers can't set Authorization headers on the WS handshake.
app.route('/api', realtime);

// Cloudflare cron + fetch entry point.
// Cron drains the job queue every minute (configured in wrangler.toml).
//
// Operational hardening:
//  - KV-based lease so overlapping cron runs (slow drain >60s) don't both pull jobs.
//  - Per-run AI-call budget enforced inside processQueueBatch via env hint.
//  - Errors re-thrown so the Workers platform records cron failures.
export default {
  fetch: app.fetch.bind(app),
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const work = (async () => {
      // Acquire a 90s lease — longer than the cron interval so an in-progress
      // drain blocks the next tick.
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
        // Best-effort lease release.
        try {
          const cur = await env.RATE_LIMITS.get(LEASE_KEY);
          if (cur === leaseHolder) await env.RATE_LIMITS.delete(LEASE_KEY);
        } catch {}
      }
    })();

    // Surface failures to the Workers platform (better observability) AND keep
    // the work alive past the response.
    ctx.waitUntil(work);
    await work;
  },
  // Cloudflare Queues consumer for `studioos-job-queue`. Required because
  // wrangler.toml declares a [[queues.consumers]] block; deploys are
  // rejected without this export. See cloudflare-worker/src/queue-consumer.ts
  // for the dispatch logic — it reuses the same handler as the D1 cron drain.
  async queue(batch: MessageBatch<JobMessage>, env: Env, ctx: ExecutionContext) {
    await queueConsumer(batch, env, ctx);
  },
};

// Durable Object class re-exports — REQUIRED by the Workers runtime so it
// can find the classes named in wrangler.toml's [[durable_objects.bindings]].
// Removing these will cause the deploy to fail with "class not found".
export { PipelineRoom } from './durable-objects/pipeline-room';
export { OnboardingChat } from './durable-objects/onboarding-chat';
