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
import integrations from './routes/integrations';
import network from './routes/network';
import networkfx from './routes/networkfx';
import profiling from './routes/profiling';
import studioops from './routes/studioops';
import dashboard from './routes/dashboard';
import matches from './routes/matches';
import settings from './routes/settings';
import personas from './routes/personas';
import onboarding from './routes/onboarding';
import notificationsRoutes from './routes/notifications';
import votesRoutes from './routes/votes';
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
app.route('/api/onboarding', onboarding);
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
app.route('/api/integrations', integrations);
app.route('/api/personas', personas);
app.route('/api/notifications', notificationsRoutes);
app.route('/api/pipeline/votes', votesRoutes);
// The frontend (and backend) cast endpoint is the singular `/vote/:deal_id`;
// the plural `/votes/:deal_id` exists as a back-compat alias. Both go to
// the same handler so the threshold publisher fires regardless of caller.
app.route('/api/pipeline/vote', votesRoutes);

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

// Phase 0.1 — D1 schema migration for the partner→investor split.
// Lazy, idempotent, runs at most once per worker isolate. We piggy-back on the
// fetch entry point because workers have no startup hook; the cold-start
// penalty is one cheap PRAGMA + two CREATE/ALTER ... IF NOT EXISTS calls.
let _investorSchemaReady = false;
async function ensureInvestorSchema(env: Env): Promise<void> {
  if (_investorSchemaReady) return;
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS investors (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL, user_id INTEGER, investor_type TEXT NOT NULL DEFAULT 'angel', accreditation_status TEXT NOT NULL DEFAULT 'unverified', check_size_min REAL, check_size_max REAL, sector_focus TEXT, stage_focus TEXT, notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
    );
    await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_investors_user ON investors(user_id)");
    await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_investors_type ON investors(investor_type)");
    // SQLite/D1 lacks ADD COLUMN IF NOT EXISTS. Probe pragma instead.
    const cols = await env.DB.prepare("PRAGMA table_info(users)").all<{ name: string }>();
    const hasInvestorId = (cols.results || []).some(r => r.name === 'investor_id');
    if (!hasInvestorId) {
      try { await env.DB.exec("ALTER TABLE users ADD COLUMN investor_id INTEGER"); } catch {}
    }
    // Phase 0.1 — relax the legacy users.role CHECK constraint that excluded
    // 'investor'. SQLite/D1 has no ALTER TABLE DROP/MODIFY CONSTRAINT, so on
    // existing prod DBs we must rebuild the table. We use the canonical DDL
    // from sql/schema.sql (PK/UNIQUE/CHECK/FK/defaults preserved) plus an
    // explicit recreate of the indexes — no CTAS/constraint-stripping shortcut
    // (architect blocking-fix: preserve all integrity constraints).
    try {
      const tbl = await env.DB.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
      ).first<{ sql: string }>();
      const ddl = (tbl?.sql || '');
      const needsRebuild = ddl.includes("CHECK") && ddl.includes("'partner'") && !ddl.includes("'investor'");
      if (needsRebuild) {
        const NEW_USERS_DDL = `CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
          email TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'founder' CHECK (role IN ('admin', 'founder', 'partner', 'investor')),
          investor_id INTEGER REFERENCES investors(id),
          password_hash TEXT,
          founder_id INTEGER REFERENCES founders(id),
          partner_id INTEGER REFERENCES partners(id),
          is_active INTEGER NOT NULL DEFAULT 1,
          email_verified INTEGER NOT NULL DEFAULT 0,
          verification_token TEXT,
          verification_token_expires TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`;
        // Build the column list dynamically from the OLD table so we copy
        // only columns that exist on both sides (handles partial-migration
        // states). investor_id may or may not yet exist on the source.
        const oldCols = (cols.results || []).map(r => r.name);
        const newCols = ['id','uid','email','name','role','investor_id','password_hash','founder_id','partner_id','is_active','email_verified','verification_token','verification_token_expires','created_at'];
        const sharedCols = newCols.filter(c => oldCols.includes(c));
        const colList = sharedCols.join(', ');
        await env.DB.batch([
          env.DB.prepare("PRAGMA foreign_keys=OFF"),
          env.DB.prepare(NEW_USERS_DDL),
          env.DB.prepare(`INSERT INTO users_new (${colList}) SELECT ${colList} FROM users`),
          env.DB.prepare("DROP TABLE users"),
          env.DB.prepare("ALTER TABLE users_new RENAME TO users"),
          env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)"),
          env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_users_uid ON users(uid)"),
          env.DB.prepare("PRAGMA foreign_keys=ON"),
        ]);
      }
    } catch (e) {
      console.warn('[boot] users role-CHECK rebuild skipped:', (e as Error).message);
    }
    // Promote partner users with an LP record to investor; create investor row.
    try {
      await env.DB.exec(
        "UPDATE users SET role = 'investor' WHERE role = 'partner' AND id IN (SELECT DISTINCT u.id FROM users u JOIN limited_partners lp ON lp.user_id = u.id OR lower(lp.email) = lower(u.email))"
      );
      await env.DB.exec(
        "INSERT INTO investors (uid, user_id, investor_type, accreditation_status) SELECT lower(hex(randomblob(16))), u.id, 'lp', 'verified' FROM users u WHERE u.role = 'investor' AND NOT EXISTS (SELECT 1 FROM investors i WHERE i.user_id = u.id)"
      );
      await env.DB.exec(
        "UPDATE users SET investor_id = (SELECT i.id FROM investors i WHERE i.user_id = users.id LIMIT 1) WHERE role = 'investor' AND investor_id IS NULL"
      );
    } catch (e) {
      console.warn('[boot] investor promote step skipped:', (e as Error).message);
    }
    _investorSchemaReady = true;
  } catch (e) {
    console.error('[boot] ensureInvestorSchema failed:', (e as Error).message);
  }
}

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
    // Phase 0.1 — block the FIRST request per isolate on the role-split
    // migration so RBAC + schema rebuild are deterministic before any
    // protected route runs (architect blocking-fix). Subsequent requests
    // hit the in-memory `_investorSchemaReady` short-circuit (zero cost).
    if (!_investorSchemaReady && env.DB) {
      await ensureInvestorSchema(env);
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
        // Daily admin digest for flagged-but-unreviewed scores (>24h old).
        // Runs at 14:00 UTC so US/EU admins see it in the morning.
        if (now.getUTCHours() === 14 && now.getUTCMinutes() === 0) {
          try { await Jobs.enqueue(env, 'flagged_score_digest', {}); } catch {}
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
