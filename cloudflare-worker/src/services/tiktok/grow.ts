/**
 * D5863 (#5863, part 2a of #2401) — a founder's own TikTok in Grow: the venture it serves, the sync that lands its
 * figures, the "From TikTok" part of Distribution and of Revenue and traction, and what disconnect removes.
 *
 *   Revenue and traction  FACT  the account's followers, total likes and video count, one snapshot per sync day,
 *                               shown beside revenue and never as revenue: never written to `project_metrics` or
 *                               `custom_kpi_values`, never a KPI (owner decision H).
 *   Distribution          FACT  each public video's views, likes, comments and shares, with its post date and the
 *                               first 150 characters of its title. The funnel's Visit row is not touched: a view is
 *                               not a site visit.
 *
 * ONE ACCOUNT, ONE VENTURE (decision F). The first sync links the member's connection to the venture
 * (`tiktok_account_links`). A venture another member's TikTok serves is refused (`venture_served`), and a TikTok
 * already serving another venture is refused (`serves_other_venture`). The link goes with the connection.
 *
 * EVERY LANDING GOES THROUGH `connector_fed_items` (D655), as Beehiiv's does: a re-sync updates the row its ledger
 * row links, and a row the founder deleted keeps its ledger row with no `local_id` and is never re-created.
 *
 * WHAT IS MISSING SAYS SO. A scope the member did not grant is not read, and its figures read "Not recorded" with
 * that reason; a count TikTok did not give is `null`. Never 0. Logs carry counts only: no figure, title or open_id.
 *
 * THE CHANNEL PROPOSAL (D5864, part 2b). A sync raises "Add TikTok as a channel" when the venture has no Distribution
 * channel whose `utm_source` is 'tiktok'. Accept creates that channel through the existing writer the route hands in
 * (`addChannel`); Dismiss is final. `tiktok_proposals` is unique on (project, kind, subject), so a decided proposal
 * never returns on a re-sync. There is no KPI proposal (owner decision H (a)).
 *
 * DISCONNECT (decision E): `purgeTikTokConnection` deletes the connection's facts, their ledger rows, its proposals
 * and its link.
 */
import type { Env } from '../../types';
import type { TikTokAccount, TikTokReads, TikTokVideo } from './client';
import { TikTokReadError } from './client';

export type TikTokSlug = 'distribution' | 'revenue-and-traction';
export const TIKTOK_SLUGS: readonly TikTokSlug[] = Object.freeze(['distribution', 'revenue-and-traction']);
export const CONNECT_HREF = '/account/connectors/tiktok';
export const STATS_SCOPE = 'user.info.stats';
export const VIDEO_SCOPE = 'video.list';
/** The most pages of the video list one sync reads; past them it stops "Partly synced" and keeps its cursor. */
export const VIDEO_PAGE_BUDGET = 5;
/** The most videos a module part lists. */
export const VIDEOS_SHOWN = 20;

export const SENTENCES = Object.freeze({
  not_linked: 'Not recorded: no TikTok account serves this venture yet.',
  not_synced: 'Not recorded: TikTok has not been synced for this venture yet.',
  unreadable: 'Unreadable: the TikTok figures could not be read',
  stats_scope: 'Not recorded: you did not let Axal VC read your TikTok audience counts.',
  video_scope: 'Not recorded: you did not let Axal VC read your public TikTok videos.',
  not_revenue: 'Your TikTok audience, shown beside revenue and never as revenue.',
  public_only: 'Your public TikTok videos only. A view is not a visit to your site.',
  add_channel: 'Add TikTok as a Distribution channel? Customers who arrive with utm_source=tiktok are then counted for it.',
});

/** The one proposal kind, and the UTM source the channel it proposes carries. */
export const ADD_CHANNEL = 'add_channel';
export const CHANNEL_UTM = 'tiktok';
export const CHANNEL_NAME = 'TikTok';

const fromTikTok = (asOf: string | null) => (asOf ? `From TikTok, as of ${asOf.slice(0, 10)}` : null);

// ═════════════════════════════════════════════════════════════ the link

export interface TikTokLink {
  integration_id: number; project_id: number; owner_id: number; owner_name: string | null;
  active: boolean; scopes: string[]; video_cursor: string | null;
}

function scopesOf(raw: unknown): string[] {
  try { const v = JSON.parse(String(raw ?? '[]')); return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []; } catch { return []; }
}

/** The venture's link and whose TikTok serves it, or null. */
export async function linkOf(env: Env, projectId: number): Promise<TikTokLink | null> {
  const l = await env.DB.prepare(
    `SELECT l.integration_id, l.project_id, l.video_cursor, i.user_id AS owner_id, i.status AS status, i.scopes_json AS scopes_json,
            COALESCE(u.display_name, u.name) AS owner_name
       FROM tiktok_account_links l JOIN integrations i ON i.id = l.integration_id LEFT JOIN users u ON u.id = i.user_id
      WHERE l.project_id = ?`,
  ).bind(projectId).first<Record<string, unknown>>();
  if (!l) return null;
  return {
    integration_id: Number(l.integration_id), project_id: Number(l.project_id), owner_id: Number(l.owner_id),
    owner_name: (l.owner_name as string | null) ?? null, active: l.status === 'active', scopes: scopesOf(l.scopes_json),
    video_cursor: (l.video_cursor as string | null) ?? null,
  };
}

/**
 * Link the member's connection to the venture, once. `served`: another connection serves the venture.
 * `elsewhere`: this connection already serves another venture.
 */
export async function claimVenture(env: Env, p: { integrationId: number; projectId: number; userId: number }): Promise<'ok' | 'served' | 'elsewhere'> {
  await env.DB.prepare('INSERT OR IGNORE INTO tiktok_account_links (integration_id, project_id, linked_by) VALUES (?, ?, ?)')
    .bind(p.integrationId, p.projectId, p.userId).run();
  const byVenture = await env.DB.prepare('SELECT integration_id FROM tiktok_account_links WHERE project_id = ?').bind(p.projectId).first<{ integration_id: number }>();
  if (byVenture && Number(byVenture.integration_id) !== p.integrationId) return 'served';
  if (!byVenture) return 'elsewhere';
  return 'ok';
}

// ═════════════════════════════════════════════════════════════ the ledger

type Store = 'tiktok_account_facts' | 'tiktok_video_facts';
/** Each store's fixed liveness read, so a table name never comes from data. */
const ALIVE: Record<Store, string> = {
  tiktok_account_facts: 'SELECT 1 FROM tiktok_account_facts WHERE id = ? AND project_id = ?',
  tiktok_video_facts: 'SELECT 1 FROM tiktok_video_facts WHERE id = ? AND project_id = ?',
};
const LEDGER_LINK = `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(integration_id, external_id) DO UPDATE SET project_id = excluded.project_id, local_table = excluded.local_table,
       local_id = excluded.local_id, last_seen_at = CURRENT_TIMESTAMP`;
const LEDGER_TOUCH = 'UPDATE connector_fed_items SET last_seen_at = CURRENT_TIMESTAMP WHERE project_id = ? AND external_id = ?';

const accountExternal = (projectId: number, date: string) => `tiktok:acct:${projectId}:${date}`;
const videoExternal = (projectId: number, videoId: string) => `tiktok:video:${projectId}:${videoId}`;

/** The ledger's word on one external item for this venture: `deleted`, `linked` with its row, or `new`. */
async function ledgerState(env: Env, store: Store, projectId: number, externalId: string):
  Promise<{ state: 'new' } | { state: 'deleted' } | { state: 'linked'; id: number }> {
  const rows = (await env.DB.prepare(
    'SELECT local_table, local_id FROM connector_fed_items WHERE project_id = ? AND external_id = ? ORDER BY id',
  ).bind(projectId, externalId).all<{ local_table: string | null; local_id: number | null }>()).results || [];
  if (!rows.length) return { state: 'new' };
  if (rows.some((r) => r.local_id == null || r.local_table !== store)) return { state: 'deleted' };
  const id = Number(rows[rows.length - 1].local_id);
  if (await env.DB.prepare(ALIVE[store]).bind(id, projectId).first()) return { state: 'linked', id };
  await env.DB.prepare('UPDATE connector_fed_items SET local_id = NULL WHERE project_id = ? AND external_id = ?').bind(projectId, externalId).run();
  return { state: 'deleted' };
}

// ═════════════════════════════════════════════════════════════ the sync

export interface TikTokCounts {
  /** 1 when today's account snapshot was written or updated. */
  snapshots: number;
  videos: number;
  /** Rows the founder deleted, left deleted. */
  kept_deleted: number;
  /** Scopes the member did not grant, so their figures were not read. */
  scopes_missing: string[];
  /** Something was not read (a failed read, or the page budget): the rest still landed. */
  partial: boolean;
  /** 'Partly synced' when the video list stopped at its budget or a read failed. */
  outcome: 'Synced' | 'Partly synced';
  /** 1 when this sync raised "Add TikTok as a channel"; 0 when a channel exists or it was raised or decided before. */
  proposals: number;
}

interface SyncCtx { integrationId: number; projectId: number; today: string; scopes: string[]; cursor: string | null }

async function landAccount(env: Env, x: SyncCtx, a: TikTokAccount, counts: TikTokCounts): Promise<void> {
  if (a.followers == null && a.following == null && a.likes_total == null && a.video_count == null) return;
  const externalId = accountExternal(x.projectId, x.today);
  const known = await ledgerState(env, 'tiktok_account_facts', x.projectId, externalId);
  if (known.state === 'deleted') { await env.DB.prepare(LEDGER_TOUCH).bind(x.projectId, externalId).run(); counts.kept_deleted += 1; return; }
  const vals = [a.followers, a.following, a.likes_total, a.video_count, x.today];
  let id: number;
  if (known.state === 'linked') {
    await env.DB.prepare(`UPDATE tiktok_account_facts SET followers = ?, following = ?, likes_total = ?, video_count = ?, as_of = ?, integration_id = ?,
      updated_at = datetime('now') WHERE id = ? AND project_id = ?`).bind(...vals, x.integrationId, known.id, x.projectId).run();
    id = known.id;
  } else {
    const row = await env.DB.prepare(
      `INSERT INTO tiktok_account_facts (followers, following, likes_total, video_count, as_of, integration_id, project_id, snapshot_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, snapshot_date) DO UPDATE SET followers = excluded.followers, following = excluded.following,
         likes_total = excluded.likes_total, video_count = excluded.video_count, as_of = excluded.as_of,
         integration_id = excluded.integration_id, updated_at = datetime('now')
       RETURNING id`,
    ).bind(...vals, x.integrationId, x.projectId, x.today).first<{ id: number }>();
    id = Number(row!.id);
  }
  await env.DB.prepare(LEDGER_LINK).bind(x.integrationId, x.projectId, 'revenue_and_traction', 'tiktok_account_snapshot', externalId, 'tiktok_account_facts', id).run();
  counts.snapshots += 1;
}

async function landVideo(env: Env, x: SyncCtx, v: TikTokVideo, counts: TikTokCounts): Promise<void> {
  const externalId = videoExternal(x.projectId, v.id);
  const known = await ledgerState(env, 'tiktok_video_facts', x.projectId, externalId);
  if (known.state === 'deleted') { await env.DB.prepare(LEDGER_TOUCH).bind(x.projectId, externalId).run(); counts.kept_deleted += 1; return; }
  const vals = [v.posted_on, v.title, v.duration_s, v.views, v.likes, v.comments, v.shares, x.today];
  let id: number;
  if (known.state === 'linked') {
    await env.DB.prepare(`UPDATE tiktok_video_facts SET posted_on = ?, title = ?, duration_s = ?, views = ?, likes = ?, comments = ?, shares = ?, as_of = ?,
      integration_id = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?`).bind(...vals, x.integrationId, known.id, x.projectId).run();
    id = known.id;
  } else {
    const row = await env.DB.prepare(
      `INSERT INTO tiktok_video_facts (posted_on, title, duration_s, views, likes, comments, shares, as_of, integration_id, project_id, video_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, video_id) DO UPDATE SET posted_on = excluded.posted_on, title = excluded.title, duration_s = excluded.duration_s,
         views = excluded.views, likes = excluded.likes, comments = excluded.comments, shares = excluded.shares, as_of = excluded.as_of,
         integration_id = excluded.integration_id, updated_at = datetime('now')
       RETURNING id`,
    ).bind(...vals, x.integrationId, x.projectId, v.id).first<{ id: number }>();
    id = Number(row!.id);
  }
  await env.DB.prepare(LEDGER_LINK).bind(x.integrationId, x.projectId, 'distribution', 'tiktok_video', externalId, 'tiktok_video_facts', id).run();
  counts.videos += 1;
}

/**
 * One founder-pressed sync: today's account snapshot, then the video list from where the last sync stopped, at most
 * `VIDEO_PAGE_BUDGET` pages. Past the budget, or on a rate limit, it stops "Partly synced" and keeps the cursor; it
 * clears the cursor when it reads to the end. One failed read leaves the other's landing intact; both failing (with
 * nothing landed) throws the first failure.
 */
export async function syncTikTok(env: Env, reads: TikTokReads, x: SyncCtx): Promise<TikTokCounts> {
  const counts: TikTokCounts = { snapshots: 0, videos: 0, kept_deleted: 0, scopes_missing: [], partial: false, outcome: 'Synced', proposals: 0 };
  let first: unknown = null;
  let accountRead = false, videosRead = false;
  if (x.scopes.includes(STATS_SCOPE)) {
    try { await landAccount(env, x, await reads.account(), counts); accountRead = true; } catch (e) { if (!(e instanceof TikTokReadError)) throw e; first = e; counts.partial = true; }
  } else counts.scopes_missing.push(STATS_SCOPE);

  if (x.scopes.includes(VIDEO_SCOPE)) {
    let cursor = x.cursor;
    let pages = 0;
    let done = false;
    while (pages < VIDEO_PAGE_BUDGET) {
      let page;
      try { page = await reads.videos(cursor); } catch (e) {
        if (!(e instanceof TikTokReadError)) throw e;
        first ??= e; counts.partial = true; break;
      }
      pages += 1; videosRead = true;
      for (const v of page.videos) await landVideo(env, x, v, counts);
      if (!page.has_more || !page.cursor) { done = true; cursor = null; break; }
      cursor = page.cursor;
    }
    if (!done && !counts.partial) counts.partial = true;
    await env.DB.prepare("UPDATE tiktok_account_links SET video_cursor = ?, updated_at = datetime('now') WHERE project_id = ? AND integration_id = ?")
      .bind(done ? null : cursor, x.projectId, x.integrationId).run();
  } else counts.scopes_missing.push(VIDEO_SCOPE);

  if (first && !accountRead && !videosRead) throw first;
  counts.proposals = await raiseChannelProposal(env, x.integrationId, x.projectId);
  counts.outcome = counts.partial ? 'Partly synced' : 'Synced';
  return counts;
}

// ═════════════════════════════════════════════════════════════ the channel proposal

/** The venture's channel with utm_source 'tiktok', or null. `growth_channels` holds UTM sources lowercased. */
async function tiktokChannel(env: Env, projectId: number) {
  return env.DB.prepare('SELECT id, uid, name FROM growth_channels WHERE project_id = ? AND utm_source = ?')
    .bind(projectId, CHANNEL_UTM).first<{ id: number; uid: string; name: string }>();
}

/**
 * Raise "Add TikTok as a channel" once, only while the venture has no TikTok channel. A proposal already there, in any
 * state, is left as it is: the unique key makes a dismissed one final. Returns 1 when one was raised.
 */
export async function raiseChannelProposal(env: Env, integrationId: number, projectId: number): Promise<number> {
  const r = await env.DB.prepare(
    `INSERT INTO tiktok_proposals (integration_id, project_id, kind, subject)
       SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM growth_channels WHERE project_id = ? AND utm_source = ?)
     ON CONFLICT(project_id, kind, subject) DO NOTHING`,
  ).bind(integrationId, projectId, ADD_CHANNEL, CHANNEL_UTM, projectId, CHANNEL_UTM).run();
  return Number(r.meta?.changes ?? 0);
}

/**
 * The proposal as Distribution shows it. Pending and no TikTok channel yet: the question, with whether this viewer may
 * decide it. Accepted: the channel it created. Dismissed, none, or a TikTok channel the founder added another way: null.
 */
async function proposalOf(env: Env, projectId: number, canDecide: boolean) {
  const p = await env.DB.prepare('SELECT id, state, growth_channel_id FROM tiktok_proposals WHERE project_id = ? AND kind = ? AND subject = ?')
    .bind(projectId, ADD_CHANNEL, CHANNEL_UTM).first<{ id: number; state: string; growth_channel_id: number | null }>();
  if (!p || p.state === 'dismissed') return null;
  const ch = await tiktokChannel(env, projectId);
  if (p.state === 'pending') {
    if (ch) return null;
    return { id: Number(p.id), kind: ADD_CHANNEL, state: 'pending' as const, can_decide: canDecide, sentence: SENTENCES.add_channel, channel: null };
  }
  return { id: Number(p.id), kind: ADD_CHANNEL, state: 'accepted' as const, can_decide: false, sentence: null,
    channel: ch && p.growth_channel_id === Number(ch.id) ? { uid: ch.uid, name: ch.name } : null };
}

export type DecideOutcome = 'ok' | 'not_found' | 'decided' | 'channel_exists';

async function pendingProposal(env: Env, projectId: number, id: number): Promise<DecideOutcome> {
  const p = await env.DB.prepare('SELECT state FROM tiktok_proposals WHERE id = ? AND project_id = ?').bind(id, projectId).first<{ state: string }>();
  if (!p) return 'not_found';
  return p.state === 'pending' ? 'ok' : 'decided';
}

/**
 * Accept: `create` (the route's call to the existing channel writer) makes the one TikTok channel, then the proposal
 * records it. A TikTok channel already on the venture is `channel_exists` and nothing is created: `growth_channels` is
 * unique on (project, utm_source), so two Accepts at once still leave exactly one row.
 */
export async function acceptTikTokProposal(env: Env, projectId: number, id: number, userId: number,
  create: () => Promise<string>): Promise<DecideOutcome> {
  const state = await pendingProposal(env, projectId, id);
  if (state !== 'ok') return state;
  if (await tiktokChannel(env, projectId)) return 'channel_exists';
  const uid = await create();
  const ch = await env.DB.prepare('SELECT id FROM growth_channels WHERE uid = ? AND project_id = ?').bind(uid, projectId).first<{ id: number }>();
  const r = await env.DB.prepare(
    `UPDATE tiktok_proposals SET state = 'accepted', growth_channel_id = ?, decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND project_id = ? AND state = 'pending'`,
  ).bind(ch ? ch.id : null, userId, id, projectId).run();
  return Number(r.meta?.changes ?? 0) ? 'ok' : 'decided';
}

/** Dismiss: final. The row stays, so no later sync raises it again. */
export async function dismissTikTokProposal(env: Env, projectId: number, id: number, userId: number): Promise<DecideOutcome> {
  const r = await env.DB.prepare(
    `UPDATE tiktok_proposals SET state = 'dismissed', decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND project_id = ? AND state = 'pending'`,
  ).bind(userId, id, projectId).run();
  if (Number(r.meta?.changes ?? 0)) return 'ok';
  return (await pendingProposal(env, projectId, id)) === 'not_found' ? 'not_found' : 'decided';
}

// ═════════════════════════════════════════════════════════════ the reads

interface Snapshot { id: number; snapshot_date: string; followers: number | null; following: number | null; likes_total: number | null; video_count: number | null; as_of: string }

const ACCOUNT_FIGURES = Object.freeze([
  ['followers', 'followers'], ['likes_total', 'total likes'], ['video_count', 'videos'],
] as const);

function accountFigures(rows: Snapshot[], scoped: boolean) {
  const [latest, before] = rows;
  return ACCOUNT_FIGURES.map(([key, label]) => {
    const v = latest ? latest[key] : null;
    if (v == null) {
      return { key, label, count: null, period: latest?.snapshot_date ?? null, change: null, reason: scoped ? `Not recorded: TikTok has given no ${label} yet` : SENTENCES.stats_scope };
    }
    const prior = before ? before[key] : null;
    return { key, label, count: v, period: latest.snapshot_date, change: prior == null ? null : { since: before.snapshot_date, delta: v - prior }, reason: null };
  });
}

const videoReason = (scoped: boolean) => (scoped ? 'Not recorded: TikTok gave no figure for this video' : SENTENCES.video_scope);

export interface PartViewer { userId: number; support: boolean; writer: boolean; /** The venture's founder, who alone decides a proposal (D5864). */ founder: boolean }

/**
 * A module's "From TikTok" part for one viewer. No link and nothing landed: how to connect. A link and nothing
 * landed: not synced yet. Facts landed: each figure with "From TikTok, as of <date>", or its reason.
 */
export async function tiktokPart(env: Env, projectId: number, slug: TikTokSlug, viewer: PartViewer) {
  const link = await linkOf(env, projectId);
  const statsScoped = !link || link.scopes.includes(STATS_SCOPE);
  const videoScoped = !link || link.scopes.includes(VIDEO_SCOPE);
  const common = {
    link: link ? { served_by: { name: link.owner_name }, connected: link.active, partly_synced: link.video_cursor !== null } : null,
    can_sync: (!link || link.owner_id === viewer.userId) && !viewer.support && viewer.writer,
    can_delete: viewer.writer && !viewer.support,
    note: slug === 'revenue-and-traction' ? SENTENCES.not_revenue : SENTENCES.public_only,
  };
  if (slug === 'revenue-and-traction') {
    const rows = (await env.DB.prepare(
      `SELECT id, snapshot_date, followers, following, likes_total, video_count, as_of FROM tiktok_account_facts
        WHERE project_id = ? ORDER BY snapshot_date DESC LIMIT 2`,
    ).bind(projectId).all<Snapshot>()).results || [];
    if (!rows.length) return empty(link, common, statsScoped ? null : SENTENCES.stats_scope);
    return { state: 'ok' as const, ...common, as_of: rows[0].as_of, source: fromTikTok(rows[0].as_of), snapshot_id: rows[0].id, figures: accountFigures(rows, statsScoped) };
  }
  const videos = ((await env.DB.prepare(
    `SELECT id, video_id, posted_on, title, duration_s, views, likes, comments, shares, as_of FROM tiktok_video_facts
      WHERE project_id = ? ORDER BY posted_on IS NULL, posted_on DESC, id DESC LIMIT ?`,
  ).bind(projectId, VIDEOS_SHOWN).all<Record<string, unknown>>()).results || []).map((r): Record<string, unknown> & { as_of: string } => ({
    ...r, as_of: String(r.as_of), source: fromTikTok(String(r.as_of)),
    reasons: Object.fromEntries((['views', 'likes', 'comments', 'shares'] as const).filter((k) => r[k] == null).map((k) => [k, videoReason(videoScoped)])),
  }));
  // D5864: Distribution carries the channel proposal whether or not any video has landed.
  const proposal = await proposalOf(env, projectId, viewer.founder && viewer.writer && !viewer.support);
  if (!videos.length) return { ...empty(link, common, videoScoped ? null : SENTENCES.video_scope), proposal };
  const asOf = videos.map((v) => v.as_of).sort().at(-1) ?? null;
  return { state: 'ok' as const, ...common, as_of: asOf, source: fromTikTok(asOf), videos, proposal };
}

function empty(link: TikTokLink | null, common: Record<string, unknown>, scopeReason: string | null) {
  if (!link) return { state: 'not_linked' as const, reason: SENTENCES.not_linked, connect_href: CONNECT_HREF, ...common };
  return { state: 'not_recorded' as const, reason: scopeReason ?? SENTENCES.not_synced, ...common };
}

// ═════════════════════════════════════════════════════════════ delete and disconnect

/** Delete a snapshot or a video's figures; the ledger keeps it deleted through every later sync. Its slug, or null. */
export async function deleteTikTokRow(env: Env, kind: 'account' | 'video', projectId: number, id: number): Promise<TikTokSlug | null> {
  const store: Store = kind === 'account' ? 'tiktok_account_facts' : 'tiktok_video_facts';
  const gone = kind === 'account'
    ? await env.DB.prepare('DELETE FROM tiktok_account_facts WHERE id = ? AND project_id = ? RETURNING id').bind(id, projectId).first()
    : await env.DB.prepare('DELETE FROM tiktok_video_facts WHERE id = ? AND project_id = ? RETURNING id').bind(id, projectId).first();
  if (!gone) return null;
  await env.DB.prepare('UPDATE connector_fed_items SET local_id = NULL WHERE project_id = ? AND local_table = ? AND local_id = ?').bind(projectId, store, id).run();
  return kind === 'account' ? 'revenue-and-traction' : 'distribution';
}

/**
 * Decision E: a disconnect removes the connection's TikTok facts, their ledger rows, its proposals (D5864) and its
 * venture link. The same
 * statements, by an open_id and a cutoff, are `purgeByOpenIdStatements`, which the deauthorization webhook batches
 * with its own deletes.
 */
export function purgeStatements(env: Env, integrationId: number) {
  return [
    env.DB.prepare("DELETE FROM connector_fed_items WHERE integration_id = ? AND kind IN ('tiktok_account_snapshot', 'tiktok_video')").bind(integrationId),
    env.DB.prepare('DELETE FROM tiktok_account_facts WHERE integration_id = ?').bind(integrationId),
    env.DB.prepare('DELETE FROM tiktok_video_facts WHERE integration_id = ?').bind(integrationId),
    env.DB.prepare('DELETE FROM tiktok_proposals WHERE integration_id = ?').bind(integrationId),
    env.DB.prepare('DELETE FROM tiktok_account_links WHERE integration_id = ?').bind(integrationId),
  ];
}

export async function purgeTikTokConnection(env: Env, integrationId: number): Promise<void> {
  await env.DB.batch(purgeStatements(env, integrationId));
}

/**
 * The purge for every TikTok connection of an open_id last changed at or before `cutoff` (unix seconds). The same
 * subquery is written out in each statement, as the webhook's own deletes are: no interpolation in the query text.
 */
export function purgeByOpenIdStatements(env: Env, openId: string, cutoff: number) {
  return [
    env.DB.prepare(`DELETE FROM connector_fed_items WHERE kind IN ('tiktok_account_snapshot', 'tiktok_video') AND integration_id IN (SELECT id FROM integrations
                     WHERE provider_key = 'tiktok' AND external_account_id = ? AND unixepoch(updated_at) <= ?)`).bind(openId, cutoff),
    env.DB.prepare(`DELETE FROM tiktok_account_facts WHERE integration_id IN (SELECT id FROM integrations
                     WHERE provider_key = 'tiktok' AND external_account_id = ? AND unixepoch(updated_at) <= ?)`).bind(openId, cutoff),
    env.DB.prepare(`DELETE FROM tiktok_video_facts WHERE integration_id IN (SELECT id FROM integrations
                     WHERE provider_key = 'tiktok' AND external_account_id = ? AND unixepoch(updated_at) <= ?)`).bind(openId, cutoff),
    env.DB.prepare(`DELETE FROM tiktok_proposals WHERE integration_id IN (SELECT id FROM integrations
                     WHERE provider_key = 'tiktok' AND external_account_id = ? AND unixepoch(updated_at) <= ?)`).bind(openId, cutoff),
    env.DB.prepare(`DELETE FROM tiktok_account_links WHERE integration_id IN (SELECT id FROM integrations
                     WHERE provider_key = 'tiktok' AND external_account_id = ? AND unixepoch(updated_at) <= ?)`).bind(openId, cutoff),
  ];
}
