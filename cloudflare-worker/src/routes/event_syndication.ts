/**
 * D1490 (#3904) — one event's syndication: which channels it is listed on,
 * and the host's or an admin's choices. Mounted at `/api/events` before
 * `events.ts`; every path is `/:id/syndication…`, so nothing of `events.ts`
 * is shadowed.
 *
 *   GET  /:id/syndication                 the rows, one per account it may use
 *   PUT  /:id/syndication                 { channels: [{ account_uid, on, overrides? }] }
 *   POST /:id/syndication/preview         { account_uid }: what would be sent; sends nothing
 *   POST /:id/syndication/:uid/retry      a failed listing, again
 *   POST /:id/syndication/:uid/withdraw   a posted listing, removed
 *
 * The gate is `canManage` (the host or an admin). Anyone else, and an event
 * that does not exist, gets the same 404, never 403, so ids don't leak.
 * Registrations per channel are not imported until Part D: `registrations`
 * is null with a sentence, never 0.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { canManage } from './events';
import { DEFAULT_TEXT_LIMIT, DEFAULT_TITLE_LIMIT, syndicationChannel } from '../services/eventSyndication/channels';
import { eligibility, eventEligibility, readSettings, type SyndicationSettings } from '../services/eventSyndication/eligibility';
import { contentHash, listingEvent, listingLink } from '../services/eventSyndication/content';
import { enqueueSyndication } from '../services/eventSyndication/hooks';
import { logSyndication } from '../services/eventSyndication/jobs';

const eventSyndication = new Hono<{ Bindings: Env }>();

export const REGISTRATIONS_NOT_RECORDED = 'Not recorded: this channel’s registrations are not imported';
const ON_STATES = ['selected', 'pending', 'posted', 'failed', 'skipped'];

const NOT_FOUND = { code: 'not_found', message: 'This event could not be found.' };

type Account = { id: number; uid: string; channel: string; owner_kind: string; owner_user_id: number | null; display_name: string; status: string; default_on: number };

/** The event, when the caller manages it; otherwise the 404 every caller without the right gets. */
async function managed(c: any): Promise<{ user: User; event: Record<string, any> } | Response> {
  let user: User;
  try { user = await requireAuth(c); } catch { return refuse(c, 401, { code: 'unauthorized', message: 'Sign in to manage this event.' }); }
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return refuse(c, 404, NOT_FOUND);
  const event = await c.env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
  if (!event || !canManage(event, user)) return refuse(c, 404, NOT_FOUND);
  return { user, event };
}

/** The accounts this event may choose: HQ's live ones, and the host's own while HQ allows them. */
async function accountsFor(env: Env, event: Record<string, any>, settings: SyndicationSettings): Promise<Account[]> {
  const rows = await env.DB.prepare(
    `SELECT id, uid, channel, owner_kind, owner_user_id, display_name, status, default_on FROM event_channel_accounts
      WHERE status != 'disconnected' AND (owner_kind = 'hq' OR (owner_kind = 'host' AND ? = 1 AND owner_user_id = ?))
      ORDER BY channel, id`,
  ).bind(settings.host_accounts ? 1 : 0, event.host_user_id ?? null).all<Account>();
  return rows.results || [];
}

async function hostRole(env: Env, event: Record<string, any>): Promise<string | null> {
  if (event.host_user_id == null) return null;
  return (await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(event.host_user_id).first<{ role: string }>())?.role ?? null;
}

/** The read: one row per account the event may use, and every listing it already has. */
async function readRows(env: Env, event: Record<string, any>) {
  const settings = await readSettings(env);
  const role = await hostRole(env, event);
  const accounts = await accountsFor(env, event, settings);
  const existing = (await env.DB.prepare(
    `SELECT s.*, a.uid AS account_uid, a.display_name, a.status AS account_status FROM event_syndications s
       JOIN event_channel_accounts a ON a.id = s.account_id WHERE s.event_id = ? ORDER BY s.channel, s.id`,
  ).bind(event.id).all<any>()).results || [];
  const byAccount = new Map(existing.map((r: any) => [Number(r.account_id), r]));
  const typeDefaults = new Set(settings.default_channels_by_type[String(event.type)] ?? []);
  const rows = accounts.map((a) => shape(a.channel, a.uid, a.display_name, byAccount.get(a.id) ?? null, !!a.default_on || typeDefaults.has(a.channel as any)));
  // A listing whose account was disconnected since stays visible: it is still out there.
  for (const r of existing) if (!accounts.some((a) => a.id === Number(r.account_id))) rows.push(shape(r.channel, r.account_uid, r.display_name, r, false));
  const own = eventEligibility(event as any, role, settings);
  return { eligible: own.ok, reason: own.ok ? null : own.reason, rows };
}

function shape(channel: string, accountUid: string, displayName: string, row: any | null, suggested: boolean) {
  const adapter = syndicationChannel(channel);
  return {
    uid: row?.uid ?? null,
    channel,
    account_uid: accountUid,
    display_name: displayName,
    capability: adapter?.capability ?? null,
    on: row ? ON_STATES.includes(row.status) : suggested,
    status: row?.status ?? null,
    sync_state: row?.sync_state ?? null,
    skip_reason: row?.skip_reason ?? null,
    last_error: row?.last_error ?? null,
    external_url: row?.external_url ?? null,
    posted_at: row?.posted_at ?? null,
    registrations: null,
    registrations_reason: REGISTRATIONS_NOT_RECORDED,
  };
}

/** Overrides held to the channel's limits; a ticket link must be https. Null when one is out of bounds. */
function cleanOverrides(channel: string, raw: unknown): Record<string, string> | null {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const adapter = syndicationChannel(channel);
  const titleLimit = adapter?.title_limit ?? DEFAULT_TITLE_LIMIT;
  const textLimit = adapter?.text_limit ?? DEFAULT_TEXT_LIMIT;
  const o = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of Object.keys(o)) if (!['title', 'description', 'ticket_url'].includes(k)) return null;
  if (o.title != null) { if (typeof o.title !== 'string' || o.title.length > titleLimit) return null; if (o.title.trim()) out.title = o.title.trim(); }
  if (o.description != null) { if (typeof o.description !== 'string' || o.description.length > textLimit) return null; if (o.description.trim()) out.description = o.description.trim(); }
  if (o.ticket_url != null) {
    if (typeof o.ticket_url !== 'string' || o.ticket_url.length > 2000 || !/^https:\/\/[^\s]+$/i.test(o.ticket_url)) return null;
    out.ticket_url = o.ticket_url;
  }
  return out;
}

eventSyndication.get('/:id/syndication', async (c) => {
  const m = await managed(c);
  if (m instanceof Response) return m;
  return c.json(await readRows(c.env, m.event));
});

eventSyndication.put('/:id/syndication', async (c) => {
  const m = await managed(c);
  if (m instanceof Response) return m;
  const body: any = await c.req.json().catch(() => ({}));
  if (!Array.isArray(body?.channels) || body.channels.length > 20) return refuse(c, 400, { code: 'invalid_channels', message: 'Send the channels as a list.' });
  const settings = await readSettings(c.env);
  const accounts = await accountsFor(c.env, m.event, settings);
  // Validate every entry before writing any.
  const plan: Array<{ account: Account; on: boolean; overrides: Record<string, string> }> = [];
  for (const entry of body.channels) {
    const account = accounts.find((a) => a.uid === String(entry?.account_uid ?? ''));
    if (!account) return refuse(c, 404, { code: 'account_not_found', message: 'That channel account is not one this event can use.' });
    const overrides = cleanOverrides(account.channel, entry?.overrides);
    if (!overrides) return refuse(c, 400, { code: 'invalid_overrides', message: 'A title or description is over the channel’s limit, or the ticket link is not an https address.' });
    plan.push({ account, on: !!entry?.on, overrides });
  }
  const current = (await c.env.DB.prepare('SELECT account_id, status FROM event_syndications WHERE event_id = ?').bind(m.event.id).all<any>()).results || [];
  for (const p of plan) {
    const was = current.find((r: any) => Number(r.account_id) === p.account.id);
    if (!p.on && was?.status === 'posted') return refuse(c, 409, { code: 'already_posted', message: 'This listing is posted. Withdraw it to take it down.' });
  }
  const approved = m.event.status === 'published' && Number(m.event.admin_published) === 1;
  const hash = await contentHash(m.event);
  for (const p of plan) {
    if (p.on) {
      // A channel ticked after the approval posts now: the approval it waits for has happened.
      const start = approved ? 'pending' : 'selected';
      const row = await c.env.DB.prepare(
        `INSERT INTO event_syndications (uid, event_id, account_id, channel, status, overrides_json, content_hash, selected_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (event_id, account_id) DO UPDATE SET overrides_json = excluded.overrides_json,
           status = CASE WHEN event_syndications.status IN ('withdrawn', 'cancelled', 'skipped') THEN excluded.status ELSE event_syndications.status END,
           skip_reason = CASE WHEN event_syndications.status IN ('withdrawn', 'cancelled', 'skipped') THEN NULL ELSE event_syndications.skip_reason END,
           attempts = CASE WHEN event_syndications.status IN ('withdrawn', 'cancelled', 'skipped') THEN 0 ELSE event_syndications.attempts END,
           updated_at = datetime('now')
         RETURNING uid, status`,
      ).bind(crypto.randomUUID(), m.event.id, p.account.id, p.account.channel, start, JSON.stringify(p.overrides), hash, m.user.id).first<{ uid: string; status: string }>();
      const was = current.find((r: any) => Number(r.account_id) === p.account.id);
      if (!was || !ON_STATES.includes(was.status)) {
        await logSyndication(c.env, { account_id: p.account.id, event_id: m.event.id, channel: p.account.channel, action: 'select', outcome: 'ok', actor_user_id: m.user.id });
      }
      if (row && row.status === 'pending' && (!was || was.status !== 'pending')) await enqueueSyndication(c.env, row.uid, 'post', hash);
    } else {
      const gone = await c.env.DB.prepare(
        "DELETE FROM event_syndications WHERE event_id = ? AND account_id = ? AND status != 'posted' RETURNING id",
      ).bind(m.event.id, p.account.id).first();
      if (gone) await logSyndication(c.env, { account_id: p.account.id, event_id: m.event.id, channel: p.account.channel, action: 'unselect', outcome: 'ok', actor_user_id: m.user.id });
    }
  }
  return c.json(await readRows(c.env, m.event));
});

eventSyndication.post('/:id/syndication/preview', async (c) => {
  const m = await managed(c);
  if (m instanceof Response) return m;
  const body: any = await c.req.json().catch(() => ({}));
  const settings = await readSettings(c.env);
  const account = (await accountsFor(c.env, m.event, settings)).find((a) => a.uid === String(body?.account_uid ?? ''));
  if (!account) return refuse(c, 404, { code: 'account_not_found', message: 'That channel account is not one this event can use.' });
  const adapter = syndicationChannel(account.channel);
  if (!adapter) return refuse(c, 409, { code: 'adapter_not_ready', message: 'This channel is not available yet. Nothing was sent.' });
  const row = await c.env.DB.prepare('SELECT overrides_json FROM event_syndications WHERE event_id = ? AND account_id = ?').bind(m.event.id, account.id).first<{ overrides_json: string }>();
  const overrides = cleanOverrides(account.channel, body?.overrides ?? (row ? JSON.parse(row.overrides_json || '{}') : {}));
  if (!overrides) return refuse(c, 400, { code: 'invalid_overrides', message: 'A title or description is over the channel’s limit, or the ticket link is not an https address.' });
  const view = adapter.preview({
    event: listingEvent(m.event), link: listingLink(c.env.APP_URL, String(m.event.slug), account.channel), overrides, credentials: null,
    account: { external_account_id: '', display_name: account.display_name },
  });
  return c.json({ channel: account.channel, capability: adapter.capability, ...view });
});

async function ownRow(c: any, eventId: number): Promise<any> {
  return (c.env as Env).DB.prepare(
    `SELECT s.*, a.status AS account_status, a.owner_kind, a.owner_user_id FROM event_syndications s
       JOIN event_channel_accounts a ON a.id = s.account_id WHERE s.uid = ? AND s.event_id = ?`,
  ).bind(String(c.req.param('uid') || ''), eventId).first<any>();
}

async function rowOut(env: Env, event: Record<string, any>, uid: string) {
  return (await readRows(env, event)).rows.find((r) => r.uid === uid) ?? null;
}

eventSyndication.post('/:id/syndication/:uid/retry', async (c) => {
  const m = await managed(c);
  if (m instanceof Response) return m;
  const row = await ownRow(c, m.event.id);
  if (!row) return refuse(c, 404, { code: 'not_found', message: 'This listing could not be found.' });
  const postFailed = row.status === 'failed';
  const editFailed = row.status === 'posted' && row.sync_state === 'failed';
  if (!postFailed && !editFailed) return refuse(c, 409, { code: 'not_failed', message: 'Only a failed listing can be retried.' });
  const settings = await readSettings(c.env);
  const ok = eligibility(m.event as any, { status: row.account_status, owner_kind: row.owner_kind, owner_user_id: row.owner_user_id }, await hostRole(c.env, m.event), settings);
  if (postFailed && !ok.ok) return refuse(c, 409, { code: 'not_eligible', message: ok.reason });
  const hash = await contentHash(m.event);
  const moved = postFailed
    ? await c.env.DB.prepare("UPDATE event_syndications SET status = 'pending', attempts = 0, updated_at = datetime('now') WHERE id = ? AND status = 'failed' RETURNING uid").bind(row.id).first()
    : await c.env.DB.prepare("UPDATE event_syndications SET sync_state = 'pending', attempts = 0, updated_at = datetime('now') WHERE id = ? AND status = 'posted' AND sync_state = 'failed' RETURNING uid").bind(row.id).first();
  if (!moved) return refuse(c, 409, { code: 'not_failed', message: 'Only a failed listing can be retried.' });
  await logSyndication(c.env, { syndication_id: row.id, account_id: row.account_id, event_id: m.event.id, channel: row.channel, action: 'retry', outcome: 'ok', actor_user_id: m.user.id });
  // A failed edit retries as an update; an edit failure after a cancel is not retried here.
  await enqueueSyndication(c.env, row.uid, postFailed ? 'post' : 'update', `${hash}:retry:${Date.now()}`);
  return c.json({ row: await rowOut(c.env, m.event, row.uid) });
});

eventSyndication.post('/:id/syndication/:uid/withdraw', async (c) => {
  const m = await managed(c);
  if (m instanceof Response) return m;
  const row = await ownRow(c, m.event.id);
  if (!row) return refuse(c, 404, { code: 'not_found', message: 'This listing could not be found.' });
  if (row.status !== 'posted') return refuse(c, 409, { code: 'not_posted', message: 'Only a posted listing can be withdrawn.' });
  const cancels = !!syndicationChannel(row.channel)?.cancels;
  await c.env.DB.prepare(
    "UPDATE event_syndications SET sync_state = ?, attempts = 0, updated_at = datetime('now') WHERE id = ? AND status = 'posted'",
  ).bind(cancels ? 'pending' : 'unsupported', row.id).run();
  await logSyndication(c.env, { syndication_id: row.id, account_id: row.account_id, event_id: m.event.id, channel: row.channel, action: 'withdraw', outcome: cancels ? 'ok' : 'skipped', actor_user_id: m.user.id,
    detail: cancels ? null : 'This channel cannot remove its post. Remove it on the channel by hand.' });
  if (cancels) await enqueueSyndication(c.env, row.uid, 'withdraw', `withdraw:${Date.now()}`);
  return c.json({ row: await rowOut(c.env, m.event, row.uid) });
});

export default eventSyndication;
