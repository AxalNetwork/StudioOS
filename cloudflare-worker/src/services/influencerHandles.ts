/**
 * D4289 P2 (#4291) — an influencer's handle (`axal.vc/@handle`), its channel
 * sub-links, the public read and its visit events. Attribution through a
 * handle is `services/referrals/handleAttribution.ts`.
 *
 * THE HANDLE (D-c). 3 to 24 of [a-z0-9_], case-folded, unique across handles,
 * user uids and the slug namespace. It may not be a reserved word (`RESERVED_SLUGS`
 * plus every top-level route word), contain the brand (`axal`), or look like
 * either once look-alike characters are read as letters (0→o, 1→l, 3→e, 4→a,
 * 5→s, 7→t, 8→b, 9→g; i, l and 1 read as one, and `_` dropped). It changes at most once every 30 days; the
 * first one may be set at any time.
 *
 * AN OLD HANDLE (D4289 §1.2) goes to `slug_history` (kind `handle`) and
 * redirects to the influencer's current handle for 12 months; after that it
 * reads unknown and can be taken again. A handle HQ took down never redirects
 * and cannot be taken until it expires.
 *
 * THE PUBLIC READ shows only what the page shows: name, photo (as the member's
 * public profile allows), the page's line, tier, the disclosure, and the offer
 * (P4 adds it; null until then). A paused or ended influencer gets a neutral
 * answer with no name, no offer and no attribution.
 *
 * VISITS (D-h) are one row per handle, channel, day and visitor: the visitor is
 * a client-held random id, hashed with the day and a server secret, so no IP
 * is stored and two days cannot be joined.
 */
import type { Env } from '../types';
import { RESERVED_SLUGS } from './slugs';

export const HANDLE_SHAPE = /^[a-z0-9_]{3,24}$/;
export const CHANNEL_SHAPE = /^[a-z0-9_]{1,24}$/;
export const UTM_SHAPE = /^[A-Za-z0-9_.-]{1,60}$/;
export const HANDLE_CHANGE_DAYS = 30;
export const HANDLE_REDIRECT_MONTHS = 12;
export const LINE_MAX = 160;
export const LINKS_MAX = 20;
export const SITE = 'https://axal.vc';
const DAY_MS = 86_400_000;

/**
 * Every top-level route word of the app and the site (App.jsx, the route
 * modules, the Worker's own paths). `influencer_handles_d4291.test.ts` reads
 * the app's routes and fails when one is missing here.
 */
export const ROUTE_WORDS: ReadonlySet<string> = new Set([
  'about', 'account', 'accounts', 'activity', 'admin', 'administrators', 'advisor', 'advisors', 'advisory', 'agents', 'ai',
  'analytics', 'api', 'app', 'apply', 'articles', 'assets', 'attest', 'auth', 'authors', 'billing', 'blog', 'branch', 'brand',
  'build', 'calendar', 'cap_tables', 'careers', 'changelog', 'checkout', 'circles', 'cofounder', 'cohorts', 'comarketing',
  'communities', 'community', 'companies', 'company', 'company_settings', 'compliance', 'connect', 'contact', 'contacts',
  'cookies', 'customer_discovery', 'cycles', 'dashboard', 'data', 'dataroom', 'deal', 'deals', 'deck', 'decks', 'delivery',
  'demo', 'developer', 'diligence', 'directory', 'docs', 'due_diligence', 'email', 'embed', 'esign', 'events', 'execution',
  'expertise', 'explore', 'exploring', 'faq', 'feed', 'for_advisors', 'for_founders', 'for_investors', 'for_mentors',
  'for_service_partners', 'founder', 'founders', 'fund', 'funds', 'grow', 'help', 'home', 'hq', 'inbox', 'incorporate',
  'influencer', 'influencers', 'insights', 'integrations', 'intelligence', 'investor', 'investor_seats', 'investors',
  'invitations', 'invite', 'jobs', 'join', 'kyc', 'landing', 'learn', 'learning', 'legal', 'legal_capital', 'login', 'logout',
  'lp_portal', 'magic', 'market', 'market_intel', 'marketplace', 'mcp', 'me', 'mentors', 'messages', 'methodology', 'monitoring',
  'needs', 'network', 'network_effects', 'network_intro', 'news', 'newsletter', 'notifications', 'offers', 'office_hours',
  'onboarding', 'partner', 'partner_onboarding', 'partner_portal', 'partners', 'payouts', 'perks', 'pipeline', 'pitch',
  'plans_and_pricing', 'platform', 'portfolio', 'practice', 'press', 'pricing', 'privacy', 'product_testing', 'products',
  'profile', 'programs', 'projects', 'raise', 'refer', 'referrals', 'register', 'relationships', 'reports', 'research',
  'resources', 'risk_disclosures', 'round_calls', 'scoring', 'search', 'security', 'services', 'settings', 'share', 'signals',
  'signin', 'signup', 'skills', 'spinout', 'spinout_lab', 'startups', 'status', 'studio', 'studios', 'support', 'team', 'terms',
  'tickets', 'trust', 'u', 'updates', 'validate', 'values', 'verify', 'verify_email', 'welcome', 'well_known', 'wellbeing',
]);

const LOOKALIKE: Record<string, string> = { 0: 'o', 1: 'l', i: 'l', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g' };
/** A handle read as letters: look-alike digits mapped (and i, l and 1 read as one), underscores dropped. */
export const skeleton = (h: string) => h.toLowerCase().replace(/[01345789i]/g, (d) => LOOKALIKE[d] ?? d).replace(/_/g, '');

export type HandleCheck = { ok: true; handle: string } | { ok: false; code: 'handle_invalid' | 'handle_reserved'; sentence: string };

/** Shape, reserved words, the brand and look-alikes; whether it is free is `handleHolder`'s. */
export function checkHandle(raw: unknown): HandleCheck {
  if (typeof raw !== 'string') return { ok: false, code: 'handle_invalid', sentence: 'A handle is 3 to 24 letters, digits or underscores.' };
  const handle = raw.trim().replace(/^@/, '').toLowerCase();
  if (!HANDLE_SHAPE.test(handle)) return { ok: false, code: 'handle_invalid', sentence: 'A handle is 3 to 24 letters, digits or underscores.' };
  const sk = skeleton(handle);
  const reserved = (w: string) => w === handle || skeleton(w) === sk;
  if (sk.includes('axal') || [...RESERVED_SLUGS, ...ROUTE_WORDS].some(reserved)) {
    return { ok: false, code: 'handle_reserved', sentence: 'That handle is reserved. Choose another.' };
  }
  return { ok: true, handle };
}

const sqlTime = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const msOf = (sql: string | null | undefined) => (sql ? Date.parse(`${String(sql).replace(' ', 'T')}Z`) : NaN);
const addMonths = (ms: number, n: number) => { const d = new Date(ms); d.setUTCMonth(d.getUTCMonth() + n); return d.getTime(); };
const uidOf = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

export class HandleRefusal extends Error {
  readonly status: 400 | 403 | 404 | 409;
  readonly code: string;
  readonly sentence: string;
  readonly extra: Record<string, unknown>;
  constructor(status: 400 | 403 | 404 | 409, code: string, sentence: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.status = status; this.code = code; this.sentence = sentence; this.extra = extra;
  }
}

/** Who holds `handle` now, or who it still redirects for: the influencer's id, or null when it is free. */
export async function handleHolder(env: Env, handle: string, now: number): Promise<number | null> {
  const current = await env.DB.prepare('SELECT id FROM influencers WHERE handle = ?').bind(handle).first<{ id: number }>();
  if (current) return Number(current.id);
  const retired = await env.DB.prepare(
    `SELECT target_id FROM slug_history WHERE kind = 'handle' AND slug = ? AND (expires_at IS NULL OR datetime(expires_at) > datetime(?))`,
  ).bind(handle, sqlTime(now)).first<{ target_id: number }>();
  return retired ? Number(retired.target_id) : null;
}

/** Is the word taken elsewhere in the namespace: a member's uid, a company slug, or a slug that keeps pointing somewhere? */
async function takenElsewhere(env: Env, handle: string): Promise<boolean> {
  const r = await env.DB.prepare(
    `SELECT EXISTS (SELECT 1 FROM users WHERE lower(uid) = ?1)
         OR EXISTS (SELECT 1 FROM company_profiles WHERE slug = ?1)
         OR EXISTS (SELECT 1 FROM slug_history WHERE kind = 'company' AND slug = ?1) AS taken`,
  ).bind(handle).first<{ taken: number }>();
  return Number(r?.taken) === 1;
}

type Member = { id: number; uid: string; user_id: number; status: string; tier: string; handle: string | null; handle_changed_at: string | null; page_line: string | null };

export async function memberByUser(env: Env, userId: number) {
  return env.DB.prepare('SELECT id, uid, user_id, status, tier, handle, handle_changed_at, page_line FROM influencers WHERE user_id = ?').bind(userId).first<Member>();
}

/** When the handle may next change: null when it may change now (or was never set). */
export function nextChangeAt(m: { handle: string | null; handle_changed_at: string | null }, now: number): string | null {
  if (!m.handle || !m.handle_changed_at) return null;
  const at = msOf(m.handle_changed_at) + HANDLE_CHANGE_DAYS * DAY_MS;
  return Number.isFinite(at) && at > now ? new Date(at).toISOString() : null;
}

export function handleView(m: Member, now: number) {
  return {
    handle: m.handle ?? null,
    url: m.handle ? `${SITE}/@${m.handle}` : null,
    line: m.page_line ?? null,
    next_change_at: nextChangeAt(m, now),
    status: m.status,
  };
}

/**
 * The member's handle and line. A handle change retires the old one to
 * `slug_history` (redirecting for 12 months) in the same batch, so a change
 * without its history cannot land.
 */
export async function setHandle(env: Env, userId: number, body: any, now = Date.now()) {
  const m = await memberByUser(env, userId);
  if (!m) throw new HandleRefusal(404, 'not_influencer', 'Only an Axal influencer has a handle.');
  if (m.status !== 'active') throw new HandleRefusal(409, 'influencer_not_active', 'Your influencer membership is not active, so your handle cannot change.');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HandleRefusal(400, 'invalid_request', 'Send { handle?, line? }.');
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  let line: string | null | undefined;
  if (has('line')) {
    if (body.line === null) line = null;
    else if (typeof body.line !== 'string' || body.line.trim().length > LINE_MAX) throw new HandleRefusal(400, 'line_invalid', `Your line is at most ${LINE_MAX} characters, or null.`);
    else line = body.line.trim() || null;
  }
  let handle: string | undefined;
  if (has('handle')) {
    const c = checkHandle(body.handle);
    if (!c.ok) throw new HandleRefusal(400, c.code, c.sentence);
    if (c.handle !== m.handle) {
      const next = nextChangeAt(m, now);
      if (next) throw new HandleRefusal(409, 'handle_change_too_soon', `Your handle can change again from ${next.slice(0, 10)}.`, { next_change_at: next });
      const holder = await handleHolder(env, c.handle, now);
      if ((holder != null && holder !== m.id) || await takenElsewhere(env, c.handle)) {
        throw new HandleRefusal(409, 'handle_taken', 'That handle is taken. Choose another.');
      }
      handle = c.handle;
    }
  }
  if (handle === undefined && line === undefined) return handleView(m, now);
  const at = sqlTime(now);
  const stmts: D1PreparedStatement[] = [];
  if (handle !== undefined) {
    // Claiming a handle frees any expired history row for it; the influencer's own row for it goes too (taking it back).
    stmts.push(env.DB.prepare(
      `DELETE FROM slug_history WHERE kind = 'handle' AND slug = ?
         AND ((expires_at IS NOT NULL AND datetime(expires_at) <= datetime(?)) OR (target_id = ? AND taken_down = 0))`,
    ).bind(handle, at, m.id));
    if (m.handle) {
      stmts.push(env.DB.prepare(
        `INSERT INTO slug_history (kind, scope_company_id, slug, target_id, retired_by, retired_at, expires_at)
         VALUES ('handle', NULL, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      ).bind(m.handle, m.id, userId, at, sqlTime(addMonths(now, HANDLE_REDIRECT_MONTHS))));
    }
    stmts.push(env.DB.prepare('UPDATE influencers SET handle = ?, handle_changed_at = ?, updated_at = ? WHERE id = ? AND handle IS ?')
      .bind(handle, at, at, m.id, m.handle));
    stmts.push(env.DB.prepare(
      `INSERT INTO influencer_events (user_id, influencer_id, event, detail_json, actor_user_id, created_at)
       SELECT ?, ?, 'handle_changed', ?, ?, ? WHERE EXISTS (SELECT 1 FROM influencers WHERE id = ? AND handle = ?)`,
    ).bind(userId, m.id, JSON.stringify({ from: m.handle, to: handle }), userId, at, m.id, handle));
  }
  if (line !== undefined) stmts.push(env.DB.prepare('UPDATE influencers SET page_line = ?, updated_at = ? WHERE id = ?').bind(line, at, m.id));
  try {
    const out = await env.DB.batch(stmts);
    if (handle !== undefined && !Number(out[stmts.length - (line !== undefined ? 3 : 2)]?.meta?.changes)) {
      throw new HandleRefusal(409, 'handle_changed', 'Your handle changed while you were editing it. Read it again.');
    }
  } catch (e) {
    if (e instanceof HandleRefusal) throw e;
    // The unique index on influencers.handle: someone took it between the check and the write.
    if (/UNIQUE/i.test(String((e as Error)?.message))) throw new HandleRefusal(409, 'handle_taken', 'That handle is taken. Choose another.');
    throw e;
  }
  return handleView((await memberByUser(env, userId))!, now);
}

/**
 * HQ takes a handle down: the handle is cleared, its history row is marked
 * taken down (no redirect, unclaimable for 12 months), and the influencer may
 * choose another at once. Returns the handle taken down, or null when there
 * was none.
 */
export function takedownStatements(env: Env, m: { id: number; handle: string | null }, adminId: number, now: number) {
  if (!m.handle) return null;
  const at = sqlTime(now);
  return [
    env.DB.prepare(`DELETE FROM slug_history WHERE kind = 'handle' AND slug = ?`).bind(m.handle),
    env.DB.prepare(
      `INSERT INTO slug_history (kind, scope_company_id, slug, target_id, retired_by, retired_at, expires_at, taken_down)
       VALUES ('handle', NULL, ?, ?, ?, ?, ?, 1)`,
    ).bind(m.handle, m.id, adminId, at, sqlTime(addMonths(now, HANDLE_REDIRECT_MONTHS))),
    // Cleared. The member may choose another at once: the 30-day wait (`nextChangeAt`) runs only while a handle is set.
    env.DB.prepare('UPDATE influencers SET handle = NULL, updated_at = ? WHERE id = ? AND handle = ?').bind(at, m.id, m.handle),
  ];
}

// ─────────────────────────────────────────────── channel sub-links

type LinkRow = { id: number; uid: string; influencer_id: number; channel: string; utm_campaign: string | null; created_at: string; archived_at: string | null };
const linkView = (l: LinkRow, handle: string | null) => ({
  uid: l.uid, channel: l.channel, utm_campaign: l.utm_campaign ?? null, created_at: l.created_at,
  url: handle ? `${SITE}/@${handle}/${l.channel}${l.utm_campaign ? `?utm_campaign=${encodeURIComponent(l.utm_campaign)}` : ''}` : null,
});

export async function listLinks(env: Env, userId: number) {
  const m = await memberByUser(env, userId);
  if (!m) throw new HandleRefusal(404, 'not_influencer', 'Only an Axal influencer has links.');
  const r = await env.DB.prepare('SELECT * FROM influencer_links WHERE influencer_id = ? AND archived_at IS NULL ORDER BY id').bind(m.id).all<LinkRow>();
  return { handle: m.handle ?? null, links: (r.results || []).map((l) => linkView(l, m.handle)) };
}

export async function addLink(env: Env, userId: number, body: any, now = Date.now()) {
  const m = await memberByUser(env, userId);
  if (!m) throw new HandleRefusal(404, 'not_influencer', 'Only an Axal influencer has links.');
  if (m.status !== 'active') throw new HandleRefusal(409, 'influencer_not_active', 'Your influencer membership is not active.');
  const channel = typeof body?.channel === 'string' ? body.channel.trim().toLowerCase() : '';
  if (!CHANNEL_SHAPE.test(channel)) throw new HandleRefusal(400, 'channel_invalid', 'A channel is 1 to 24 letters, digits or underscores, such as yt or newsletter.');
  const utm = body?.utm_campaign == null || body.utm_campaign === '' ? null : String(body.utm_campaign).trim();
  if (utm !== null && !UTM_SHAPE.test(utm)) throw new HandleRefusal(400, 'utm_invalid', 'A UTM campaign is 1 to 60 letters, digits, dots, dashes or underscores.');
  const live = await env.DB.prepare('SELECT COUNT(*) AS n FROM influencer_links WHERE influencer_id = ? AND archived_at IS NULL').bind(m.id).first<{ n: number }>();
  if (Number(live?.n) >= LINKS_MAX) throw new HandleRefusal(409, 'links_full', `You have ${LINKS_MAX} links. Archive one first.`);
  const uid = uidOf('ifl');
  try {
    await env.DB.prepare('INSERT INTO influencer_links (uid, influencer_id, channel, utm_campaign, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(uid, m.id, channel, utm, sqlTime(now)).run();
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error)?.message))) throw new HandleRefusal(409, 'channel_taken', 'You already have a link for that channel.');
    throw e;
  }
  return linkView((await env.DB.prepare('SELECT * FROM influencer_links WHERE uid = ?').bind(uid).first<LinkRow>())!, m.handle);
}

export async function archiveLink(env: Env, userId: number, uid: string, now = Date.now()) {
  const m = await memberByUser(env, userId);
  if (!m) throw new HandleRefusal(404, 'not_influencer', 'Only an Axal influencer has links.');
  const r = await env.DB.prepare('UPDATE influencer_links SET archived_at = ? WHERE uid = ? AND influencer_id = ? AND archived_at IS NULL')
    .bind(sqlTime(now), uid, m.id).run();
  if (!Number(r.meta?.changes)) throw new HandleRefusal(404, 'link_not_found', 'No live link has that id.');
}

// ─────────────────────────────────────────────── the public read

export const DISCLOSURE = (name: string) => `${name} earns a commission when you subscribe. Axal memberships are software, not an investment.`;

export async function visitorHash(env: Env, visitorId: string | null | undefined, day: string): Promise<string | null> {
  const id = typeof visitorId === 'string' ? visitorId.trim() : '';
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return null;
  const secret = String((env as any).JWT_SECRET || '');
  const bytes = new TextEncoder().encode(`handle-visit:${secret}:${day}:${id}`);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * `GET /api/public/handle/:handle[/:channel]`. Records one visit for a live
 * handle (and a live channel). Never throws for a bad visit write: the page
 * answers either way.
 */
export async function publicHandle(env: Env, rawHandle: string, rawChannel: string | null, visitorId: string | null, now = Date.now()) {
  const handle = String(rawHandle || '').replace(/^@/, '').toLowerCase();
  if (!HANDLE_SHAPE.test(handle)) return { status: 404 as const, body: { state: 'unknown' as const } };
  const m = await env.DB.prepare(
    `SELECT i.id, i.uid, i.user_id, i.status, i.tier, i.handle, i.page_line, u.uid AS user_uid, u.role,
            COALESCE(u.display_name, u.name) AS name, u.headshot_r2_key, u.privacy_prefs
       FROM influencers i JOIN users u ON u.id = i.user_id WHERE i.handle = ?`,
  ).bind(handle).first<any>();
  if (!m) {
    const old = await env.DB.prepare(
      `SELECT h.taken_down, i.handle AS current FROM slug_history h JOIN influencers i ON i.id = h.target_id
        WHERE h.kind = 'handle' AND h.slug = ? AND datetime(h.expires_at) > datetime(?)`,
    ).bind(handle, sqlTime(now)).first<{ taken_down: number; current: string | null }>();
    if (old && Number(old.taken_down) === 0 && old.current) {
      return { status: 200 as const, body: { state: 'moved' as const, handle: old.current, redirect: `/@${old.current}${rawChannel ? `/${String(rawChannel).toLowerCase()}` : ''}` } };
    }
    return { status: 404 as const, body: { state: 'unknown' as const } };
  }
  // A paused or ended influencer: a neutral page, no name, no offer, no attribution.
  if (m.status !== 'active') return { status: 200 as const, body: { state: 'unavailable' as const } };
  let channel: string | null = null;
  if (rawChannel != null && rawChannel !== '') {
    const ch = String(rawChannel).toLowerCase();
    const link = CHANNEL_SHAPE.test(ch)
      ? await env.DB.prepare('SELECT channel FROM influencer_links WHERE influencer_id = ? AND channel = ? AND archived_at IS NULL').bind(m.id, ch).first<{ channel: string }>()
      : null;
    // An unknown or archived channel is the handle itself: the visitor still came through it.
    channel = link ? link.channel : null;
  }
  const day = new Date(now).toISOString().slice(0, 10);
  try {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO handle_visits (influencer_id, handle, channel, day, visitor_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(m.id, handle, channel ?? '', day, await visitorHash(env, visitorId, day), sqlTime(now)).run();
  } catch (e) { console.warn('[handles] visit not recorded', (e as Error)?.message); }
  const { effectiveFlags } = await import('../routes/public');
  let prefs: unknown = null;
  try { prefs = m.privacy_prefs ? JSON.parse(m.privacy_prefs) : null; } catch { prefs = null; }
  const photo = m.headshot_r2_key && effectiveFlags(prefs, String(m.role || ''))?.headshot ? `/api/settings/headshot/${m.user_uid}` : null;
  const { TIER_LABEL } = await import('./influencers');
  const name = String(m.name || '').trim() || 'This influencer';
  return {
    status: 200 as const,
    body: {
      state: 'live' as const, handle, channel, name, photo, line: m.page_line ?? null,
      tier: m.tier, tier_label: (TIER_LABEL as any)[m.tier] ?? null,
      // P4 (#4293) adds the influencer's offer; until then there is none to show.
      offer: null,
      disclosure: DISCLOSURE(name),
      // The first-touch cookie the page sets: `h:<handle>[:<channel>]`.
      ref: `h:${handle}${channel ? `:${channel}` : ''}`,
    },
  };
}
