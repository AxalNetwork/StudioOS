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
import authSms from './routes/auth_sms';
import authRecover from './routes/auth_recover';
// Task #51 — Optional "Continue with Google" sign-in. Sits alongside
// /api/auth (magic link + TOTP); never the only path in. See
// routes/auth_google.ts for the linking precedence and step-up rules.
import authGoogle from './routes/auth_google';
import authPasskey from './routes/auth_passkey';
import { recoveryCoolOff } from './middleware/recoveryCoolOff';
import scoring from './routes/scoring';
import projects from './routes/projects';
import legal from './routes/legal';
import legalcap from './routes/legalcap';
import partners from './routes/partners';
import adminPartners from './routes/admin_partners';
import adminPublications from './routes/admin_publications';
// Task #10 (LD) — Admin team roster + public team endpoint.
import adminTeam from './routes/admin_team';
import adminNetworkProfiles from './routes/admin_network_profiles';
import networkPublic from './routes/network_public';
// Task #3 — Admin Telegram channels + aggregator + post send.
import adminTelegram from './routes/admin_telegram';
import telegramJoin from './routes/telegram_join';
import adminX from './routes/admin_x';
import adminSlack from './routes/admin_slack';
// Task #2 — News with author proposals + admin queue.
import newsRoutes from './routes/news';
import adminNews from './routes/admin_news';
import articlesRoutes from './routes/articles';
import adminArticles from './routes/admin_articles';
import teamPublic from './routes/team_public';
import contactRoutes from './routes/contact';
import partnerOnboarding from './routes/partner_onboarding';
import partnerPortal from './routes/partner_portal';
// Task #10 (AC-1) — Personal advisor backend + write-router.
import advisorRoutes from './routes/advisor';
import partnernet from './routes/partnernet';
import capital from './routes/capital';
import tickets from './routes/tickets';
import deals from './routes/deals';
import users from './routes/users';
import marketIntel from './routes/market_intel';
import marketIntelPublic from './routes/market_intel_public';
import { investorProfile, investorSignals, aggregateInvestorSignals } from './routes/investor_signals';
import assistantRoutes, { sweepExpiredConversations } from './routes/assistant';
import { runTotpRemediation } from './services/totpRemediation';
import { writeDailySnapshot } from './services/analyticsReports';
// Task #5 (IE) — Backup + DR. Daily KV snapshot to R2.
import { runDailyKvSnapshot, writeBackupHeartbeat } from './services/backup';
import advisory from './routes/advisory';
import activity from './routes/activity';
import admin from './routes/admin';
import adminContracts from './routes/admin_contracts';
import adminIntegrationKeys from './routes/admin_integration_keys';
// Task #4 (AW) — Admin reader for advisor_turn_audit (L6) + lock/shadow controls (L7).
import adminAdvisorAudit from './routes/admin_advisor_audit';
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
import trust from './routes/trust';
import { expireDueArtifacts as expireTrustArtifacts, resyncKycKyb } from './services/trust';
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
// Task #1 (2026-05-10) — Slack provider (one-way notifications).
// Side-effect import so registerProvider() runs at boot. No cron/sync —
// Slack is send-only, driven by services/notify.ts.
import './integrations/providers/slack';
// Crunchbase provider — named import (not bare side-effect) so CodeQL's
// unused-import check sees a real reference. The module's top-level
// `registerProvider(impl)` still runs as soon as it's loaded.
import { crunchbaseFetch as _registerCrunchbase } from './integrations/providers/crunchbase';
void _registerCrunchbase;
// Task #6 (DG) — Stripe provider. Side-effect import so registerProvider() runs at boot.
import { syncAllStripeIntegrations, handleStripeConnectEvent } from './integrations/providers/stripe';
import crunchbaseRoutes from './routes/crunchbase';
import network from './routes/network';
import referEarn from './routes/refer_earn';
import networkfx from './routes/networkfx';
import profiling from './routes/profiling';
import studioops from './routes/studioops';
import dashboard from './routes/dashboard';
import matches from './routes/matches';
import settings from './routes/settings';
import personas from './routes/personas';
import onboarding from './routes/onboarding';
// Task #6 (IF) — per-role onboarding checklist + product-tour tracking.
import onboardingChecklist from './routes/onboarding_checklist';
// Task #7 (IG) — Customer chat for paid tiers (Studio/Institutional/Partner).
import customerChat from './routes/customer_chat';
// Task #8 (IH) — Data import + migration tools (Carta/AngelList CSV/Deck
// PDF+PPTX/Investor portfolio/HubSpot pipeline/Universal CSV).
import importsRoutes from './routes/imports';
import brand, { renderLandingHtml, renderLandingPreview } from './routes/brand';
import decks from './routes/decks';
// Task #6 — share-link viewer onboarding (signup/NDA/feedback/deal-pack)
// + conversion tracking. MUST be mounted BEFORE the `/api/decks`
// catch-all so its `/share/:token/...` subpaths take precedence over
// the existing /share/:token reader in decks.ts.
import deckShareActions from './routes/deck_share_actions';
import notificationsRoutes from './routes/notifications';
import votesRoutes from './routes/votes';
import linkedinRoutes from './routes/linkedin';
import calendarRoutes from './routes/calendar';
import financialsRoutes from './routes/financials';
import progressRoutes from './routes/progress';
import metricsRoutes from './routes/metrics';
import wellbeingRoutes from './routes/wellbeing';
import complianceRoutes from './routes/compliance';
import captableRoutes from './routes/captable';
import cofounderRoutes from './routes/cofounder';
import spinoutLabRoutes from './routes/spinout_lab';
// T13/T14/T15 — port of FastAPI mentors/partner_office_hours/watchlist/journal/
// portfolio_health/references/comarketing/company/needs/insights routers.
import mentorsRoutes from './routes/mentors';
import partnerOfficeHoursRoutes from './routes/partner_office_hours';
// Task #6 (W-1) — investor paywall surfaces.
import introductionsRoutes from './routes/introductions';
import investorSeatsRoutes, { downgradeExpiredInvestorTrials } from './routes/investor_seats';
import { requireInvestorTier } from './middleware/requireInvestorTier';
import watchlistRoutes from './routes/watchlist';
import journalRoutes from './routes/journal';
import portfolioRoutes from './routes/portfolio';
import referencesRoutes from './routes/references';
import comarketingRoutes from './routes/comarketing';
import companyRoutes from './routes/company';
import needsRoutes, { quotesRouter, engagementsRouter } from './routes/needs';
import insightsRoutes from './routes/insights';
import founderRiskRoutes from './routes/founder_risk';
import servicesRoutes from './routes/services';
import publicRoutes from './routes/public';
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
import { lastActiveMiddleware } from './middleware/lastActive';
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
// Task #30 — Production allowlist. `app.axal.vc` is the same-origin SPA
// (no CORS preflight needed for that traffic, but listing it keeps
// preflight code paths well-behaved). `axal.vc` + `www.axal.vc` are the
// GitHub-Pages marketing site, which posts to `/api/forms/*` and reads
// `/api/public/status` cross-origin. `status.axal.vc` is the public
// status page (Worker-served HTML), allowed for any future widget JS.
const PROD_ORIGINS = [
  'https://app.axal.vc',
  'https://axal.vc',
  'https://www.axal.vc',
  'https://status.axal.vc',
];
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
// Task #1 (DB) — stamps users.last_active_at, throttled via RATE_LIMITS KV.
// Mounted AFTER observability so the cached `currentUser` is available; the
// middleware short-circuits when no user is on context.
app.use('/api/*', lastActiveMiddleware());
// T6 — CSRF double-submit on mutating verbs for cookie-auth requests. Bearer
// auth (impersonation, websockets, signed-download URLs) is exempt by design
// — see middleware/csrf.ts for the full predicate.
app.use('/api/*', csrfMiddleware());

// Task #5 (DC) — Hard-block third-party OAuth callbacks that arrive on the
// `*.workers.dev` sandbox host in production. The provider apps (Google,
// Microsoft, LinkedIn) are now registered with axal.vc redirect URIs only;
// any callback hitting workers.dev is either a stale redirect from before
// the migration or an attacker probing the legacy URL. Returning 410 Gone
// (vs 404) signals "this URL is permanently retired" so providers stop
// retrying and any cached browser state self-heals on the next attempt.
// The non-callback workers.dev surface stays open for preview/debugging.
//
// Mounted AFTER observability + rate-limit + CSRF so blocked traffic still
// shows up in metrics and counts against the per-bucket rate limit (so a
// stuck retry loop on a stale URL gets throttled instead of free-firing).
async function oauthCallbackWorkersDevGuard(c: any, next: () => Promise<void>) {
  const envName = String((c.env?.ENVIRONMENT || '')).toLowerCase();
  if (envName === 'production' || envName === 'prod') {
    const host = (c.req.header('host') || '').toLowerCase();
    if (host.endsWith('.workers.dev')) {
      console.warn('[OAUTH-GUARD] blocked workers.dev callback', c.req.path, host);
      return c.text(
        'This OAuth callback URL is no longer accepted. Please reconnect from https://axal.vc.',
        410,
      );
    }
  }
  await next();
}
app.use('/api/calendar/google/callback', oauthCallbackWorkersDevGuard);
app.use('/api/calendar/microsoft/callback', oauthCallbackWorkersDevGuard);
app.use('/api/linkedin/oauth/callback', oauthCallbackWorkersDevGuard);

// Canonical-host flip — axal.vc is now the primary host. SPA navigations
// (HTML page loads) hitting app.axal.vc are 301'd to the same path on
// axal.vc so users, search engines, and external bookmarks all converge
// on one origin. /api/* traffic is intentionally NOT redirected:
//   - OAuth callbacks (Google/Microsoft/LinkedIn) are registered with the
//     provider against app.axal.vc/api/auth/*/callback and MUST keep working
//     on that host. 301-ing them would break the OAuth handshake (the
//     provider POSTs back to app.axal.vc; redirecting that POST loses the
//     body / state).
//   - The SPA's same-origin /api/* XHRs already work on whichever host
//     the user loaded; no need to bounce them.
app.use('*', async (c, next) => {
  const envName = String((c.env as any)?.ENVIRONMENT || '').toLowerCase();
  const isProd = envName === 'production' || envName === 'prod';
  if (!isProd) return next();
  const host = (c.req.header('host') || '').toLowerCase();
  if (host !== 'app.axal.vc') return next();
  if (c.req.path.startsWith('/api/')) return next();
  const url = new URL(c.req.url);
  url.host = 'axal.vc';
  return c.redirect(url.toString(), 301);
});

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
// SMS as a backup 2FA factor (Google Cloud Identity Platform). Mounted on
// the same /api/auth prefix as the password/TOTP routes so endpoint paths
// match the docstrings in routes/auth_sms.ts. Hono dispatches the most-
// specific route first, so this never shadows /api/auth/login etc.
app.route('/api/auth', authSms);
// Task #50 — Lost-TOTP recovery flow (layered). Mounted at /api/auth/recover
// so the existing /api/auth surface remains untouched.
app.route('/api/auth/recover', authRecover);
// Task #51 — Google sign-in (optional). Mounted on its own /api/auth/google
// prefix so it never shadows the magic-link / TOTP routes on /api/auth.
app.route('/api/auth/google', authGoogle);
// BLOCK-AUTH-02 — WebAuthn passkeys. Own /api/auth/passkey prefix so the
// ceremony routes never shadow the password/TOTP/magic routes on /api/auth.
app.route('/api/auth/passkey', authPasskey);

// Task #50 — 24h cool-off middleware. Blocks the listed sensitive
// surfaces while users.recovery_cooling_off_until is in the future
// (set by Layer 2c / 2d / 3f / 4 resolutions). Applied as a wildcard
// BEFORE the route table so the gate runs ahead of every handler.
// Round-5 review fix — the frontend calls `/api/legal/esign/*` (mounted
// at line ~479) and admin contract operations live under
// `/api/admin/contracts`. Without these prefixes the cool-off gate
// missed actual contract surfaces; the threat-model post-recovery
// containment requires ALL contract-sensitive routes to be paused.
const COOL_OFF_PREFIXES = [
  '/api/billing',
  '/api/contracts',
  '/api/esign',
  '/api/legal/esign',
  '/api/admin/contracts',
  '/api/kyc',
  '/api/capital',
  '/api/dd',
  '/api/admin/impersonate',
];
for (const p of COOL_OFF_PREFIXES) {
  app.use(p, recoveryCoolOff);
  app.use(`${p}/*`, recoveryCoolOff);
}
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

// Task #6 (W-1) — Investor paywall gates. Mounted BEFORE the route table so
// the middleware always wraps the handlers. The middleware is a no-op for
// non-investor callers (admin/partner/mentor bypass; founder/etc. pass
// through unchanged) and only enforces tier when caller.role === 'investor'.
const INVESTOR_PRO_PREFIXES = [
  '/api/pipeline',
  '/api/deals',
  '/api/calendar',
];
for (const p of INVESTOR_PRO_PREFIXES) {
  app.use(p, requireInvestorTier('professional'));
  app.use(`${p}/*`, requireInvestorTier('professional'));
}
// Market Intel: only the export endpoint is paywalled for free investors;
// browsing pulses/benchmarks remains free. Inline gate lives in
// market_intel.ts /export.
app.use('/api/market-intel/export', requireInvestorTier('professional'));
// Institutional-only surfaces: co-invest discovery + dealroom Carta-write
// (general /api/captable POST is still founder/admin; this guards investor
// callers specifically). LP reporting + benchmarks ship in AC-1.
app.use('/api/matches/co-invest', requireInvestorTier('institutional'));

app.route('/api/scoring', scoring);
app.route('/api/projects', projects);
app.route('/api/legal', legal);
app.route('/api/legalcap', legalcap);
app.route('/api/partners', partners);
// Task #8 (X-1) — Partner deal engine. Admin endpoints under
// /api/admin/partners (separate from legacy /api/partners) and the
// public token-gated onboarding flow under /api/partner-onboard.
app.route('/api/admin/partners', adminPartners);
app.route('/api/admin/publications', adminPublications);
app.route('/api/partner-onboard', partnerOnboarding);
app.route('/api/partner-portal', partnerPortal);
// Task #10 (AC-1) — Personal advisor (dashboard chatbot + write-router).
app.route('/api/advisor', advisorRoutes);
app.route('/api/partnernet', partnernet);
app.route('/api/capital', capital);
app.route('/api/tickets', tickets);
app.route('/api/deals', deals);
app.route('/api/users', users);
app.route('/api/market-intel', marketIntel);
// Public (no-auth) companion of /api/market-intel — currently the email
// digest unsubscribe link. Mounted as a sibling so it sits OUTSIDE the
// requireAuth middleware applied to /api/market-intel.
app.route('/api/market-intel-public', marketIntelPublic);
app.route('/api/investor-profile', investorProfile);
app.route('/api/investor-signals', investorSignals);
// Task #31 — Dashboard personal assistant is Anthropic-only and is
// gated behind ENABLE_ANTHROPIC_DEV=1 on non-production stages. We
// can't read env at module init time, so the gate runs as a
// per-request middleware in front of the mount; in production STAGE
// callers get a canonical 404 instead of reaching the route. The
// assistant route itself also self-checks in `anthropicDevAllowed()`.
app.use('/api/assistant/*', async (c, next) => {
  const env = c.env as unknown as { STAGE?: string; ENVIRONMENT?: string; ENABLE_ANTHROPIC_DEV?: string };
  const prod = env.STAGE === 'production' || env.ENVIRONMENT === 'production';
  if (prod || env.ENABLE_ANTHROPIC_DEV !== '1') {
    return c.json({ error: 'not_found' }, 404);
  }
  await next();
});
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
app.route('/api/admin/integration-keys', adminIntegrationKeys);
app.route('/api/admin/advisor-audit', adminAdvisorAudit);
// Task #10 (LD) — Admin team roster CRUD + photo upload. Mounted BEFORE
// the generic /api/admin router so the more-specific prefix wins.
app.route('/api/admin/team', adminTeam);
// Task #1 — Network profiles. Mounted BEFORE catch-all /api/admin so
// /api/admin/network-profiles/* resolves here.
app.route('/api/admin/network-profiles', adminNetworkProfiles);
// Task #3 — mount Telegram BEFORE the catch-all `/api/admin` so the
// nested `/api/admin/telegram/*` routes resolve here rather than 404ing
// inside the generic admin router.
app.route('/api/admin/telegram', adminTelegram);
// User-facing Telegram channel join request — pings the studio Slack
// inbox so an admin can issue the invite link manually. Mounted under
// /api/telegram (not /api/admin) since any authenticated user can ask.
app.route('/api/telegram', telegramJoin);
// Task #4 — same mount-before-catch-all precedence as Telegram.
app.route('/api/admin/x', adminX);
// Slack bus (Phase 1, 2026-05-26) — org-wide channel poster status +
// per-channel test action. Mounted BEFORE catch-all /api/admin so the
// /api/admin/slack/* routes resolve here.
app.route('/api/admin/slack', adminSlack);
// Task #2 — News admin queue. Mounted BEFORE catch-all /api/admin so the
// nested /api/admin/news/* routes resolve here.
app.route('/api/admin/news', adminNews);
// Task #1 (Articles) — same mount-before-catch-all precedence as News.
app.route('/api/admin/articles', adminArticles);
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
// Task #6 (IF) — mounts /api/onboarding/checklist + /api/onboarding/meta.
// Sits on the same prefix as the legacy wizard router; Hono dispatches the
// most specific path first so /progress + /complete keep going to the
// original handler.
app.route('/api/onboarding', onboardingChecklist);
// Task #7 (IG) — Customer chat (paid tiers). Tier gating is enforced
// inline (isEligible) so admin/mentor bypass + Partner-tier access work
// without listing the prefix in STUDIO_PREFIXES (which would block
// partners).
app.route('/api/customer-chat', customerChat);
// Task #8 (IH) — Data imports. Outside STUDIO_PREFIXES — tier limits are
// enforced inline (Free=1/mo, Growth=10/mo, Studio=unlimited; admin/
// partner/investor/mentor bypass).
app.route('/api/imports', importsRoutes);
app.route('/api/brand', brand);
// Task #6 — viewer onboarding routes mounted FIRST so subpaths under
// /api/decks/share/:token (signup, nda, feedback, deal-pack, context)
// resolve to the new handlers before falling through to the catch-all.
app.route('/api/decks', deckShareActions);
app.route('/api/decks', decks);

// Public landing page HTML (no /api prefix). Founders publish via the
// authenticated /api/brand/landing/by-project/:pid/publish endpoint;
// this route renders the page for un-authenticated visitors.
app.get('/landing/:slug', async (c) => renderLandingHtml(c.env, c.req.param('slug'), c.get('cspNonce' as never) as string | undefined));
// Task #4 — private preview URL for unpublished drafts (noindex).
app.get('/landing/preview/:token', async (c) => renderLandingPreview(c.env, c.req.param('token'), c.get('cspNonce' as never) as string | undefined));
app.route('/api/kyc', kyc);
// Task #3 (Y-1) — Trust Center: per-role obligations + 3-way NDA flow.
app.route('/api/trust', trust);
// Frontend (`frontend/src/lib/api.js`) calls `/api/legal/esign/...` — mount
// the esign router under that path, NOT `/api/esign`. Mounting it inside
// `/api/legal` would be cleaner but `legal.ts` is its own router, so we just
// register esign at the path the UI already uses.
app.route('/api/legal/esign', esign);
app.route('/api/network', network);
// Task #9 — Refer & Earn payouts via Stripe Connect Express (import at top).
app.route('/api/refer-earn', referEarn);
app.route('/api/networkfx', networkfx);
app.route('/api/profiling', profiling);
app.route('/api/studioops', studioops);
app.route('/api/dashboard', dashboard);
app.route('/api/matches', matches);
app.route('/api/settings', settings);
app.route('/api/integrations', integrations);
app.route('/api/crunchbase', crunchbaseRoutes);
app.route('/api/personas', personas);
app.route('/api/notifications', notificationsRoutes);
app.route('/api/linkedin', linkedinRoutes);
app.route('/api/calendar', calendarRoutes);
// T11 — Financial Model Builder + Founder Wellbeing (ported from FastAPI).
app.route('/api/financials', financialsRoutes);
// Task #1 (AG) — kept alphabetically adjacent to /api/financials.
app.route('/api/founder-risk', founderRiskRoutes);
app.route('/api/progress', progressRoutes);
// Task #3 (DF) — `/api/metrics/*` alias of /api/progress/metrics/* + /series.
app.route('/api/metrics', metricsRoutes);
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

// Task #6 (W-1) — investor paywall: introductions (quota-gated) + seats
// (Institutional). Tier gates for pipeline/deals/calendar/market-intel are
// applied above (mounted before the route table to wrap all handlers).
app.route('/api/introductions', introductionsRoutes);
app.route('/api/investor-seats', investorSeatsRoutes);
// T14 — Watchlist (incl. /api/antiportfolio), Decision Journal, Portfolio Health,
// Reference Checks. watchlistRoutes mounts both /watchlist and /antiportfolio so
// it sits at the /api root.
app.route('/api', watchlistRoutes);
app.route('/api/journal', journalRoutes);
app.route('/api/portfolio', portfolioRoutes);
// Task #1 (AG) — public profile facade (no auth) sits between /api/portfolio
// and /api/references alphabetically.
app.route('/api/public', publicRoutes);
// Task #10 (LD) — Public team roster. Mounted under /api/public so it
// sits OUTSIDE auth + the /api/admin/* CF Access perimeter; the Jekyll
// marketing build (axalnetwork.github.io) curls /api/public/team into
// _data/team.json before rendering /team on axal.vc.
app.route('/api/public', teamPublic);
// Task #1 — Public photo proxy for network_profiles (mentor/partner
// roster). Mounted under /api/public so it bypasses CF-Access.
app.route('/api/public', networkPublic);
// Public contact form → GitHub Issues. No auth; honeypot + email validation
// + global per-IP rate cap; returns 503 when GITHUB_ISSUES_TOKEN is unset.
app.route('/api', contactRoutes);
// Task #2 — Public + author-facing /api/news. Public GETs are CORS-open
// to axal.vc and edge-cached 60d; author writes self-gate on trust>=70.
app.route('/api/news', newsRoutes);
// Task #1 (Articles) — Public + author-facing /api/articles. Shares the
// articles tables with /api/news; adds role filter, by-author endpoint,
// and sector taxonomy. Public GETs are CORS-open + edge-cached 60d.
app.route('/api/articles', articlesRoutes);
app.route('/api/references', referencesRoutes);
// Task #1 (AG) — service offerings (founder marketplace) alphabetically
// after /api/references and before /api/spinout-lab/comarketing.
app.route('/api/services', servicesRoutes);
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
  // BLOCK-AUTH-03 — step-up gate. Carries a machine-readable code + the TTL so
  // the SPA can prompt for a fresh TOTP, POST /api/auth/step-up, then retry.
  if (msg === 'step_up_required') {
    return c.json(
      { detail: 'Recent re-authentication required', code: 'step_up_required', ttl_minutes: err?.ttlMinutes ?? 15 },
      403,
    );
  }
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
        // Task #3 (Y-1) — nightly Trust Center housekeeping at 04:35 UTC:
        // expires past-due `legal_obligations` (TTL elapsed) and pairwise
        // NDAs past their `valid_until`, then runs the KYC/KYB resync stub
        // (no-op until Persona/Sumsub are wired). All side-effects are
        // idempotent so re-runs after a missed minute are safe.
        if (now.getUTCHours() === 4 && now.getUTCMinutes() === 35) {
          try {
            const r = await expireTrustArtifacts(env);
            if (r.obligations_expired || r.ndas_expired) {
              console.info(`[cron] trust expiry obligations=${r.obligations_expired} ndas=${r.ndas_expired}`);
            }
            const k = await resyncKycKyb(env);
            if (k.scanned) {
              console.info(`[cron] trust kyc resync scanned=${k.scanned} updated=${k.updated}`);
            }
          } catch (e) { console.error('[cron] trust expiry failed', e); }
        }
        // Task #9 — daily Refer & Earn auto-approval sweep at 04:50 UTC.
        // Walks every pending referral_payouts row, re-runs the
        // (email-verified + investor-KYC + 30-day refund window + OFAC)
        // checks, and flips eligible rows to 'approved' so the admin
        // queue stays current without manual intervention. Idempotent;
        // failures during one row don't affect the rest.
        if (now.getUTCHours() === 4 && now.getUTCMinutes() === 50) {
          try {
            const { runApprovalEngine } = await import('./services/referralPayouts');
            const r = await runApprovalEngine(env);
            if (r.scanned) {
              console.info(
                `[cron] refer-earn approval-engine scanned=${r.scanned} ` +
                `approved=${r.approved} still_pending=${r.still_pending} blocked=${r.blocked}`,
              );
            }
          } catch (e) {
            console.error('[cron] refer-earn approval-engine failed', e);
          }
        }
        // Task #8 (X-1) — daily partner deal expiry sweep at 04:40 UTC.
        // Flips deals past their term to 'expired' and revokes tier
        // grants on the partner + every redeemer (paid upgrades that
        // replaced a grant are preserved by status guards). Idempotent.
        if (now.getUTCHours() === 4 && now.getUTCMinutes() === 40) {
          try {
            const { expirePartnerDeals } = await import('./services/partnerDeals');
            const r = await expirePartnerDeals(env);
            if (r.deals_expired) {
              console.info(
                `[cron] partner deal expiry deals=${r.deals_expired} ` +
                `founder_revoked=${r.founder_grants_revoked} ` +
                `investor_revoked=${r.investor_grants_revoked} ` +
                `redemptions_revoked=${r.redemptions_revoked}`,
              );
            }
          } catch (e) { console.error('[cron] partner deal expiry failed', e); }
        }
        // Task #38 — daily rev-share attribution-window warning sweep
        // at 04:45 UTC. Finds deal_sourcing_revshare redemptions whose
        // 365-day window closes in 30 / 7 / 1 days, sends an email +
        // in-app notification per (redemption, threshold) tuple, and
        // a digest summary to admins. Idempotent via the
        // partner_revshare_window_notifications dedupe table.
        if (now.getUTCHours() === 4 && now.getUTCMinutes() === 45) {
          try {
            const { notifyExpiringRevshareWindows } = await import('./services/partnerDeals');
            const r = await notifyExpiringRevshareWindows(env);
            if (r.warnings_sent) {
              console.info(
                `[cron] revshare window warnings sent=${r.warnings_sent} ` +
                `partner_emails=${r.partner_emails_sent} admin_digest=${r.admin_digest_sent}`,
              );
            }
          } catch (e) { console.error('[cron] revshare window warnings failed', e); }
        }
        // Task #6 (W-1) — daily investor trial downgrade at 04:25 UTC.
        // Idempotent: only flips users whose trial_ends_at is in the past
        // AND status='trialing'. Re-runs harmlessly when none are due.
        if (now.getUTCHours() === 4 && now.getUTCMinutes() === 25) {
          try {
            const r = await downgradeExpiredInvestorTrials(env);
            if (r.scanned) {
              console.info(`[cron] investor trial downgrade scanned=${r.scanned} downgraded=${r.downgraded}`);
            }
          } catch (e) {
            console.error('[cron] investor trial downgrade failed', e);
          }
        }
        // Task #5 — daily assistant retention sweep at 04:10 UTC. Drops
        // conversations past their tier's TTL (90d free / 1y paid /
        // 5y admin opt-in). CASCADE deletes messages + feedback.
        // Task #31 — only runs on dev/preview stages where the assistant
        // route is mounted; in production the assistant tables are
        // expected to be empty so the sweep is a no-op anyway.
        if (now.getUTCHours() === 4 && now.getUTCMinutes() === 10) {
          const e2 = env as unknown as { STAGE?: string; ENVIRONMENT?: string; ENABLE_ANTHROPIC_DEV?: string };
          const prod = e2.STAGE === 'production' || e2.ENVIRONMENT === 'production';
          if (!prod && e2.ENABLE_ANTHROPIC_DEV === '1') {
            try {
              const r = await sweepExpiredConversations(env);
              console.info(`[cron] assistant retention sweep deleted_free=${r.deleted_free} deleted_paid=${r.deleted_paid}`);
            } catch (e) {
              console.error('[cron] assistant retention sweep failed', e);
            }
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
        // Task #7 (AM) — daily project trash sweep at 04:30 UTC. Hard-deletes
        // projects that have been soft-deleted (deleted_at) for more than
        // 30 days. Idempotent — short-circuits when no aged rows remain.
        // The DELETE handler in routes/projects.ts handles the soft-delete
        // path; this cron is the auto-purge backstop. Task #9 (AO) may
        // adjust the schedule via wrangler.toml as needed.
        // Task #6 (AT-1) + Task #3 (CE) — Market Intelligence reducer.
        // Runs at 02:15 UTC nightly AND every 6h (08:15 / 14:15 / 20:15)
        // so opt-outs propagate within 6 hours per CE acceptance spec.
        // Re-aggregates per-answer signals into k≥5 cells, recomputes
        // fit_match cosine pairs, and purges any signals from users who
        // flipped `mi_contribution_optout=1` since the last sweep.
        if ([2, 8, 14, 20].includes(now.getUTCHours()) && now.getUTCMinutes() === 15) {
          try { await Jobs.enqueue(env, 'mi_reduce', {}); }
          catch (e) { console.error('[cron] mi_reduce enqueue failed', e); }
        }
        // Task #4 (CF) — Platform Personas weekly digest. Mondays 09:00 UTC.
        // Fan-outs to Studio/Institutional + admin/partner/mentor only.
        // Idempotent via ISO-week KV marker inside the helper.
        if (now.getUTCDay() === 1 && now.getUTCHours() === 9 && now.getUTCMinutes() === 0) {
          try {
            const { sendPlatformPersonasDigest } = await import('./routes/market_intel');
            const r = await sendPlatformPersonasDigest(env);
            if (!r.skipped) {
              console.info(`[cron] personas digest scanned=${r.scanned} sent=${r.sent}`);
            }
          } catch (e) { console.error('[cron] personas digest failed', e); }
        }
        // Task #5 (IE) — Daily KV snapshot to R2 at 02:00 UTC. D1
        // backup is taken separately by .github/workflows/backup-d1.yml
        // (wrangler d1 export → R2) since the worker runtime has no
        // native D1 export. Best-effort: failures log + page but never
        // raise; the next 24h tick retries.
        if (now.getUTCHours() === 2 && now.getUTCMinutes() === 0) {
          try {
            const r = await runDailyKvSnapshot(env);
            console.info(`[cron] kv snapshot configured=${r.configured} ok=${r.ok} failed=${r.failed}`);
            // Only advance the KV heartbeat when at least one snapshot
            // actually landed and none failed. This prevents a "fresh"
            // heartbeat from masking a regression where every target
            // 404s or refuses (ephemeral guard).
            if (r.ok > 0 && r.failed === 0) {
              await writeBackupHeartbeat(env, 'worker_cron', 'kv', {
                snapshots: r.objects,
                configured: r.configured,
              });
            }
          } catch (e) {
            console.error('[cron] kv snapshot failed', e);
          }
        }
        if (now.getUTCHours() === 4 && now.getUTCMinutes() === 30) {
          try {
            const { sweepTrashedProjects } = await import('./services/projectTrash');
            const r = await sweepTrashedProjects(env, 30);
            if (r.scanned || r.deleted || r.failed) {
              console.info(`[cron] project trash sweep scanned=${r.scanned} deleted=${r.deleted} failed=${r.failed}`);
            }
          } catch (e) {
            console.error('[cron] project trash sweep failed', e);
          }
        }
        // Task #5 (AV) — hourly Vectorize re-embed for axal-search.
        // Walks every entity table, finds rows with id > last watermark
        // and enqueues `embed_entity` jobs so new content lands in the
        // search index within ~1h. Watermark stored in RATE_LIMITS KV
        // (axal-search:watermark:<type>). Best-effort — failures here
        // never raise; the next tick retries.
        if (now.getUTCMinutes() === 0) {
          try {
            const { ALL_ENTITY_TYPES } = await import('./services/vectorize');
            const TABLE_BY_TYPE: Record<string, string> = {
              project: 'projects', deal: 'deals', founder: 'founders',
              partner: 'users', document: 'legal_documents',
              academy_lesson: 'academy_lessons', mentor: 'mentors',
              investor: 'users',
            };
            const PER_TYPE_LIMIT = 200;
            for (const type of ALL_ENTITY_TYPES) {
              const table = TABLE_BY_TYPE[type];
              if (!table) continue;
              const wmKey = `axal-search:watermark:${type}`;
              let since = 0;
              try {
                const v = await env.RATE_LIMITS.get(wmKey);
                since = v ? Number(v) || 0 : 0;
              } catch { /* best-effort */ }
              try {
                // `users` is shared by partner+investor — filter by role
                // (mirrors /search/backfill) so we never enqueue an
                // unrelated user under the wrong type and contaminate
                // findPartner / findInvestor results.
                const where = type === 'investor'
                  ? `id > ? AND role = 'investor' ORDER BY id ASC LIMIT ?`
                  : type === 'partner'
                  ? `id > ? AND role = 'partner' ORDER BY id ASC LIMIT ?`
                  : `id > ? ORDER BY id ASC LIMIT ?`;
                const rows = await env.DB.prepare(
                  `SELECT id FROM ${table} WHERE ${where}`,
                ).bind(since, PER_TYPE_LIMIT).all<{ id: number }>();
                const ids = (rows.results || []).map((r) => Number(r.id));
                if (!ids.length) continue;
                // Only advance the watermark to the highest *successfully*
                // enqueued ID. If an enqueue fails partway through, we
                // stop advancing so the next tick retries the missed
                // tail rather than silently dropping rows.
                let lastOk = 0;
                let failed = 0;
                for (const id of ids) {
                  try {
                    await Jobs.enqueue(env, 'embed_entity', { type, id });
                    lastOk = id;
                  } catch (e) {
                    failed += 1;
                    console.error(`[cron] axal-search enqueue failed type=${type} id=${id}`, (e as Error).message);
                    break;
                  }
                }
                if (lastOk > since) {
                  try { await env.RATE_LIMITS.put(wmKey, String(lastOk), { expirationTtl: 90 * 86400 }); } catch {}
                }
                console.info(`[cron] axal-search re-embed type=${type} ok=${ids.indexOf(lastOk) + 1} failed=${failed} watermark=${lastOk || since}`);
              } catch (e) {
                console.error(`[cron] axal-search re-embed ${type} failed`, e);
              }
            }
          } catch (e) {
            console.error('[cron] axal-search re-embed failed', e);
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
        // Task #14 (AA-1) — Market Intelligence aggregator cron.
        // Per-cadence dispatch + nightly composite recompute.
        //   • hourly sources   → top of hour (minute === 0)
        //   • daily sources    → 02:30 UTC
        //   • weekly sources   → Sunday 02:45 UTC (UTC day 0)
        //   • recomputeIndexes → 03:15 UTC nightly (after daily runs settle)
        try {
          const { runSourcesByCadence, recomputeIndexes, runFreeConnectors } = await import('./services/market_intel/aggregator');
          await import('./services/market_intel/sources'); // ensures registerSource() ran
          if (now.getUTCMinutes() === 0) {
            const r = await runSourcesByCadence(env, 'hourly');
            if (r.scanned) console.info(`[cron] mi hourly scanned=${r.scanned} ok=${r.ok} failed=${r.failed} inserted=${r.inserted}`);
          }
          // Task #5 (AK) — every 6h (00:05/06:05/12:05/18:05 UTC), run
          // ALL free connectors regardless of their declared cadence.
          // The hourly slot above already pulls free hourly sources at
          // :00 — overlapping by minute is acceptable since connectors
          // are idempotent on (source_key, sector, ts) and the quota
          // ledger short-circuits duplicate writes within the same day.
          // This satisfies the spec contract that free sources refresh
          // every 6h end-to-end.
          if ([0, 6, 12, 18].includes(now.getUTCHours()) && now.getUTCMinutes() === 5) {
            for (const cad of ['hourly', 'daily', 'weekly'] as const) {
              const r = await runFreeConnectors(env, cad);
              if (r.scanned) console.info(`[cron] mi free-connectors-6h cadence=${cad} scanned=${r.scanned} ok=${r.ok} failed=${r.failed} inserted=${r.inserted}`);
            }
          }
          if (now.getUTCHours() === 2 && now.getUTCMinutes() === 30) {
            const r = await runSourcesByCadence(env, 'daily');
            if (r.scanned) console.info(`[cron] mi daily scanned=${r.scanned} ok=${r.ok} failed=${r.failed} inserted=${r.inserted}`);
          }
          if (now.getUTCDay() === 0 && now.getUTCHours() === 2 && now.getUTCMinutes() === 45) {
            const r = await runSourcesByCadence(env, 'weekly');
            if (r.scanned) console.info(`[cron] mi weekly scanned=${r.scanned} ok=${r.ok} failed=${r.failed} inserted=${r.inserted}`);
          }
          // Task #5 (AK) — daily 04:00 UTC: combined index recompute +
          // investor-signals snapshot refresh. The 03:15 slot was kept
          // through #14 for historical compatibility but the AK spec
          // pins this surface to a single nightly refresh window so
          // operators have one timestamp to monitor for staleness.
          if (now.getUTCHours() === 4 && now.getUTCMinutes() === 0) {
            const r = await recomputeIndexes(env);
            console.info(`[cron] mi recompute sectors=${r.sectors} rows_written=${r.rows_written}`);
            try {
              const s = await aggregateInvestorSignals(env);
              console.info(`[cron] investor_signals daily-refresh n_total=${s.n_total} snapshot_id=${s.snapshot_id}`);
            } catch (e) {
              console.error('[cron] investor_signals daily-refresh failed', e);
            }
          }
          // Institutional quarterly Axal-VC PDF — stub trigger. The PDF
          // renderer + R2 dropbox land with AA-2; this cron simply logs
          // the eligible window so we have an audit trail before the
          // generator ships. Fires on the 1st of Jan/Apr/Jul/Oct at 04:00.
          if (now.getUTCDate() === 1 && [0, 3, 6, 9].includes(now.getUTCMonth()) && now.getUTCHours() === 4 && now.getUTCMinutes() === 0) {
            console.info(`[cron] mi quarterly_pdf eligible_period=${now.getUTCFullYear()}Q${Math.floor(now.getUTCMonth() / 3) + 1} (renderer pending AA-2)`);
          }
        } catch (e) {
          console.error('[cron] market intel failed', e);
        }
        // Task #30 — Market-Intel watchlist digest. Walks
        // market_intel_watchlist on the cadence-matched send slots
        // (weekly Mon 09:00 UTC, monthly 1st 09:00 UTC), composes the
        // composite-delta + new-citations email per user, and stamps
        // last_period_key on confirmed delivery so a same-period retry
        // is a no-op. Cheap on every other tick: the helper exits in
        // O(1) when neither cadence window matches.
        try {
          const { sendMarketIntelDigests } = await import('./services/market_intel/digest');
          const r = await sendMarketIntelDigests(env, now);
          if (r.sent > 0 || r.failed > 0) {
            console.info(`[cron] mi watchlist digest users=${r.users} sent=${r.sent} failed=${r.failed} rows=${r.rows}`);
          }
        } catch (e) {
          console.error('[cron] mi watchlist digest failed', e);
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
