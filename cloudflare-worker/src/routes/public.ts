/**
 * Task #1 (AG) — Public profile facade.
 *
 * Mounted at /api/public. NO AUTHENTICATION — only exposes fields that
 * are explicitly safe to share publicly (display name, headline, role,
 * uid). Sensitive PII columns (email, phone, ciphertext) are never
 * returned. The handle is the user's `uid` (already public).
 *
 *   GET /u/:handle           — public user card
 *   GET /p/:partner_slug     — public partner card (uid)
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, getCurrentUser } from '../auth';
import { effectiveVisibilityFor, visibleToViewer } from '../services/userSettings';
import { ensureProfileExpansionSchema } from '../services/profileExpansion';
import { ensureFollowsSchema } from './follows';
import { kvGetJSON, kvPutJSON, createL1 } from '../kv';
import { bindingKey } from '../util/schemaBootstrap';
import { likeNeedleLower } from '../util/likeSearch';
import { refuse } from '../util/refusal';
import { ROUTE, type TaskClass } from '../services/aiRouter';
import { TASK_LABELS, MODEL_NAMES } from '../services/aiCatalog';
import { publicModels, type PublicModel } from '../services/ai/publicModels';
import { sendNotificationEmail } from '../services/email';
import { CONTACT_MAILBOX, DEFAULT_CONTACT_MAILBOX } from './contact';
import { isRedirectKey } from '../services/redirectRoutes';
import { REGISTRY } from '../integrations/registry';
import { MCP_PROVIDERS } from '../integrations/mcpProviders';
import { channelRollout } from '../services/channels/connections';

const publicRoutes = new Hono<{ Bindings: Env }>();

// ---------- /stats (Task #18) ---------------------------------------
// Landing page headline stats — public, no-auth. Hit on every anon page
// load, so it's cached: 30s per-isolate (L1) + 5min shared (KV) with D1
// as the origin of truth on a full miss. Never throws — any query failure
// falls back to 0 for that field so the page still renders.
const STATS_L1_TTL_MS = 30_000;

/**
 * D675 (#1549): the figures the public site prints. The four Task #18 fields
 * stay as they were, but for `funds` (below); three are added for the new site's hero and Network
 * pages, each counted from D1 with the definition beside it:
 *   - users            — accounts with `is_active = 1`, the same rule every
 *                        other user count in the worker uses;
 *   - companies        — ventures (`projects`) not deleted;
 *   - members_verified — the rows `/directory` lists, by the SAME predicate
 *                        `GET /partners` below uses (DIRECTORY_LISTED_WHERE),
 *                        so the figure and the list can never disagree.
 * `funds` counts every fund still open or investing (OPEN_FUND_WHERE): a
 * fund raising its first close is as live as one deploying, and only a
 * closed or wound-down fund is not. Until 2026-10-12 it counted `active`
 * alone, so the home page's "Active funds" hid Fund I, which is raising.
 *
 * Countries, LPs & funds and operators & advisors are not served: the
 * directory has no country or member-type column. The module count the home
 * page prints is derived in the frontend from the registries that serve each
 * module (`frontend/src/lib/siteModules.js`), not here. A page draws only the
 * figures this returns.
 */
export const OPEN_FUND_WHERE = `status IN ('fundraising', 'active')`;
type PublicStats = {
  partners: number; funds: number; deals_scored: number; spinouts: number;
  users: number; companies: number; members_verified: number;
};
export const DIRECTORY_LISTED_WHERE = `status = 'active' AND directory_listed = 1`;

/** Tests only: drop the per-isolate copy so each case reads D1 afresh. */
export function _resetPublicStatsCache(): void { statsL1.map.clear(); }
const STATS_KV_TTL_SEC = 300;
const statsL1 = createL1<PublicStats>(STATS_L1_TTL_MS);
const STATS_KV_KEY = 'cache:public-stats';

async function countOrZero(env: Env, label: string, sql: string, params: any[] = []): Promise<number> {
  try {
    const row = await env.DB.prepare(sql).bind(...params).first<{ n: number }>();
    return Number(row?.n || 0);
  } catch (e: any) {
    console.error(`[public/stats:${label}] ${String(e?.message || e)}`);
    return 0;
  }
}

publicRoutes.get('/stats', async (c) => {
  const now = Date.now();
  const l1Hit = statsL1.map.get(STATS_KV_KEY);
  if (l1Hit && l1Hit.exp > now) return c.json(l1Hit.v);

  if (c.env.TOKENS) {
    const kvHit = await kvGetJSON<PublicStats>(c.env.TOKENS, STATS_KV_KEY);
    if (kvHit) {
      statsL1.map.set(STATS_KV_KEY, { v: kvHit, exp: now + STATS_L1_TTL_MS });
      return c.json(kvHit);
    }
  }

  const [partners, funds, dealsScored, spinouts, users, companies, membersVerified] = await Promise.all([
    countOrZero(c.env, 'partners', `SELECT COUNT(*) as n FROM partners WHERE status = 'active'`),
    countOrZero(c.env, 'funds', `SELECT COUNT(*) as n FROM vc_funds WHERE ${OPEN_FUND_WHERE}`),
    countOrZero(c.env, 'deals_scored', `SELECT COUNT(DISTINCT project_id) as n FROM score_snapshots WHERE is_sandbox = 0`),
    countOrZero(c.env, 'spinouts', `SELECT COUNT(*) as n FROM projects WHERE status = 'spinout' AND deleted_at IS NULL`),
    countOrZero(c.env, 'users', `SELECT COUNT(*) as n FROM users WHERE is_active = 1`),
    countOrZero(c.env, 'companies', `SELECT COUNT(*) as n FROM projects WHERE deleted_at IS NULL`),
    countOrZero(c.env, 'members_verified', `SELECT COUNT(*) as n FROM partners WHERE ${DIRECTORY_LISTED_WHERE}`),
  ]);

  const payload: PublicStats = {
    partners, funds, deals_scored: dealsScored, spinouts,
    users, companies, members_verified: membersVerified,
  };
  statsL1.map.set(STATS_KV_KEY, { v: payload, exp: now + STATS_L1_TTL_MS });
  if (c.env.TOKENS) {
    const ctx = (c.executionCtx as any);
    const writeP = kvPutJSON(c.env.TOKENS, STATS_KV_KEY, payload, STATS_KV_TTL_SEC);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(writeP); else void writeP;
  }
  return c.json(payload);
});

// ---------- /ai-models (D678, #1552) --------------------------------
// The model registry as the public Intelligence page shows it: one row per
// task the router runs, with its label, its default model and that model's
// provider. Read from `ROUTE` and `aiCatalog.ts` on the first request, never
// copied, so the page cannot name a model the router does not default to.
//
// ONLY THE SAFE FIELDS. No price, no fallback chain, no alternates, no cache
// setting, no budget: what a logged-out reader is told is which model does
// which job. The signed-in reads (`/api/ai/pricing`, `/api/ai/rates`) keep the
// rest.
//
// CACHED LIKE /stats, WITHOUT ITS KV STEP. /stats caches because its origin is
// D1; this one's origin is a constant in the bundle, so the per-isolate copy is
// the whole cache and the shared copy is the edge's, for the same five minutes
// /stats keeps in KV.
export type PublicAiModel = { feature: string; model: string; name: string; provider: string };
let aiModelsL1: PublicAiModel[] | null = null;

export function publicAiModels(): PublicAiModel[] {
  // D761 / D764: the rail_<kind> tasks have no fixed model (a page's row picks
  // it), so a fixed row for them would name a default the page may not use.
  return (Object.keys(ROUTE) as TaskClass[]).filter((task) => !task.startsWith('rail_')).map((task) => {
    const entry = ROUTE[task];
    return {
      feature: TASK_LABELS[task] ?? task,
      model: entry.model,
      name: MODEL_NAMES[entry.model] ?? entry.model,
      provider: entry.provider,
    };
  });
}

publicRoutes.get('/ai-models', (c) => {
  if (!aiModelsL1) aiModelsL1 = publicAiModels();
  c.header('Cache-Control', `public, max-age=${STATS_KV_TTL_SEC}, s-maxage=${STATS_KV_TTL_SEC}`);
  return c.json({ ok: true, models: aiModelsL1 });
});

// ---------- /ai/models (D786, #2211) -------------------------------
// The Pricing page's Models tab, for anyone: every model the router offers,
// priced as a member pays (cost × AI_MARKUP), with its pages and flags. Only
// public fields (`services/ai/publicModels.ts`). Its origin is the bundle and
// the owner's two catalogue switches, so like /ai-models it is cached per
// isolate and at the edge for five minutes; the `public_ai_models` bucket
// bounds it per IP.
let publicModelsL1: { key: string; models: PublicModel[] } | null = null;

publicRoutes.get('/ai/models', (c) => {
  const env = { AI_PARTNER_MODELS: c.env.AI_PARTNER_MODELS, AI_PAID_MODELS: c.env.AI_PAID_MODELS };
  const key = `${env.AI_PARTNER_MODELS ?? ''}|${env.AI_PAID_MODELS ?? ''}`;
  if (!publicModelsL1 || publicModelsL1.key !== key) publicModelsL1 = { key, models: publicModels(env) };
  c.header('Cache-Control', `public, max-age=${STATS_KV_TTL_SEC}, s-maxage=${STATS_KV_TTL_SEC}`);
  return c.json({ ok: true, models: publicModelsL1.models });
});

// ---------- /plans-and-packs (D755 §11, §13; #1919) ---------------
// What /pricing shows a visitor: every plan with its price and AI allowance,
// and the token packs on sale. D1 only, never Stripe, and no person in it: the
// allowance is a projection with no recorded_by and no name. D816 (#2262): each
// plan also carries its monthly and yearly price and the computed yearly
// saving, and the read is cached at the edge for five minutes; the
// `public_plans` rate-limit bucket bounds it per IP.
publicRoutes.get('/plans-and-packs', async (c) => {
  try {
    const { plansAndPacks } = await import('../services/aiCredits');
    const body = await plansAndPacks(c.env);
    c.header('Cache-Control', `public, max-age=${STATS_KV_TTL_SEC}, s-maxage=${STATS_KV_TTL_SEC}`);
    return c.json(body);
  } catch (e) {
    return refuse(c, 503, { code: 'plans_unreadable', message: 'Unreadable: the plans and token packs could not be read.', raw: e, audience: 'member' });
  }
});

// ------------------------------------------------------------------
// Task #4 (ID) — schema bootstrap helper. The migration in
// 054_marketing_surfaces.sql may not be applied yet on dev/preview D1,
// so we lazily create the tables on first hit. CREATE IF NOT EXISTS
// makes this idempotent on prod too. Cached per isolate to avoid
// re-executing on every request.
// ------------------------------------------------------------------
const MARKETING_SCHEMA_READY = new WeakMap<object, boolean>();
async function ensureMarketingSchema(env: Env): Promise<void> {
  if (MARKETING_SCHEMA_READY.get(bindingKey(env))) return;
  // Production migrations own these tables. A cold status read must not run a
  // five-statement DDL batch before returning its public health information.
  if (env.ENVIRONMENT === 'production') {
    MARKETING_SCHEMA_READY.set(bindingKey(env), true);
    return;
  }
  try {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS status_incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'investigating',
        severity TEXT NOT NULL DEFAULT 'minor',
        affected_services TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT,
        created_by INTEGER
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS status_incident_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_by INTEGER
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS roadmap_votes (
        user_id INTEGER NOT NULL,
        item_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, item_id)
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS demo_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        company TEXT,
        message TEXT,
        github_issue_url TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS public_pageviews (
        day TEXT NOT NULL,
        path TEXT NOT NULL,
        views INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, path)
      )`),
    ]);
    MARKETING_SCHEMA_READY.set(bindingKey(env), true);
  } catch {
    // Best-effort — main endpoints handle missing-table errors gracefully.
  }
}

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw as T;
  try { return JSON.parse(String(raw)) as T; } catch { return fallback; }
}

// Per-role default visibility. Mirrors backend/app/api/routes/public_profiles.py
// so the same profile renders identically on prod (Worker) and dev (FastAPI).
const _PROFILE_DEFAULTS: Record<string, Record<string, boolean>> = {
  founder: { name: true, bio: true, headshot: true, socials: false, projects: true, traction: true, background: true },
  investor: { name: true, bio: true, headshot: true, socials: false, thesis: true, portfolio_summary: false, background: true },
  partner: { name: true, bio: true, headshot: true, socials: false, services: true, background: true },
  admin: { name: true, bio: true, headshot: true, socials: false, background: true },
};

/**
 * Which profile fields a member shows, after their own privacy_prefs.
 * Exported (D414) so the Messages counterparty card applies the SAME rules as
 * this public card rather than a copy of them.
 */
export function effectiveFlags(privacyPrefs: any, role: string): Record<string, boolean> {
  const base = { ...(_PROFILE_DEFAULTS[role] || _PROFILE_DEFAULTS.admin) };
  const pp = (safeJsonParse<any>(privacyPrefs, {}) || {}).public_profile || {};
  if (pp && typeof pp === 'object') {
    for (const [k, v] of Object.entries(pp)) base[k] = !!v;
  }
  return base;
}

async function followerCountFor(env: Env, type: 'user' | 'project', id: number): Promise<number> {
  try {
    await ensureFollowsSchema(env);
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM follows WHERE entity_type = ? AND entity_id = ?`,
    ).bind(type, id).first<{ c: number }>();
    return Number(row?.c || 0);
  } catch { return 0; }
}

/**
 * D702 — who is reading a public card. `null` is a caller who is not signed in;
 * otherwise the signed-in member's id and role. The preview on
 * `/api/profile/preview` passes a member who matches no row (id 0), so it reads
 * exactly what an unrelated signed-in member of that role would.
 */
export type PublicViewer = { id: number; role?: string | null } | null;

/** A card read's answer: the body the route sends, or the 404 it sends. */
export type CardResult = { status: 200; body: Record<string, unknown> } | { status: 404; body: { detail: string } };
const NOT_FOUND: CardResult = { status: 404, body: { detail: 'Not found' } };

/**
 * Rich public person profile — Task #66. Role-tailored + privacy-gated.
 *
 * D702 — and gated on the member's EFFECTIVE profile visibility
 * (services/userSettings.ts `effectiveVisibility`): Hidden is served only to
 * the member themself, Members only only to a signed-in caller, and Public to
 * anyone. Every other caller gets the same 404 as a missing handle.
 */
export async function publicPersonCard(env: Env, handle: string, viewer: PublicViewer): Promise<CardResult> {
  await ensureProfileExpansionSchema(env);

  // Broad select with a minimal fallback for older/dev DBs missing the
  // lazily-added identity columns (bio/socials/headshot_r2_key/privacy_prefs).
  let row: any = null;
  try {
    row = await env.DB.prepare(
      `SELECT u.id, u.uid, u.name, u.role, u.display_name, u.headline, u.bio, u.socials,
              u.headshot_r2_key, u.privacy_prefs, e.experience, e.education,
              e.certifications, e.website, u.founder_id, u.investor_id, u.partner_id,
              u.created_at
         FROM users u
         LEFT JOIN user_profile_ext e ON e.user_id = u.id
        WHERE lower(u.uid) = ? AND u.is_active = 1`,
    ).bind(handle).first<any>();
  } catch {
    row = await env.DB.prepare(
      `SELECT id, uid, name, role, founder_id, investor_id, partner_id, created_at
         FROM users WHERE lower(uid) = ? AND is_active = 1`,
    ).bind(handle).first<any>();
  }
  if (!row) return NOT_FOUND;
  const vis = (await effectiveVisibilityFor(env, [Number(row.id)])).get(Number(row.id)) ?? 'public';
  if (!visibleToViewer(vis, Number(row.id), viewer ? viewer.id : null)) return NOT_FOUND;

  const role = String(row.role || '').toLowerCase();
  const flags = effectiveFlags(row.privacy_prefs, role);
  const socials = safeJsonParse<Record<string, string>>(row.socials, {}) || {};

  const payload: Record<string, unknown> = {
    id: row.id,
    uid: row.uid,
    handle: row.uid,
    role,
    joined_at: row.created_at || null,
    name: flags.name ? (row.display_name || row.name || null) : null,
    display_name: flags.name ? (row.display_name || row.name || null) : null,
    headline: row.headline || null,
    bio: flags.bio ? (row.bio || null) : null,
    headshot_url: flags.headshot && row.headshot_r2_key ? `/api/settings/headshot/${row.uid}` : null,
    socials: flags.socials
      ? Object.fromEntries(Object.entries(socials).filter(([, v]) => typeof v === 'string' && v))
      : {},
    website: flags.background ? (row.website || socials.website || null) : null,
    followers: await followerCountFor(env, 'user', row.id),
    visible_fields: flags,
  };

  // Structured career background (public, LinkedIn-style).
  if (flags.background) {
    payload.experience = safeJsonParse(row.experience, []);
    payload.education = safeJsonParse(row.education, []);
    payload.certifications = safeJsonParse(row.certifications, []);
  }

  // Founder → cross-linkable startups.
  if (role === 'founder' && row.founder_id && (flags.projects || flags.traction)) {
    const pr = await env.DB.prepare(
      `SELECT uid, name, sector, stage, status FROM projects
         WHERE founder_id = ? AND deleted_at IS NULL`,
    ).bind(row.founder_id).all<any>();
    const projects = (pr.results || []).filter(
      (p: any) => !['archived', 'rejected', 'intake'].includes(String(p.status || '').toLowerCase()),
    );
    if (flags.projects) {
      payload.projects = projects.slice(0, 12).map((p: any) => ({
        handle: p.uid, name: p.name, sector: p.sector, stage: p.stage,
      }));
    }
    if (flags.traction) {
      payload.traction = { active_projects: projects.length };
    }
  }

  // Investor → thesis.
  if (role === 'investor' && row.investor_id && flags.thesis) {
    const inv = await env.DB.prepare(
      `SELECT investor_type, sector_focus, stage_focus, check_size_min, check_size_max, accreditation_status
         FROM investors WHERE id = ?`,
    ).bind(row.investor_id).first<any>();
    if (inv) {
      payload.thesis = {
        investor_type: inv.investor_type,
        sector_focus: inv.sector_focus || null,
        stage_focus: inv.stage_focus || null,
        check_size_min: inv.check_size_min,
        check_size_max: inv.check_size_max,
        accredited: (inv.accreditation_status || '') === 'verified',
      };
    }
  }

  // Partner → services summary.
  if (role === 'partner' && row.partner_id && flags.services) {
    const p = await env.DB.prepare(
      `SELECT specialization, company FROM partners WHERE id = ?`,
    ).bind(row.partner_id).first<any>();
    if (p) {
      payload.services = {
        specialization: p.specialization || null,
        company: p.company || null,
      };
    }
  }

  return { status: 200, body: payload };
}

publicRoutes.get('/u/:handle', async (c) => {
  const handle = String(c.req.param('handle') || '').trim().toLowerCase();
  if (!handle) return c.json({ detail: 'handle required' }, 400);
  const viewer = await getCurrentUser(c);
  const out = await publicPersonCard(c.env, handle, viewer ? { id: Number(viewer.id), role: viewer.role } : null);
  return c.json(out.body, out.status);
});

/** The statuses that keep a venture off the public startup page. */
export const STARTUP_NOT_PUBLIC_STATUSES = ['archived', 'rejected', 'intake'];

/**
 * Task #66 — Public, shareable startup profile. Handle is the project uid.
 * Returns only fields safe for anonymous sharing (no data-room links, no
 * financial internals beyond headline traction), founder cards for
 * cross-linking, recent SUBMITTED updates, and the published landing URL.
 * Projects that are archived/rejected/intake or soft-deleted are not
 * addressable in public (mirrors the founder-block visibility rule).
 *
 * D702 — a founder card is drawn only when that founder's effective profile
 * visibility serves `viewer` (Hidden: only the founder; Members only: any
 * signed-in member), the same rule `publicPersonCard` applies.
 */
export async function publicStartupCard(env: Env, handle: string, viewer: PublicViewer): Promise<CardResult> {
  const proj = await env.DB.prepare(
    `SELECT id, uid, name, sector, stage, status, description, problem_statement,
            solution, why_now, users_count, revenue, funding_needed, founded_year,
            hq, website, founder_id, created_at
       FROM projects WHERE lower(uid) = ? AND deleted_at IS NULL`,
  ).bind(handle).first<any>();
  if (!proj) return NOT_FOUND;
  const status = String(proj.status || '').toLowerCase();
  if (STARTUP_NOT_PUBLIC_STATUSES.includes(status)) return NOT_FOUND;

  // Founder card(s) — the primary founder user, safe fields only.
  const founders: any[] = [];
  if (proj.founder_id) {
    try {
      const fr = await env.DB.prepare(
        `SELECT id, uid, name, display_name, headline, role, headshot_r2_key
           FROM users WHERE founder_id = ? AND is_active = 1`,
      ).bind(proj.founder_id).all<any>();
      const people = fr.results || [];
      const vis = await effectiveVisibilityFor(env, people.map((u: any) => Number(u.id)));
      for (const u of people) {
        if (!visibleToViewer(vis.get(Number(u.id)) ?? 'public', Number(u.id), viewer ? viewer.id : null)) continue;
        founders.push({
          handle: u.uid,
          name: u.display_name || u.name || null,
          headline: u.headline || null,
          role: u.role,
          headshot_url: u.headshot_r2_key ? `/api/settings/headshot/${u.uid}` : null,
        });
      }
    } catch { /* founder card is best-effort */ }
  }

  // Recent submitted updates (news feed).
  let updates: any[] = [];
  try {
    const ur = await env.DB.prepare(
      `SELECT uid, period, title, submitted_at FROM portfolio_updates
         WHERE project_id = ? AND status = 'submitted'
         ORDER BY COALESCE(submitted_at, updated_at) DESC LIMIT 6`,
    ).bind(proj.id).all<any>();
    updates = (ur.results || []).map((u: any) => ({
      uid: u.uid, period: u.period, title: u.title, submitted_at: u.submitted_at,
    }));
  } catch { /* portfolio_updates may not exist on some dev DBs */ }

  // Site/Website button target: an explicit startup website URL wins; when
  // absent, fall back to a published Brand & Landing page (Brand Builder output).
  let website: string | null = proj.website ? String(proj.website).trim() || null : null;
  if (!website) {
    try {
      // Multi-page sites: the oldest published page is the site's public face.
      const lp = await env.DB.prepare(
        `SELECT slug, published FROM landing_pages WHERE project_id = ? AND published = 1 ORDER BY id LIMIT 1`,
      ).bind(proj.id).first<any>();
      if (lp && lp.published) website = `https://axal.vc/landing/${lp.slug}`;
    } catch { /* landing_pages may not exist */ }
  }

  return {
    status: 200,
    body: {
      id: proj.id,
      handle: proj.uid,
      name: proj.name,
      sector: proj.sector || null,
      stage: proj.stage || null,
      status,
      description: proj.description || null,
      problem_statement: proj.problem_statement || null,
      solution: proj.solution || null,
      why_now: proj.why_now || null,
      founded_year: proj.founded_year || null,
      hq: proj.hq || null,
      traction: {
        users: proj.users_count || null,
        revenue: proj.revenue || null,
        funding_needed: proj.funding_needed || null,
      },
      founders,
      updates,
      website,
      followers: await followerCountFor(env, 'project', proj.id),
      joined_at: proj.created_at || null,
    },
  };
}

publicRoutes.get('/startup/:handle', async (c) => {
  const handle = String(c.req.param('handle') || '').trim().toLowerCase();
  if (!handle) return c.json({ detail: 'handle required' }, 400);
  const viewer = await getCurrentUser(c);
  const out = await publicStartupCard(c.env, handle, viewer ? { id: Number(viewer.id), role: viewer.role } : null);
  return c.json(out.body, out.status);
});

// PublicDirectoryPage (`/directory`) — list endpoint for anonymous
// visitors. The `partners` table only carries the minimal shape
// {uid, name, company, specialization, referral_code, status,
// referrals_count}, so the richer fields the frontend renders
// (categories, kyb_verified, featured, ratings, response time,
// pricing tier, ranking_score) are filled with safe defaults until
// a follow-up populates them from a richer source. The page's
// PartnerCard already handles null/empty values gracefully.
//
// Filters supported:
//   q      — case-insensitive LIKE against name/company/specialization
// All other filter params (category, capacity, pricing,
// verified_only, rate_max) are accepted but ignored at this layer
// — they have no backing columns yet. Returning the full set rather
// than a 400 keeps the UI working when a user toggles a filter on
// the existing page.
publicRoutes.get('/partners', async (c) => {
  // Admin-gated directory: only rows where the admin has flipped
  // `directory_listed = 1` are visible to anonymous visitors. The
  // `directory_featured` flag promotes a partner above standard rows
  // in the PartnerCard grid via the `featured: true` field on the
  // response payload. See `routes/admin_partners.ts` for the admin
  // toggle endpoints.
  const { ensurePartnerDirectoryColumns } = await import('../services/partnerDirectorySchema');
  await ensurePartnerDirectoryColumns(c.env);
  const q = String(c.req.query('q') || '').trim().toLowerCase();
  const params: any[] = [];
  let where = DIRECTORY_LISTED_WHERE;
  if (q) {
    // `1`, not the helper's default: this search accepts a single character
    // today and D128 is a de-duplication, not a behaviour change.
    const like = likeNeedleLower(q, 1)!;
    where += ` AND (lower(name) LIKE ? ESCAPE '\\' OR lower(coalesce(company, '')) LIKE ? ESCAPE '\\' OR lower(coalesce(specialization, '')) LIKE ? ESCAPE '\\')`;
    params.push(like, like, like);
  }
  const sqlText = `SELECT uid, name, company, specialization, referral_code, referrals_count,
                          directory_featured
                     FROM partners
                    WHERE ${where}
                    ORDER BY directory_featured DESC, referrals_count DESC, name ASC
                    LIMIT 200`;
  try {
    const rs = await c.env.DB.prepare(sqlText).bind(...params).all<{
      uid: string; name: string; company: string | null;
      specialization: string | null; referral_code: string | null;
      referrals_count: number; directory_featured: number;
    }>();
    const partners = (rs.results || []).map((r) => ({
      slug: r.uid,
      name: r.name,
      company: r.company,
      headline: r.specialization,
      categories: [] as string[],
      kyb_verified: false,
      featured: !!r.directory_featured,
      featured_tier: r.directory_featured ? 'editor' : null,
      reviews: { avg_rating: null as number | null },
      response_time_hours: null as number | null,
      pricing_tier: null as string | null,
      completed_engagements: r.referrals_count || 0,
      // Featured rows always outrank standard ones; within each band we
      // still use referrals_count as the only "engagement" proxy.
      ranking_score: (r.directory_featured ? 1_000_000 : 0) + (r.referrals_count || 0),
    }));
    return c.json({ partners, total: partners.length });
  } catch (e: any) {
    console.error('[public/partners] list failed:', e?.message || e);
    return c.json({ partners: [], total: 0 });
  }
});

publicRoutes.get('/p/:partner_slug', async (c) => {
  const slug = String(c.req.param('partner_slug') || '').trim().toLowerCase();
  if (!slug) return c.json({ detail: 'slug required' }, 400);
  const row = await c.env.DB.prepare(
    `SELECT uid, name, company, specialization, status
       FROM partners WHERE lower(uid) = ? OR lower(referral_code) = ?`,
  ).bind(slug, slug).first<{
    uid: string; name: string; company: string | null;
    specialization: string | null; status: string;
  }>();
  if (!row || row.status !== 'active') return c.json({ detail: 'Not found' }, 404);
  return c.json({
    uid: row.uid,
    handle: row.uid,
    name: row.name,
    company: row.company,
    specialization: row.specialization,
  });
});

// ==================================================================
// Task #4 (ID) — Public marketing surfaces.
// ==================================================================

// ---------- /status ------------------------------------------------
type ServiceHealth = {
  name: string;
  match?: string;
  status: 'operational' | 'degraded' | 'down' | 'unknown';
  uptime_pct?: number | null;
  monitoring?: 'not_monitored';
  availability?: string;
  note?: string;
  history?: Array<{ day: string; status: string }>;
};

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysBefore(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

/**
 * Source service states from the shared /api/health endpoint so the public
 * status page reflects the EXACT same probes the uptime monitors see.
 * We call /api/health via in-isolate `fetch()` (Workers route the request
 * to the same isolate without leaving the edge) so this is cheap and
 * stays consistent with the canonical health surface.
 *
 * Each /api/health binding maps to one display row. We also run a live
 * D1 probe so a degraded database is reported as `down` rather than
 * "binding present, status ok".
 */
type HealthSnapshot = {
  status: string;
  bindings: { db: boolean; kv_tokens: boolean; kv_rate_limits: boolean; durable_pipeline: boolean; durable_onboarding: boolean };
};

async function fetchHealthSnapshot(c: Parameters<typeof requireAuth>[0]): Promise<HealthSnapshot | null> {
  try {
    const origin = new URL(c.req.url).origin;
    const res = await fetch(`${origin}/api/health`, { headers: { 'User-Agent': 'axal-status-page' } });
    if (!res.ok) return null;
    return (await res.json()) as HealthSnapshot;
  } catch {
    return null;
  }
}

async function probeServices(c: Parameters<typeof requireAuth>[0]): Promise<ServiceHealth[]> {
  const env = c.env;
  const snap = await fetchHealthSnapshot(c);
  const bindings = snap?.bindings || {
    db: !!env.DB,
    kv_tokens: !!(env as unknown as { TOKENS?: unknown }).TOKENS,
    kv_rate_limits: !!(env as unknown as { RATE_LIMITS?: unknown }).RATE_LIMITS,
    durable_pipeline: !!(env as unknown as { PIPELINE_ROOM?: unknown }).PIPELINE_ROOM,
    durable_onboarding: !!(env as unknown as { ONBOARDING_CHAT?: unknown }).ONBOARDING_CHAT,
  };

  const services: ServiceHealth[] = [];

  // Live DB probe — /api/health only reports binding presence, so we run
  // an actual SELECT 1 to flip a wedged database from "operational" to "down".
  let dbStatus: ServiceHealth['status'] = bindings.db ? 'operational' : 'down';
  if (bindings.db) {
    try { await env.DB.prepare('SELECT 1').first(); }
    catch { dbStatus = 'down'; }
  }
  // Rows name what a visitor uses, never the platform part behind it. `match`
  // keeps the technical word an incident's `affected_services` may name (an
  // admin tagging "D1" or "R2") so renaming a row never drops an incident
  // from its strip; it is stripped before the response.
  services.push({ name: 'API and database', match: 'd1 db database api', status: dbStatus });
  services.push({ name: 'Sign-in sessions', match: 'kv tokens token store', status: bindings.kv_tokens ? 'operational' : 'down' });
  services.push({ name: 'Rate limiting', match: 'kv rate limit', status: bindings.kv_rate_limits ? 'operational' : 'down' });
  services.push({ name: 'Live updates', match: 'do realtime pipeline', status: bindings.durable_pipeline ? 'operational' : 'down' });
  services.push({ name: 'Onboarding chat', match: 'do onboarding', status: bindings.durable_onboarding ? 'operational' : 'down' });
  // None of these is in /api/health, so binding presence stands in, and an
  // absent binding reads "unknown". File storage is the `FILES` bucket: the probe
  // used to read `env.R2`, a binding that has never existed, so the row was
  // always "unknown" and the page rolled up to "Degraded".
  const bound = (key: string) => !!(env as unknown as Record<string, unknown>)[key];
  const presence = (key: string): ServiceHealth['status'] => (bound(key) ? 'operational' : 'unknown');
  services.push({ name: 'AI scoring', match: 'workers ai', status: presence('AI') });
  services.push({ name: 'File storage', match: 'r2 files', status: presence('FILES') });
  services.push({ name: 'Search', match: 'vectorize vector', status: presence('VECTORIZE') });
  services.push({ name: 'Background jobs', match: 'queue job_queue', status: presence('JOB_QUEUE') });
  services.push({ name: 'Published pages', match: 'publications', status: presence('PUBLICATIONS') });
  services.push({ name: 'Backups', match: 'backups', status: presence('BACKUPS') });
  services.push({ name: 'Document rendering', match: 'browser rendering pdf', status: presence('BROWSER') });

  // Public capability coverage, not member connection checks. Never contact a
  // remote MCP server, read credentials or run a tool on this anonymous GET.
  const unmonitored = (name: string, match: string, availability: string) => {
    services.push({ name, match, availability, status: 'unknown', monitoring: 'not_monitored',
      note: 'Availability reflects platform settings. Live service health is not monitored here.' });
  };
  unmonitored('MCP server', 'mcp server assistants',
    env.MCP_SERVER_ENABLED === 'true' && bound('OAUTH_KV') ? 'Enabled' : 'Not enabled');
  unmonitored('Member API keys', 'member api keys', env.API_KEYS_ENABLED === 'true' ? 'Enabled' : 'Not enabled');
  unmonitored('MCP clients', 'mcp clients shared client', 'Available');
  for (const provider of Object.values(MCP_PROVIDERS)) {
    const name = REGISTRY.find((entry) => entry.key === provider.key)?.display_name ?? provider.key;
    unmonitored(`${name} MCP client`, `${provider.key} mcp client`, 'Available');
  }
  unmonitored('Custom MCP clients', 'custom mcp clients',
    String(env.CUSTOM_MCP_ENABLED ?? '').trim().toLowerCase() === 'true' ? 'Enabled' : 'Not enabled');
  for (const provider of REGISTRY.filter((entry) => entry.status !== 'coming_soon')) {
    unmonitored(`${provider.display_name} connector`, `${provider.key} connector`,
      provider.status === 'beta' ? 'Beta' : 'Available');
  }
  for (const provider of ['whatsapp', 'telegram'] as const) {
    const rollout = channelRollout(env, provider);
    unmonitored(provider === 'whatsapp' ? 'WhatsApp messaging' : 'Telegram messaging', provider,
      rollout === 'on' ? 'Enabled' : rollout === 'off' ? 'Not enabled' : 'Limited rollout');
  }
  unmonitored('Google Meet transcripts', 'google meet transcripts',
    String(env.MEET_TRANSCRIPTS_ENABLED ?? '').trim().toLowerCase() === 'on' ? 'Enabled' : 'Not enabled');
  unmonitored('Email delivery', 'email gmail notifications',
    bound('GMAIL_CLIENT_ID') && bound('GMAIL_CLIENT_SECRET') && bound('GMAIL_REFRESH_TOKEN') ? 'Configured' : 'Not configured');
  unmonitored('Payments', 'payments billing stripe', bound('STRIPE_SECRET_KEY') ? 'Configured' : 'Not configured');
  return services;
}

publicRoutes.get('/status', async (c) => {
  await ensureMarketingSchema(c.env);
  const services = await probeServices(c);

  // Load incidents from the last 90 days plus their updates.
  type IncRow = { id: number; title: string; status: string; severity: string; affected_services: string | null; created_at: string };
  type UpdRow = { id: number; incident_id: number; status: string; body: string; created_at: string };
  let incRows: IncRow[] = [];
  let updRows: UpdRow[] = [];
  try {
    const since = daysBefore(90);
    const incRes = await c.env.DB.prepare(
      `SELECT id, title, status, severity, affected_services, created_at
         FROM status_incidents WHERE created_at >= ? ORDER BY created_at DESC LIMIT 50`,
    ).bind(since).all<IncRow>();
    incRows = incRes.results || [];
    if (incRows.length > 0) {
      const ids = incRows.map((r) => r.id);
      const placeholders = ids.map(() => '?').join(',');
      const updRes = await c.env.DB.prepare(
        `SELECT id, incident_id, status, body, created_at
           FROM status_incident_updates WHERE incident_id IN (${placeholders}) ORDER BY created_at ASC`,
      ).bind(...ids).all<UpdRow>();
      updRows = updRes.results || [];
    }
  } catch { /* tables not yet present */ }

  // Group updates by incident.
  const updateMap = new Map<number, UpdRow[]>();
  for (const u of updRows) {
    if (!updateMap.has(u.incident_id)) updateMap.set(u.incident_id, []);
    updateMap.get(u.incident_id)!.push(u);
  }
  const incidents = incRows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    severity: r.severity,
    affected_services: (() => {
      if (!r.affected_services) return [];
      try {
        const parsed = JSON.parse(r.affected_services);
        return Array.isArray(parsed) ? parsed : [];
      } catch { return []; }
    })(),
    created_at: r.created_at,
    updates: updateMap.get(r.id) || [],
  }));

  // Per-service 90-day history derived from incidents that name the service.
  // We mark every day in the window operational by default and downgrade based
  // on active incidents touching that service.
  const today = todayUTC();
  const days: string[] = [];
  for (let i = 89; i >= 0; i--) days.push(daysBefore(i));
  // Build a resolved-at lookup so each cell only degrades within the actual
  // incident window (start day → resolved day, or "today" if still open).
  type ResolvedRow = { id: number; resolved_at: string | null; status: string };
  const resolvedById = new Map<number, ResolvedRow>();
  try {
    const r = await c.env.DB.prepare(
      `SELECT id, resolved_at, status FROM status_incidents WHERE id IN (${incRows.map(() => '?').join(',') || 'NULL'})`,
    ).bind(...incRows.map((row) => row.id)).all<ResolvedRow>();
    (r.results || []).forEach((row) => resolvedById.set(row.id, row));
  } catch { /* ignore */ }

  const enriched = services.map(({ match, ...svc }) => {
    const slug = `${svc.name} ${match || ''}`.toLowerCase();
    const cells = days.map((day) => {
      let status: ServiceHealth['status'] = svc.monitoring === 'not_monitored' ? 'unknown' : 'operational';
      for (const inc of incidents) {
        const touches = !inc.affected_services?.length
          || inc.affected_services.some((s: string) => slug.includes(String(s).toLowerCase()));
        if (!touches) continue;
        const incDay = inc.created_at.slice(0, 10);
        if (day < incDay) continue;
        const meta = resolvedById.get(inc.id);
        const isResolved = meta?.status === 'resolved';
        const resolvedDay = meta?.resolved_at ? meta.resolved_at.slice(0, 10) : null;
        // For resolved incidents, only paint days from start through the
        // resolved day. For open incidents, paint from start through today.
        const endDay = isResolved ? (resolvedDay || incDay) : today;
        if (day > endDay) continue;
        const sev = (inc.severity || 'minor') as string;
        if (sev === 'critical') status = 'down';
        else if (status !== 'down') status = 'degraded';
      }
      return { day, status };
    });
    const opCount = cells.filter((c) => c.status === 'operational').length;
    // A resolved incident stays in today's history but must not keep today's
    // live state down after recovery.
    const activeIncidents = incidents.filter((inc) => inc.status !== 'resolved'
      && inc.created_at.slice(0, 10) <= today
      && (!inc.affected_services?.length || inc.affected_services.some((key: string) => slug.includes(String(key).toLowerCase()))));
    const incidentStatus = activeIncidents.some((inc) => inc.severity === 'critical') ? 'down'
      : activeIncidents.length ? 'degraded' : null;
    const status = svc.status === 'down' || incidentStatus === 'down' ? 'down' : incidentStatus ?? svc.status;
    return { ...svc, status, history: cells, uptime_pct: svc.monitoring === 'not_monitored' ? null : (opCount / cells.length) * 100 };
  });

  return c.json({ services: enriched, incidents });
});

// ---------- /changelog ---------------------------------------------
// Pulls GitHub Releases from the configured repo and filters to those tagged
// `public-changelog`. The release body is parsed for optional `Audience: x`
// and `Image: <url>` lines (sensible defaults if absent).

type GhReleaseRaw = {
  id: number;
  name: string | null;
  tag_name: string;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
  html_url: string;
};

function parseRelease(r: GhReleaseRaw) {
  const body = r.body || '';
  const audienceMatch = body.match(/^Audience:\s*(\w+)/im);
  const imageMatch = body.match(/^Image:\s*(\S+)/im);
  // Strip the meta lines from the summary
  const summary = body
    .replace(/^Audience:.*$/im, '')
    .replace(/^Image:.*$/im, '')
    .trim();
  return {
    id: String(r.id),
    title: r.name || r.tag_name,
    audience: (audienceMatch?.[1] || 'all').toLowerCase(),
    summary,
    image: imageMatch?.[1] || null,
    published_at: r.published_at,
    url: r.html_url,
  };
}

publicRoutes.get('/changelog', async (c) => {
  const env = c.env as unknown as { GITHUB_TOKEN?: string; GITHUB_REPO?: string };
  const repo = env.GITHUB_REPO || 'axalvc/studioos';
  const token = env.GITHUB_TOKEN || '';
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'axal-studioos-changelog',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=50`, { headers });
    if (!res.ok) {
      // Quietly degrade to an empty list rather than failing the public page.
      return c.json({ entries: [] });
    }
    const raw = (await res.json()) as GhReleaseRaw[];
    const entries = raw
      .filter((r) => !r.draft && !r.prerelease)
      .filter((r) => {
        const body = r.body || '';
        // Tagged "public-changelog" via a literal token in the body or a
        // dedicated `Tags:` line. Falls back to release name suffix.
        return /\bpublic-changelog\b/i.test(body)
          || /\bpublic-changelog\b/i.test(r.tag_name)
          || /\bpublic-changelog\b/i.test(r.name || '');
      })
      .map(parseRelease);
    return c.json({ entries });
  } catch {
    return c.json({ entries: [] });
  }
});

// ---------- /roadmap/votes -----------------------------------------
// GET — current vote counts (and whether the caller has voted on each).
// POST — record an upvote (requires auth).
// DELETE — remove the caller's upvote.

publicRoutes.get('/roadmap/votes', async (c) => {
  await ensureMarketingSchema(c.env);
  // Determine caller (optional auth).
  let userId: number | null = null;
  try {
    const u = await requireAuth(c);
    userId = u.id;
  } catch { /* anonymous */ }

  type Row = { item_id: string; count: number };
  let counts: Row[] = [];
  try {
    const r = await c.env.DB.prepare(
      `SELECT item_id, COUNT(*) AS count FROM roadmap_votes GROUP BY item_id`,
    ).all<Row>();
    counts = r.results || [];
  } catch { /* table missing */ }

  let mine = new Set<string>();
  if (userId != null) {
    try {
      const r = await c.env.DB.prepare(
        `SELECT item_id FROM roadmap_votes WHERE user_id = ?`,
      ).bind(userId).all<{ item_id: string }>();
      mine = new Set((r.results || []).map((row) => row.item_id));
    } catch { /* ignore */ }
  }
  return c.json({
    items: counts.map((c2) => ({ id: c2.item_id, count: c2.count, mine: mine.has(c2.item_id) })),
  });
});

publicRoutes.post('/roadmap/votes', async (c) => {
  await ensureMarketingSchema(c.env);
  const user = await requireAuth(c);
  const body = await c.req.json<{ item_id?: string }>().catch(() => ({} as { item_id?: string }));
  const itemId = String(body.item_id || '').trim();
  if (!itemId || itemId.length > 80) {
    return c.json({ detail: 'item_id required' }, 400);
  }
  try {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO roadmap_votes (user_id, item_id) VALUES (?, ?)`,
    ).bind(user.id, itemId).run();
  } catch (ex) {
    return refuse(c, 500, { code: 'vote_failed', message: 'Your vote could not be recorded. Try again in a moment.', raw: ex });
  }
  return c.json({ ok: true, item_id: itemId });
});

publicRoutes.delete('/roadmap/votes', async (c) => {
  await ensureMarketingSchema(c.env);
  const user = await requireAuth(c);
  const body = await c.req.json<{ item_id?: string }>().catch(() => ({} as { item_id?: string }));
  const itemId = String(body.item_id || '').trim();
  if (!itemId) return c.json({ detail: 'item_id required' }, 400);
  try {
    await c.env.DB.prepare(
      `DELETE FROM roadmap_votes WHERE user_id = ? AND item_id = ?`,
    ).bind(user.id, itemId).run();
  } catch (ex) {
    return refuse(c, 500, { code: 'unvote_failed', message: 'Your vote could not be removed. Try again in a moment.', raw: ex });
  }
  return c.json({ ok: true, item_id: itemId });
});

// ---------- /demo-request ------------------------------------------
// Persists the lead, emails them a confirmation and emails the team (D680).
// The HTTP response never waits on either email.

/** D680 — who reads each demo topic: the contact form's mailboxes. */
export const DEMO_MAILBOX: Record<string, string> = {
  product: DEFAULT_CONTACT_MAILBOX,
  investor: CONTACT_MAILBOX.invest,
  partnership: CONTACT_MAILBOX.advise,
};

publicRoutes.post('/demo-request', async (c) => {
  await ensureMarketingSchema(c.env);
  const body = await c.req.json<{
    topic?: string; name?: string; email?: string;
    company?: string; message?: string;
  }>().catch(() => ({} as any));
  const topic = String(body.topic || '').trim();
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const company = String(body.company || '').trim().slice(0, 200);
  const message = String(body.message || '').trim().slice(0, 4000);

  if (!['product', 'investor', 'partnership'].includes(topic)) {
    return c.json({ detail: 'invalid topic' }, 400);
  }
  if (!name || name.length > 200) return c.json({ detail: 'name required' }, 400);
  if (!email || email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return c.json({ detail: 'valid email required' }, 400);
  }

  // Anti-spam: dedupe by (email, topic) — if a request landed in the last
  // 5 minutes we silently treat the second submit as a no-op success.
  // This caps duplicate team emails even though the global /api/* rate limit
  // (cloudflare-worker/src/middleware/rateLimit.ts) is already in front
  // of this route.
  try {
    const dup = await c.env.DB.prepare(
      `SELECT id FROM demo_requests
         WHERE email = ? AND topic = ?
           AND created_at >= datetime('now', '-5 minutes')
         LIMIT 1`,
    ).bind(email, topic).first<{ id: number }>();
    if (dup) {
      return c.json({ ok: true, id: dup.id, deduped: true });
    }
  } catch { /* dedupe is best-effort */ }

  let insertedId: number | null = null;
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO demo_requests (topic, name, email, company, message)
         VALUES (?, ?, ?, ?, ?)`,
    ).bind(topic, name, email, company || null, message || null).run();
    insertedId = (r.meta?.last_row_id as number) || null;
  } catch (ex) {
    return refuse(c, 500, { code: 'request_failed', message: 'Your request could not be recorded. Try again in a moment.', raw: ex });
  }

  // Email the lead a confirmation out-of-band. Uses sendRawEmail rather
  // than the templated send() pipeline because we don't want to add a
  // registry entry for a single transactional confirmation — keeps the
  // template registry tied to in-app user flows. Gmail creds are
  // optional in dev; we silently no-op if they're missing.
  const TOPIC_LABEL: Record<string, string> = {
    product: '30-min product demo',
    investor: 'Investor brief',
    partnership: 'Partnership intro',
  };
  c.executionCtx.waitUntil((async () => {
    try {
      const gmailEnv = c.env as unknown as {
        GMAIL_CLIENT_ID?: string; GMAIL_CLIENT_SECRET?: string; GMAIL_REFRESH_TOKEN?: string;
      };
      if (!gmailEnv.GMAIL_CLIENT_ID || !gmailEnv.GMAIL_CLIENT_SECRET || !gmailEnv.GMAIL_REFRESH_TOKEN) {
        return;
      }
      const { sendRawEmail } = await import('../services/email/gmail');
      const topicLabel = TOPIC_LABEL[topic] || topic;
      const subject = `We received your request — ${topicLabel}`;
      const text = [
        `Hi ${name},`,
        '',
        `Thanks for reaching out about a ${topicLabel.toLowerCase()} with Axal StudioOS. We've logged your request and someone from the team will be in touch within one business day.`,
        '',
        message ? `For context, you wrote:\n${message}\n` : '',
        'In the meantime you can read our pricing (https://axal.vc/pricing) or browse the public roadmap (https://axal.vc/roadmap).',
        '',
        '— The Axal team',
      ].filter(Boolean).join('\n');
      const html = `
        <p>Hi ${name.replace(/[<>&]/g, '')},</p>
        <p>Thanks for reaching out about a <strong>${topicLabel.toLowerCase()}</strong> with Axal StudioOS. We've logged your request and someone from the team will be in touch within one business day.</p>
        ${message ? `<p><em>For context, you wrote:</em><br>${message.replace(/[<>&]/g, (m) => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[m]!))}</p>` : ''}
        <p>In the meantime you can read our <a href="https://axal.vc/pricing">pricing</a> or browse the <a href="https://axal.vc/roadmap">public roadmap</a>.</p>
        <p>— The Axal team</p>
      `;
      await sendRawEmail(c.env, {
        to: email,
        subject,
        text,
        html,
        from: 'Axal VC <noreply@axal.vc>',
        replyTo: 'support@axal.vc',
      });
    } catch (ex) {
      console.warn('[demo-request] confirmation email failed', ex);
    }
  })());

  // D680 — the team hears of the request by email, from the same mailboxes the
  // contact form uses. It is never filed to GitHub: the repository is public
  // and the request carries the lead's name, email and message.
  if (insertedId) {
    c.executionCtx.waitUntil((async () => {
      try {
        const lines = [
          'A new request from the axal.vc demo form.',
          '',
          `Topic: ${TOPIC_LABEL[topic] || topic}`,
          `From: ${name} <${email}>`,
          ...(company ? [`Company: ${company}`] : []),
          '',
          message || '(no message)',
          '',
          `Reference: request #${insertedId} (demo_requests)`,
        ];
        const sent = await sendNotificationEmail(
          c.env,
          DEMO_MAILBOX[topic] || DEFAULT_CONTACT_MAILBOX,
          `[Demo] ${TOPIC_LABEL[topic] || topic} — ${company || name}`.slice(0, 200),
          lines.join('\n'),
        );
        if (!sent) console.warn(`[demo-request] request #${insertedId} stored but not emailed to the team; read it from demo_requests`);
      } catch {
        console.warn(`[demo-request] request #${insertedId} stored but not emailed to the team; read it from demo_requests`);
      }
    })());
  }
  return c.json({ ok: true, id: insertedId });
});

// ---------- admin: status incident management ----------------------
// These are auth-gated inside the handler (role === 'admin'). The
// /api/public mount-point runs no auth middleware, so we
// re-check the caller here.

async function requireAdminInline(c: Parameters<typeof requireAuth>[0]) {
  const user = await requireAuth(c);
  if (user.role !== 'admin') {
    const err = new Error('Admin required');
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
  return user;
}

publicRoutes.post('/status/incidents', async (c) => {
  await ensureMarketingSchema(c.env);
  const user = await requireAdminInline(c);
  const body = await c.req.json<{
    title?: string; severity?: string; status?: string;
    affected_services?: string[]; update?: string;
  }>().catch(() => ({} as any));
  const title = String(body.title || '').trim();
  if (!title) return c.json({ detail: 'title required' }, 400);
  const severity = ['minor', 'major', 'critical'].includes(String(body.severity)) ? body.severity! : 'minor';
  const status = ['investigating', 'identified', 'monitoring', 'resolved'].includes(String(body.status))
    ? body.status! : 'investigating';
  const services = Array.isArray(body.affected_services) ? JSON.stringify(body.affected_services.slice(0, 20)) : null;
  const ins = await c.env.DB.prepare(
    `INSERT INTO status_incidents (title, status, severity, affected_services, created_by)
       VALUES (?, ?, ?, ?, ?)`,
  ).bind(title, status, severity, services, user.id).run();
  const id = (ins.meta?.last_row_id as number) || null;
  if (id && body.update) {
    await c.env.DB.prepare(
      `INSERT INTO status_incident_updates (incident_id, status, body, created_by) VALUES (?, ?, ?, ?)`,
    ).bind(id, status, String(body.update).slice(0, 4000), user.id).run();
  }
  return c.json({ ok: true, id });
});

publicRoutes.post('/status/incidents/:id/updates', async (c) => {
  await ensureMarketingSchema(c.env);
  const user = await requireAdminInline(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'invalid id' }, 400);
  const body = await c.req.json<{ status?: string; body?: string }>().catch(() => ({} as any));
  const status = ['investigating', 'identified', 'monitoring', 'resolved'].includes(String(body.status))
    ? body.status! : 'investigating';
  const text = String(body.body || '').trim();
  if (!text) return c.json({ detail: 'body required' }, 400);
  await c.env.DB.prepare(
    `INSERT INTO status_incident_updates (incident_id, status, body, created_by) VALUES (?, ?, ?, ?)`,
  ).bind(id, status, text.slice(0, 4000), user.id).run();
  await c.env.DB.prepare(
    `UPDATE status_incidents SET status = ?, resolved_at = CASE WHEN ? = 'resolved' THEN datetime('now') ELSE resolved_at END WHERE id = ?`,
  ).bind(status, status, id).run();
  return c.json({ ok: true });
});

// ---------- /analytics/pageview ------------------------------------
// First-party, privacy-friendly pageview counter. No IP, no UA, no cookies.

publicRoutes.post('/analytics/pageview', async (c) => {
  await ensureMarketingSchema(c.env);
  const body = await c.req.json<{ path?: string }>().catch(() => ({} as { path?: string }));
  const raw = String(body.path || '').trim();
  // Only count paths from our known public surfaces; ignore everything else.
  const allowed = new Set(['/', '/pricing', '/demo', '/status', '/changelog', '/spinout-lab', '/terms', '/privacy']);
  // D939: retain only a complete, explicitly allowlisted admin-tab key.
  // Other paths keep the original query/hash stripping behavior.
  const adminKey = raw === 'redirect:/admin' || raw.startsWith('redirect:/admin?') || raw.startsWith('redirect:/admin#');
  const path = adminKey ? (isRedirectKey(raw) ? raw : '') : (isRedirectKey(raw) ? raw : raw.split('?')[0].split('#')[0]);
  // #2301: an old redirect address opened in the SPA, counted under its own
  // `redirect:<pattern>` key — only a pattern on the list (services/redirectRoutes.ts).
  if (!allowed.has(path) && !isRedirectKey(path)) return c.body(null, 204);
  try {
    await c.env.DB.prepare(
      `INSERT INTO public_pageviews (day, path, views) VALUES (?, ?, 1)
         ON CONFLICT(day, path) DO UPDATE SET views = views + 1`,
    ).bind(todayUTC(), path).run();
  } catch { /* table missing — best-effort */ }
  return c.body(null, 204);
});

// Task #5 — Public author profile page. Accepts numeric user ID and returns
// the live profile from the users table (not the legacy author_websites table)
// plus the author's published articles. Powers /authors/:key in the SPA.
// No auth required — fields here are limited to the public display set.
//
// Owner, 2026-10-12: an author is also reachable by a name slug —
// /authors/guillaumelauzier — and the payload names that slug so the page can
// show it as the address. The slug is the display name lower-cased, accents
// dropped, letters and digits only. Two published authors with the same slug:
// the lower user id keeps it, the other is `<slug>-<id>`. The photo honours the
// author's own privacy choice, as /u/:handle and the photo route already do.

/** An author's name as a URL slug: `Guillaume Lauzier` → `guillaumelauzier`. */
export function authorSlugBase(name: unknown): string {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Every published author's slug, by user id; a clash goes to the lower id. */
export function authorSlugs(rows: Array<{ id: number; name?: string | null; display_name?: string | null }>): Map<number, string> {
  const taken = new Set<string>();
  const out = new Map<number, string>();
  for (const r of [...rows].sort((a, b) => a.id - b.id)) {
    const base = authorSlugBase(r.display_name || r.name) || 'author';
    const slug = taken.has(base) ? `${base}-${r.id}` : base;
    taken.add(slug);
    out.set(r.id, slug);
  }
  return out;
}

async function publishedAuthorSlugs(env: Env): Promise<Map<number, string>> {
  try {
    const res = await env.DB.prepare(
      `SELECT DISTINCT u.id, u.name, u.display_name
         FROM users u JOIN articles a ON a.author_user_id = u.id
        WHERE a.status = 'published' AND u.is_active = 1`,
    ).all<{ id: number; name: string | null; display_name: string | null }>();
    return authorSlugs(res.results || []);
  } catch {
    return new Map();
  }
}

publicRoutes.get('/authors/:userId', async (c) => {
  const key = String(c.req.param('userId') || '').trim().toLowerCase();
  const slugs = await publishedAuthorSlugs(c.env);
  let userId = /^\d+$/.test(key) ? Number(key) : 0;
  if (!userId && /^[a-z0-9-]{1,120}$/.test(key)) {
    for (const [id, slug] of slugs) if (slug === key) { userId = id; break; }
  }
  if (!Number.isInteger(userId) || userId <= 0) {
    return /^[a-z0-9-]{1,120}$/.test(key) ? c.json({ detail: 'Not found' }, 404) : c.json({ detail: 'invalid' }, 400);
  }

  let userRow: any = null;
  try {
    userRow = await c.env.DB.prepare(
      `SELECT u.id, u.uid, u.name, u.display_name, u.headline, u.bio, u.socials,
              u.headshot_r2_key, u.city, u.country, u.role, u.privacy_prefs
         FROM users u
        WHERE u.id = ? AND u.is_active = 1 LIMIT 1`,
    ).bind(userId).first<any>();
  } catch { /* older dev DB may be missing columns — fall through to 404 */ }
  if (!userRow) return c.json({ detail: 'Not found' }, 404);

  let company: string | null = null;
  try {
    const companyRow: any = await c.env.DB.prepare(
      `SELECT JSON_EXTRACT(experience, '$[0].company') AS company FROM user_profile_ext WHERE user_id = ? LIMIT 1`,
    ).bind(userId).first<any>();
    company = companyRow?.company || null;
  } catch { /* user_profile_ext may not exist on older dev DBs */ }

  let items: any[] = [];
  try {
    const res = await c.env.DB.prepare(
      `SELECT a.id, a.slug, a.title, a.subtitle, a.sector, a.tags,
              a.cover_r2_key, a.published_at, a.word_count, a.read_minutes,
              a.author_user_id, a.excerpt
         FROM articles a
        WHERE a.author_user_id = ? AND a.status = 'published'
        ORDER BY a.published_at DESC
        LIMIT 50`,
    ).bind(userId).all<any>();
    items = (res.results || []).map((row: any) => {
      let tags: string[] = [];
      try { tags = JSON.parse(row.tags || '[]'); } catch { tags = []; }
      return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        subtitle: row.subtitle || null,
        sector: row.sector || null,
        tags,
        cover_url: row.cover_r2_key ? `/api/articles/cover/${row.id}` : null,
        published_at: row.published_at,
        word_count: row.word_count,
        read_minutes: row.read_minutes,
        excerpt: row.excerpt || null,
      };
    });
  } catch { /* articles table missing on older dev DB */ }

  if (items.length === 0) return c.json({ detail: 'Not found' }, 404);

  const socials = safeJsonParse<Record<string, string>>(userRow.socials, {}) || {};
  const location = [userRow.city, userRow.country].filter(Boolean).join(', ') || null;

  return c.json({
    author: {
      id: userRow.id,
      uid: userRow.uid,
      name: userRow.display_name || userRow.name || null,
      role: userRow.role || null,
      headline: userRow.headline || null,
      bio: userRow.bio || null,
      slug: slugs.get(userRow.id) || null,
      headshot_url: userRow.headshot_r2_key && effectiveFlags(userRow.privacy_prefs, String(userRow.role || '').toLowerCase()).headshot
        ? `/api/settings/headshot/${userRow.uid}` : null,
      location,
      company,
      socials: {
        linkedin: socials.linkedin || null,
        twitter: socials.twitter || null,
        website: socials.website || null,
        github: socials.github || null,
        instagram: socials.instagram || null,
      },
    },
    items,
  });
});

export default publicRoutes;
