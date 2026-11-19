/**
 * D5859 (#5859, part 2a of #2399) — a connected Facebook Page in Grow: the venture it feeds, the sync that lands its
 * figures, the "From Facebook" part of Distribution and of Revenue and traction, and what disconnect removes.
 *
 *   Revenue and traction  FACT  the Page's followers, one snapshot per sync day, shown beside revenue and never as
 *                               revenue: never written to `project_metrics` or `custom_kpi_values`.
 *   Distribution          FACT  the Page's daily views, unique viewers and engagements. The funnel's Visit row is not
 *                               touched: a view of a Page is not a visit to the venture's site.
 *
 * ONE PAGE PER VENTURE (owner, 2026-11-15, option A on #2399). The connection keeps the Pages chosen per company; a
 * venture names its one Page in `facebook_page_links`, which only the member whose connection chose that Page can
 * set. Another member's connection already linked to the venture is `served` (Beehiiv's precedent).
 *
 * EVERY LANDING GOES THROUGH `connector_fed_items` (D655): a re-sync updates the row its ledger row links, and a row
 * the founder deleted keeps its ledger row with no `local_id` and is never re-created.
 *
 * WHAT IS MISSING SAYS SO. A metric Facebook did not return has no row and reads "Not recorded"; never 0. Logs carry
 * counts only: no figure, Page name or token.
 * D5860 adds the channel-link proposal, its resumable acceptance through the route's channel writer and final dismissal.
 */
import type { Env } from '../../types';
import { projectEnabled } from '../../integrations/companyScope';
import { addDays, WINDOW_DAYS, type FacebookReads, type InsightKind } from './insights';

export type FacebookSlug = 'distribution' | 'revenue-and-traction';
export const FACEBOOK_SLUGS: readonly FacebookSlug[] = Object.freeze(['distribution', 'revenue-and-traction']);
export const CONNECT_HREF = '/account/connectors/facebook';
/** The sync reads back at most 12 months. */
export const HISTORY_DAYS = 365;
/** The most insights requests one sync makes; past them it stops "Partly synced" and keeps its cursor. */
export const WINDOW_BUDGET = 3;
/** The days Distribution's part lists, ending at the newest day recorded. */
export const DAYS_SHOWN = 28;
const FACT_KIND = 'facebook_page_fact';
const DAILY: readonly InsightKind[] = Object.freeze(['views', 'viewers', 'engagements']);

export const SENTENCES = Object.freeze({
  not_linked: 'Not recorded: no Facebook Page is linked to this venture.',
  not_synced: 'Not recorded: the linked Facebook Page has not been synced yet.',
  unreadable: 'Unreadable: the Facebook figures could not be read',
  not_given: 'Not recorded: Facebook gave no figure for this day.',
  no_followers: 'Not recorded: Facebook has given no follower count yet.',
  not_revenue: 'Your Facebook Page audience, shown beside revenue and never as revenue.',
  page_views: 'Views of your Facebook Page and its posts. A view is not a visit to your site.',
  unique_per_day: 'Unique viewers are counted per day, so days do not add up.',
  channel_link: 'Link your Facebook Page to a Distribution channel?',
});

const fromFacebook = (asOf: string | null) => (asOf ? `From Facebook, as of ${asOf.slice(0, 10)}` : null);

// ═════════════════════════════════════════════════════════════ the link

export interface FacebookLink {
  integration_id: number; project_id: number; page_id: string; page_name: string | null;
  owner_id: number; owner_name: string | null; active: boolean; insights_cursor: string | null; backfilled: boolean;
}

/** The venture's Page link and whose connection holds it, or null. */
export async function linkOf(env: Env, projectId: number): Promise<FacebookLink | null> {
  const l = await env.DB.prepare(
    `SELECT l.integration_id, l.project_id, l.page_id, l.page_name, l.insights_cursor, l.backfilled,
            i.user_id AS owner_id, i.status AS status, COALESCE(u.display_name, u.name) AS owner_name
       FROM facebook_page_links l JOIN integrations i ON i.id = l.integration_id LEFT JOIN users u ON u.id = i.user_id
      WHERE l.project_id = ?`,
  ).bind(projectId).first<Record<string, unknown>>();
  if (!l) return null;
  return {
    integration_id: Number(l.integration_id), project_id: Number(l.project_id), page_id: String(l.page_id),
    page_name: (l.page_name as string | null) ?? null, owner_id: Number(l.owner_id), owner_name: (l.owner_name as string | null) ?? null,
    active: l.status === 'active', insights_cursor: (l.insights_cursor as string | null) ?? null, backfilled: Number(l.backfilled) === 1,
  };
}

/**
 * Link a venture to one Page of this connection. `served`: another connection holds the venture's link.
 * `page_elsewhere`: this connection already links that Page to another venture. A new Page on the same venture
 * starts its history again; the old Page's facts stay until deleted, and the part reads the linked Page's only.
 */
export async function linkPage(env: Env, p: { integrationId: number; projectId: number; userId: number; pageId: string; pageName: string }):
  Promise<'ok' | 'served' | 'page_elsewhere'> {
  const held = await env.DB.prepare('SELECT integration_id FROM facebook_page_links WHERE project_id = ?').bind(p.projectId).first<{ integration_id: number }>();
  if (held && Number(held.integration_id) !== p.integrationId) return 'served';
  const elsewhere = await env.DB.prepare('SELECT project_id FROM facebook_page_links WHERE integration_id = ? AND page_id = ? AND project_id <> ?')
    .bind(p.integrationId, p.pageId, p.projectId).first();
  if (elsewhere) return 'page_elsewhere';
  await env.DB.prepare(
    `INSERT INTO facebook_page_links (integration_id, project_id, page_id, page_name, linked_by) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       insights_cursor = CASE WHEN facebook_page_links.page_id = excluded.page_id THEN facebook_page_links.insights_cursor ELSE NULL END,
       backfilled = CASE WHEN facebook_page_links.page_id = excluded.page_id THEN facebook_page_links.backfilled ELSE 0 END,
       page_id = excluded.page_id, page_name = excluded.page_name, linked_by = excluded.linked_by, updated_at = datetime('now')
     WHERE facebook_page_links.integration_id = excluded.integration_id`,
  ).bind(p.integrationId, p.projectId, p.pageId, p.pageName.slice(0, 200), p.userId).run();
  await raiseFacebookProposal(env, p.integrationId, p.projectId, p.pageId);
  return 'ok';
}

/** Remove the venture's link, if this connection holds it. The landed facts stay until deleted or disconnected. */
export async function unlinkPage(env: Env, projectId: number, integrationId: number): Promise<boolean> {
  const gone = await env.DB.prepare('DELETE FROM facebook_page_links WHERE project_id = ? AND integration_id = ? RETURNING id')
    .bind(projectId, integrationId).first();
  return !!gone;
}

// ═════════════════════════════════════════════════════════════ the sync

export interface FacebookCounts {
  /** 1 when today's follower snapshot was written or updated. */
  followers: number;
  /** Daily figures written or updated. */
  daily: number;
  /** Figures the founder deleted, left deleted. */
  kept_deleted: number;
  /** A read failed, or the 12 months are not all read yet. */
  partial: boolean;
  outcome: 'Synced' | 'Partly synced';
}

export interface SyncCtx {
  integrationId: number; projectId: number; pageId: string; today: string;
  cursor: string | null; backfilled: boolean;
}

/** The insights windows one sync asks for: the newest 90 days, then back from the cursor, within budget and 12 months. */
export function windowsFor(x: Pick<SyncCtx, 'today' | 'cursor' | 'backfilled'>): Array<[string, string]> {
  const floor = addDays(x.today, -(HISTORY_DAYS - 1));
  const later = (a: string, b: string) => (a > b ? a : b);
  const out: Array<[string, string]> = [[later(addDays(x.today, -(WINDOW_DAYS - 1)), floor), x.today]];
  let next: string | null = x.backfilled ? null : x.cursor ? addDays(x.cursor, -1) : addDays(x.today, -WINDOW_DAYS);
  while (next && next >= floor && out.length < WINDOW_BUDGET) {
    const since = later(addDays(next, -(WINDOW_DAYS - 1)), floor);
    out.push([since, next]);
    next = since > floor ? addDays(since, -1) : null;
  }
  return out;
}

interface Landing { kind: InsightKind | 'followers'; period: string; value: number }
const moduleOf = (kind: Landing['kind']) => (kind === 'followers' ? 'revenue_and_traction' : 'distribution');
const externalOf = (projectId: number, pageId: string, kind: string, period: string) => `facebook:${projectId}:${pageId}:${kind}:${period}`;
const UPSERT = `INSERT INTO facebook_page_facts (integration_id, project_id, module, kind, period, subject, value, as_of) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(project_id, kind, period, subject) DO UPDATE SET value = excluded.value, as_of = excluded.as_of,
    integration_id = excluded.integration_id, updated_at = datetime('now')`;
const LEDGER_LINK = `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
  VALUES (?, ?, ?, 'facebook_page_fact', ?, 'facebook_page_facts',
    (SELECT id FROM facebook_page_facts WHERE project_id = ? AND kind = ? AND period = ? AND subject = ?))
  ON CONFLICT(integration_id, external_id) DO UPDATE SET project_id = excluded.project_id, local_table = excluded.local_table,
    local_id = excluded.local_id, last_seen_at = CURRENT_TIMESTAMP`;
const LEDGER_DELETED = 'UPDATE connector_fed_items SET local_id = NULL, last_seen_at = CURRENT_TIMESTAMP WHERE project_id = ? AND external_id = ?';

/** Land the rows: two reads to learn what the ledger and the store hold, then batched writes. */
async function land(env: Env, x: SyncCtx, rows: Landing[], counts: FacebookCounts): Promise<void> {
  if (!rows.length) return;
  const ledger = new Map<string, { local_table: string | null; local_id: number | null }>();
  for (const r of (await env.DB.prepare('SELECT external_id, local_table, local_id FROM connector_fed_items WHERE project_id = ? AND kind = ?')
    .bind(x.projectId, FACT_KIND).all<{ external_id: string; local_table: string | null; local_id: number | null }>()).results || []) ledger.set(r.external_id, r);
  const facts = new Set<string>();
  for (const r of (await env.DB.prepare('SELECT kind, period FROM facebook_page_facts WHERE project_id = ? AND subject = ?')
    .bind(x.projectId, x.pageId).all<{ kind: string; period: string }>()).results || []) facts.add(`${r.kind}|${r.period}`);
  const statements = [];
  for (const row of rows) {
    const ext = externalOf(x.projectId, x.pageId, row.kind, row.period);
    const known = ledger.get(ext);
    // Deleted: the ledger row lost its local row, or the row it points to is gone. It stays deleted.
    if (known && (known.local_id == null || known.local_table !== 'facebook_page_facts' || !facts.has(`${row.kind}|${row.period}`))) {
      statements.push(env.DB.prepare(LEDGER_DELETED).bind(x.projectId, ext));
      counts.kept_deleted += 1;
      continue;
    }
    statements.push(env.DB.prepare(UPSERT).bind(x.integrationId, x.projectId, moduleOf(row.kind), row.kind, row.period, x.pageId, row.value, x.today));
    statements.push(env.DB.prepare(LEDGER_LINK).bind(x.integrationId, x.projectId, moduleOf(row.kind), ext, x.projectId, row.kind, row.period, x.pageId));
    if (row.kind === 'followers') counts.followers += 1; else counts.daily += 1;
  }
  for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));
}

/**
 * One founder-pressed sync: today's follower count, then the daily insights, newest 90 days first and then back from
 * where the last sync stopped, at most `WINDOW_BUDGET` requests and 12 months. Until the 12 months are read it is
 * "Partly synced" and keeps its cursor. A failed read leaves what was read landed; nothing read throws the failure.
 */
export async function syncFacebook(env: Env, reads: FacebookReads, x: SyncCtx): Promise<FacebookCounts> {
  const counts: FacebookCounts = { followers: 0, daily: 0, kept_deleted: 0, partial: false, outcome: 'Synced' };
  const rows: Landing[] = [];
  let first: unknown = null;
  let readAny = false;
  try {
    const n = await reads.followers();
    readAny = true;
    if (n !== null) rows.push({ kind: 'followers', period: x.today, value: n });
  } catch (e) { first = e; counts.partial = true; }

  const windows = windowsFor(x);
  let oldestOlder: string | null = null;
  let allRead = true;
  for (const [i, [since, until]] of windows.entries()) {
    let got;
    try { got = await reads.insights(since, until); } catch (e) { first ??= e; counts.partial = true; allRead = false; break; }
    readAny = true;
    for (const r of got) rows.push({ kind: r.kind, period: r.day, value: r.value });
    if (i > 0) oldestOlder = since;
  }
  if (!readAny) throw first;
  await raiseFacebookProposal(env, x.integrationId, x.projectId, x.pageId);
  await land(env, x, rows, counts);

  const floor = addDays(x.today, -(HISTORY_DAYS - 1));
  let { cursor, backfilled } = x;
  if (!backfilled && allRead) {
    const reached = oldestOlder ?? (windows.length === 1 ? windows[0][0] : null);
    if (reached && reached <= floor) { backfilled = true; cursor = null; }
    else if (oldestOlder) cursor = oldestOlder;
    else if (!cursor) cursor = windows[0][0];
  } else if (!backfilled && oldestOlder) cursor = oldestOlder;
  await env.DB.prepare("UPDATE facebook_page_links SET insights_cursor = ?, backfilled = ?, updated_at = datetime('now') WHERE project_id = ? AND integration_id = ?")
    .bind(cursor, backfilled ? 1 : 0, x.projectId, x.integrationId).run();
  if (!backfilled) counts.partial = true;
  counts.outcome = counts.partial ? 'Partly synced' : 'Synced';
  return counts;
}

// ═════════════════════════════════════════════════════════════ the reads

export interface PartViewer { userId: number; support: boolean; writer: boolean }

/**
 * A module's "From Facebook" part for one viewer. No link: how to link a Page. A link and nothing landed: not synced
 * yet. Facts landed: each figure with "From Facebook, as of <date>", or its reason.
 */
export async function facebookPart(env: Env, projectId: number, slug: FacebookSlug, viewer: PartViewer) {
  const link = await linkOf(env, projectId);
  const common = {
    link: link ? { page_name: link.page_name, served_by: { name: link.owner_name }, connected: link.active, partly_synced: !link.backfilled } : null,
    can_sync: !!link && link.owner_id === viewer.userId && !viewer.support && viewer.writer,
    can_link: (!link || link.owner_id === viewer.userId) && !viewer.support && viewer.writer,
    can_delete: viewer.writer && !viewer.support,
    note: slug === 'revenue-and-traction' ? SENTENCES.not_revenue : SENTENCES.page_views,
    ...(slug === 'distribution' && link ? { proposal: await facebookProposal(env, projectId, link, viewer) } : {}),
  };
  if (!link) return { state: 'not_linked' as const, reason: SENTENCES.not_linked, connect_href: CONNECT_HREF, ...common };
  if (slug === 'revenue-and-traction') {
    const rows = (await env.DB.prepare(
      `SELECT id, period, value, as_of FROM facebook_page_facts WHERE project_id = ? AND subject = ? AND kind = 'followers'
        ORDER BY period DESC LIMIT 2`,
    ).bind(projectId, link.page_id).all<{ id: number; period: string; value: number; as_of: string }>()).results || [];
    if (!rows.length) return { state: 'not_recorded' as const, reason: SENTENCES.not_synced, ...common };
    const [latest, before] = rows;
    return {
      state: 'ok' as const, ...common, as_of: latest.as_of, source: fromFacebook(latest.as_of),
      followers: { id: latest.id, count: latest.value, period: latest.period, change: before ? { since: before.period, delta: latest.value - before.value } : null },
    };
  }
  const newest = await env.DB.prepare(
    "SELECT MAX(period) AS day, MAX(as_of) AS as_of FROM facebook_page_facts WHERE project_id = ? AND subject = ? AND kind IN ('views', 'viewers', 'engagements')",
  ).bind(projectId, link.page_id).first<{ day: string | null; as_of: string | null }>();
  if (!newest?.day) return { state: 'not_recorded' as const, reason: SENTENCES.not_synced, ...common };
  const from = addDays(newest.day, -(DAYS_SHOWN - 1));
  const rows = (await env.DB.prepare(
    `SELECT id, kind, period, value FROM facebook_page_facts WHERE project_id = ? AND subject = ? AND kind IN ('views', 'viewers', 'engagements')
        AND period >= ? AND period <= ?`,
  ).bind(projectId, link.page_id, from, newest.day).all<{ id: number; kind: InsightKind; period: string; value: number }>()).results || [];
  const byDay = new Map<string, Map<InsightKind, { id: number; value: number }>>();
  for (const r of rows) {
    if (!byDay.has(r.period)) byDay.set(r.period, new Map());
    byDay.get(r.period)!.set(r.kind, { id: r.id, value: r.value });
  }
  const days = Array.from({ length: DAYS_SHOWN }, (_, i) => addDays(newest.day!, -i)).map((day) => {
    const got = byDay.get(day);
    return {
      day,
      ...Object.fromEntries(DAILY.map((k) => [k, got?.get(k) ? { id: got.get(k)!.id, count: got.get(k)!.value } : { count: null, reason: SENTENCES.not_given }])),
    };
  });
  const total = (k: InsightKind) => {
    const recorded = rows.filter((r) => r.kind === k);
    return recorded.length ? { count: recorded.reduce((s, r) => s + r.value, 0), days_recorded: recorded.length, of_days: DAYS_SHOWN } : { count: null, reason: SENTENCES.not_given };
  };
  return {
    state: 'ok' as const, ...common, as_of: newest.as_of, source: fromFacebook(newest.as_of),
    totals: { views: total('views'), engagements: total('engagements'), viewers: { count: null, reason: SENTENCES.unique_per_day } },
    days,
  };
}

// D5860: decisions belong to this venture's linked Page and survive every re-sync.
async function raiseFacebookProposal(env: Env, integrationId: number, projectId: number, pageId: string) {
  await env.DB.prepare(
    `INSERT INTO facebook_proposals (integration_id, project_id, kind, subject)
     SELECT ?, ?, 'channel_link', ? WHERE EXISTS (
       SELECT 1 FROM facebook_page_links WHERE project_id = ? AND integration_id = ? AND page_id = ?
     )
     ON CONFLICT(project_id, kind, subject) DO UPDATE SET integration_id = excluded.integration_id
     WHERE facebook_proposals.integration_id <> excluded.integration_id`,
  ).bind(integrationId, projectId, pageId, projectId, integrationId, pageId).run();
}

interface FacebookProposal {
  id: number; state: string; growth_channel_id: number | null; decided_at: string | null;
}

async function facebookProposal(env: Env, projectId: number, link: FacebookLink, viewer: PartViewer) {
  const proposal = await env.DB.prepare(
    `SELECT id, state, growth_channel_id, decided_at FROM facebook_proposals
     WHERE project_id = ? AND integration_id = ? AND subject = ? AND kind = 'channel_link'`,
  ).bind(projectId, link.integration_id, link.page_id).first<FacebookProposal>();
  if (!proposal || proposal.state === 'dismissed') return null;
  const pending = proposal.state === 'pending' || proposal.decided_at === null;
  const channel = proposal.growth_channel_id === null ? null : await env.DB.prepare(
    "SELECT uid, name FROM growth_channels WHERE id = ? AND project_id = ? AND utm_source = 'facebook'",
  ).bind(proposal.growth_channel_id, projectId).first<{ uid: string; name: string }>();
  return {
    id: proposal.id, kind: 'channel_link' as const, state: pending ? 'pending' as const : 'accepted' as const,
    sentence: pending ? SENTENCES.channel_link : null,
    can_decide: pending && link.active && viewer.writer && !viewer.support && link.owner_id === viewer.userId
      && await projectEnabled(env, link.integration_id, projectId),
    channel,
  };
}

export type FacebookDecision = 'ok' | 'not_found' | 'decided' | 'unknown_channel' | 'wrong_source';

/** Scope the decision to the current connection and Page, including after relinking. */
async function facebookDecision(env: Env, projectId: number, id: number, link: FacebookLink) {
  return env.DB.prepare(
    `SELECT id, state, growth_channel_id, decided_at FROM facebook_proposals
     WHERE id = ? AND project_id = ? AND integration_id = ? AND subject = ? AND kind = 'channel_link'`,
  ).bind(id, projectId, link.integration_id, link.page_id).first<FacebookProposal>();
}

/** Reserve acceptance before the channel writer so a concurrent Dismiss cannot win halfway through. */
export async function acceptFacebookProposal(env: Env, projectId: number, id: number, userId: number, link: FacebookLink,
  channelUid: string | null, create: () => Promise<string>): Promise<FacebookDecision> {
  let proposal = await facebookDecision(env, projectId, id, link);
  if (!proposal) return 'not_found';
  if (proposal.state === 'dismissed' || proposal.decided_at !== null) return 'decided';
  if (channelUid !== null) {
    const chosen = await env.DB.prepare('SELECT utm_source FROM growth_channels WHERE uid = ? AND project_id = ?')
      .bind(channelUid, projectId).first<{ utm_source: string }>();
    if (!chosen) return 'unknown_channel';
    if (chosen.utm_source !== 'facebook') return 'wrong_source';
  }
  await env.DB.prepare(
    `UPDATE facebook_proposals SET state = 'accepted', decided_by = ?, updated_at = datetime('now')
     WHERE id = ? AND project_id = ? AND state = 'pending'`,
  ).bind(userId, id, projectId).run();
  proposal = await facebookDecision(env, projectId, id, link);
  if (!proposal || proposal.state !== 'accepted' || proposal.decided_at !== null) return 'decided';

  const findChannel = () => env.DB.prepare("SELECT id FROM growth_channels WHERE project_id = ? AND utm_source = 'facebook'")
    .bind(projectId).first<{ id: number }>();
  let channel = await findChannel();
  if (!channel) {
    try { await create(); } catch (error) {
      // Two accepts may reach the writer together. Its UTM uniqueness leaves one channel.
      channel = await findChannel();
      if (!channel) throw error;
    }
    channel ??= await findChannel();
  }
  if (!channel) return 'unknown_channel';
  const result = await env.DB.prepare(
    `UPDATE facebook_proposals SET growth_channel_id = ?, decided_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND project_id = ? AND state = 'accepted' AND decided_at IS NULL`,
  ).bind(channel.id, id, projectId).run();
  return Number(result.meta?.changes ?? 0) ? 'ok' : 'decided';
}

/** A successful dismissal is final. A reserved acceptance is completed by retrying Accept. */
export async function dismissFacebookProposal(env: Env, projectId: number, id: number, userId: number, link: FacebookLink): Promise<FacebookDecision> {
  if (!await facebookDecision(env, projectId, id, link)) return 'not_found';
  const result = await env.DB.prepare(
    `UPDATE facebook_proposals SET state = 'dismissed', decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND project_id = ? AND state = 'pending'`,
  ).bind(userId, id, projectId).run();
  return Number(result.meta?.changes ?? 0) ? 'ok' : 'decided';
}

// ═════════════════════════════════════════════════════════════ delete and disconnect

/** Delete one figure; the ledger keeps it deleted through every later sync. Its slug, or null. */
export async function deleteFacebookFact(env: Env, projectId: number, id: number): Promise<FacebookSlug | null> {
  const gone = await env.DB.prepare('DELETE FROM facebook_page_facts WHERE id = ? AND project_id = ? RETURNING kind')
    .bind(id, projectId).first<{ kind: string }>();
  if (!gone) return null;
  await env.DB.prepare("UPDATE connector_fed_items SET local_id = NULL WHERE project_id = ? AND local_table = 'facebook_page_facts' AND local_id = ?")
    .bind(projectId, id).run();
  return gone.kind === 'followers' ? 'revenue-and-traction' : 'distribution';
}

/** Disconnect: the connection's facts, their ledger rows and its Page links. */
export function purgeStatements(env: Env, integrationId: number) {
  return [
    env.DB.prepare('DELETE FROM facebook_proposals WHERE integration_id = ?').bind(integrationId),
    env.DB.prepare("DELETE FROM connector_fed_items WHERE integration_id = ? AND kind = 'facebook_page_fact'").bind(integrationId),
    env.DB.prepare('DELETE FROM facebook_page_facts WHERE integration_id = ?').bind(integrationId),
    env.DB.prepare('DELETE FROM facebook_page_links WHERE integration_id = ?').bind(integrationId),
  ];
}

export async function purgeFacebookConnection(env: Env, integrationId: number): Promise<void> {
  await env.DB.batch(purgeStatements(env, integrationId));
}

/**
 * The same purge for every Facebook connection of one Meta user, for the deletion callback, which batches it before
 * its own deletes. The subquery is written out in each statement: no interpolation in the query text.
 */
export function purgeByAccountStatements(env: Env, account: string) {
  return [
    env.DB.prepare("DELETE FROM facebook_proposals WHERE integration_id IN (SELECT id FROM integrations WHERE provider_key = 'facebook' AND external_account_id = ?)").bind(account),
    env.DB.prepare("DELETE FROM connector_fed_items WHERE kind = 'facebook_page_fact' AND integration_id IN (SELECT id FROM integrations WHERE provider_key = 'facebook' AND external_account_id = ?)").bind(account),
    env.DB.prepare("DELETE FROM facebook_page_facts WHERE integration_id IN (SELECT id FROM integrations WHERE provider_key = 'facebook' AND external_account_id = ?)").bind(account),
    env.DB.prepare("DELETE FROM facebook_page_links WHERE integration_id IN (SELECT id FROM integrations WHERE provider_key = 'facebook' AND external_account_id = ?)").bind(account),
  ];
}
