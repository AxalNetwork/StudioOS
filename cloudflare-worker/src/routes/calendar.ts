/**
 * Calendar routes — port of backend/app/api/routes/calendar.py.
 *
 * Mounted at /api/calendar. Twenty-three endpoints across:
 *   - unified events feed + ICS export
 *   - "Subscribe to my events": its token (make, read, remove) and the feed (D1033)
 *   - "Subscribe to my whole calendar": the same, on a token of its own (D1209)
 *   - IC meetings CRUD + RSVP + Reschedule (D1207)
 *   - founder check-ins CRUD + Reschedule (D1207)
 *   - the people and deal pickers for New IC meeting and New check-in (D1207)
 *   - Google Calendar OAuth + sync (status, connect, callback, sync, disconnect)
 *   - Microsoft 365 / Outlook OAuth + sync (same five)
 *
 * Every authenticated handler runs through `safe()` so any uncaught error
 * surfaces as a friendly JSON 500 with the cause logged to Cloudflare. The
 * two callbacks intentionally skip requireAuth — the user_id comes from the
 * single-use HMAC-signed state token persisted in oauth_state_tokens. So does
 * the two feeds, whose member comes from their token (migrations 603, 610).
 *
 * D1209: each sync leaves its failure on the token row for the status reads,
 * and a disconnect keeps the copies it made unless the member removes them
 * first (migration 610).
 */
import { Hono } from 'hono';
import { prepareWorkspaceConnect } from './google_workspace';
import { DRIVE_FILE_SCOPE, WorkspaceError, clearWorkspaceConnection, ensureWorkspaceIntegration } from '../services/google/workspace';
import type { Env, User } from '../types';
import type { CalendarEvent } from '../services/calendar';
import { getSQL } from '../db';
import { canAccessProject, getProjectMembershipRole } from '../services/projectAccess';
import { userMayReadDeal } from './deals';
import { addToCalendarLinks, eventVisibleTo, joinLinkAllowed, MY_EVENT_KINDS } from '../services/calendar/myEvents';
import { CALENDAR_FEED_SCOPE, FEED_SCOPE, feedStatus, mintFeedToken, resolveFeedToken, revokeFeedToken, type FeedScope } from '../services/calendar/feedTokens';
import {
  accountMarker, clearSyncError, forgetRetained, readSyncError, recordSyncError, retainCopies, takeRetainedMarker,
  type SyncProvider,
} from '../services/calendar/syncState';
import { removeProviderCopies } from '../services/calendar/sync';
import { describeItems } from '../services/calendar/items';
import { investorUpsell, userMeetsInvestorTier } from '../middleware/requireInvestorTier';
import { logAdminAction } from '../services/adminAudit';
import { requireAuth, isSuperAdmin } from '../auth';
import { branchOf } from '../util/branch';
import {
  googleOAuthAvailable, microsoftOAuthAvailable,
  buildGoogleAuthUrl, buildMicrosoftAuthUrl, GOOGLE_MEET_TRANSCRIPT_SCOPE,
  revokeGoogleOAuthGrant, loadRefreshTokenExport,
  exchangeGoogleCode, exchangeMicrosoftCode,
  fetchGoogleUserinfo, fetchMicrosoftUserinfo,
  fetchUserEvents, fetchUserEventsWithSources, fetchCalendarScope, attachPushRecords, eventsToIcs, KNOWN_KINDS, SCOPED_EXCLUDED_KINDS, validScopeWindow,
  syncUserToGoogle, syncUserToMicrosoft,
  preflightOAuthSecrets,
} from '../services/calendar';
export { preflightOAuthSecrets };
import { encryptString } from '../services/cryptoBox';
import { bindingKey } from '../util/schemaBootstrap';
import { refuse } from '../util/refusal';
import { parseReturn, returnFromNonce, returnTag } from '../util/oauthReturn';

const calendar = new Hono<{ Bindings: Env }>();

const STATE_TTL_SECONDS = 600;

// ---------------------------------------------------------------------------
// safe() — defensive wrapper, mirrors routes/auth.ts.
// ---------------------------------------------------------------------------
function safe(label: string, friendly: string, handler: (c: any) => Promise<any>) {
  return async (c: any) => {
    try {
      return await handler(c);
    } catch (e: any) {
      const msg = e?.message || '';
      if (msg === 'Unauthorized' || msg === 'Forbidden') throw e;
      console.error('[CAL]', label, msg, e?.stack || '');
      return c.json({ error: friendly }, 500);
    }
  };
}

function isAdmin(role: string): boolean { return role.toLowerCase() === 'admin'; }
function lc(role: any): string { return String(role || '').toLowerCase(); }

// ---------------------------------------------------------------------------
// HMAC state — same construction as routes/linkedin.ts. The nonce is the
// row key in oauth_state_tokens (single-use), HMAC binds it to JWT_SECRET so
// even an attacker who guessed the row key cannot forge a valid state.
// ---------------------------------------------------------------------------
function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function hmacSign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return b64url(sig);
}
async function makeState(env: Env, nonce: string): Promise<string> {
  const sig = await hmacSign(env.JWT_SECRET, nonce);
  return `${nonce}.${sig}`;
}
async function verifyState(env: Env, raw: string): Promise<string | null> {
  const i = raw.indexOf('.');
  if (i < 0) return null;
  const nonce = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = await hmacSign(env.JWT_SECRET, nonce);
  // crypto.subtle does not expose timingSafeEqual; compare equal-length strings
  // char-by-char to avoid early-exit timing leaks on the HMAC suffix.
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let j = 0; j < sig.length; j++) diff |= sig.charCodeAt(j) ^ expected.charCodeAt(j);
  return diff === 0 ? nonce : null;
}

// Lazy schema bootstrap — calendar.sql creates oauth_state_tokens with
// (state UNIQUE, user_id, provider CHECK, expires_at, created_at). On a
// prod DB where the table is missing entirely (or was created by the
// integrations/oauth.ts shape lacking `expires_at`), the INSERT below
// throws and `safe()` returns the generic "Could not start Google OAuth"
// string. Bootstrap the calendar shape once per isolate so the OAuth
// start handler is self-healing.
const CALENDAR_OAUTH_STATE_READY = new WeakMap<object, boolean>();
async function ensureCalendarOauthStateTable(env: Env): Promise<void> {
  if (CALENDAR_OAUTH_STATE_READY.get(bindingKey(env))) return;
  try {
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS oauth_state_tokens (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'state TEXT NOT NULL UNIQUE, ' +
      'user_id INTEGER NOT NULL, ' +
      'provider TEXT NOT NULL, ' +
      'expires_at TEXT NOT NULL, ' +
      "created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))",
    );
    // Add expires_at if the table existed in the integrations/oauth.ts
    // shape (no expires_at column). Ignore "duplicate column" errors.
    try {
      await env.DB.exec("ALTER TABLE oauth_state_tokens ADD COLUMN expires_at TEXT NOT NULL DEFAULT ''");
    } catch { /* column already exists */ }
    CALENDAR_OAUTH_STATE_READY.set(bindingKey(env), true);
  } catch (e) {
    console.warn('[CAL:ensureOauthStateTable]', (e as Error).message);
  }
}

async function persistState(env: Env, nonce: string, userId: number, provider: 'google' | 'microsoft'): Promise<void> {
  await ensureCalendarOauthStateTable(env);
  const sql = getSQL(env);
  const expires = new Date(Date.now() + STATE_TTL_SECONDS * 1000).toISOString();
  // Opportunistic sweep — keeps the table from growing unbounded.
  //
  // `AND expires_at != ''` IS LOAD-BEARING AND IT IS NOT AN OPTIMISATION.
  // `oauth_state_tokens` has two definitions and this file's is the one that
  // lost: `integrations/oauth.ts` created the table first, so production holds
  // its shape plus the `expires_at TEXT NOT NULL DEFAULT ''` the bootstrap
  // above ALTERs in. That provider's INSERT names five columns and not
  // `expires_at`, so every Salesforce, Carta, DocuSign, HubSpot and LinkedIn
  // handshake sits in this table with `expires_at = ''` — and `'' < <any ISO
  // stamp>` is TRUE in SQLite, so without this clause the sweep deleted every
  // in-flight integration OAuth state each time a calendar connect started.
  // `services/fundSheets.ts:192` already carries the same clause for the same
  // reason; this is the copy that was missing. See D191.
  const nowIso = new Date().toISOString();
  await sql`DELETE FROM oauth_state_tokens WHERE expires_at < ${nowIso} AND expires_at != ''`;
  await sql`
    INSERT INTO oauth_state_tokens (state, user_id, provider, expires_at)
    VALUES (${nonce}, ${userId}, ${provider}, ${expires})
  `;
}

async function consumeState(env: Env, nonce: string, provider: 'google' | 'microsoft'): Promise<number | null> {
  const sql = getSQL(env);
  const row = (await sql`
    SELECT user_id, expires_at FROM oauth_state_tokens
    WHERE state = ${nonce} AND provider = ${provider}
  ` as any[])[0];
  if (!row) return null;
  await sql`DELETE FROM oauth_state_tokens WHERE state = ${nonce}`;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row.user_id as number;
}

// ===========================================================================
// Unified feed
// ===========================================================================
calendar.get('/events', safe('events', 'Could not list calendar events', async (c) => {
  const user = await requireAuth(c);
  const url = new URL(c.req.url);
  const fromQ = url.searchParams.get('from');
  const toQ = url.searchParams.get('to');
  const kindsQ = url.searchParams.get('kinds');
  const scope = url.searchParams.get('scope') || 'mine';
  if (!['mine', 'studio', 'all'].includes(scope)) return c.json({ detail: 'Invalid calendar scope' }, 400);
  if (scope !== 'mine' && user.role !== 'admin') return c.json({ detail: 'Admin role required' }, 403);
  if (scope === 'all' && (branchOf(c.env) || !isSuperAdmin(user))) return c.json({ detail: 'Super admin required' }, 403);
  const fromDt = fromQ ? new Date(fromQ) : new Date(Date.now() - 86_400_000);
  const toDt = toQ ? new Date(toQ) : new Date(Date.now() + 90 * 86_400_000);
  if (Number.isNaN(fromDt.getTime()) || Number.isNaN(toDt.getTime())) {
    return c.json({ detail: 'Invalid from/to ISO datetime' }, 400);
  }
  const kinds = kindsQ ? kindsQ.split(',').map(s => s.trim()).filter(Boolean) : undefined;
  if (scope === 'studio' || scope === 'all') {
    if (!validScopeWindow(fromDt.toISOString(),toDt.toISOString())) return c.json({ detail: 'Staff calendar windows must be ordered and at most 180 days.' }, 400);
    const result = await fetchCalendarScope(c.env, user, scope, fromDt.toISOString(), toDt.toISOString(), kinds);
    await logAdminAction(c.env, user.id, user.email, 'calendar_scope_read', {
      scope, from: fromDt.toISOString(), to: toDt.toISOString(),
    });
    return c.json({ items: result.events, sources: result.sources, coverage: result.coverage,
      scope, read_only: true, excluded_kinds: SCOPED_EXCLUDED_KINDS, from: fromDt.toISOString(), to: toDt.toISOString() });
  }
  // THE DEGRADING READ, deliberately — see `gather` in services/calendar.ts.
  // Until now one unreadable source turned the whole agenda into a 500 and
  // nothing in the response could say which one. `sources` reports every kind
  // that was asked for and whether it answered, so the page can render the four
  // that loaded and name the fifth instead of blanking.
  //
  // D1207: this read alone asks for cancelled rows, so the page can strike
  // them through with their reason; and each item carries what the drawer
  // draws (`describeItems`). The feed, the sync and the push never see either.
  const { events, sources } = await fetchUserEventsWithSources(
    c.env, user.id, lc(user.role), fromDt.toISOString(), toDt.toISOString(), kinds, { withCancelled: true },
  );
  const items = await describeItems(c.env, user, await attachPushRecords(c.env, user.id, events));
  await ensureCalendarOAuthSchema(c.env);
  const sql = getSQL(c.env);
  const tok = (await sql`SELECT 1 FROM google_oauth_tokens WHERE user_id = ${user.id}` as any[])[0];
  return c.json({
    items,
    from: fromDt.toISOString(),
    to: toDt.toISOString(),
    google_connected: !!tok,
    sources,
  });
}));

calendar.get('/events.ics', safe('ics', 'Could not export calendar', async (c) => {
  const user = await requireAuth(c);
  const url = new URL(c.req.url);
  const fromQ = url.searchParams.get('from');
  const toQ = url.searchParams.get('to');
  const fromDt = fromQ ? new Date(fromQ) : new Date(Date.now() - 7 * 86_400_000);
  const toDt = toQ ? new Date(toQ) : new Date(Date.now() + 180 * 86_400_000);
  if (Number.isNaN(fromDt.getTime()) || Number.isNaN(toDt.getTime())) {
    return c.json({ detail: 'Invalid from/to ISO datetime' }, 400);
  }
  // D1033 — `kinds` narrows the file as it narrows `/events`, so
  // `?kinds=event_ticket,event_hosted` is "my events" alone. A kind the
  // aggregator does not know is refused rather than read as an empty file.
  const kindsQ = url.searchParams.get('kinds');
  const kinds = kindsQ ? kindsQ.split(',').map(s => s.trim()).filter(Boolean) : undefined;
  if (kinds && kinds.some(k => !(KNOWN_KINDS as readonly string[]).includes(k))) {
    return c.json({ detail: 'Unknown calendar kind' }, 400);
  }
  const events = await fetchUserEvents(c.env, user.id, lc(user.role), fromDt.toISOString(), toDt.toISOString(), kinds);
  const body = eventsToIcs(events, `Axal StudioOS — ${user.name}`);
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar',
      'content-disposition': 'attachment; filename="axal-studioos.ics"',
    },
  });
}));

// ===========================================================================
// D1033 (#2874) item 2 — "Subscribe to my events" (migration 603)
// ===========================================================================
// The my-events `.ics` (tickets and hosted events alone) at a URL a calendar
// client can fetch with no session. The member makes the URL here, signed in;
// it is shown once, and making a new one or removing it stops the old one.
// The token rides in the query, never the path: see `feedTokens.ts`.
const FEED_PATH = '/api/calendar/feed/my-events.ics';
// D1209 (#3175): the whole calendar, Mine only, at its own token (migration 610).
const CALENDAR_FEED_PATH = '/api/calendar/feed/calendar.ics';

function feedUrls(c: any, token: string, path = FEED_PATH): { url: string; webcal_url: string } {
  const origin = new URL(c.req.url).origin;
  const url = `${origin}${path}?token=${encodeURIComponent(token)}`;
  return { url, webcal_url: url.replace(/^https?:/, 'webcal:') };
}

calendar.get('/my-events/feed', safe('feed_status', 'Could not read your calendar subscription', async (c) => {
  const user = await requireAuth(c);
  return c.json(await feedStatus(c.env, user.id));
}));

calendar.post('/my-events/feed', safe('feed_mint', 'Could not make your calendar subscription', async (c) => {
  const user = await requireAuth(c);
  const minted = await mintFeedToken(c.env, user.id);
  return c.json({
    ...feedUrls(c, minted.token),
    created_at: minted.created_at,
    replaced: minted.replaced,
    note: 'This address is shown once. Anyone who has it can read your events, with the join links for seats you hold. Make a new one to stop the old one.',
  }, 201);
}));

calendar.delete('/my-events/feed', safe('feed_revoke', 'Could not remove your calendar subscription', async (c) => {
  const user = await requireAuth(c);
  return c.json({ revoked: await revokeFeedToken(c.env, user.id) });
}));

// NO SESSION: the token is the credential. Calendar reads and both
// subscriptions are available on every plan; only IC creation is Professional
// (D1206). A token answers only its own feed (D1209).
async function serveFeed(c: any, scope: FeedScope): Promise<Response> {
  const user = await resolveFeedToken(c.env, new URL(c.req.url).searchParams.get('token'), new Date(), scope);
  if (!user) return c.json({ detail: 'Calendar feed not found' }, 404);
  const whole = scope === CALENDAR_FEED_SCOPE;
  const fromDt = new Date(Date.now() - (whole ? 30 : 7) * 86_400_000);
  const toDt = new Date(Date.now() + 180 * 86_400_000);
  // MINE ONLY. Every reader is keyed on the member's own id and none widens
  // for a role (`gather` ignores it), so an admin's feed holds what the admin
  // is party to, never a studio's or every studio's calendar. Every kind the
  // calendar reads, by name, so a kind added later joins the feed on purpose.
  const kinds = whole ? [...KNOWN_KINDS] : [...MY_EVENT_KINDS];
  const events = await fetchUserEvents(c.env, user.id, lc(user.role), fromDt.toISOString(), toDt.toISOString(), kinds);
  const body = eventsToIcs(events, whole ? `Axal StudioOS — ${user.name}` : `Axal StudioOS — my events — ${user.name}`);
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `inline; filename="${whole ? 'axal-calendar.ics' : 'axal-my-events.ics'}"`,
      // The body carries join links: never kept by a shared cache.
      'cache-control': 'private, no-store',
    },
  });
}

calendar.get('/feed/my-events.ics', safe('feed_ics', 'Could not export calendar', (c) => serveFeed(c, FEED_SCOPE)));

// ===========================================================================
// D1209 (#3175) — "Subscribe to my whole calendar" (migration 610)
// ===========================================================================
// The same three verbs as the my-events address, on a token of its own.
// POST makes the address, or replaces it (`replaced: true`): the old URL stops
// at once. DELETE removes it.
calendar.get('/subscription', safe('cal_feed_status', 'Could not read your calendar subscription', async (c) => {
  const user = await requireAuth(c);
  return c.json(await feedStatus(c.env, user.id, CALENDAR_FEED_SCOPE));
}));

calendar.post('/subscription', safe('cal_feed_mint', 'Could not make your calendar subscription', async (c) => {
  const user = await requireAuth(c);
  const minted = await mintFeedToken(c.env, user.id, new Date(), CALENDAR_FEED_SCOPE);
  return c.json({
    ...feedUrls(c, minted.token, CALENDAR_FEED_PATH),
    created_at: minted.created_at,
    replaced: minted.replaced,
    note: 'This address is shown once. Anyone who has it can read your calendar, with the join links of your sessions and events. Make a new one to stop the old one.',
  }, 201);
}));

calendar.delete('/subscription', safe('cal_feed_revoke', 'Could not remove your calendar subscription', async (c) => {
  const user = await requireAuth(c);
  return c.json({ revoked: await revokeFeedToken(c.env, user.id, CALENDAR_FEED_SCOPE) });
}));

calendar.get('/feed/calendar.ics', safe('cal_feed_ics', 'Could not export calendar', (c) => serveFeed(c, CALENDAR_FEED_SCOPE)));

// ===========================================================================
// IC meetings
// ===========================================================================
function canScheduleIc(role: string): boolean {
  const r = role.toLowerCase();
  return r === 'admin' || r === 'investor';
}

async function serializeIc(env: Env, m: any): Promise<any> {
  const sql = getSQL(env);
  const att = await sql`
    SELECT a.user_id, a.rsvp, u.email, u.name
    FROM ic_meeting_attendees a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE a.meeting_id = ${m.id}
  ` as any[];
  return {
    id: m.id, uid: m.uid, title: m.title, agenda: m.agenda,
    start_at: m.start_at, duration_min: m.duration_min,
    deal_id: m.deal_id, organizer_user_id: m.organizer_user_id,
    location_kind: m.location_kind, location_uri: m.location_uri,
    status: m.status,
    attendees: att.map(a => ({ user_id: a.user_id, email: a.email, name: a.name, rsvp: a.rsvp })),
  };
}

// Calendar invitations need an actual venture tie, not staff's global read
// permission. Investor access follows the deal invitation/commitment stores;
// advisor access follows the founder's live, unexpired session grant.
async function isProjectParty(env: Env, user: User, project: { id: number; founder_id: number | null }, allowVentureLead = true): Promise<boolean> {
  if (user.role === 'founder' && user.founder_id && user.founder_id === project.founder_id) return true;
  const member = await getProjectMembershipRole(env, project.id, user.id);
  if (member && await canAccessProject(env, user, project)) return true;
  const sql = getSQL(env);
  if (allowVentureLead) {
    const lead = await sql`SELECT 1 FROM deals WHERE project_id = ${project.id} AND lead_partner_id = ${user.id} LIMIT 1`;
    if (lead.length) return true;
  }
  if (user.role === 'investor') {
    const invited = await sql`SELECT 1 FROM deal_invitations i JOIN deals d ON d.id = i.deal_id
      WHERE d.project_id = ${project.id} AND i.investor_user_id = ${user.id} AND i.status IN ('invited','interested') LIMIT 1`;
    if (invited.length) return true;
    const committed = await sql`SELECT 1 FROM commitments c JOIN deals d ON d.id = c.deal_id
      WHERE d.project_id = ${project.id} AND c.investor_user_id = ${user.id} AND c.status IN ('pending','confirmed') LIMIT 1`;
    return committed.length > 0;
  }
  if (String(user.role) === 'advisor') {
    const grants = await sql`SELECT 1 FROM advisor_client_grants
      WHERE project_id = ${project.id} AND advisor_user_id = ${user.id} AND status = 'active'
        AND scope_sessions = 1 AND (expires_at IS NULL OR datetime(expires_at) > datetime('now')) LIMIT 1`;
    return grants.length > 0;
  }
  return false;
}

// IC invitations are scoped to this exact deal, rather than any deal belonging
// to the same venture. Reading a deal as staff alone does not make an invitee
// a party to it; the authenticated organiser is explicitly opting in themselves.
async function isDealParty(env: Env, user: User, dealId: number): Promise<boolean> {
  const sql = getSQL(env);
  const deal = (await sql`SELECT p.id, p.founder_id, d.lead_partner_id FROM deals d JOIN projects p ON p.id = d.project_id
    WHERE d.id = ${dealId} AND p.deleted_at IS NULL` as any[])[0];
  if (!deal) return false;
  if (deal.lead_partner_id === user.id) return true;
  if (user.role === 'investor') {
    const invited = await sql`SELECT 1 FROM deal_invitations WHERE deal_id = ${dealId} AND investor_user_id = ${user.id} AND status IN ('invited','interested') LIMIT 1`;
    if (invited.length) return true;
    const committed = await sql`SELECT 1 FROM commitments WHERE deal_id = ${dealId} AND investor_user_id = ${user.id} AND status IN ('pending','confirmed') LIMIT 1`;
    return committed.length > 0;
  }
  return isProjectParty(env, user, deal, false);
}

/** A person's id from the uid the people picker gave, or null. */
async function userIdByUid(env: Env, ref: unknown): Promise<number | null> {
  if (typeof ref !== 'string') return null;
  const row = await env.DB.prepare('SELECT id FROM users WHERE uid = ? AND is_active = 1').bind(ref).first<{ id: number }>();
  return row ? Number(row.id) : null;
}

/**
 * The copy each attendee's Google or Outlook calendar holds of an IC meeting:
 * the organiser first, then everyone else invited. Create and Reschedule send
 * the same event, so a reschedule PATCHes the copies the create made.
 */
async function icSyncEvent(env: Env, meetingId: number): Promise<CalendarEvent | null> {
  const sql = getSQL(env);
  const m = (await sql`SELECT * FROM ic_meetings WHERE id = ${meetingId}` as any[])[0];
  if (!m) return null;
  const att = await sql`
    SELECT u.email, u.name FROM ic_meeting_attendees a
    LEFT JOIN users u ON u.id = a.user_id WHERE a.meeting_id = ${meetingId}
  ` as any[];
  const me = (await sql`SELECT email, name FROM users WHERE id = ${m.organizer_user_id}` as any[])[0];
  return {
    id: `ic_meeting:${meetingId}`, kind: 'ic_meeting', source_id: meetingId,
    source_uid: m.uid, title: m.title, start_at: m.start_at,
    end_at: new Date(new Date(m.start_at).getTime() + Number(m.duration_min) * 60_000).toISOString(),
    status: 'confirmed', location_kind: m.location_kind, location_uri: m.location_uri,
    organizer_email: me?.email || null, notes: m.agenda || null,
    attendees: [
      { email: me?.email || null, name: me?.name || null, role: 'organizer' },
      ...att.filter((a: any) => a.email && a.email !== me?.email)
            .map((a: any) => ({ email: a.email, name: a.name, role: 'invitee' })),
    ],
  };
}

/**
 * D1207 — a Reschedule's new start and length (CAL19). The start must be
 * ahead, as at create; a length outside the kind's range is held to it, as
 * create holds it; no length keeps the current one.
 */
function rescheduleOf(body: any, current: number, min: number, max: number):
  { ok: true; start: string; duration: number } | { ok: false; detail: string } {
  if (!body?.start_at) return { ok: false, detail: 'start_at required' };
  const start = new Date(body.start_at);
  if (Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) return { ok: false, detail: 'start_at must be in the future' };
  const asked = body.duration_min == null ? current : parseInt(body.duration_min, 10);
  const duration = Math.min(max, Math.max(min, Number.isFinite(asked) ? asked : current));
  return { ok: true, start: start.toISOString(), duration };
}

calendar.post('/ic-meetings', safe('ic_create', 'Could not create IC meeting', async (c) => {
  const user = await requireAuth(c);
  if (!userMeetsInvestorTier(user, 'professional')) return c.json(investorUpsell('professional'), 402);
  if (!canScheduleIc(lc(user.role))) return c.json({ detail: 'Investor or admin role required' }, 403);
  const body = await c.req.json().catch(() => ({}));
  const title = String(body?.title || '').trim().slice(0, 240);
  if (title.length < 2) return c.json({ detail: 'title required (min 2 chars)' }, 400);
  if (!body?.start_at) return c.json({ detail: 'start_at required' }, 400);
  const startAt = new Date(body.start_at);
  if (Number.isNaN(startAt.getTime()) || startAt.getTime() <= Date.now()) {
    return c.json({ detail: 'start_at must be in the future' }, 400);
  }
  const duration = Math.min(600, Math.max(10, parseInt(body.duration_min, 10) || 60));
  const sql = getSQL(c.env);
  const dealId = Number(body.deal_id);
  if (!Number.isSafeInteger(dealId) || dealId <= 0) return c.json({ detail: 'deal_id required' }, 400);
  if (!(await userMayReadDeal(c.env, user, dealId))) return c.json({ detail: 'Not allowed to schedule for this deal' }, 403);
  if (user.role === 'investor' && !(await isDealParty(c.env, user, dealId))) return c.json({ detail: 'Current deal relationship required' }, 403);
  if (body.attendee_user_ids != null && !Array.isArray(body.attendee_user_ids)) return c.json({ detail: 'Invalid attendees' }, 400);
  if (body.attendee_uids != null && !Array.isArray(body.attendee_uids)) return c.json({ detail: 'Invalid attendees' }, 400);
  const attendeeIds = new Set<number>((body.attendee_user_ids || []).map(Number));
  // D1207: the people picker gives each person's uid, so the page never asks for a number.
  for (const ref of body.attendee_uids || []) {
    const id = await userIdByUid(c.env, ref);
    if (id === null) return c.json({ detail: 'Invalid attendee' }, 400);
    attendeeIds.add(id);
  }
  for (const attendeeId of attendeeIds) {
    if (!Number.isSafeInteger(attendeeId) || attendeeId <= 0) return c.json({ detail: 'Invalid attendee' }, 400);
    if (attendeeId === user.id) continue;
    const attendee = (await sql`SELECT * FROM users WHERE id = ${attendeeId} AND is_active = 1` as User[])[0];
    if (!attendee || !(await isDealParty(c.env, attendee, dealId))) return c.json({ detail: 'Attendee is not on this deal' }, 403);
  }
  attendeeIds.add(user.id);
  const uid = crypto.randomUUID();
  const r = await sql`
    INSERT INTO ic_meetings
      (uid, title, agenda, start_at, duration_min, deal_id, organizer_user_id,
       location_kind, location_uri)
    VALUES
      (${uid}, ${title}, ${body.agenda || null}, ${startAt.toISOString()}, ${duration},
       ${dealId}, ${user.id},
       ${body.location_kind || 'video'}, ${body.location_uri || null})
    RETURNING *
  ` as any[];
  const meeting = r[0];
  await logAdminAction(c.env, user.id, user.email, 'calendar_ic_created', { meeting_id: meeting.id, deal_id: dealId, attendees: attendeeIds.size });
  for (const uid2 of attendeeIds) {
    const u = (await sql`SELECT 1 FROM users WHERE id = ${uid2}` as any[])[0];
    if (!u) continue;
    const rsvp = uid2 === user.id ? 'accepted' : 'invited';
    try {
      await sql`
        INSERT INTO ic_meeting_attendees (meeting_id, user_id, rsvp)
        VALUES (${meeting.id}, ${uid2}, ${rsvp})
      `;
    } catch { /* UNIQUE collision — ignore */ }
  }
  // Task #52 — push to attendees' external calendars. All prep
  // (attendee lookup + event assembly + dynamic import) happens inside
  // the waitUntil closure so the IC-create response returns immediately.
  const meetingId = meeting.id;
  const icSyncP = (async () => {
    try {
      const { onAxalSessionCreated } = await import('../services/calendar/sync');
      const ev = await icSyncEvent(c.env, meetingId);
      if (ev) await onAxalSessionCreated(c.env, ev);
    } catch (e) { console.warn('[calendar] IC sync hook failed', e); }
  })();
  if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(icSyncP);
  return c.json(await serializeIc(c.env, meeting));
}));

calendar.get('/ic-meetings', safe('ic_list', 'Could not list IC meetings', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM ic_meetings ORDER BY start_at DESC` as any[];
  const out: any[] = [];
  for (const m of rows) {
    const att = await sql`SELECT user_id FROM ic_meeting_attendees WHERE meeting_id = ${m.id}` as any[];
    const invited = new Set(att.map(a => a.user_id));
    if (!(isAdmin(lc(user.role)) || m.organizer_user_id === user.id || invited.has(user.id))) continue;
    out.push(await serializeIc(c.env, m));
  }
  return c.json({ items: out });
}));

calendar.post('/ic-meetings/:id/rsvp', safe('ic_rsvp', 'Could not record RSVP', async (c) => {
  const user = await requireAuth(c);
  const meetingId = parseInt(c.req.param('id'), 10);
  const url = new URL(c.req.url);
  const rsvp = url.searchParams.get('rsvp') || '';
  if (!['accepted', 'declined', 'tentative'].includes(rsvp)) {
    return c.json({ detail: 'Invalid rsvp value' }, 400);
  }
  const sql = getSQL(c.env);
  const row = (await sql`
    SELECT id FROM ic_meeting_attendees WHERE meeting_id = ${meetingId} AND user_id = ${user.id}
  ` as any[])[0];
  if (!row) return c.json({ detail: 'You are not invited to this meeting' }, 404);
  await sql`UPDATE ic_meeting_attendees SET rsvp = ${rsvp} WHERE id = ${row.id}`;
  return c.json({ ok: true, rsvp });
}));

calendar.delete('/ic-meetings/:id', safe('ic_cancel', 'Could not cancel IC meeting', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'), 10);
  const url = new URL(c.req.url);
  const reason = (url.searchParams.get('reason') || '').trim().slice(0, 240) || null;
  const sql = getSQL(c.env);
  const m = (await sql`SELECT id, organizer_user_id FROM ic_meetings WHERE id = ${id}` as any[])[0];
  if (!m) return c.json({ detail: 'IC meeting not found' }, 404);
  if (!(isAdmin(lc(user.role)) || m.organizer_user_id === user.id)) {
    return c.json({ detail: 'Only the organiser or an admin can cancel' }, 403);
  }
  const nowIso = new Date().toISOString();
  await sql`
    UPDATE ic_meetings
       SET status = 'cancelled', cancelled_at = ${nowIso},
           cancel_reason = ${reason}, updated_at = ${nowIso}
     WHERE id = ${id}
  `;
  // Task #52 — remove from attendees' external calendars (deferred).
  const icCancelP = (async () => {
    try {
      const { onAxalSessionCancelled } = await import('../services/calendar/sync');
      await onAxalSessionCancelled(c.env, 'ic_meeting', id);
    } catch (e) { console.warn('[calendar] IC cancel sync hook failed', e); }
  })();
  if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(icCancelP);
  return c.json({ ok: true });
}));

// D1207 — Reschedule (CAL19): "Everyone invited is told, and their calendar
// copies move." The organiser's or an admin's, as Cancel is.
calendar.patch('/ic-meetings/:id', safe('ic_reschedule', 'Could not reschedule IC meeting', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json().catch(() => ({}));
  const sql = getSQL(c.env);
  const m = (await sql`SELECT id, organizer_user_id, status, duration_min FROM ic_meetings WHERE id = ${id}` as any[])[0];
  if (!m) return c.json({ detail: 'IC meeting not found' }, 404);
  if (!(isAdmin(lc(user.role)) || m.organizer_user_id === user.id)) {
    return c.json({ detail: 'Only the organiser or an admin can reschedule' }, 403);
  }
  if (m.status === 'cancelled') return c.json({ error: 'cancelled', detail: 'A cancelled meeting cannot be moved.' }, 409);
  const next = rescheduleOf(body, Number(m.duration_min), 10, 600);
  if (!next.ok) return c.json({ detail: next.detail }, 400);
  const nowIso = new Date().toISOString();
  await sql`
    UPDATE ic_meetings SET start_at = ${next.start}, duration_min = ${next.duration}, updated_at = ${nowIso}
     WHERE id = ${id} AND status != 'cancelled'
  `;
  await logAdminAction(c.env, user.id, user.email, 'calendar_ic_rescheduled', { meeting_id: id, duration_min: next.duration });
  // Moves each attendee's Google or Outlook copy (deferred, best-effort).
  const icMoveP = (async () => {
    try {
      const { onAxalSessionUpdated } = await import('../services/calendar/sync');
      const ev = await icSyncEvent(c.env, id);
      if (ev) await onAxalSessionUpdated(c.env, ev);
    } catch (e) { console.warn('[calendar] IC reschedule sync hook failed', e); }
  })();
  if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(icMoveP);
  const row = (await sql`SELECT * FROM ic_meetings WHERE id = ${id}` as any[])[0];
  return c.json(await serializeIc(c.env, row));
}));

// ===========================================================================
// Founder check-ins
// ===========================================================================
async function serializeCheckin(env: Env, c: any): Promise<any> {
  const sql = getSQL(env);
  const f = (await sql`SELECT email, name FROM users WHERE id = ${c.founder_user_id}` as any[])[0];
  const co = c.counterpart_user_id
    ? (await sql`SELECT email, name FROM users WHERE id = ${c.counterpart_user_id}` as any[])[0]
    : null;
  return {
    id: c.id, uid: c.uid, title: c.title, notes: c.notes,
    start_at: c.start_at, duration_min: c.duration_min,
    location_kind: c.location_kind, location_uri: c.location_uri,
    status: c.status,
    founder: { user_id: c.founder_user_id, email: f?.email || null, name: f?.name || null },
    counterpart: co ? { user_id: c.counterpart_user_id, email: co.email, name: co.name } : null,
    project_id: c.project_id,
  };
}

/** A check-in's calendar copy: the founder and the counterpart. Create and Reschedule send the same. */
async function checkinSyncEvent(env: Env, checkinId: number): Promise<CalendarEvent | null> {
  const sql = getSQL(env);
  const ck = (await sql`SELECT * FROM founder_checkins WHERE id = ${checkinId}` as any[])[0];
  if (!ck) return null;
  const f = (await sql`SELECT email, name FROM users WHERE id = ${ck.founder_user_id}` as any[])[0];
  const co = ck.counterpart_user_id ? (await sql`SELECT email, name FROM users WHERE id = ${ck.counterpart_user_id}` as any[])[0] : null;
  return {
    id: `founder_checkin:${checkinId}`, kind: 'founder_checkin', source_id: checkinId,
    source_uid: ck.uid, title: ck.title, start_at: ck.start_at,
    end_at: new Date(new Date(ck.start_at).getTime() + Number(ck.duration_min) * 60_000).toISOString(),
    status: 'confirmed', location_kind: ck.location_kind, location_uri: ck.location_uri,
    organizer_email: co?.email || f?.email || null, notes: ck.notes || null,
    attendees: [
      { email: f?.email || null, name: f?.name || null, role: 'founder' },
      ...(co ? [{ email: co.email, name: co.name, role: 'counterpart' }] : []),
    ],
  };
}

calendar.post('/founder-checkins', safe('ck_create', 'Could not create check-in', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  if (!body?.start_at) return c.json({ detail: 'start_at required' }, 400);
  const startAt = new Date(body.start_at);
  if (Number.isNaN(startAt.getTime()) || startAt.getTime() <= Date.now()) {
    return c.json({ detail: 'start_at must be in the future' }, 400);
  }
  // D1207: the people picker gives a uid; a number is still taken as before.
  if (body.founder_uid != null) {
    const id = await userIdByUid(c.env, body.founder_uid);
    if (id === null) return c.json({ detail: 'founder user not found' }, 404);
    body.founder_user_id = id;
  }
  if (body.counterpart_uid != null) {
    const id = await userIdByUid(c.env, body.counterpart_uid);
    if (id === null) return c.json({ detail: 'Invalid counterpart' }, 400);
    body.counterpart_user_id = id;
  }
  const founderId = parseInt(body.founder_user_id, 10);
  if (!Number.isFinite(founderId)) return c.json({ detail: 'founder_user_id required' }, 400);
  const title = String(body?.title || '').trim().slice(0, 240);
  if (title.length < 2) return c.json({ detail: 'title required (min 2 chars)' }, 400);

  const sql = getSQL(c.env);
  const founder = (await sql`SELECT * FROM users WHERE id = ${founderId} AND is_active = 1` as any[])[0];
  if (!founder) return c.json({ detail: 'founder user not found' }, 404);

  if (founder.role !== 'founder') return c.json({ detail: 'Target must be a founder' }, 403);
  const projectId = body.project_id == null ? null : Number(body.project_id);
  if (projectId !== null && (!Number.isSafeInteger(projectId) || projectId <= 0)) return c.json({ detail: 'Invalid project_id' }, 400);
  const projects = projectId === null
    ? await sql`SELECT id, founder_id FROM projects WHERE founder_id = ${founder.founder_id} AND deleted_at IS NULL` as any[]
    : await sql`SELECT id, founder_id FROM projects WHERE id = ${projectId} AND founder_id = ${founder.founder_id} AND deleted_at IS NULL` as any[];
  if (projectId !== null && !projects.length) return c.json({ detail: 'Project does not belong to this founder' }, 403);
  const isSelf = user.id === founderId;
  const related = async (person: User) => {
    for (const project of projects) if (await isProjectParty(c.env, person, project)) return true;
    return false;
  };
  if (!isSelf && !(await related(user))) return c.json({ detail: 'Not allowed to schedule this check-in' }, 403);
  const counterId = body.counterpart_user_id == null ? (isSelf ? null : user.id) : Number(body.counterpart_user_id);
  if (counterId !== null) {
    if (!Number.isSafeInteger(counterId) || counterId <= 0) return c.json({ detail: 'Invalid counterpart' }, 400);
    if (counterId !== founderId && counterId !== user.id) {
      const counterpart = (await sql`SELECT * FROM users WHERE id = ${counterId} AND is_active = 1` as User[])[0];
      if (!counterpart || !(await related(counterpart))) return c.json({ detail: 'Counterpart is not related to this venture' }, 403);
    }
  }
  const duration = Math.min(240, Math.max(10, parseInt(body.duration_min, 10) || 30));
  const uid = crypto.randomUUID();
  const r = await sql`
    INSERT INTO founder_checkins
      (uid, founder_user_id, counterpart_user_id, project_id, title, notes,
       start_at, duration_min, location_kind, location_uri)
    VALUES
      (${uid}, ${founderId}, ${counterId}, ${projectId},
       ${title}, ${body.notes || null}, ${startAt.toISOString()}, ${duration},
       ${body.location_kind || 'video'}, ${body.location_uri || null})
    RETURNING *
  ` as any[];
  const checkin = r[0];
  await logAdminAction(c.env, user.id, user.email, 'calendar_checkin_created', { checkin_id: checkin.id, target_user_id: founderId, project_id: projectId });
  // Task #52 — push founder check-in to attendees' external calendars
  // (deferred via waitUntil so the response returns immediately).
  const ckId = checkin.id;
  const ckSyncP = (async () => {
    try {
      const ev = await checkinSyncEvent(c.env, ckId);
      const { onAxalSessionCreated } = await import('../services/calendar/sync');
      if (ev) await onAxalSessionCreated(c.env, ev);
    } catch (e) { console.warn('[calendar] checkin sync hook failed', e); }
  })();
  if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(ckSyncP);
  return c.json(await serializeCheckin(c.env, checkin));
}));

calendar.get('/founder-checkins', safe('ck_list', 'Could not list check-ins', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const rows = isAdmin(lc(user.role))
    ? await sql`SELECT * FROM founder_checkins ORDER BY start_at DESC` as any[]
    : await sql`
        SELECT * FROM founder_checkins
        WHERE founder_user_id = ${user.id} OR counterpart_user_id = ${user.id}
        ORDER BY start_at DESC
      ` as any[];
  const out = [];
  for (const r of rows) out.push(await serializeCheckin(c.env, r));
  return c.json({ items: out });
}));

calendar.delete('/founder-checkins/:id', safe('ck_cancel', 'Could not cancel check-in', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'), 10);
  const sql = getSQL(c.env);
  const row = (await sql`
    SELECT founder_user_id, counterpart_user_id FROM founder_checkins WHERE id = ${id}
  ` as any[])[0];
  if (!row) return c.json({ detail: 'Check-in not found' }, 404);
  if (!(isAdmin(lc(user.role)) || row.founder_user_id === user.id || row.counterpart_user_id === user.id)) {
    return c.json({ detail: 'Only attendees or admin can cancel' }, 403);
  }
  const nowIso = new Date().toISOString();
  await sql`
    UPDATE founder_checkins SET status = 'cancelled', cancelled_at = ${nowIso}, updated_at = ${nowIso}
    WHERE id = ${id}
  `;
  // Task #52 — remove from attendees' external calendars (deferred).
  const ckCancelP = (async () => {
    try {
      const { onAxalSessionCancelled } = await import('../services/calendar/sync');
      await onAxalSessionCancelled(c.env, 'founder_checkin', id);
    } catch (e) { console.warn('[calendar] checkin cancel sync hook failed', e); }
  })();
  if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(ckCancelP);
  return c.json({ ok: true });
}));

// D1207 — Reschedule a check-in. A check-in stores no booker, so either of
// its two people may move it, or an admin: its Cancel's rule.
calendar.patch('/founder-checkins/:id', safe('ck_reschedule', 'Could not reschedule check-in', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json().catch(() => ({}));
  const sql = getSQL(c.env);
  const row = (await sql`
    SELECT founder_user_id, counterpart_user_id, status, duration_min FROM founder_checkins WHERE id = ${id}
  ` as any[])[0];
  if (!row) return c.json({ detail: 'Check-in not found' }, 404);
  if (!(isAdmin(lc(user.role)) || row.founder_user_id === user.id || row.counterpart_user_id === user.id)) {
    return c.json({ detail: 'Only attendees or admin can reschedule' }, 403);
  }
  if (row.status === 'cancelled') return c.json({ error: 'cancelled', detail: 'A cancelled check-in cannot be moved.' }, 409);
  const next = rescheduleOf(body, Number(row.duration_min), 10, 240);
  if (!next.ok) return c.json({ detail: next.detail }, 400);
  const nowIso = new Date().toISOString();
  await sql`
    UPDATE founder_checkins SET start_at = ${next.start}, duration_min = ${next.duration}, updated_at = ${nowIso}
     WHERE id = ${id} AND status != 'cancelled'
  `;
  await logAdminAction(c.env, user.id, user.email, 'calendar_checkin_rescheduled', { checkin_id: id, duration_min: next.duration });
  const ckMoveP = (async () => {
    try {
      const { onAxalSessionUpdated } = await import('../services/calendar/sync');
      const ev = await checkinSyncEvent(c.env, id);
      if (ev) await onAxalSessionUpdated(c.env, ev);
    } catch (e) { console.warn('[calendar] checkin reschedule sync hook failed', e); }
  })();
  if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(ckMoveP);
  const ck = (await sql`SELECT * FROM founder_checkins WHERE id = ${id}` as any[])[0];
  return c.json(await serializeCheckin(c.env, ck));
}));

// ===========================================================================
// D1207 — the people and deal pickers (CAL7, CAL8). New IC meeting and New
// check-in search by name, so nobody types a user number or an email.
//
// ONLY PEOPLE YOU WORK WITH. A person is offered only when they share the
// deal (IC) or a venture (check-in) with the caller, by the same rule the
// create applies (`isDealParty`, `isProjectParty`). So the picker never offers
// someone a create would refuse, and never another studio's people. Each
// person carries their uid (the create takes it), their name, their profile
// and how the caller knows them; never an email and never a user number.
// ===========================================================================
const PROFILE_WORDS: Readonly<Record<string, string>> = {
  admin: 'Admin', founder: 'Founder', partner: 'Operating Partner',
  investor: 'Investor', advisor: 'Advisor', exploring: 'Member',
};
const PICK_MAX = 20;

type Venture = { id: number; name: string; founder_id: number | null };
type Picked = { how: string[]; ventures: Map<number, string> };

function note(into: Map<number, Picked>, userId: unknown, how: string, venture: Venture) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) return;
  const p: Picked = into.get(id) || { how: [], ventures: new Map() };
  if (!p.how.includes(how)) p.how.push(how);
  p.ventures.set(venture.id, venture.name);
  into.set(id, p);
}

/** Everyone on one venture, each with how they are on it. */
async function ventureCandidates(env: Env, v: Venture, into: Map<number, Picked>, withDealId?: number) {
  const sql = getSQL(env);
  const deals = withDealId
    ? await sql`SELECT id, lead_partner_id FROM deals WHERE id = ${withDealId}` as any[]
    : await sql`SELECT id, lead_partner_id FROM deals WHERE project_id = ${v.id}` as any[];
  for (const d of deals) {
    note(into, d.lead_partner_id, `Lead partner on ${v.name}`, v);
    for (const r of await sql`SELECT investor_user_id AS id FROM deal_invitations WHERE deal_id = ${d.id} AND status IN ('invited','interested')` as any[]) note(into, r.id, `Invited to ${v.name}`, v);
    for (const r of await sql`SELECT investor_user_id AS id FROM commitments WHERE deal_id = ${d.id} AND status IN ('pending','confirmed')` as any[]) note(into, r.id, `Committed to ${v.name}`, v);
  }
  if (v.founder_id) {
    for (const r of await sql`SELECT id FROM users WHERE founder_id = ${v.founder_id} AND role = 'founder'` as any[]) note(into, r.id, `Founder of ${v.name}`, v);
  }
  // A removed or pending member is dropped by the create's rule in `presentPicked`.
  for (const r of await sql`SELECT user_id AS id FROM project_members WHERE project_id = ${v.id}` as any[]) note(into, r.id, `On the ${v.name} team`, v);
  for (const r of await sql`SELECT advisor_user_id AS id FROM advisor_client_grants
      WHERE project_id = ${v.id} AND status = 'active' AND scope_sessions = 1
        AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))` as any[]) note(into, r.id, `Advisor to ${v.name}`, v);
}

/** The ventures a person is on, by any of the ties `isProjectParty` reads. */
async function venturesOf(env: Env, user: User): Promise<Venture[]> {
  const r = await env.DB.prepare(
    `SELECT DISTINCT p.id, p.name, p.founder_id FROM projects p
      WHERE p.deleted_at IS NULL AND (
        (? IS NOT NULL AND p.founder_id = ?)
        OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ? AND status = 'accepted' AND removed_at IS NULL)
        OR p.id IN (SELECT project_id FROM advisor_client_grants WHERE advisor_user_id = ? AND status = 'active')
        OR p.id IN (SELECT project_id FROM deals WHERE lead_partner_id = ?)
        OR p.id IN (SELECT d.project_id FROM deal_invitations i JOIN deals d ON d.id = i.deal_id WHERE i.investor_user_id = ?)
        OR p.id IN (SELECT d.project_id FROM commitments k JOIN deals d ON d.id = k.deal_id WHERE k.investor_user_id = ?)
      ) ORDER BY p.name, p.id`,
  ).bind(user.founder_id ?? null, user.founder_id ?? null, user.id, user.id, user.id, user.id, user.id).all<Venture>();
  const out: Venture[] = [];
  for (const v of r.results || []) if (await isProjectParty(env, user, v)) out.push(v);
  return out;
}

async function presentPicked(env: Env, picked: Map<number, Picked>, keep: (u: User) => Promise<boolean>, q: string) {
  const items: any[] = [];
  for (const [id, p] of picked) {
    const u = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').bind(id).first<User & { uid: string; display_name?: string | null; headline?: string | null }>();
    if (!u || !(await keep(u))) continue;
    const name = String(u.display_name || u.name || '').trim();
    if (!name || (q && !name.toLowerCase().includes(q))) continue;
    items.push({
      uid: u.uid, name, profile: PROFILE_WORDS[String(u.role)] || 'Member', headline: u.headline || null,
      how: p.how, ventures: [...p.ventures].map(([vid, vname]) => ({ id: vid, name: vname })),
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items.slice(0, PICK_MAX);
}

calendar.get('/people', safe('people_pick', 'Could not search people', async (c) => {
  const user = await requireAuth(c);
  const url = new URL(c.req.url);
  const purpose = url.searchParams.get('for') || '';
  const q = (url.searchParams.get('q') || '').trim().slice(0, 80).toLowerCase();
  const sql = getSQL(c.env);
  const picked = new Map<number, Picked>();
  if (purpose === 'ic') {
    if (!canScheduleIc(lc(user.role))) return c.json({ detail: 'Investor or admin role required' }, 403);
    const dealId = Number(url.searchParams.get('deal_id'));
    if (!Number.isSafeInteger(dealId) || dealId <= 0) {
      return c.json({ error: 'deal_required', detail: 'Choose the deal first: the people come from it.' }, 400);
    }
    if (!(await userMayReadDeal(c.env, user, dealId))) return c.json({ detail: 'Not allowed to schedule for this deal' }, 403);
    if (user.role === 'investor' && !(await isDealParty(c.env, user, dealId))) return c.json({ detail: 'Current deal relationship required' }, 403);
    const v = (await sql`SELECT p.id, p.name, p.founder_id FROM deals d JOIN projects p ON p.id = d.project_id
      WHERE d.id = ${dealId} AND p.deleted_at IS NULL` as Venture[])[0];
    if (v) await ventureCandidates(c.env, v, picked, dealId);
    picked.delete(user.id);
    // The create's own rule for each attendee.
    return c.json({ for: 'ic', items: await presentPicked(c.env, picked, (u) => isDealParty(c.env, u, dealId), q) });
  }
  if (purpose === 'checkin') {
    const ventures = await venturesOf(c.env, user);
    const mine = ventures.filter((v) => user.role === 'founder' && user.founder_id && v.founder_id === user.founder_id);
    if (mine.length) {
      // A founder books with anyone on their ventures, as the counterpart.
      for (const v of mine) await ventureCandidates(c.env, v, picked);
      picked.delete(user.id);
      return c.json({ for: 'checkin', items: await presentPicked(c.env, picked, async (u) => {
        for (const v of mine) if (await isProjectParty(c.env, u, v)) return true;
        return false;
      }, q) });
    }
    // Anyone else books with the founders of the ventures they are on.
    for (const v of ventures) {
      if (!v.founder_id) continue;
      for (const r of await sql`SELECT id FROM users WHERE founder_id = ${v.founder_id}` as any[]) note(picked, r.id, `Founder of ${v.name}`, v);
    }
    picked.delete(user.id);
    // The create books only a founder (`Target must be a founder`).
    return c.json({ for: 'checkin', items: await presentPicked(c.env, picked, async (u) => u.role === 'founder', q) });
  }
  return c.json({ error: 'for_required', detail: "Say who the search is for: 'ic' or 'checkin'." }, 400);
}));

/** D1207 — the deals the caller can open, by venture name, for New IC meeting's Deal field. */
calendar.get('/deals', safe('deal_pick', 'Could not search deals', async (c) => {
  const user = await requireAuth(c);
  const q = (new URL(c.req.url).searchParams.get('q') || '').trim().slice(0, 80).toLowerCase();
  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.status, p.name FROM deals d JOIN projects p ON p.id = d.project_id
      WHERE p.deleted_at IS NULL AND (? = '' OR instr(lower(p.name), ?) > 0)
      ORDER BY p.name, d.id LIMIT 200`,
  ).bind(q, q).all() as { results?: { id: number; status: string; name: string }[] };
  const items: any[] = [];
  for (const d of rows.results || []) {
    if (items.length >= PICK_MAX) break;
    if (!(await userMayReadDeal(c.env, user, d.id))) continue;
    // An investor schedules only on a deal they are still on (the create's rule).
    if (user.role === 'investor' && !(await isDealParty(c.env, user, d.id))) continue;
    items.push({ id: d.id, name: d.name, status: d.status });
  }
  return c.json({ items });
}));

// ===========================================================================
// Task #52 — "Add to my external calendar" for events that pre-date the
// user's OAuth connection. POST /api/calendar/push/:kind/:source_id pushes
// one specific Axal session to whichever providers the caller has connected.
// ===========================================================================
// An item's `can.copy` reads the same six (COPYABLE_KINDS in
// services/calendar/items.ts); calendar_items_d1207 holds the two lists equal.
const PUSHABLE_KINDS = new Set([
  'advisor_booking', 'ic_meeting', 'founder_checkin', 'partner_office_hour',
  'event_ticket', 'event_hosted',
]);
calendar.post('/push/:kind/:source_id', safe('push_one', 'Could not push event', async (c) => {
  const user = await requireAuth(c);
  const kind = String(c.req.param('kind') || '');
  const sourceId = parseInt(c.req.param('source_id'), 10);
  if (!PUSHABLE_KINDS.has(kind)) return c.json({ detail: 'Unsupported kind' }, 400);
  if (!Number.isFinite(sourceId)) return c.json({ detail: 'invalid source_id' }, 400);
  const { fetchUserEvents } = await import('../services/calendar');
  // Window broad enough to find historic + future bookings.
  const from = new Date(Date.now() - 365 * 86400_000).toISOString();
  const to = new Date(Date.now() + 365 * 86400_000).toISOString();
  const events = await fetchUserEvents(c.env, user.id, user.role, from, to, [kind]);
  const ev = events.find(e => e.source_id === sourceId);
  if (!ev) return c.json({ detail: 'Event not found or not accessible' }, 404);
  const { pushOneEventForUser } = await import('../services/calendar/sync');
  const result = await pushOneEventForUser(c.env, user.id, ev);
  return c.json({ ok: true, pushed: result });
}));

// ===========================================================================
// D1033 — "Add to Google Calendar" and "Outlook" for one event.
//
// GET /api/calendar/event-links/:event_id. Built here, not on the page, so the
// page never assembles a join link it was not given: the URLs carry the title,
// the times, the place and the event page, and the join link only under the
// same rule as `canReadJoinLink` in `routes/events.ts` (#2623). Anyone who may
// see the event may have the links (`canViewEvent`'s rule, as `eventVisibleTo`),
// exactly as with its .ics.
// ===========================================================================
calendar.get('/event-links/:event_id', safe('event_links', 'Could not build calendar links', async (c) => {
  const user = await requireAuth(c);
  const eventId = Number(c.req.param('event_id'));
  if (!Number.isInteger(eventId) || eventId <= 0) return c.json({ detail: 'Event not found' }, 404);
  const env = c.env as Env;
  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(eventId).first<Record<string, any>>();
  if (!event) return c.json({ detail: 'Event not found' }, 404);
  if (!(await eventVisibleTo(env, event, user))) return c.json({ detail: 'You cannot see this event' }, 403);
  const registration = await env.DB.prepare(
    'SELECT status, payment_status FROM event_registrations WHERE event_id = ? AND user_id = ?',
  ).bind(eventId, user.id).first<{ status: string; payment_status: string }>();
  const links = addToCalendarLinks(env, event, joinLinkAllowed(event, user, registration));
  return c.json({ event_id: eventId, ics: `/api/events/${eventId}/ics`, ...links });
}));

// ===========================================================================
// Provider OAuth — generic helpers shared by Google + Microsoft routes.
// ===========================================================================
// Task #70 — the Integrations page can hand the OAuth round-trip off to
// the Calendar router (Google is the SINGLE-source-of-truth tokens store
// for the worker, so we don't duplicate it). The Connect button there
// sets `?return_to=integrations` on /google/start which writes a short-
// lived cookie; the callback reads + deletes the cookie and routes the
// user back to /integrations instead of /calendar. Same `?google=…`
// flash contract on the destination either way.
const CALENDAR_RETURN_COOKIE_RE = /(?:^|;\s*)studioos_cal_return=([^;]+)/;
function readReturnTo(c: any): string {
  const m = (c.req.header('cookie') || '').match(CALENDAR_RETURN_COOKIE_RE);
  return m ? decodeURIComponent(m[1]).slice(0, 32) : '';
}
function clearReturnToHeader(): string {
  return 'studioos_cal_return=; HttpOnly; Secure; SameSite=Lax; Path=/api/calendar; Max-Age=0';
}
function ventureQuery(returnTo: string): string {
  const { kind, projectId } = parseReturn(returnTo);
  return kind === 'build' && projectId ? `&project_id=${projectId}` : '';
}
function destFor(env: Env, returnTo: string): string {
  const base = env.APP_URL || '';
  return parseReturn(returnTo).kind === 'build' ? `${base}/build/connect`
    : returnTo === 'integrations' ? `${base}/integrations`
    : returnTo === 'record' ? `${base}/validate/record` : `${base}/calendar`;
}
function failureRedirect(env: Env, provider: string, reason: string | undefined, returnTo: string): Response {
  const url = `${destFor(env, returnTo)}?${provider}=error${reason ? `&reason=${encodeURIComponent(reason)}` : ''}${ventureQuery(returnTo)}`;
  return new Response(null, { status: 302, headers: { Location: url, 'Set-Cookie': clearReturnToHeader() } });
}
function successRedirect(env: Env, provider: string, returnTo: string, extra?: Record<string, string>): Response {
  const params = new URLSearchParams({ [provider]: 'connected', ...(extra || {}) });
  const url = `${destFor(env, returnTo)}?${params.toString()}${ventureQuery(returnTo)}`;
  return new Response(null, { status: 302, headers: { Location: url, 'Set-Cookie': clearReturnToHeader() } });
}

/**
 * Task #69 — bucket a thrown error message from the OAuth callback into a
 * stable, URL-safe reason code so the user-facing toast surfaces something
 * actionable instead of a misleading bare `token_exchange`. Buckets:
 *   - `token_exchange:<status>:<code>` — real upstream Google/MS rejection
 *   - `oauth_unavailable` — server-side secret/redirect-uri config gap
 *   - `db_write` — SQLite/D1 error reaching the *_oauth_tokens table
 *   - `encrypt` — AES-GCM key derivation or encryption failure
 *   - `timeout` — fetch abort hit the 10s timeout in fetchWithTimeout
 *   - `unknown:<slug>` — everything else, slug = first ≤40 chars URL-safe
 */
function bucketCallbackFailure(msg: string): string {
  // Google throws `token_exchange_failed:<status>:<code>`, Microsoft throws
  // `token_exchange_failed:<status>` — accept both and normalise.
  const m = msg.match(/^token_exchange_failed:(\d+)(?::(.+))?$/);
  if (m) return `token_exchange:${m[1]}:${m[2] || 'unknown'}`;
  if (msg.includes('oauth_unavailable')) return 'oauth_unavailable';
  // Task #71 — cryptoBox.getSecret throws `cryptoBox:secret_missing ...` when
  // neither AXAL_ENCRYPTION_SECRET nor JWT_SECRET resolves to a usable value.
  // Bucket BEFORE the generic encrypt regex so the toast surfaces the more
  // actionable cause.
  if (msg.startsWith('cryptoBox:secret_missing')) return 'secret_missing';
  // Task #71 follow-up — cryptoBox now step-tags its WebCrypto throws:
  //   cryptoBox:encrypt:importkey:<slug>  ← PBKDF2 importKey threw
  //   cryptoBox:encrypt:derive:<slug>     ← PBKDF2 deriveKey threw
  //   cryptoBox:encrypt:aesgcm:<slug>     ← AES-GCM encrypt threw
  // Surface the step + slug verbatim so the toast tells us WHERE inside
  // WebCrypto the failure happened.
  const stepM = msg.match(/^cryptoBox:encrypt:(importkey|derive|aesgcm)(?::(.+))?$/);
  if (stepM) {
    const step = stepM[1];
    const slug = (stepM[2] || '').slice(0, 40).replace(/[^a-zA-Z0-9._:-]+/g, '_');
    return slug ? `encrypt:${step}:${slug}` : `encrypt:${step}`;
  }
  if (/sqlite|no such table|UNIQUE constraint|D1_|FOREIGN KEY/i.test(msg)) return 'db_write';
  if (/^(encrypt|crypto|AXAL_ENCRYPTION)/i.test(msg) || /AES-GCM|PBKDF2/i.test(msg)) return 'encrypt';
  if (/aborted|timeout|TimedOut/i.test(msg)) return 'timeout';
  const slug = msg.slice(0, 40).replace(/[^a-zA-Z0-9._:-]+/g, '_').replace(/^_+|_+$/g, '');
  return `unknown:${slug || 'no_message'}`;
}

// ---------------------------------------------------------------------------
// Task #69 — Lazy schema check for the calendar OAuth tables. `calendar.sql`
// is the canonical schema but is *not* a numbered migration, so on a fresh
// D1 it would be absent and the callback's INSERT would throw the
// misclassified `token_exchange` reason. This mirrors the documented
// `ensureAdvisorWeekColumn()` / `ensureMarketIntelSchema()` pattern in
// replit.md. Per-isolate cache keyed by env identity so the
// CREATE TABLE IF NOT EXISTS only runs on the first request of an isolate.
// ---------------------------------------------------------------------------
const calendarOAuthSchemaChecked = new WeakSet<object>();
async function ensureCalendarOAuthSchema(env: Env): Promise<void> {
  if (calendarOAuthSchemaChecked.has(env as unknown as object)) return;
  try {
    const sql = getSQL(env);
    // `last_sync_error` and `last_sync_error_at` are migration 610's (D1209),
    // declared here too so a fresh table matches the migrated one.
    await sql`
      CREATE TABLE IF NOT EXISTS google_oauth_tokens (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id),
        refresh_token   TEXT    NOT NULL,
        scope           TEXT    NOT NULL DEFAULT '',
        google_email    TEXT,
        google_sub      TEXT,
        last_synced_at  TEXT,
        last_sync_error TEXT,
        last_sync_error_at TEXT,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `;
    // Task #1 — atomic enforcement of one-Google-to-one-Axal at the DB
    // boundary. Partial unique index so legacy rows with NULL google_sub
    // (pre-Task #70) don't collide. Two concurrent callbacks for the
    // same google_sub on different user_ids can both pass the pre-check,
    // but only one INSERT/UPDATE can win the race — the other surfaces a
    // UNIQUE constraint error which the callback maps to
    // `google_already_linked_other_user`.
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_google_oauth_tokens_google_sub_unique
      ON google_oauth_tokens(google_sub)
      WHERE google_sub IS NOT NULL
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS microsoft_oauth_tokens (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id),
        refresh_token   TEXT    NOT NULL,
        scope           TEXT    NOT NULL DEFAULT '',
        microsoft_email TEXT,
        microsoft_sub   TEXT,
        last_synced_at  TEXT,
        last_sync_error TEXT,
        last_sync_error_at TEXT,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `;
    calendarOAuthSchemaChecked.add(env as unknown as object);
  } catch (e: any) {
    // Don't poison the cache on failure — let the next call retry.
    console.error('[CAL] ensureCalendarOAuthSchema:', e?.message || e);
  }
}

// ===========================================================================
// Google
// ===========================================================================
// D757 (#1926) — Meet transcript import is offered only once the owner has
// switched it on: "on" (trimmed, any case) is on, anything else is off.
export function meetTranscriptsEnabled(env: Env): boolean {
  return String(env.MEET_TRANSCRIPTS_ENABLED ?? '').trim().toLowerCase() === 'on';
}

/** 'granted' when the stored grant holds the Meet scope; else the flag decides. */
export function meetTranscriptsState(env: Env, scope: string | null | undefined): 'granted' | 'available' | 'not_set_up' {
  if (String(scope || '').split(/[\s,]+/).includes(GOOGLE_MEET_TRANSCRIPT_SCOPE)) return 'granted';
  return meetTranscriptsEnabled(env) ? 'available' : 'not_set_up';
}

/**
 * D1209 — the last sync's failure, on both status reads. `sync_error` is null
 * when the last sync completed (or nothing is connected); `sync_error_read` is
 * false when the state itself could not be read, so the page says
 * "Unreadable" rather than claiming a clean sync.
 */
async function syncErrorFields(env: Env, userId: number, provider: SyncProvider, connected: boolean) {
  if (!connected) return { sync_error: null, sync_error_read: true };
  const r = await readSyncError(env, userId, provider);
  return { sync_error: r.error, sync_error_read: r.read };
}

/** Write what a full sync left: a refused copy, a refused connection, or a clean run. */
async function settleSync(env: Env, userId: number, provider: SyncProvider,
  outcome: { failed: number } | { error: any }): Promise<void> {
  if ('error' in outcome) {
    if (outcome.error?.message === 'not_connected') return;
    await recordSyncError(env, userId, provider,
      outcome.error?.code === 'connection_refused' ? 'connection_refused' : 'sync_failed');
  } else if (outcome.failed > 0) {
    await recordSyncError(env, userId, provider, 'copy_refused');
  } else {
    await clearSyncError(env, userId, provider);
  }
}

/**
 * D1209 — the disconnect's one choice: "Remove the copies first"
 * (`remove_copies`, in the query or the JSON body). Without it the copies stay
 * on the provider and their mappings stay here.
 */
async function wantsCopiesRemoved(c: any): Promise<boolean> {
  const q = String(new URL(c.req.url).searchParams.get('remove_copies') || '').toLowerCase();
  if (q === '1' || q === 'true') return true;
  if (c.req.method !== 'POST') return false;
  const body: any = await c.req.json().catch(() => null);
  return body?.remove_copies === true;
}

/**
 * After the token row is gone: remember whose account the kept copies belong
 * to, or forget it when none is kept. A connection with no account id (rows
 * from before Task #70) keeps its copies with no marker, and the next connect
 * treats them as an unknown account's.
 */
async function settleRetained(env: Env, userId: number, provider: SyncProvider, accountId: string | null): Promise<void> {
  const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM calendar_sync_records WHERE user_id = ? AND provider = ?')
    .bind(userId, provider).first<{ n: number }>();
  try {
    if (Number(left?.n || 0) > 0 && accountId) await retainCopies(env, userId, provider, await accountMarker(env.JWT_SECRET, provider, accountId));
    else await forgetRetained(env, userId, provider);
  } catch (e) {
    // Before migration 610 there is no table to hold the marker: the copies
    // stay, and the next connect decides as it did before.
    if (!/no such table/i.test(String((e as Error)?.message || e))) throw e;
  }
}

const COPIES_NOT_REMOVED = {
  code: 'copies_not_removed',
  message: 'Some copies could not be removed from your calendar, so nothing was disconnected. Try again, or disconnect and keep them.',
};

calendar.get('/google/status', safe('g_status', 'Could not load Google status', async (c) => {
  const user = await requireAuth(c);
  await ensureCalendarOAuthSchema(c.env);
  const sql = getSQL(c.env);
  const row = (await sql`
    SELECT google_email, last_synced_at, scope FROM google_oauth_tokens WHERE user_id = ${user.id}
  ` as any[])[0];
  const configured = googleOAuthAvailable(c.env);
  return c.json({
    configured,
    available: configured, // back-compat alias
    connected: configured ? !!row : false,
    google_email: row?.google_email || null,
    last_synced_at: row?.last_synced_at || null,
    scope: row?.scope || null,
    meet_transcripts: meetTranscriptsState(c.env, row?.scope),
    ...await syncErrorFields(c.env, user.id, 'google', !!row),
  });
}));

/** Revoke Google's grant before dropping the only locally stored refresh token. */
export async function revokeAndDisconnectGoogle(
  env: Env, userId: number, fetcher: typeof fetch = fetch,
  options: { preserveCalendarSync?: boolean; preserveGoogleIdentity?: boolean } = {},
): Promise<void> {
  const token = await loadRefreshTokenExport(env, 'google_oauth_tokens', userId);
  if (token) {
    try {
      await revokeGoogleOAuthGrant(token.raw, fetcher);
    } catch (cause: any) {
      const error: any = new Error(`Google did not confirm grant revocation: ${String(cause?.message || cause)}`);
      error.code = 'google_revocation_failed';
      throw error;
    }
  }

  await clearWorkspaceConnection(env, userId);
  await clearGoogleLocalConnection(env, userId, options);
}

async function clearGoogleLocalConnection(
  env: Env, userId: number, options: { preserveCalendarSync?: boolean; preserveGoogleIdentity?: boolean } = {},
): Promise<void> {
  const sql = getSQL(env);
  await sql`DELETE FROM google_oauth_tokens WHERE user_id = ${userId}`;
  if (!options.preserveCalendarSync) {
    await sql`DELETE FROM calendar_sync_records WHERE user_id = ${userId} AND provider = 'google'`;
  }
  // The Google link table was added after older deployments. Disconnect must
  // still work there while removing the sign-in link where the table exists.
  if (!options.preserveGoogleIdentity) {
    try {
      await sql`DELETE FROM user_google_links WHERE user_id = ${userId}`;
    } catch (e: any) {
      if (!/no such table/i.test(String(e?.message || e))) throw e;
    }
  }
}

export function googleGrantHasScope(scope: unknown, wanted: string): boolean {
  return String(scope || '').split(/[\s,]+/)
    .includes(wanted);
}

/** Opaque, signed marker lets the Gmail-reset callback identify the account that owns retained event mappings. */
export async function makeGoogleSyncIdentityStateMarker(env: Env, googleSub: string | null | undefined): Promise<string> {
  if (!googleSub) return '';
  return `gs${await hmacSign(env.JWT_SECRET, `calendar-sync:${googleSub}`)}_`;
}

export async function googleSyncIdentityMatchesState(
  env: Env, nonce: string, googleSub: string | null | undefined,
): Promise<boolean | null> {
  const marker = /(?:^|_)gs([A-Za-z0-9_-]{43})_/.exec(nonce)?.[1];
  if (!marker) return null;
  if (!googleSub) return false;
  return marker === await hmacSign(env.JWT_SECRET, `calendar-sync:${googleSub}`);
}

export function shouldResetGoogleSyncMappings(
  retainedIdentityMatches: boolean | null,
  hadPreviousGoogleConnection: boolean,
): boolean {
  return retainedIdentityMatches === false
    || (retainedIdentityMatches === null && !hadPreviousGoogleConnection);
}

export function callbackGoogleScopes(
  incomingScope: unknown,
  previousScope: unknown,
  identityChanged: boolean,
): string {
  const scopes = new Set(String(incomingScope || '').split(/[\s,]+/).filter(Boolean));
  const gmailScope = 'https://www.googleapis.com/auth/gmail.readonly';
  if (!identityChanged && googleGrantHasScope(previousScope, gmailScope)) scopes.add(gmailScope);
  return [...scopes].join(' ');
}

export async function clearGoogleIdentityLink(env: Env, userId: number, previousGoogleSub: string): Promise<void> {
  if (!previousGoogleSub) return;
  const sql = getSQL(env);
  try {
    await sql`DELETE FROM user_google_links WHERE user_id = ${userId} AND google_sub = ${previousGoogleSub}`;
  } catch (e: any) {
    if (!/no such table/i.test(String(e?.message || e))) throw e;
  }
}

async function storedGoogleGrantHasScope(env: Env, userId: number, wanted: string): Promise<boolean> {
  await ensureCalendarOAuthSchema(env);
  const sql = getSQL(env);
  const row = (await sql`
    SELECT scope FROM google_oauth_tokens WHERE user_id = ${userId}
  ` as any[])[0];
  return googleGrantHasScope(row?.scope, wanted);
}

calendar.post('/google/remove-gmail-access', safe('g_remove_gmail', 'Could not remove Gmail access', async (c) => {
  const user = await requireAuth(c);
  await ensureCalendarOAuthSchema(c.env);
  const sql = getSQL(c.env);
  const row = (await sql`
    SELECT scope, google_sub FROM google_oauth_tokens WHERE user_id = ${user.id}
  ` as any[])[0];
  if (!row) return c.json({ error: { code: 'google_not_connected' } }, 409);
  if (!googleGrantHasScope(row.scope, 'https://www.googleapis.com/auth/gmail.readonly')) {
    return c.json({ error: { code: 'gmail_scope_not_granted' } }, 409);
  }

  // Prepare the new consent before revoking the existing grant so a missing
  // OAuth configuration cannot leave the member disconnected.
  const loginHint = user?.email ? String(user.email).toLowerCase().trim() : undefined;
  const keepMeetTranscripts = meetTranscriptsEnabled(c.env)
    && googleGrantHasScope(row.scope, GOOGLE_MEET_TRANSCRIPT_SCOPE);
  const identityMarker = await makeGoogleSyncIdentityStateMarker(c.env, row.google_sub);
  const next = await buildGoogleOAuthStartResponse(
    c.env, user.id, loginHint, keepMeetTranscripts, '', keepMeetTranscripts, identityMarker,
    googleGrantHasScope(row.scope, DRIVE_FILE_SCOPE),
  );
  if (next.status !== 200) return c.json(next.body, next.status);
  try {
    await revokeAndDisconnectGoogle(c.env, user.id, undefined, {
      preserveCalendarSync: !!row.google_sub,
      preserveGoogleIdentity: true,
    });
  } catch (e: any) {
    if (e?.code !== 'google_revocation_failed') throw e;
    // The consent state was prepared before revocation so bad OAuth config
    // cannot strand the connection. Discard it when revocation fails.
    try {
      const rawState = new URL(next.body.redirect_url).searchParams.get('state');
      const nonce = rawState ? await verifyState(c.env, rawState) : null;
      if (nonce) await consumeState(c.env, nonce, 'google');
    } catch (cleanupError) {
      console.warn('[CAL:g_remove_gmail] could not discard unused OAuth state', cleanupError);
    }
    return c.json({ error: { code: 'google_revocation_failed', message: 'Google did not confirm revocation. Your saved connection is still available to retry.' } }, 502);
  }
  return c.json({ ...next.body, gmail_access_removed: true });
}));

/**
 * Task #35 — pure helper exposed for testing. Returns the JSON body +
 * HTTP status that `/google/start` should send. Side effect: persists the
 * OAuth state row when secrets are healthy. Split out of the Hono handler
 * so the regression test can drive it without booting the Hono app or
 * synthesising a JWT cookie.
 */
export async function buildGoogleOAuthStartResponse(
  env: Env,
  userId: number,
  loginHint?: string,
  meetTranscripts = false,
  tag = '',
  meetTranscriptsPreserved = false,
  stateMarker = '',
  workspaceFiles = false,
): Promise<{ status: 200 | 500; body: any }> {
  const missing = preflightOAuthSecrets(env, 'google');
  if (missing.length > 0) {
    return {
      status: 500,
      body: {
        error: {
          code: 'oauth_config_missing',
          message: `Google Calendar OAuth is not fully configured on the server. Missing: ${missing.join(', ')}.`,
          missing,
        },
      },
    };
  }
  const nonce = `${tag === 'gw_' ? 'gw_' : meetTranscriptsPreserved ? 'mp_' : meetTranscripts ? 'gm_' : ''}${tag === 'gw_' ? '' : tag}${stateMarker}${crypto.randomUUID().replace(/-/g, '')}`;
  try {
    await persistState(env, nonce, userId, 'google');
    const state = await makeState(env, nonce);
    // Task #1 — at connect time we always know the signed-in Axal user;
    // pass their email to Google as `login_hint` so the account chooser
    // pre-selects/highlights the matching row. The chooser still always
    // appears (`prompt=select_account consent`) so the user can pick a
    // different account if they really want to.
    const url = buildGoogleAuthUrl(env, state, loginHint, meetTranscripts, workspaceFiles);
    return { status: 200, body: { redirect_url: url, auth_url: url } };
  } catch (e: any) {
    if (tag === 'gw_') console.warn('[CAL:workspace_start]', 'failed');
    else console.error('[CAL:g_start] persistState/makeState failed:', e?.message, e?.stack || '');
    return {
      status: 500,
      body: {
        error: {
          code: 'oauth_state_error',
          // D278 — our state store failed, not Google: the text is logged above.
          message: 'Could not start connecting Google Calendar. Nothing was saved; try again in a moment.',
        },
      },
    };
  }
}

export async function buildMicrosoftOAuthStartResponse(
  env: Env,
  userId: number,
  tag = '',
): Promise<{ status: 200 | 500; body: any }> {
  const missing = preflightOAuthSecrets(env, 'microsoft');
  if (missing.length > 0) {
    return {
      status: 500,
      body: {
        error: {
          code: 'oauth_config_missing',
          message: `Outlook Calendar OAuth is not fully configured on the server. Missing: ${missing.join(', ')}.`,
          missing,
        },
      },
    };
  }
  const nonce = `${tag}${crypto.randomUUID().replace(/-/g, '')}`;
  try {
    await persistState(env, nonce, userId, 'microsoft');
    const state = await makeState(env, nonce);
    const url = buildMicrosoftAuthUrl(env, state);
    return { status: 200, body: { redirect_url: url, auth_url: url } };
  } catch (e: any) {
    console.error('[CAL:ms_start] persistState/makeState failed:', e?.message, e?.stack || '');
    return {
      status: 500,
      body: {
        error: {
          code: 'oauth_state_error',
          // D278 — our state store failed, not Outlook: the text is logged above.
          message: 'Could not start connecting Outlook Calendar. Nothing was saved; try again in a moment.',
        },
      },
    };
  }
}

async function startGoogleOAuth(c: any, meetTranscripts = false) {
  const user = await requireAuth(c);
  // Task #1 — pass the Axal user's email as `login_hint` so Google's
  // account chooser pre-selects the matching row. Falls through as
  // undefined if the JWT somehow lacks an email (older sessions).
  const loginHint = user?.email ? String(user.email).toLowerCase().trim() : undefined;
  // Task #70 — let the Integrations page hand-off remember its origin
  // across the Google round-trip via a short-lived, scoped cookie. Build's
  // return also rides in the signed nonce, with its venture (#1597).
  const returnTo = String(c.req.query('return_to') || '').toLowerCase();
  // With incremental scope carry-forward disabled, include an already granted
  // optional Meet scope explicitly during ordinary reconnects.
  const preserveMeetTranscripts = !meetTranscripts
    && meetTranscriptsEnabled(c.env)
    && await storedGoogleGrantHasScope(c.env, user.id, GOOGLE_MEET_TRANSCRIPT_SCOPE);
  const sql = getSQL(c.env);
  let linkedGoogle: any;
  try {
    linkedGoogle = (await sql`
      SELECT google_sub FROM google_oauth_tokens WHERE user_id = ${user.id}
    ` as any[])[0];
  } catch (e: any) {
    if (!/no such table/i.test(String(e?.message || e))) throw e;
  }
  const stateMarker = await makeGoogleSyncIdentityStateMarker(c.env, linkedGoogle?.google_sub);
  const { status, body } = await buildGoogleOAuthStartResponse(
    c.env, user.id, loginHint, meetTranscripts || preserveMeetTranscripts,
    returnTag(returnTo, c.req.query('project_id')), preserveMeetTranscripts, stateMarker, await storedGoogleGrantHasScope(c.env, user.id, DRIVE_FILE_SCOPE),
  );
  if (status === 200 && (returnTo === 'integrations' || returnTo === 'build' || returnTo === 'record')) {
    c.header(
      'Set-Cookie',
      `studioos_cal_return=${returnTo}; HttpOnly; Secure; SameSite=Lax; Path=/api/calendar; Max-Age=600`,
      { append: true },
    );
  }
  return c.json(body, status);
}
calendar.post('/google/connect', safe('g_connect', 'Could not start Google OAuth', startGoogleOAuth));
calendar.get('/google/start',    safe('g_start',   'Could not start Google OAuth', startGoogleOAuth));
calendar.post('/google/start',   safe('g_start',   'Could not start Google OAuth', startGoogleOAuth));
// Explicit opt-in. A normal Calendar connection never asks to read Meet transcripts.
// Until the owner switches it on (D757, #1926) it refuses before any state is written.
calendar.post('/google/meet-transcripts/connect', safe('g_meet_consent', 'Could not start Meet transcript consent',
  async (c) => {
    if (!meetTranscriptsEnabled(c.env)) {
      return c.json({ error: 'meet_transcripts_not_set_up', message: "Importing Meet transcripts isn't set up on Axal yet." }, 503);
    }
    return startGoogleOAuth(c, true);
  }));

// D1091: incremental file consent shares Calendar's single token store.
calendar.post('/google/workspace-files/connect', async (c) => {
  try {
    const user = await prepareWorkspaceConnect(c);
    const existing = await c.env.DB.prepare('SELECT google_sub,scope FROM google_oauth_tokens WHERE user_id = ?').bind(user.id).first<{ google_sub: string; scope: string }>();
    const marker = await makeGoogleSyncIdentityStateMarker(c.env, existing?.google_sub);
    const keepMeet = meetTranscriptsEnabled(c.env) && googleGrantHasScope(existing?.scope, GOOGLE_MEET_TRANSCRIPT_SCOPE);
    const result = await buildGoogleOAuthStartResponse(c.env, user.id, undefined, keepMeet, 'gw_', keepMeet, marker, true);
    return c.json(result.body, result.status);
  } catch (error) {
    if (error instanceof Error && ['Unauthorized','Forbidden'].includes(error.message)) throw error;
    return c.json({ error: error instanceof WorkspaceError ? error.code : 'workspace_unreadable' }, error instanceof WorkspaceError ? error.status as any : 503);
  }
});

/**
 * Task #1 — pure persistence step of /google/callback, extracted for
 * testability and so the one-Google-to-one-Axal collision guard can be
 * exercised end-to-end (token write + sign-in link write) without
 * mocking Hono, JWT, or Google's token exchange.
 *
 * Atomicity model:
 *   - Pre-checks for collisions on both google_oauth_tokens and
 *     user_google_links. Catches missing column/table on legacy
 *     deployments so the upsert can proceed (the UNIQUE constraint
 *     fallback below still applies once schema bootstraps).
 *   - Writes the token row; the partial UNIQUE INDEX on
 *     google_oauth_tokens(google_sub) (created by
 *     ensureCalendarOAuthSchema) catches any racer that slipped past
 *     the pre-check and is mapped back to
 *     `google_already_linked_other_user`.
 *   - Writes user_google_links with a plain INSERT (not OR IGNORE) so
 *     a different Axal user racing in between the pre-check and the
 *     write surfaces as the same explicit error instead of a silent
 *     no-op (which would leave token rows for one user and a sign-in
 *     link for another). Same-user reconnect remains idempotent
 *     because we check for an existing self-row first.
 */
export type PersistGoogleCallbackArgs = {
  userId: number;
  refreshEnc: string;
  scope: string;
  googleEmail: string | null;
  googleSub: string;
  emailsMatch: boolean;
  userEmail: string;
};
export type PersistGoogleCallbackResult =
  | { ok: true; warn?: 'google_email_mismatch'; warnEmail?: string }
  | { ok: false; reason: 'google_already_linked_other_user' };

export async function persistGoogleCallbackTokens(
  env: Env,
  a: PersistGoogleCallbackArgs,
): Promise<PersistGoogleCallbackResult> {
  const sql = getSQL(env);
  const { userId, refreshEnc, scope, googleEmail, googleSub, emailsMatch, userEmail } = a;
  const isUniqueErr = (e: any): boolean =>
    /UNIQUE constraint failed|UNIQUE constraint|constraint failed/i.test(String(e?.message || e));

  // Pre-check token-side conflict.
  if (googleSub) {
    try {
      const tokConflict = (await sql`
        SELECT user_id FROM google_oauth_tokens
         WHERE google_sub = ${googleSub} AND user_id <> ${userId}
         LIMIT 1
      ` as any[])[0];
      if (tokConflict) return { ok: false, reason: 'google_already_linked_other_user' };
    } catch (e: any) {
      if (!/no such column|no such table/i.test(String(e?.message || e))) throw e;
    }
    // Pre-check link-side conflict.
    try {
      const linkConflict = (await sql`
        SELECT user_id FROM user_google_links
         WHERE google_sub = ${googleSub} AND user_id <> ${userId}
         LIMIT 1
      ` as any[])[0];
      if (linkConflict) return { ok: false, reason: 'google_already_linked_other_user' };
    } catch (e: any) {
      if (!/no such table/i.test(String(e?.message || e))) throw e;
    }
  }

  // Token upsert. UNIQUE on (user_id) makes same-user reconnect an
  // UPDATE; partial UNIQUE on (google_sub) catches the concurrent-racer
  // case that slipped past the pre-check.
  const nowIso = new Date().toISOString();
  try {
    const existing = (await sql`SELECT id FROM google_oauth_tokens WHERE user_id = ${userId}` as any[])[0];
    if (existing) {
      await sql`
        UPDATE google_oauth_tokens
           SET refresh_token = ${refreshEnc}, scope = ${scope},
               google_email = ${googleEmail}, google_sub = ${googleSub || null},
               updated_at = ${nowIso}
         WHERE user_id = ${userId}
      `;
    } else {
      await sql`
        INSERT INTO google_oauth_tokens
          (user_id, refresh_token, scope, google_email, google_sub)
        VALUES
          (${userId}, ${refreshEnc}, ${scope}, ${googleEmail}, ${googleSub || null})
      `;
    }
  } catch (e: any) {
    if (isUniqueErr(e)) return { ok: false, reason: 'google_already_linked_other_user' };
    throw e;
  }

  // Sign-in link write (only when emails verifiably match — legacy
  // /calendar flow with a personal Google calendar deliberately skips
  // the link so we don't bind a personal Google identity to the
  // workplace Axal account).
  let warn: 'google_email_mismatch' | undefined;
  let warnEmail = '';
  if (googleSub && googleEmail) {
    const ge = String(googleEmail).toLowerCase().trim();
    if (emailsMatch) {
      try {
        await sql`CREATE TABLE IF NOT EXISTS user_google_links (user_id INTEGER PRIMARY KEY, google_sub TEXT NOT NULL UNIQUE)`;
        const existingLink = (await sql`
          SELECT google_sub FROM user_google_links WHERE user_id = ${userId}
        ` as any[])[0];
        if (existingLink) {
          // Same-user reconnect: idempotent if it's the same google_sub;
          // explicit collision if it's a different one (the same user
          // is trying to re-bind to a different Google identity, which
          // we currently disallow at the sign-in layer too).
          if (String(existingLink.google_sub) !== googleSub) {
            return { ok: false, reason: 'google_already_linked_other_user' };
          }
        } else {
          try {
            await sql`INSERT INTO user_google_links (user_id, google_sub) VALUES (${userId}, ${googleSub})`;
          } catch (insErr: any) {
            if (isUniqueErr(insErr)) {
              return { ok: false, reason: 'google_already_linked_other_user' };
            }
            throw insErr;
          }
        }
      } catch (linkErr: any) {
        // Non-UNIQUE errors here are best-effort logged (legacy
        // deployments without the side table etc) — calendar tokens
        // already wrote successfully.
        console.warn('[CAL:g_callback] user_google_links write failed:', linkErr?.message || linkErr);
      }
    } else if (userEmail && ge !== userEmail) {
      warn = 'google_email_mismatch';
      // googleEmail is proven truthy by the enclosing `if (googleSub && googleEmail)`
      // above, so the `|| ''` fallback here was always dead.
      warnEmail = googleEmail;
    }
  }
  return warn ? { ok: true, warn, warnEmail } : { ok: true };
}

calendar.get('/google/callback', async (c) => {
  let workspaceCallback = false;
  // Intentionally no requireAuth — the user_id comes from the state row.
  let returnTo = readReturnTo(c);
  try {
    await ensureCalendarOAuthSchema(c.env);
    const url = new URL(c.req.url);
    const code = url.searchParams.get('code');
    const stateRaw = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    // The signed nonce names Build's return when the cookie is on another host (#1597).
    const signed = stateRaw ? await verifyState(c.env, stateRaw) : null;
    returnTo = returnFromNonce(signed) || returnTo;
    if (error || !code || !stateRaw) return failureRedirect(c.env, 'google', signed?.startsWith('gw_') ? 'workspace_consent_refused' : error || 'invalid_state', returnTo);
    const nonce = signed;
    if (!nonce) return failureRedirect(c.env, 'google', 'invalid_state', returnTo);
    const newMeetGrant = nonce.startsWith('gm_');
    const newWorkspaceGrant = nonce.startsWith('gw_');
    workspaceCallback = newWorkspaceGrant;
    const userId = await consumeState(c.env, nonce, 'google');
    if (!userId) return failureRedirect(c.env, 'google', 'invalid_state', returnTo);

    const tokens = await exchangeGoogleCode(c.env, code);
    if (newMeetGrant && !String(tokens?.scope || '').split(/[\s,]+/).includes(GOOGLE_MEET_TRANSCRIPT_SCOPE)) {
      return failureRedirect(c.env, 'google', 'meet_scope_missing', returnTo);
    }
    if (newWorkspaceGrant && !googleGrantHasScope(tokens?.scope, DRIVE_FILE_SCOPE)) return failureRedirect(c.env, 'google', 'workspace_scope_missing', returnTo);
    const refreshToken = tokens?.refresh_token;
    if (!refreshToken) return failureRedirect(c.env, 'google', 'no_refresh_token', returnTo);
    const info = await fetchGoogleUserinfo(tokens.access_token || '');

    // Task #70 — when the OAuth round-trip was initiated from the
    // Integrations page (single combined "Google" tile that covers
    // Calendar + Gmail + Continue-with-Google), the connect is meant
    // to bind the user's StudioOS account to ONE Google identity.
    // We therefore validate verified-email + exact match BEFORE any
    // write so a mismatch leaves zero residue (no calendar tokens, no
    // user_google_links row). The legacy /calendar entry point keeps
    // its prior behaviour: users may intentionally connect a personal
    // Google calendar that differs from their work StudioOS email.
    const sql = getSQL(c.env);
    const googleEmailRaw = info.email || '';
    const googleEmail = String(googleEmailRaw).toLowerCase().trim();
    const googleSub = String(info.id || '');
    const verified = info.verified_email === true || info.verified_email === 1;
    const me = (await sql`SELECT email FROM users WHERE id = ${userId}` as any[])[0];
    const userEmail = String(me?.email || '').toLowerCase().trim();
    const emailsMatch = !!(verified && googleEmail && userEmail && googleEmail === userEmail);

    if ((returnTo === 'integrations' || returnTo === 'build') && !emailsMatch) {
      // Strict: no token persistence, no link write, no calendar_sync
      // touch. Surface the mismatch as an explicit error (not a warn)
      // so the tile renders it inline as a failure, not a partial
      // success — matches the Task #70 contract.
      const reason = (!verified && googleEmailRaw) ? 'email_unverified' : 'email_mismatch';
      const params = new URLSearchParams({ google: 'error', reason });
      if (googleEmailRaw) params.set('google_email', googleEmailRaw);
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${destFor(c.env, returnTo)}?${params.toString()}`,
          'Set-Cookie': clearReturnToHeader(),
        },
      });
    }

    const retainedIdentityMatches = await googleSyncIdentityMatchesState(c.env, nonce, googleSub);
    let previousGoogleConnection: any;
    try {
      previousGoogleConnection = (await sql`
        SELECT google_sub, scope FROM google_oauth_tokens WHERE user_id = ${userId}
      ` as any[])[0];
    } catch (e: any) {
      if (!/no such table/i.test(String(e?.message || e))) throw e;
    }
    const previousGoogleSub = String(previousGoogleConnection?.google_sub || '');
    const identityChanged = retainedIdentityMatches === false
      || (retainedIdentityMatches === null && !!previousGoogleSub && !!googleSub && previousGoogleSub !== googleSub);
    if (newWorkspaceGrant && (!previousGoogleSub || previousGoogleSub !== googleSub)) return failureRedirect(c.env, 'google', 'workspace_account_changed', returnTo);
    let previousGoogleIdentityLink = '';
    try {
      const link = (await sql`
        SELECT google_sub FROM user_google_links WHERE user_id = ${userId}
      ` as any[])[0];
      previousGoogleIdentityLink = String(link?.google_sub || '');
    } catch (e: any) {
      if (!/no such table/i.test(String(e?.message || e))) throw e;
    }
    // include_granted_scopes=false makes Google's new token omit legacy Gmail,
    // but the old same-account grant remains until its owner removes it explicitly.
    const callbackScope = callbackGoogleScopes(tokens.scope, previousGoogleConnection?.scope, identityChanged);

    const refreshEnc = await encryptString(c.env, refreshToken);
    const persist = await persistGoogleCallbackTokens(c.env, {
      userId,
      refreshEnc,
      scope: callbackScope,
      googleEmail: info.email || null,
      googleSub,
      emailsMatch,
      userEmail,
    });
    if (!persist.ok) {
      return failureRedirect(c.env, 'google', persist.reason, returnTo);
    }
    if (identityChanged) await clearWorkspaceConnection(c.env, userId);
    if (identityChanged && previousGoogleIdentityLink && previousGoogleIdentityLink !== googleSub) {
      // The original sign-in link remains intact if consent is abandoned; once
      // a different Calendar identity is confirmed, remove only that old link.
      await clearGoogleIdentityLink(c.env, userId, previousGoogleIdentityLink);
    }
    // D1209: a disconnect that kept the copies left a marker of their account.
    // With no Gmail-removal marker and no live connection, it decides.
    let mappingsMatch = identityChanged ? false : retainedIdentityMatches;
    if (mappingsMatch === null && !previousGoogleConnection) {
      const kept = await takeRetainedMarker(c.env, userId, 'google');
      if (kept) mappingsMatch = !!googleSub && kept === await accountMarker(c.env.JWT_SECRET, 'google', googleSub);
    }
    if (shouldResetGoogleSyncMappings(mappingsMatch, !!previousGoogleConnection)) {
      // Gmail removal retained Calendar event mappings so reconnecting the
      // same account remains idempotent. A different account clears them; an
      // unmarked callback clears them only when no previous connection exists
      // (for example, a fresh connect after abandoned Gmail-removal consent).
      try {
        await sql`DELETE FROM calendar_sync_records WHERE user_id = ${userId} AND provider = 'google'`;
      } catch (e: any) {
        if (!/no such table/i.test(String(e?.message || e))) throw e;
      }
    }
    const extra: Record<string, string> = {};
    // The return banner tells a transcript grant from an ordinary connect (#1926).
    if (newMeetGrant) extra.meet = 'granted';
    if (newWorkspaceGrant) { await ensureWorkspaceIntegration(c.env, userId); extra.workspace = 'granted'; }
    if (persist.warn && !newWorkspaceGrant) {
      extra.warn = persist.warn;
      if (persist.warnEmail) extra.google_email = persist.warnEmail;
    }
    return successRedirect(c.env, 'google', returnTo, extra);
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (workspaceCallback) console.warn('[CAL:workspace_callback]', 'failed');
    else console.error('[CAL:g_callback]', msg, e?.stack || '');
    return failureRedirect(c.env, 'google', workspaceCallback ? 'workspace_unreadable' : bucketCallbackFailure(msg), returnTo);
  }
});

/**
 * D1209 — ONE GOOGLE DISCONNECT, for `DELETE /google` and
 * `POST /google/disconnect`. The grant is revoked at Google first (#2413);
 * a refused revocation keeps everything, so the member can retry. The copies
 * on Google and their mappings stay, unless the member chose "Remove the
 * copies first": then every copy is deleted at Google before anything else,
 * and a copy Google refuses stops the disconnect.
 */
async function disconnectGoogle(c: any) {
  const user = await requireAuth(c);
  await ensureCalendarOAuthSchema(c.env);
  const removeCopies = await wantsCopiesRemoved(c);
  if (removeCopies && !(await removeProviderCopies(c.env, user.id, 'google')).ok) {
    return c.json({ error: COPIES_NOT_REMOVED }, 502);
  }
  const sub = (await c.env.DB.prepare('SELECT google_sub FROM google_oauth_tokens WHERE user_id = ?').bind(user.id)
    .first() as { google_sub: string | null } | null)?.google_sub || null;
  try {
    await revokeAndDisconnectGoogle(c.env, user.id, undefined, { preserveCalendarSync: true });
  } catch (e: any) {
    if (e?.code === 'google_revocation_failed') {
      return c.json({ error: { code: 'google_revocation_failed', message: 'Google did not confirm revocation. Your saved connection is still available to retry.' } }, 502);
    }
    throw e;
  }
  await settleRetained(c.env, user.id, 'google', sub);
  return c.json({ ok: true, copies: removeCopies ? 'removed' : 'kept' });
}

calendar.delete('/google', safe('g_disconnect', 'Could not disconnect Google', disconnectGoogle));

calendar.post('/google/sync', safe('g_sync', 'Google sync failed', async (c) => {
  const user = await requireAuth(c);
  await ensureCalendarOAuthSchema(c.env);
  if (!googleOAuthAvailable(c.env)) {
    return c.json({ detail: 'Google OAuth not configured on server' }, 503);
  }
  const url = new URL(c.req.url);
  const fromQ = url.searchParams.get('from');
  const toQ = url.searchParams.get('to');
  const fromDt = fromQ ? new Date(fromQ) : new Date(Date.now() - 86_400_000);
  const toDt = toQ ? new Date(toQ) : new Date(Date.now() + 60 * 86_400_000);
  try {
    const summary = await syncUserToGoogle(c.env, user.id, lc(user.role), fromDt.toISOString(), toDt.toISOString());
    await settleSync(c.env, user.id, 'google', summary);
    return c.json(summary);
  } catch (e: any) {
    await settleSync(c.env, user.id, 'google', { error: e });
    if (e?.message === 'not_connected') return c.json({ detail: 'Connect a Google account first' }, 409);
    return refuse(c, 502, { code: 'google_sync_failed', message: 'The Google calendar sync did not complete. Check the connection and try again.', raw: e, audience: 'owner' });
  }
}));

// ===========================================================================
// Microsoft 365 / Outlook
// ===========================================================================
calendar.get('/microsoft/status', safe('m_status', 'Could not load Microsoft status', async (c) => {
  const user = await requireAuth(c);
  await ensureCalendarOAuthSchema(c.env);
  const sql = getSQL(c.env);
  const row = (await sql`
    SELECT microsoft_email, last_synced_at, scope FROM microsoft_oauth_tokens WHERE user_id = ${user.id}
  ` as any[])[0];
  const configured = microsoftOAuthAvailable(c.env);
  return c.json({
    configured,
    available: configured, // back-compat alias
    connected: configured ? !!row : false,
    microsoft_email: row?.microsoft_email || null,
    last_synced_at: row?.last_synced_at || null,
    scope: row?.scope || null,
    ...await syncErrorFields(c.env, user.id, 'microsoft', !!row),
  });
}));

async function startMicrosoftOAuth(c: any) {
  const user = await requireAuth(c);
  // Parity with startGoogleOAuth — let the Integrations page hand-off
  // remember its origin across the Microsoft round-trip via the same
  // short-lived, scoped cookie; Build's return rides in the signed nonce too (#1597).
  const returnTo = String(c.req.query('return_to') || '').toLowerCase();
  const { status, body } = await buildMicrosoftOAuthStartResponse(c.env, user.id, returnTag(returnTo, c.req.query('project_id')));
  if (status === 200 && (returnTo === 'integrations' || returnTo === 'build')) {
    c.header(
      'Set-Cookie',
      `studioos_cal_return=${returnTo}; HttpOnly; Secure; SameSite=Lax; Path=/api/calendar; Max-Age=600`,
      { append: true },
    );
  }
  return c.json(body, status);
}
calendar.post('/microsoft/connect', safe('m_connect', 'Could not start Microsoft OAuth', startMicrosoftOAuth));
calendar.get('/microsoft/start',    safe('m_start',   'Could not start Microsoft OAuth', startMicrosoftOAuth));
calendar.post('/microsoft/start',   safe('m_start',   'Could not start Microsoft OAuth', startMicrosoftOAuth));
calendar.get('/outlook/start',      safe('o_start',   'Could not start Outlook OAuth',   startMicrosoftOAuth));
calendar.post('/outlook/start',     safe('o_start',   'Could not start Outlook OAuth',   startMicrosoftOAuth));

calendar.get('/microsoft/callback', async (c) => {
  let returnTo = readReturnTo(c);
  try {
    await ensureCalendarOAuthSchema(c.env);
    const url = new URL(c.req.url);
    const code = url.searchParams.get('code');
    const stateRaw = url.searchParams.get('state');
    returnTo = returnFromNonce(stateRaw ? await verifyState(c.env, stateRaw) : null) || returnTo;
    const error = url.searchParams.get('error');
    if (error || !code || !stateRaw) return failureRedirect(c.env, 'microsoft', error || 'invalid_state', returnTo);
    const nonce = await verifyState(c.env, stateRaw);
    if (!nonce) return failureRedirect(c.env, 'microsoft', 'invalid_state', returnTo);
    const userId = await consumeState(c.env, nonce, 'microsoft');
    if (!userId) return failureRedirect(c.env, 'microsoft', 'invalid_state', returnTo);

    const tokens = await exchangeMicrosoftCode(c.env, code);
    const refreshToken = tokens?.refresh_token;
    if (!refreshToken) return failureRedirect(c.env, 'microsoft', 'no_refresh_token', returnTo);
    const info = await fetchMicrosoftUserinfo(tokens.access_token || '');
    const email = info.mail || info.userPrincipalName || null;
    const subId = info.id || null;
    const refreshEnc = await encryptString(c.env, refreshToken);

    const sql = getSQL(c.env);
    const nowIso = new Date().toISOString();
    const existing = (await sql`SELECT id FROM microsoft_oauth_tokens WHERE user_id = ${userId}` as any[])[0];
    if (existing) {
      await sql`
        UPDATE microsoft_oauth_tokens
           SET refresh_token = ${refreshEnc}, scope = ${tokens.scope || ''},
               microsoft_email = ${email}, microsoft_sub = ${subId},
               updated_at = ${nowIso}
         WHERE user_id = ${userId}
      `;
    } else {
      await sql`
        INSERT INTO microsoft_oauth_tokens
          (user_id, refresh_token, scope, microsoft_email, microsoft_sub)
        VALUES
          (${userId}, ${refreshEnc}, ${tokens.scope || ''}, ${email}, ${subId})
      `;
      // D1209: copies a disconnect kept stay for the same account. Another
      // account's are dropped here; they stay on that account's calendar.
      const kept = await takeRetainedMarker(c.env, userId, 'microsoft');
      if (kept && !(subId && kept === await accountMarker(c.env.JWT_SECRET, 'microsoft', subId))) {
        await sql`DELETE FROM calendar_sync_records WHERE user_id = ${userId} AND provider = 'microsoft'`;
      }
    }
    return successRedirect(c.env, 'microsoft', returnTo);
  } catch (e: any) {
    const msg = String(e?.message || e);
    console.error('[CAL:m_callback]', msg, e?.stack || '');
    return failureRedirect(c.env, 'microsoft', bucketCallbackFailure(msg), returnTo);
  }
});

/**
 * D1209 — one Microsoft disconnect, for `DELETE /microsoft` and
 * `POST /microsoft/disconnect`, with the same choice as Google's. Microsoft
 * has no grant revocation the Worker can call, so only the saved token goes.
 */
async function disconnectMicrosoft(c: any) {
  const user = await requireAuth(c);
  await ensureCalendarOAuthSchema(c.env);
  const removeCopies = await wantsCopiesRemoved(c);
  if (removeCopies && !(await removeProviderCopies(c.env, user.id, 'microsoft')).ok) {
    return c.json({ error: COPIES_NOT_REMOVED }, 502);
  }
  const sub = (await c.env.DB.prepare('SELECT microsoft_sub FROM microsoft_oauth_tokens WHERE user_id = ?').bind(user.id)
    .first() as { microsoft_sub: string | null } | null)?.microsoft_sub || null;
  await c.env.DB.prepare('DELETE FROM microsoft_oauth_tokens WHERE user_id = ?').bind(user.id).run();
  await settleRetained(c.env, user.id, 'microsoft', sub);
  return c.json({ ok: true, copies: removeCopies ? 'removed' : 'kept' });
}

calendar.delete('/microsoft', safe('m_disconnect', 'Could not disconnect Microsoft', disconnectMicrosoft));

calendar.post('/microsoft/sync', safe('m_sync', 'Microsoft sync failed', async (c) => {
  const user = await requireAuth(c);
  await ensureCalendarOAuthSchema(c.env);
  if (!microsoftOAuthAvailable(c.env)) {
    return c.json({ detail: 'Microsoft OAuth not configured on server' }, 503);
  }
  const url = new URL(c.req.url);
  const fromQ = url.searchParams.get('from');
  const toQ = url.searchParams.get('to');
  const fromDt = fromQ ? new Date(fromQ) : new Date(Date.now() - 86_400_000);
  const toDt = toQ ? new Date(toQ) : new Date(Date.now() + 60 * 86_400_000);
  try {
    const summary = await syncUserToMicrosoft(c.env, user.id, lc(user.role), fromDt.toISOString(), toDt.toISOString());
    await settleSync(c.env, user.id, 'microsoft', summary);
    return c.json(summary);
  } catch (e: any) {
    await settleSync(c.env, user.id, 'microsoft', { error: e });
    if (e?.message === 'not_connected') return c.json({ detail: 'Connect a Microsoft account first' }, 409);
    return refuse(c, 502, { code: 'microsoft_sync_failed', message: 'The Microsoft calendar sync did not complete. Check the connection and try again.', raw: e, audience: 'owner' });
  }
}));

// Task #1 (AG) — spec-contract aliases. Generic /events CRUD (separate from
// the /ic-meetings + /founder-checkins typed surfaces) writes to the same
// calendar_events table the GET /events read uses. Founders must own the row;
// admin/partner/investor may write any row attributed to them.
calendar.post('/events', async (c) => {
  const user = await requireAuth(c);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const title = String(body?.title || '').trim();
  const startAt = String(body?.start_at || '').trim();
  const endAt = String(body?.end_at || startAt).trim();
  if (!title || !startAt) return c.json({ detail: 'title and start_at required' }, 400);
  const source = body?.source ? String(body.source).slice(0, 40) : 'manual';
  const kind = body?.kind ? String(body.kind).slice(0, 40) : 'other';
  // TWO REASONS THIS THREW ON EVERY CALL BEFORE MIGRATION 235.
  //   · `kind` was not a column. Migration 062's header promised the add "in a
  //     separate migration in follow-up Task #58"; it was never written, and no
  //     `ALTER TABLE calendar_events` existed anywhere. 235 adds it.
  //   · `uid` is NOT NULL UNIQUE and nothing supplied one, so even with `kind`
  //     present the row could not be written. It is minted here from the same
  //     value as `external_uri`, which is the identity this row actually has.
  const uid = `axal:manual:${crypto.randomUUID()}`;
  const r = await c.env.DB.prepare(
    `INSERT INTO calendar_events (uid, user_id, source, kind, external_uri, title, start_at, end_at, status,
                                   notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, datetime('now'), datetime('now'))`,
  ).bind(uid, user.id, source, kind, uid, title.slice(0, 240),
         startAt, endAt, body?.notes ? String(body.notes).slice(0, 4000) : null).run();
  return c.json({ id: r.meta.last_row_id, ok: true });
});

calendar.patch('/events/:id', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);
  const row = await c.env.DB.prepare('SELECT id, user_id FROM calendar_events WHERE id = ?')
    .bind(id).first<{ id: number; user_id: number }>();
  if (!row) return c.json({ detail: 'Event not found' }, 404);
  if (row.user_id !== user.id && user.role !== 'admin') return c.json({ detail: 'Forbidden' }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const fields: string[] = [];
  const vals: (string | null)[] = [];
  for (const k of ['title', 'start_at', 'end_at', 'status', 'notes', 'location_uri'] as const) {
    if (body[k] !== undefined) {
      fields.push(`${k} = ?`);
      vals.push(body[k] == null ? null : String(body[k]).slice(0, 4000));
    }
  }
  if (!fields.length) return c.json({ ok: true });
  fields.push("updated_at = datetime('now')");
  await c.env.DB.prepare(`UPDATE calendar_events SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...vals, id).run();
  return c.json({ ok: true });
});

calendar.delete('/events/:id', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);
  const row = await c.env.DB.prepare('SELECT id, user_id FROM calendar_events WHERE id = ?')
    .bind(id).first<{ id: number; user_id: number }>();
  if (!row) return c.json({ detail: 'Event not found' }, 404);
  if (row.user_id !== user.id && user.role !== 'admin') return c.json({ detail: 'Forbidden' }, 403);
  await c.env.DB.prepare('DELETE FROM calendar_events WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// POST aliases for the existing DELETE /google and /microsoft disconnects —
// both verbs are valid per the spec contract.
calendar.post('/google/disconnect', safe('g_disconnect_post', 'Could not disconnect Google', disconnectGoogle));
// After a refused revocation: the local connection only. The copies stay, as
// every disconnect now keeps them (D1209).
calendar.post('/google/force-disconnect', safe('g_force_disconnect', 'Could not disconnect Google locally', async (c) => {
  const user = await requireAuth(c);
  await ensureCalendarOAuthSchema(c.env);
  const sub = (await c.env.DB.prepare('SELECT google_sub FROM google_oauth_tokens WHERE user_id = ?').bind(user.id)
    .first() as { google_sub: string | null } | null)?.google_sub || null;
  await clearGoogleLocalConnection(c.env, user.id, { preserveCalendarSync: true });
  await settleRetained(c.env, user.id, 'google', sub);
  return c.json({
    ok: true,
    revoked: false,
    warning: 'Google did not confirm revocation. Remove Axal VC from your Google Account access settings if it still appears there.',
  });
}));
calendar.post('/microsoft/disconnect', safe('m_disconnect_post', 'Could not disconnect Microsoft', disconnectMicrosoft));

export default calendar;
