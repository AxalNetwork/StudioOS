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
import marketIntel from './routes/market_intel';
import { investorProfile, investorSignals, aggregateInvestorSignals } from './routes/investor_signals';
import assistantRoutes, { sweepExpiredConversations } from './routes/assistant';
import { runTotpRemediation } from './services/totpRemediation';
import { writeDailySnapshot } from './services/analyticsReports';
import advisory from './routes/advisory';
import activity from './routes/activity';
import admin from './routes/admin';
import adminContracts from './routes/admin_contracts';
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
// Task #2 — HubSpot provider. Side-effect import: the module's top-level
// `registerProvider({ key: 'hubspot', ... })` runs at boot so the route
// layer in routes/integrations.ts can dispatch to it.
import { syncAllHubspotIntegrations } from './integrations/providers/hubspot';
// Task #3 — Calendly provider. Side-effect import so registerProvider() runs at boot.
import { syncAllCalendlyIntegrations } from './integrations/providers/calendly';
// Task #4 — Salesforce provider. Side-effect import so registerProvider() runs at boot.
import { syncAllSalesforceIntegrations } from './integrations/providers/salesforce';
// Task #5 — Carta provider. Side-effect import so registerProvider() runs at boot.
import { syncAllCartaIntegrations } from './integrations/providers/carta';
// Task #2 — DocuSign provider. Side-effect import so registerProvider() runs at boot.
import { syncAllDocusignIntegrations } from './integrations/providers/docusign';
import network from './routes/network';
import networkfx from './routes/networkfx';
import profiling from './routes/profiling';
import studioops from './routes/studioops';
import dashboard from './routes/dashboard';
import matches from './routes/matches';
import settings from './routes/settings';
import personas from './routes/personas';
import onboarding from './routes/onboarding';
import brand, { renderLandingHtml } from './routes/brand';
import decks from './routes/decks';
import notificationsRoutes from './routes/notifications';
import votesRoutes from './routes/votes';
import linkedinRoutes from './routes/linkedin';
import calendarRoutes from './routes/calendar';
import financialsRoutes from './routes/financials';
import progressRoutes from './routes/progress';
import wellbeingRoutes from './routes/wellbeing';
import complianceRoutes from './routes/compliance';
import captableRoutes from './routes/captable';
import cofounderRoutes from './routes/cofounder';
import spinoutLabRoutes from './routes/spinout_lab';
// T13/T14/T15 — port of FastAPI mentors/partner_office_hours/watchlist/journal/
// portfolio_health/references/comarketing/company/needs/insights routers.
import mentorsRoutes from './routes/mentors';
import partnerOfficeHoursRoutes from './routes/partner_office_hours';
import watchlistRoutes from './routes/watchlist';
import journalRoutes from './routes/journal';
import portfolioRoutes from './routes/portfolio';
import referencesRoutes from './routes/references';
import comarketingRoutes from './routes/comarketing';
import companyRoutes from './routes/company';
import needsRoutes, { quotesRouter, engagementsRouter } from './routes/needs';
import insightsRoutes from './routes/insights';
// T3 — Reserve allocation + waterfall simulator (Task #46 port).
import fundSimulatorRoutes from './routes/fund_simulator';
import { processQueueBatch } from './services/queueWorker';
// Task #6 — founder subscription tier middleware + billing router (Stripe
// checkout/portal/webhook + tier endpoints). Both must mount; the billing
// import was missed in the first pass and left tier checkout/webhook 404.
import { requireTier } from './middleware/requireTier';
import billing from './routes/billing';
import { Jobs } from './models/jobs';
import { queueConsumer } from './queue-consumer';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { observabilityMiddleware } from './middleware/observability';
import { securityHeadersMiddleware } from './middleware/securityHeaders';
import { csrfMiddleware } from './middleware/csrf';
import { requireCfAccess } from './middleware/cfAccess';
import filesRoutes from './routes/files';
import ddRoutes from './routes/dd';

const app = new Hono<{ Bindings: Env }>();

// CORS — Epic 11: env-aware allowlist. Production locks the API to the two
// canonical apex hosts only; preview/dev additionally allow the
// workers.dev sandbox + localhost so local SPA -> remote-worker iteration
// still works. The `origin` callback runs per-request and reads
// `env.ENVIRONMENT` so a single deploy serves both modes correctly.
// T22.4 — CORS allowlist. Production origins are hardcoded (axal.vc apex +
// www); the dev allowlist now comes from `env.EXTRA_DEV_ORIGINS` (comma
// separated) so the workers.dev sandbox URL is NEVER hardcoded into a
// production deploy. Production env should leave EXTRA_DEV_ORIGINS unset.
const PROD_ORIGINS = ['https://axal.vc', 'https://www.axal.vc'];
const DEV_LOCALHOSTS = ['http://localhost:5000', 'http://localhost:5173'];

function parseExtraDevOrigins(env: unknown): string[] {
  const raw = ((env as { EXTRA_DEV_ORIGINS?: string })?.EXTRA_DEV_ORIGINS) || '';
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /^https?:\/\//.test(s));
}

app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const envName = (c.env.ENVIRONMENT || '').toLowerCase();
      const isProd = envName === 'production' || envName === 'prod';
      const extraDev = parseExtraDevOrigins(c.env);
      const allowed = isProd
        ? [...PROD_ORIGINS, ...extraDev]   // prod respects EXTRA_DEV_ORIGINS only if explicitly set on prod env (should be empty)
        : [...PROD_ORIGINS, ...DEV_LOCALHOSTS, ...extraDev];
      // Hono's cors() returns null/undefined to refuse the origin (no
      // Access-Control-Allow-Origin header emitted). The browser then
      // blocks the request — exactly the behaviour we want for an unknown
      // origin in production.
      return allowed.includes(origin) ? origin : null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // T6 — `X-CSRF-Token` is the double-submit header the frontend sends
    // alongside the `studioos_csrf` cookie on cookie-authenticated mutating
    // requests. Without it in the allowlist, the browser preflight blocks
    // every POST/PUT/PATCH/DELETE from the SPA in production.
    allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  }),
);

// Defense-in-depth headers on every response (HSTS, nosniff, etc.).
app.use('*', securityHeadersMiddleware());

// Rate-limit + observability run on every /api/* request. rateLimit resolves
// the current user once and caches it on context so observability + downstream
// handlers don't re-query the DB. Both are no-ops outside `/api/*`.
app.use('/api/*', rateLimitMiddleware());
app.use('/api/*', observabilityMiddleware());
// T6 — CSRF double-submit on mutating verbs for cookie-auth requests. Bearer
// auth (impersonation, websockets, signed-download URLs) is exempt by design
// — see middleware/csrf.ts for the full predicate.
app.use('/api/*', csrfMiddleware());

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
// Task #6 — Stripe billing surface (tier checkout/portal/webhook + MI Pro).
app.route('/api/billing', billing);

// Task #6 — Studio-tier paywall mounts. Wildcards run BEFORE the route
// registration so a 402 short-circuits the handler. Bypass roles
// (admin/partner/investor/mentor) are exempt inside the middleware itself.
// Growth-tier mutation gates live inline at the specific handler (decks,
// captable, mentors booking, scoring run, comarketing, compliance create).
const STUDIO_PREFIXES = [
  '/api/capital',
  '/api/funds',
  '/api/fund-sim',
  '/api/liquidity',
  '/api/legalcap',
  '/api/cofounder',
  '/api/kyc',
  '/api/networkfx',
  '/api/insights',
  '/api/portfolio',
  '/api/journal',
  '/api/watchlist',
  '/api/antiportfolio',
  '/api/partner-office-hours',
];
for (const p of STUDIO_PREFIXES) {
  app.use(p, requireTier('studio'));
  app.use(`${p}/*`, requireTier('studio'));
}

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
app.route('/api/investor-profile', investorProfile);
app.route('/api/investor-signals', investorSignals);
app.route('/api/assistant', assistantRoutes);
app.route('/api/advisory', advisory);
app.route('/api/activity', activity);
// Task #33 — Cloudflare Access perimeter on the most sensitive route groups.
// `requireCfAccess` is a soft no-op when CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD
// are unset (dev/preview); production wrangler secrets engage the gate. The
// in-app requireAdmin/requireAuth checks still run as the inner perimeter.
// We mount BOTH the exact root and the wildcard because Hono's `/*`
// pattern doesn't always match the bare root path — without this any
// `GET /api/admin` (no trailing slash) would skip the perimeter and rely
// on RBAC alone, which is exactly the leaked-admin-JWT scenario this
// middleware exists to defend against.
app.use('/api/admin', requireCfAccess());
app.use('/api/admin/*', requireCfAccess());
app.use('/api/monitoring', requireCfAccess());
app.use('/api/monitoring/*', requireCfAccess());
app.use('/api/infra', requireCfAccess());
app.use('/api/infra/*', requireCfAccess());

// Mount the more-specific /admin/contracts prefix FIRST so it takes
// precedence over the generic /admin router (which has no contract routes).
app.route('/api/admin/contracts', adminContracts);
app.route('/api/admin', admin);
app.route('/api/private-data', privateData);
app.route('/api/monitoring', monitoring);
app.route('/api/infra', infra);
// Task #33 — One-time signed R2 download endpoint (`/api/files/dl/:token`).
// Token-gated only — no admin/auth at the route layer because the token
// itself is the authorisation. See services/signedDownload.ts.
app.route('/api/files', filesRoutes);
app.route('/api/dd', ddRoutes);
app.route('/api/funds', funds);
app.route('/api/liquidity', liquidity);
app.route('/api/email', email);
app.route('/api/pipeline', pipeline);
app.route('/api/search', search);
app.route('/api/onboarding', onboarding);
app.route('/api/brand', brand);
app.route('/api/decks', decks);

// Public landing page HTML (no /api prefix). Founders publish via the
// authenticated /api/brand/landing/by-project/:pid/publish endpoint;
// this route renders the page for un-authenticated visitors.
app.get('/landing/:slug', async (c) => renderLandingHtml(c.env, c.req.param('slug')));
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
app.route('/api/linkedin', linkedinRoutes);
app.route('/api/calendar', calendarRoutes);
// T11 — Financial Model Builder + Founder Wellbeing (ported from FastAPI).
app.route('/api/financials', financialsRoutes);
app.route('/api/progress', progressRoutes);
app.route('/api/wellbeing', wellbeingRoutes);
// T12 — Compliance calendar + Cap-table simulator + Co-founder matching.
app.route('/api/compliance', complianceRoutes);
app.route('/api/captable', captableRoutes);
app.route('/api/cofounder', cofounderRoutes);
// Spin-Out Lab — guided 4-week sprint for pre-incorporation founders.
app.route('/api/spinout-lab', spinoutLabRoutes);
// T13 — Mentors + Partner Office Hours.
app.route('/api/mentors', mentorsRoutes);
app.route('/api/partner-office-hours', partnerOfficeHoursRoutes);
// T14 — Watchlist (incl. /api/antiportfolio), Decision Journal, Portfolio Health,
// Reference Checks. watchlistRoutes mounts both /watchlist and /antiportfolio so
// it sits at the /api root.
app.route('/api', watchlistRoutes);
app.route('/api/journal', journalRoutes);
app.route('/api/portfolio', portfolioRoutes);
app.route('/api/references', referencesRoutes);
// T15 — Co-marketing, Company Profiles, Founder Needs / Quotes / Engagements,
// Insights. companyRoutes mounts /company/* + /companies (root /api).
app.route('/api/comarketing', comarketingRoutes);
app.route('/api', companyRoutes);
app.route('/api/needs', needsRoutes);
app.route('/api/quotes', quotesRouter);
app.route('/api/engagements', engagementsRouter);
app.route('/api/insights', insightsRoutes);
// T3 — Reserve allocation + waterfall simulator (admin/investor only).
app.route('/api/fund-sim', fundSimulatorRoutes);
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
  'TOTP required': 403,
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
import { assertJwtSecretStrength, assertScoringHmacSecret } from './auth';

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
      // T9 — SCORING_HMAC_SECRET is hard-required in production so the
      // score-integrity key cannot silently collide with JWT_SECRET. Dev
      // logs a one-shot warning instead of throwing.
      assertScoringHmacSecret(env);
    } catch (err) {
      console.error('[boot] secret assertion failed:', (err as Error).message);
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
        // Task #4 — Investor Signals aggregation every 6h at HH:05.
        // Cron fires every minute; gate on hour%6==0 + minute==5 so the
        // aggregator runs four times a day (00:05, 06:05, 12:05, 18:05 UTC).
        if (now.getUTCHours() % 6 === 0 && now.getUTCMinutes() === 5) {
          try {
            const r = await aggregateInvestorSignals(env);
            console.info(`[cron] investor_signals aggregated n_total=${r.n_total} snapshot_id=${r.snapshot_id}`);
          } catch (e) {
            console.error('[cron] investor_signals aggregation failed', e);
          }
        }
        // Task #5 — daily assistant retention sweep at 04:10 UTC. Drops
        // conversations past their tier's TTL (90d free / 1y paid /
        // 5y admin opt-in). CASCADE deletes messages + feedback.
        if (now.getUTCHours() === 4 && now.getUTCMinutes() === 10) {
          try {
            const r = await sweepExpiredConversations(env);
            console.info(`[cron] assistant retention sweep deleted_free=${r.deleted_free} deleted_paid=${r.deleted_paid}`);
          } catch (e) {
            console.error('[cron] assistant retention sweep failed', e);
          }
        }
        // Task #6 — daily TOTP remediation backstop at 04:20 UTC. The
        // canonical trigger is the admin /maintenance/totp-remediation
        // endpoint run at deploy time; this cron is the belt-and-braces
        // sweep that catches anything missed (e.g. users created between
        // the deploy and the manual run). Idempotent — short-circuits
        // immediately when no legacy rows remain.
        if (now.getUTCHours() === 4 && now.getUTCMinutes() === 20) {
          try {
            const r = await runTotpRemediation(env);
            if (r.scanned || r.migrated || r.failed) {
              console.info(`[cron] totp remediation scanned=${r.scanned} migrated=${r.migrated} emailed=${r.emailed} failed=${r.failed}`);
            }
          } catch (e) {
            console.error('[cron] totp remediation failed', e);
          }
        }
        // Task #2 — HubSpot 30-minute reconcile. Drift between StudioOS
        // deal stages and HubSpot pipelines gets picked up here even when
        // webhooks are dropped. Cron fires every minute; gate on minute % 30.
        if (now.getUTCMinutes() % 30 === 0) {
          try {
            const r = await syncAllHubspotIntegrations(env);
            if (r.scanned > 0) {
              console.info(`[cron] hubspot sync scanned=${r.scanned} ok=${r.ok} failed=${r.failed}`);
            }
          } catch (e) {
            console.error('[cron] hubspot sync failed', e);
          }
        }
        // Task #3 — Calendly 15-minute reconcile. Webhooks deliver real-time
        // booking events; this is the safety-net for portals where webhooks
        // are dropped or disabled.
        if (now.getUTCMinutes() % 15 === 0) {
          try {
            const r = await syncAllCalendlyIntegrations(env);
            if (r.scanned > 0) {
              console.info(`[cron] calendly sync scanned=${r.scanned} ok=${r.ok} failed=${r.failed}`);
            }
          } catch (e) {
            console.error('[cron] calendly sync failed', e);
          }
        }
        // Task #4 — Salesforce 30-minute polling fallback. Mirrors stage
        // changes from Opportunity.LastModifiedDate back into local
        // deals.status when CometD/Platform Events aren't wired.
        if (now.getUTCMinutes() % 30 === 0) {
          try {
            const r = await syncAllSalesforceIntegrations(env);
            if (r.scanned > 0) {
              console.info(`[cron] salesforce sync scanned=${r.scanned} ok=${r.ok} failed=${r.failed}`);
            }
          } catch (e) {
            console.error('[cron] salesforce sync failed', e);
          }
        }
        // Task #5 — Carta cap-table sync every 6 hours at HH:00 (00/06/12/18 UTC).
        // Cron fires every minute; gate on hour%6==0 + minute==0.
        if (now.getUTCHours() % 6 === 0 && now.getUTCMinutes() === 0) {
          try {
            const r = await syncAllCartaIntegrations(env);
            if (r.scanned > 0) {
              console.info(`[cron] carta sync scanned=${r.scanned} ok=${r.ok} failed=${r.failed}`);
            }
          } catch (e) {
            console.error('[cron] carta sync failed', e);
          }
        }
        // Task #2 — DocuSign reconcile sweep every 30 minutes (HH:05 / HH:35).
        // Polls in-flight envelopes so a missed Connect webhook delivery
        // can't leave us stuck on `sent` forever. The 30-min cadence
        // matches the HubSpot/Salesforce reconcile sweep cadence and the
        // task spec; the +5-minute offset spreads load away from the
        // top/bottom-of-hour batches.
        if (now.getUTCMinutes() % 30 === 5) {
          try {
            const r = await syncAllDocusignIntegrations(env);
            if (r.scanned > 0) {
              console.info(`[cron] docusign sync scanned=${r.scanned} ok=${r.ok} failed=${r.failed}`);
            }
          } catch (e) {
            console.error('[cron] docusign sync failed', e);
          }
        }
        // Task #14 — flush pending digest emails. Cheap on idle ticks
        // (single GROUP BY query) and only sends to users whose local
        // time is currently 09:00 with cadence-matched weekday. The
        // every-minute cron means each user's slot fires once per day.
        try {
          const { flushPendingDigests } = await import('./services/notify');
          const r = await flushPendingDigests(env);
          if (r.sent > 0) {
            console.info(`[cron] notification digest sent users=${r.sent} rows=${r.rows}`);
          }
        } catch (e) {
          console.error('[cron] notification digest failed', e);
        }
        // Task #13 — daily analytics snapshot at 02:05 UTC. Captures
        // yesterday's Overview + Financial rollup into `analytics_snapshots`
        // (USD baseline) so admin historical comparisons survive the
        // nightly system_metrics cleanup. Idempotent on re-run via the
        // table's UNIQUE(snapshot_date) constraint.
        if (now.getUTCHours() === 2 && now.getUTCMinutes() === 5) {
          try {
            const r = await writeDailySnapshot(env);
            if (r.written) {
              console.info(`[cron] analytics snapshot written for ${r.snapshot_date}`);
            } else if (r.reason) {
              console.error(`[cron] analytics snapshot skipped for ${r.snapshot_date}: ${r.reason}`);
            }
          } catch (e) {
            console.error('[cron] analytics snapshot failed', e);
          }
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
