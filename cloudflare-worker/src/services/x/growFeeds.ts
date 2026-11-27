/**
 * D8815 (#8815, part 3a of #2403) — a founder's own X in Grow: the venture it serves, the on-demand sync that lands
 * its figures, the "From X" part of Distribution and of Revenue and traction, delete, and what disconnect removes.
 *
 *   Revenue and traction  FACT  the account's followers (one snapshot per sync day; the month's last is its month-end
 *                               figure) and the founder's posts' monthly impressions and engagement, shown beside
 *                               revenue and never as revenue: never `project_metrics`, never `custom_kpi_values`.
 *   Distribution          FACT  the follower count, per month the founder's posts, impressions and engagement, and
 *                               each post's own figures (the newest 20).
 *
 * Engagement is computed: likes + reposts + replies + quotes + bookmarks, and says so. A post missing any of the five
 * has no engagement figure; a month's total leaves out a post X gave no figure for and says how many.
 *
 * ONE ACCOUNT, ONE VENTURE (TikTok's rule, D5863). The first sync links the member's connection to the venture
 * (`x_grow_links`); a venture another member's X serves is `venture_served`, an X already serving another venture is
 * `serves_other_venture`.
 *
 * EVERY LANDING GOES THROUGH `connector_fed_items` (D655): a re-sync updates the row its ledger row links, and a row
 * the founder deleted keeps its ledger row with no `local_id` and is never re-created.
 *
 * TEAM ONLY (#2403's table): only the venture's team (`isTeamViewer`) sees these figures; anyone else who reads the
 * venture gets `team_only` and the sentence.
 *
 * WHAT IS MISSING SAYS SO. A count X did not give is `null` with its reason. Never 0. Logs carry counts only: no
 * figure, handle or post id.
 *
 * DISCONNECT: `purgeXConnection` deletes the connection's facts, their ledger rows and its link. The founder's monthly
 * read budget (`budget.ts`) stays.
 */
import type { Env } from '../../types';
import { XError } from '../xClient';
import type { XAudience, XPostFacts, XReads } from './reads';

export type XSlug = 'distribution' | 'revenue-and-traction';
export const X_SLUGS: readonly XSlug[] = Object.freeze(['distribution', 'revenue-and-traction']);
export const CONNECT_HREF = '/account/connectors/x';
/** The most pages of the founder's posts one sync reads, newest first: 2 × 100 = the newest 200 (#2403's sync budget). */
export const POST_PAGE_BUDGET = 2;
/** The most posts Distribution lists, and the most months either module shows. */
export const POSTS_SHOWN = 20;
export const MONTHS_SHOWN = 6;

export const SENTENCES = Object.freeze({
  not_linked: 'Not recorded: no X account serves this venture yet.',
  not_synced: 'Not recorded: X has not been synced for this venture yet.',
  unreadable: 'Unreadable: the X figures could not be read',
  team_only: 'From the founder’s X: only the venture’s team sees these figures.',
  not_revenue: 'Your X audience, shown beside revenue and never as revenue.',
  own_posts: 'Your own posts on X, reposts left out. An impression is not a visit to your site.',
  engagement: 'Computed: likes + reposts + replies + quotes + bookmarks.',
  no_followers: 'Not recorded: X gave no follower count',
  no_month_followers: 'Not recorded: no X snapshot this month',
  no_posts: 'Not recorded: no post of yours this month has landed',
});

const fromX = (asOf: string | null) => (asOf ? `From X, as of ${asOf.slice(0, 10)}` : null);

// ═════════════════════════════════════════════════════════════ the link

export interface XLink { integration_id: number; project_id: number; owner_id: number; owner_name: string | null; active: boolean; partly_synced: boolean }

/** The venture's link and whose X serves it, or null. */
export async function linkOf(env: Env, projectId: number): Promise<XLink | null> {
  const l = await env.DB.prepare(
    `SELECT l.integration_id, l.project_id, l.partly_synced, i.user_id AS owner_id, i.status AS status, u.name AS owner_name
       FROM x_grow_links l JOIN integrations i ON i.id = l.integration_id LEFT JOIN users u ON u.id = i.user_id
      WHERE l.project_id = ?`,
  ).bind(projectId).first<Record<string, unknown>>();
  if (!l) return null;
  return {
    integration_id: Number(l.integration_id), project_id: Number(l.project_id), owner_id: Number(l.owner_id),
    owner_name: (l.owner_name as string | null) ?? null, active: l.status === 'active', partly_synced: Number(l.partly_synced) === 1,
  };
}

/** Link the member's connection to the venture, once. `served`: another connection serves it. `elsewhere`: this one serves another. */
export async function claimVenture(env: Env, p: { integrationId: number; projectId: number; userId: number }): Promise<'ok' | 'served' | 'elsewhere'> {
  await env.DB.prepare('INSERT OR IGNORE INTO x_grow_links (integration_id, project_id, linked_by) VALUES (?, ?, ?)')
    .bind(p.integrationId, p.projectId, p.userId).run();
  const byVenture = await env.DB.prepare('SELECT integration_id FROM x_grow_links WHERE project_id = ?').bind(p.projectId).first<{ integration_id: number }>();
  if (!byVenture) return 'elsewhere';
  return Number(byVenture.integration_id) === p.integrationId ? 'ok' : 'served';
}

// ═════════════════════════════════════════════════════════════ the ledger

type Store = 'x_grow_audience_facts' | 'x_grow_post_facts';
/** Each store's fixed liveness read, so a table name never comes from data. */
const ALIVE: Record<Store, string> = {
  x_grow_audience_facts: 'SELECT 1 FROM x_grow_audience_facts WHERE id = ? AND project_id = ?',
  x_grow_post_facts: 'SELECT 1 FROM x_grow_post_facts WHERE id = ? AND project_id = ?',
};
const LEDGER_LINK = `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(integration_id, external_id) DO UPDATE SET project_id = excluded.project_id, local_table = excluded.local_table,
       local_id = excluded.local_id, last_seen_at = CURRENT_TIMESTAMP`;
const LEDGER_TOUCH = 'UPDATE connector_fed_items SET last_seen_at = CURRENT_TIMESTAMP WHERE project_id = ? AND external_id = ?';
export const LEDGER_KINDS = Object.freeze(['x_audience_snapshot', 'x_post'] as const);

const audienceExternal = (projectId: number, date: string) => `x:acct:${projectId}:${date}`;
const postExternal = (projectId: number, postId: string) => `x:post:${projectId}:${postId}`;

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

export interface XCounts {
  /** 1 when today's audience snapshot was written or updated. */
  snapshots: number;
  posts: number;
  /** Rows the founder deleted, left deleted. */
  kept_deleted: number;
  /** Something was not read (a failed read, or the monthly budget): the rest still landed. */
  partial: boolean;
  outcome: 'Synced' | 'Partly synced';
  /** The founder's monthly X budget stopped this sync before it read everything. */
  capped: boolean;
}

interface SyncCtx { integrationId: number; projectId: number; today: string }

async function landAudience(env: Env, x: SyncCtx, a: XAudience, counts: XCounts): Promise<void> {
  if (a.followers == null && a.following == null && a.post_count == null) return;
  const externalId = audienceExternal(x.projectId, x.today);
  const known = await ledgerState(env, 'x_grow_audience_facts', x.projectId, externalId);
  if (known.state === 'deleted') { await env.DB.prepare(LEDGER_TOUCH).bind(x.projectId, externalId).run(); counts.kept_deleted += 1; return; }
  const vals = [a.followers, a.following, a.post_count, x.today];
  let id: number;
  if (known.state === 'linked') {
    await env.DB.prepare(`UPDATE x_grow_audience_facts SET followers = ?, following = ?, post_count = ?, as_of = ?, integration_id = ?,
      updated_at = datetime('now') WHERE id = ? AND project_id = ?`).bind(...vals, x.integrationId, known.id, x.projectId).run();
    id = known.id;
  } else {
    const row = await env.DB.prepare(
      `INSERT INTO x_grow_audience_facts (followers, following, post_count, as_of, integration_id, project_id, snapshot_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, snapshot_date) DO UPDATE SET followers = excluded.followers, following = excluded.following,
         post_count = excluded.post_count, as_of = excluded.as_of, integration_id = excluded.integration_id, updated_at = datetime('now')
       RETURNING id`,
    ).bind(...vals, x.integrationId, x.projectId, x.today).first<{ id: number }>();
    id = Number(row!.id);
  }
  await env.DB.prepare(LEDGER_LINK).bind(x.integrationId, x.projectId, 'revenue_and_traction', 'x_audience_snapshot', externalId, 'x_grow_audience_facts', id).run();
  counts.snapshots += 1;
}

async function landPost(env: Env, x: SyncCtx, p: XPostFacts, counts: XCounts): Promise<void> {
  const externalId = postExternal(x.projectId, p.id);
  const known = await ledgerState(env, 'x_grow_post_facts', x.projectId, externalId);
  if (known.state === 'deleted') { await env.DB.prepare(LEDGER_TOUCH).bind(x.projectId, externalId).run(); counts.kept_deleted += 1; return; }
  const vals = [p.posted_on, p.impressions, p.likes, p.reposts, p.replies, p.quotes, p.bookmarks, x.today];
  let id: number;
  if (known.state === 'linked') {
    await env.DB.prepare(`UPDATE x_grow_post_facts SET posted_on = ?, impressions = ?, likes = ?, reposts = ?, replies = ?, quotes = ?, bookmarks = ?,
      as_of = ?, integration_id = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?`).bind(...vals, x.integrationId, known.id, x.projectId).run();
    id = known.id;
  } else {
    const row = await env.DB.prepare(
      `INSERT INTO x_grow_post_facts (posted_on, impressions, likes, reposts, replies, quotes, bookmarks, as_of, integration_id, project_id, post_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, post_id) DO UPDATE SET posted_on = excluded.posted_on, impressions = excluded.impressions, likes = excluded.likes,
         reposts = excluded.reposts, replies = excluded.replies, quotes = excluded.quotes, bookmarks = excluded.bookmarks, as_of = excluded.as_of,
         integration_id = excluded.integration_id, updated_at = datetime('now')
       RETURNING id`,
    ).bind(...vals, x.integrationId, x.projectId, p.id).first<{ id: number }>();
    id = Number(row!.id);
  }
  await env.DB.prepare(LEDGER_LINK).bind(x.integrationId, x.projectId, 'distribution', 'x_post', externalId, 'x_grow_post_facts', id).run();
  counts.posts += 1;
}

/**
 * One founder-pressed sync: today's audience snapshot, then the founder's newest posts, at most `POST_PAGE_BUDGET`
 * pages. A failed page, or the monthly budget running out, stops it "Partly synced". One failed read leaves the other's
 * landing intact; both failing throws the first failure, so a spent budget refuses `x_monthly_cap_reached` before X is
 * called at all.
 */
export async function syncX(env: Env, reads: XReads, x: SyncCtx): Promise<XCounts> {
  const counts: XCounts = { snapshots: 0, posts: 0, kept_deleted: 0, partial: false, outcome: 'Synced', capped: false };
  const seen: { first: XError | null } = { first: null };
  const failed = (e: unknown) => {
    if (!(e instanceof XError)) throw e;
    seen.first ??= e; counts.partial = true;
    if (e.code === 'x_monthly_cap_reached') counts.capped = true;
  };
  let accountRead = false, postsRead = false;
  try { await landAudience(env, x, await reads.account(), counts); accountRead = true; } catch (e) { failed(e); }

  let next: string | null = null;
  for (let pages = 0; pages < POST_PAGE_BUDGET; pages += 1) {
    let page;
    try { page = await reads.posts(next); } catch (e) { failed(e); break; }
    postsRead = true;
    for (const p of page.posts) await landPost(env, x, p, counts);
    if (!page.next) break;
    next = page.next;
  }
  if (seen.first && !accountRead && !postsRead) throw seen.first;
  await env.DB.prepare("UPDATE x_grow_links SET partly_synced = ?, updated_at = datetime('now') WHERE project_id = ? AND integration_id = ?")
    .bind(counts.partial ? 1 : 0, x.projectId, x.integrationId).run();
  counts.outcome = counts.partial ? 'Partly synced' : 'Synced';
  return counts;
}

// ═════════════════════════════════════════════════════════════ the reads

interface Snapshot { id: number; snapshot_date: string; followers: number | null; as_of: string }
interface MonthRow { period: string; posts: number; impressions: number | null; impressions_missing: number; engagement: number | null; engagement_missing: number }

/** A month's total from its posts: the sum of the posts X gave the figure for, and how many it left out. */
function total(sum: number | null, missing: number, posts: number, what: string) {
  if (missing >= posts || sum == null) return { count: null, reason: `Not recorded: X gave no ${what} for these posts` };
  return { count: Number(sum), reason: missing ? `${missing} post${missing === 1 ? '' : 's'} had no ${what} from X; the total leaves ${missing === 1 ? 'it' : 'them'} out` : null };
}

/** The newest `MONTHS_SHOWN` months with a snapshot or a post: followers at the month's last snapshot, posts, impressions, engagement. */
async function months(env: Env, projectId: number) {
  const posts = (await env.DB.prepare(
    `SELECT substr(posted_on, 1, 7) AS period, COUNT(*) AS posts,
            SUM(impressions) AS impressions, SUM(CASE WHEN impressions IS NULL THEN 1 ELSE 0 END) AS impressions_missing,
            SUM(likes + reposts + replies + quotes + bookmarks) AS engagement,
            SUM(CASE WHEN likes IS NULL OR reposts IS NULL OR replies IS NULL OR quotes IS NULL OR bookmarks IS NULL THEN 1 ELSE 0 END) AS engagement_missing
       FROM x_grow_post_facts WHERE project_id = ? AND posted_on IS NOT NULL
      GROUP BY period ORDER BY period DESC LIMIT ?`,
  ).bind(projectId, MONTHS_SHOWN).all<MonthRow>()).results || [];
  const ends = (await env.DB.prepare(
    `SELECT substr(f.snapshot_date, 1, 7) AS period, f.followers, f.snapshot_date FROM x_grow_audience_facts f
      WHERE f.project_id = ? AND f.snapshot_date = (SELECT MAX(g.snapshot_date) FROM x_grow_audience_facts g
        WHERE g.project_id = f.project_id AND substr(g.snapshot_date, 1, 7) = substr(f.snapshot_date, 1, 7))
      ORDER BY period DESC LIMIT ?`,
  ).bind(projectId, MONTHS_SHOWN).all<{ period: string; followers: number | null; snapshot_date: string }>()).results || [];
  const byPosts = new Map(posts.map((m) => [m.period, m]));
  const byEnd = new Map(ends.map((e) => [e.period, e]));
  const periods = [...new Set([...byPosts.keys(), ...byEnd.keys()])].sort().reverse().slice(0, MONTHS_SHOWN);
  return periods.map((period) => {
    const m = byPosts.get(period);
    const e = byEnd.get(period);
    const followers = e?.followers ?? null;
    return {
      period,
      followers: { count: followers, as_of: e?.snapshot_date ?? null, reason: followers == null ? (e ? SENTENCES.no_followers : SENTENCES.no_month_followers) : null },
      posts: m ? { count: Number(m.posts), reason: null } : { count: null, reason: SENTENCES.no_posts },
      impressions: m ? total(m.impressions, Number(m.impressions_missing), Number(m.posts), 'impressions') : { count: null, reason: SENTENCES.no_posts },
      engagement: m ? total(m.engagement, Number(m.engagement_missing), Number(m.posts), 'engagement') : { count: null, reason: SENTENCES.no_posts },
    };
  });
}

function followersFigure(rows: Snapshot[]) {
  const [latest, before] = rows;
  if (!latest || latest.followers == null) return { key: 'followers', label: 'followers', count: null, period: latest?.snapshot_date ?? null, change: null, reason: SENTENCES.no_followers };
  const prior = before?.followers ?? null;
  return { key: 'followers', label: 'followers', count: latest.followers, period: latest.snapshot_date,
    change: prior == null ? null : { since: before.snapshot_date, delta: latest.followers - prior }, reason: null };
}

const ENGAGEMENT_PARTS = ['likes', 'reposts', 'replies', 'quotes', 'bookmarks'] as const;
const POST_FIGURES = ['impressions', ...ENGAGEMENT_PARTS] as const;

export interface PartViewer { userId: number; support: boolean; writer: boolean; team: boolean }

/**
 * A module's "From X" part for one viewer. Not on the team: `team_only`. No link and nothing landed: how to connect.
 * A link and nothing landed: not synced yet. Facts landed: each figure with "From X, as of <date>", or its reason.
 */
export async function xPart(env: Env, projectId: number, slug: XSlug, viewer: PartViewer) {
  if (!viewer.team) return { state: 'team_only' as const, reason: SENTENCES.team_only };
  const link = await linkOf(env, projectId);
  const common = {
    link: link ? { served_by: { name: link.owner_name }, connected: link.active, partly_synced: link.partly_synced } : null,
    can_sync: (!link || link.owner_id === viewer.userId) && !viewer.support && viewer.writer,
    can_delete: viewer.writer && !viewer.support,
    note: slug === 'revenue-and-traction' ? SENTENCES.not_revenue : SENTENCES.own_posts,
    engagement_note: SENTENCES.engagement,
  };
  const snaps = (await env.DB.prepare(
    'SELECT id, snapshot_date, followers, as_of FROM x_grow_audience_facts WHERE project_id = ? ORDER BY snapshot_date DESC LIMIT 2',
  ).bind(projectId).all<Snapshot>()).results || [];
  const monthly = await months(env, projectId);
  const posts = slug === 'distribution' ? ((await env.DB.prepare(
    `SELECT id, post_id, posted_on, impressions, likes, reposts, replies, quotes, bookmarks, as_of FROM x_grow_post_facts
      WHERE project_id = ? ORDER BY posted_on IS NULL, posted_on DESC, id DESC LIMIT ?`,
  ).bind(projectId, POSTS_SHOWN).all<Record<string, unknown>>()).results || []).map((r) => {
    const missing = POST_FIGURES.filter((k) => r[k] == null);
    const engaged = ENGAGEMENT_PARTS.every((k) => r[k] != null) ? ENGAGEMENT_PARTS.reduce((s, k) => s + Number(r[k]), 0) : null;
    return { ...r, as_of: String(r.as_of), engagement: engaged, source: fromX(String(r.as_of)),
      reasons: Object.fromEntries([...missing.map((k) => [k, 'Not recorded: X gave no figure for this post']),
        ...(engaged == null ? [['engagement', 'Not recorded: X did not give every part of this post’s engagement']] : [])]) };
  }) : [];
  if (!snaps.length && !monthly.length) {
    if (!link) return { state: 'not_linked' as const, reason: SENTENCES.not_linked, connect_href: CONNECT_HREF, ...common };
    return { state: 'not_recorded' as const, reason: SENTENCES.not_synced, ...common };
  }
  const asOf = [snaps[0]?.as_of, ...posts.map((p) => String(p.as_of))].filter(Boolean).sort().at(-1) ?? null;
  return {
    state: 'ok' as const, ...common, as_of: asOf, source: fromX(asOf), snapshot_id: snaps[0]?.id ?? null,
    figures: [followersFigure(snaps)], months: monthly, ...(slug === 'distribution' ? { posts } : {}),
  };
}

// ═════════════════════════════════════════════════════════════ delete and disconnect

/** Delete a snapshot or a post's figures; the ledger keeps it deleted through every later sync. Its slug, or null. */
export async function deleteXRow(env: Env, kind: 'audience' | 'post', projectId: number, id: number): Promise<XSlug | null> {
  const store: Store = kind === 'audience' ? 'x_grow_audience_facts' : 'x_grow_post_facts';
  const gone = kind === 'audience'
    ? await env.DB.prepare('DELETE FROM x_grow_audience_facts WHERE id = ? AND project_id = ? RETURNING id').bind(id, projectId).first()
    : await env.DB.prepare('DELETE FROM x_grow_post_facts WHERE id = ? AND project_id = ? RETURNING id').bind(id, projectId).first();
  if (!gone) return null;
  await env.DB.prepare('UPDATE connector_fed_items SET local_id = NULL WHERE project_id = ? AND local_table = ? AND local_id = ?').bind(projectId, store, id).run();
  return kind === 'audience' ? 'revenue-and-traction' : 'distribution';
}

/** Disconnect removes the connection's X facts, their ledger rows and its venture link, in one batch. */
export async function purgeXConnection(env: Env, integrationId: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM connector_fed_items WHERE integration_id = ? AND kind IN ('x_audience_snapshot', 'x_post')").bind(integrationId),
    env.DB.prepare('DELETE FROM x_grow_audience_facts WHERE integration_id = ?').bind(integrationId),
    env.DB.prepare('DELETE FROM x_grow_post_facts WHERE integration_id = ?').bind(integrationId),
    env.DB.prepare('DELETE FROM x_grow_links WHERE integration_id = ?').bind(integrationId),
  ]);
}
