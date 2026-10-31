/**
 * D1490 (#3904) — HQ › Platform › Event syndication: the channel accounts,
 * HQ's settings and the activity log. Mounted at `/api/admin/event-syndication`
 * before the `/api/admin` catch-all.
 *
 *   GET   /channels                    Super Admin   every channel, its adapter and its live HQ account
 *   POST  /channels/:channel/connect   write bar     { api_key } (a key channel) or {} → { authorize_url } (OAuth)
 *   GET   /oauth/:channel/callback     signed state  the OAuth return; redirects to the page
 *   PATCH /channels/:uid               write bar     { default_on }
 *   POST  /channels/:uid/disconnect    write bar     credentials removed; posted listings stay up
 *   GET   /settings                    HQ admin      { settings }
 *   PUT   /settings                    write bar     the settings object
 *   GET   /log                         HQ admin      ?event=&channel=&outcome=&before=&limit=
 *
 * `credentials_enc` is written through `integrations/secrets.ts` and is
 * selected by no read here. Part A has no adapter, so every connect answers
 * 409 `adapter_not_ready` until a channel's own task lands.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireHqAdmin, requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { refuse } from '../util/refusal';
import { HQ_ONLY } from '../util/branch';
import { encryptChannelCredentials } from '../integrations/secrets';
import { CHANNEL_KEYS, ChannelError, isChannelKey, syndicationChannel } from '../services/eventSyndication/channels';
import { DEFAULT_SETTINGS, parseSettings, readSettings, SETTINGS_KEY } from '../services/eventSyndication/eligibility';
import { logSyndication } from '../services/eventSyndication/jobs';

const adminEventSyndication = new Hono<{ Bindings: Env }>();

type Gate = (c: Context<{ Bindings: Env }>) => Promise<User>;

/** Each gate's refusal, by the sentence it throws. */
const GATE_REFUSALS: Record<string, [number, string, string]> = {
  [HQ_ONLY]: [403, 'hq_only', 'Event syndication is managed at HQ.'],
  'Super admin required': [403, 'super_admin_required', 'Only a Super Admin manages channel accounts.'],
  'Admin required': [403, 'admin_required', 'Only HQ administrators read event syndication.'],
  'TOTP required': [403, 'totp_required', 'Sign in with your authenticator app to change channel accounts.'],
  step_up_required: [403, 'step_up_required', 'Confirm it is you to change channel accounts.'],
  admin_frozen: [423, 'admin_frozen', 'Your admin access is paused until your compliance steps are done.'],
};

async function gate(c: Context<{ Bindings: Env }>, check: Gate): Promise<User | Response> {
  try {
    return await check(c);
  } catch (e) {
    const hit = GATE_REFUSALS[(e as Error)?.message];
    if (hit) return refuse(c, hit[0], { code: hit[1], message: hit[2] });
    return refuse(c, 401, { code: 'unauthorized', message: 'Sign in to manage event syndication.' });
  }
}

/** An account as every read returns it: never `credentials_enc`, which no read selects. */
function accountOut(a: any) {
  if (!a) return null;
  return {
    uid: a.uid, channel: a.channel, owner_kind: a.owner_kind, display_name: a.display_name, status: a.status,
    expires_at: a.expires_at ?? null, last_error: a.last_error ?? null, default_on: !!a.default_on,
    connected_by_name: a.connected_by_name ?? null, connected_at: a.created_at ?? null,
  };
}

async function accountByUid(env: Env, uid: string) {
  return env.DB.prepare(
    `SELECT a.id, a.uid, a.channel, a.owner_kind, a.display_name, a.status, a.expires_at, a.last_error, a.default_on, a.created_at,
            u.name AS connected_by_name
       FROM event_channel_accounts a LEFT JOIN users u ON u.id = a.connected_by WHERE a.uid = ?`,
  ).bind(uid).first<any>();
}

adminEventSyndication.get('/channels', async (c) => {
  const u = await gate(c, requireSuperAdmin);
  if (u instanceof Response) return u;
  const live = (await c.env.DB.prepare(
    `SELECT a.uid, a.channel, a.owner_kind, a.display_name, a.status, a.expires_at, a.last_error, a.default_on, a.created_at,
            u.name AS connected_by_name
       FROM event_channel_accounts a LEFT JOIN users u ON u.id = a.connected_by
      WHERE a.owner_kind = 'hq' AND a.status != 'disconnected'`,
  ).all<any>()).results || [];
  return c.json({
    channels: CHANNEL_KEYS.map((channel) => {
      const adapter = syndicationChannel(channel);
      return { channel, capability: adapter?.capability ?? null, adapter_ready: !!adapter, account: accountOut(live.find((a: any) => a.channel === channel)) };
    }),
  });
});

// ── OAuth state: HMAC-signed, single use, ten minutes (as `linkedin.ts`). ──
async function hmac(env: Env, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(env.JWT_SECRET)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const stateKey = (nonce: string) => `event-syndication:state:${nonce}`;
const redirectUriFor = (env: Env, channel: string) => `${(env.APP_URL || 'https://axal.vc').replace(/\/+$/, '')}/api/admin/event-syndication/oauth/${channel}/callback`;
const PAGE = '/admin/platform/event-syndication';

adminEventSyndication.post('/channels/:channel/connect', async (c) => {
  const u = await gate(c, requireSuperAdminWriteBar);
  if (u instanceof Response) return u;
  const channel = c.req.param('channel');
  if (!isChannelKey(channel)) return refuse(c, 400, { code: 'unknown_channel', message: 'That is not a channel Axal lists events on.' });
  const adapter = syndicationChannel(channel);
  if (!adapter) return refuse(c, 409, { code: 'adapter_not_ready', message: 'This channel is not available yet: it waits for the platform’s approval.' });
  const live = await c.env.DB.prepare("SELECT uid FROM event_channel_accounts WHERE channel = ? AND owner_kind = 'hq' AND status != 'disconnected'").bind(channel).first();
  if (live) return refuse(c, 409, { code: 'already_connected', message: 'HQ already has an account on this channel. Disconnect it first.' });
  const body: any = await c.req.json().catch(() => ({}));

  if (adapter.auth === 'oauth') {
    if (!adapter.authorizeUrl) return refuse(c, 409, { code: 'adapter_not_ready', message: 'This channel is not available yet.' });
    const nonce = crypto.randomUUID();
    const state = `${nonce}.${await hmac(c.env, `${channel}:${nonce}:${u.id}`)}`;
    await c.env.RATE_LIMITS.put(stateKey(nonce), JSON.stringify({ user_id: u.id, channel }), { expirationTtl: 600 });
    return c.json({ authorize_url: adapter.authorizeUrl(c.env, state, redirectUriFor(c.env, channel)) });
  }

  const apiKey = typeof body?.api_key === 'string' ? body.api_key.trim() : '';
  if (!apiKey || apiKey.length > 500 || !adapter.verifyKey) return refuse(c, 400, { code: 'api_key_required', message: 'Paste the channel’s API key.' });
  let who;
  try { who = await adapter.verifyKey(c.env, apiKey); }
  catch (failure) {
    const sentence = platformSentence(failure, apiKey);
    await logSyndication(c.env, { channel, action: 'connect', outcome: 'failed', detail: sentence, actor_user_id: u.id });
    // The platform's sentence, key removed, reaches the Super Admin on `upstream`.
    return refuse(c, 502, { code: 'channel_refused', message: 'The channel refused the key. Nothing was saved.', raw: sentence, audience: 'admin' });
  }
  const account = await insertAccount(c.env, channel, who, { api_key: apiKey }, [], u.id);
  return c.json({ account }, 201);
});

/** A channel's refusal as a sentence we store: only a ChannelError's own text, the secret removed, ≤500 characters. */
function platformSentence(failure: unknown, secret: string | null): string {
  const text = failure instanceof ChannelError ? failure.message : 'The channel refused.';
  return (secret ? text.split(secret).join('[redacted]') : text).slice(0, 500);
}

async function insertAccount(env: Env, channel: string, who: { external_account_id: string; display_name: string; expires_at?: string | null },
  credentials: Record<string, unknown>, scopes: string[], actor: number) {
  const uid = crypto.randomUUID();
  const enc = await encryptChannelCredentials(env, uid, credentials);
  const row = await env.DB.prepare(
    `INSERT INTO event_channel_accounts (uid, channel, owner_kind, owner_user_id, external_account_id, display_name, credentials_enc, scopes_json, status, expires_at, connected_by)
     VALUES (?, ?, 'hq', NULL, ?, ?, ?, ?, 'active', ?, ?) RETURNING id`,
  ).bind(uid, channel, String(who.external_account_id).slice(0, 200), String(who.display_name).slice(0, 200), enc, JSON.stringify(scopes),
    who.expires_at ?? null, actor).first<{ id: number }>();
  await logSyndication(env, { account_id: row?.id ?? null, channel, action: 'connect', outcome: 'ok', actor_user_id: actor });
  return accountOut(await accountByUid(env, uid));
}

adminEventSyndication.get('/oauth/:channel/callback', async (c) => {
  const channel = c.req.param('channel');
  const bad = () => refuse(c, 400, { code: 'bad_state', message: 'This sign-in link has expired or was already used. Connect the channel again.' });
  const [nonce, sig] = String(c.req.query('state') || '').split('.');
  if (!nonce || !sig || !isChannelKey(channel)) return bad();
  const raw = await c.env.RATE_LIMITS.get(stateKey(nonce)).catch(() => null);
  if (!raw) return bad();
  await c.env.RATE_LIMITS.delete(stateKey(nonce)).catch(() => {});
  let saved: { user_id: number; channel: string };
  try { saved = JSON.parse(raw); } catch { return bad(); }
  if (saved.channel !== channel || sig !== await hmac(c.env, `${channel}:${nonce}:${saved.user_id}`)) return bad();
  const adapter = syndicationChannel(channel);
  const code = c.req.query('code');
  if (!adapter?.exchangeCode || !code) return bad();
  try {
    const got = await adapter.exchangeCode(c.env, code, redirectUriFor(c.env, channel));
    const live = await c.env.DB.prepare("SELECT uid FROM event_channel_accounts WHERE channel = ? AND owner_kind = 'hq' AND status != 'disconnected'").bind(channel).first();
    if (!live) await insertAccount(c.env, channel, got, got.credentials, got.scopes ?? [], Number(saved.user_id));
    return c.redirect(`${PAGE}?connected=${channel}`, 302);
  } catch (failure) {
    await logSyndication(c.env, { channel, action: 'connect', outcome: 'failed', detail: platformSentence(failure, code), actor_user_id: Number(saved.user_id) });
    return c.redirect(`${PAGE}?failed=${channel}`, 302);
  }
});

adminEventSyndication.patch('/channels/:uid', async (c) => {
  const u = await gate(c, requireSuperAdminWriteBar);
  if (u instanceof Response) return u;
  const body: any = await c.req.json().catch(() => ({}));
  if (typeof body?.default_on !== 'boolean') return refuse(c, 400, { code: 'invalid_default_on', message: 'Send default_on as true or false.' });
  const moved = await c.env.DB.prepare(
    "UPDATE event_channel_accounts SET default_on = ?, updated_at = datetime('now') WHERE uid = ? AND owner_kind = 'hq' AND status != 'disconnected' RETURNING uid",
  ).bind(body.default_on ? 1 : 0, c.req.param('uid')).first();
  if (!moved) return refuse(c, 404, { code: 'not_found', message: 'This channel account could not be found.' });
  return c.json({ account: accountOut(await accountByUid(c.env, c.req.param('uid'))) });
});

adminEventSyndication.post('/channels/:uid/disconnect', async (c) => {
  const u = await gate(c, requireSuperAdminWriteBar);
  if (u instanceof Response) return u;
  const gone = await c.env.DB.prepare(
    `UPDATE event_channel_accounts SET status = 'disconnected', credentials_enc = NULL, default_on = 0, updated_at = datetime('now')
      WHERE uid = ? AND owner_kind = 'hq' AND status != 'disconnected' RETURNING id, channel`,
  ).bind(c.req.param('uid')).first<{ id: number; channel: string }>();
  if (!gone) return refuse(c, 404, { code: 'not_found', message: 'This channel account could not be found.' });
  // Listings not yet posted cannot post any more; posted ones stay up on the channel.
  await c.env.DB.prepare(
    "UPDATE event_syndications SET status = 'skipped', skip_reason = 'Account expired', updated_at = datetime('now') WHERE account_id = ? AND status IN ('selected', 'pending')",
  ).bind(gone.id).run();
  await logSyndication(c.env, { account_id: gone.id, channel: gone.channel, action: 'disconnect', outcome: 'ok', actor_user_id: u.id });
  return c.json({ account: accountOut(await accountByUid(c.env, c.req.param('uid'))) });
});

adminEventSyndication.get('/settings', async (c) => {
  const u = await gate(c, requireHqAdmin);
  if (u instanceof Response) return u;
  return c.json({ settings: await readSettings(c.env) });
});

adminEventSyndication.put('/settings', async (c) => {
  const u = await gate(c, requireSuperAdminWriteBar);
  if (u instanceof Response) return u;
  const body: any = await c.req.json().catch(() => null);
  const settings = parseSettings({ ...DEFAULT_SETTINGS, ...(body && typeof body === 'object' ? body : {}) });
  if (!body || typeof body !== 'object' || Array.isArray(body) || !settings) {
    return refuse(c, 400, { code: 'invalid_settings', message: 'A setting names an event type or channel Axal does not have, or a value it does not take.' });
  }
  await c.env.DB.prepare(
    `INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES (?, ?, datetime('now'), ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).bind(SETTINGS_KEY, JSON.stringify(settings), String(u.id)).run();
  return c.json({ settings });
});

const OUTCOMES = ['ok', 'failed', 'skipped'];

adminEventSyndication.get('/log', async (c) => {
  const u = await gate(c, requireHqAdmin);
  if (u instanceof Response) return u;
  const q = c.req.query();
  const eventId = q.event ? Number(q.event) : null;
  const before = q.before ? Number(q.before) : null;
  const limit = q.limit ? Number(q.limit) : 50;
  if ((eventId !== null && !(Number.isSafeInteger(eventId) && eventId > 0)) || (q.channel && !isChannelKey(q.channel))
      || (q.outcome && !OUTCOMES.includes(q.outcome)) || (before !== null && !(Number.isSafeInteger(before) && before > 0))
      || !(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100)) {
    return refuse(c, 400, { code: 'bad_filter', message: 'A filter is not one the log takes.' });
  }
  const rows = (await c.env.DB.prepare(
    `SELECT l.id, l.created_at, l.event_id, e.title AS event_title, l.channel, l.action, l.outcome, l.detail, l.http_status, au.name AS actor_name
       FROM event_syndication_log l LEFT JOIN events e ON e.id = l.event_id LEFT JOIN users au ON au.id = l.actor_user_id
      WHERE (? IS NULL OR l.event_id = ?) AND (? IS NULL OR l.channel = ?) AND (? IS NULL OR l.outcome = ?) AND (? IS NULL OR l.id < ?)
      ORDER BY l.id DESC LIMIT ?`,
  ).bind(eventId, eventId, q.channel || null, q.channel || null, q.outcome || null, q.outcome || null, before, before, limit + 1).all<any>()).results || [];
  const page = rows.slice(0, limit);
  return c.json({
    rows: page.map((r: any) => ({
      id: r.id, at: r.created_at, event: r.event_id == null ? null : { id: r.event_id, title: r.event_title ?? null },
      channel: r.channel, action: r.action, outcome: r.outcome, detail: r.detail ?? null, http_status: r.http_status ?? null,
      actor_name: r.actor_name ?? null,
    })),
    next: rows.length > limit ? page[page.length - 1].id : null,
  });
});

export default adminEventSyndication;
