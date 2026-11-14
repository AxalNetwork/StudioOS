/**
 * D2407 (#2407 parts 1–2) — a founder's own Beehiiv in Grow: the one
 * publication each venture reads, the sync that lands its aggregates, the
 * "From Beehiiv" part of Distribution and of Revenue and traction, and the
 * founder's decisions on what it proposes.
 *
 *   Distribution          FACT      free subscribers and the average open and
 *                                   click rates, one dated snapshot per sync
 *                                   day; the last 20 sent posts and their
 *                                   figures. Growth is computed from two
 *                                   snapshots when read, never stored.
 *                         PROPOSAL  "Track <publication> as a Distribution
 *                                   channel?": raised once per link, never
 *                                   linked without Accept, and a dismissal
 *                                   stands for the life of the link.
 *   Revenue and traction  FACT      active and premium subscribers by snapshot
 *                                   date: traction, shown beside revenue and
 *                                   never written into `project_metrics` or
 *                                   `custom_kpi_values`. No money figure:
 *                                   paid-subscription revenue is not read
 *                                   (decision G, left out).
 *
 * EVERY LANDING GOES THROUGH `connector_fed_items` (D655). A re-sync updates
 * the row its ledger row links; a row the founder deleted keeps its ledger
 * row with no `local_id` and is never re-created. The ledger is read by
 * venture and external id, across connections, so a disconnect and a new
 * sign-in do not bring a deleted figure back either.
 *
 * WHO (decision D1, provisional). The figures are audience figures, not
 * balances: anyone who may read the venture's Grow module reads them. Only the
 * member whose Beehiiv serves the venture syncs, accepts or dismisses, on a
 * venture they may write, outside a support session; any writer deletes a
 * figure. Nothing here calls Beehiiv but through `reads.ts`, and nothing is
 * logged but counts.
 *
 * A missing figure is `null` with its reason, never 0. This file never
 * imports Axal VC's own newsletters (`services/newsletter*`): a Beehiiv
 * reader never becomes a `newsletter_subscribers` row, and no Axal audience
 * is offered to Beehiiv (`beehiiv_connection_2407.test.ts`).
 */
import type { Env } from '../../types';
import type { BeehiivAudience, BeehiivPublication, BeehiivReads } from './reads';

export type BeehiivFactKind = keyof BeehiivAudience;

/** Each fact's module, label and whether it is a count or a rate. */
export const FACT_KINDS: Readonly<Record<BeehiivFactKind, { module: 'distribution' | 'revenue_and_traction'; label: string; unit: 'count' | 'rate' }>> = Object.freeze({
  subscribers_active: { module: 'revenue_and_traction', label: 'active subscribers', unit: 'count' },
  subscribers_premium: { module: 'revenue_and_traction', label: 'premium subscribers', unit: 'count' },
  subscribers_free: { module: 'distribution', label: 'free subscribers', unit: 'count' },
  open_rate_avg: { module: 'distribution', label: 'average open rate', unit: 'rate' },
  click_rate_avg: { module: 'distribution', label: 'average click rate', unit: 'rate' },
});

/** What each module's part draws, in order. */
export const PART_KINDS: Readonly<Record<BeehiivSlug, readonly BeehiivFactKind[]>> = Object.freeze({
  distribution: Object.freeze(['subscribers_active', 'subscribers_free', 'subscribers_premium', 'open_rate_avg', 'click_rate_avg'] as BeehiivFactKind[]),
  'revenue-and-traction': Object.freeze(['subscribers_active', 'subscribers_premium'] as BeehiivFactKind[]),
});

export type BeehiivSlug = 'distribution' | 'revenue-and-traction';
export const BEEHIIV_SLUGS: readonly BeehiivSlug[] = Object.freeze(['distribution', 'revenue-and-traction']);

export const CONNECT_HREF = '/account/connectors/beehiiv';
export const SENTENCES = Object.freeze({
  not_linked: 'Not recorded: no Beehiiv publication is linked to this venture.',
  not_synced: 'Not recorded: Beehiiv has not been synced for this venture yet.',
  unreadable: 'Unreadable: the Beehiiv figures could not be read',
  not_revenue: 'Paid-subscription revenue is not read from Beehiiv. These are subscribers, shown beside revenue and never as revenue.',
  addresses: 'Your publication’s audience. Never your subscribers’ addresses.',
});

const fromBeehiiv = (asOf: string | null) => (asOf ? `From Beehiiv, as of ${asOf.slice(0, 10)}` : null);

// ═════════════════════════════════════════════════════════════ the link

export interface BeehiivLink {
  id: number;
  integration_id: number;
  project_id: number;
  publication_id: string;
  publication_name: string | null;
  channel_state: 'none' | 'pending' | 'accepted' | 'dismissed';
  growth_channel_id: number | null;
  owner_id: number;
  owner_name: string | null;
  active: boolean;
}

/** The venture's link and whose Beehiiv serves it, or null. */
export async function linkOf(env: Env, projectId: number): Promise<BeehiivLink | null> {
  const l = await env.DB.prepare(
    `SELECT l.id, l.integration_id, l.project_id, l.publication_id, l.publication_name, l.channel_state, l.growth_channel_id,
            i.user_id AS owner_id, i.status AS status, i.auth_type AS auth_type, COALESCE(u.display_name, u.name) AS owner_name
       FROM beehiiv_publication_links l JOIN integrations i ON i.id = l.integration_id LEFT JOIN users u ON u.id = i.user_id
      WHERE l.project_id = ?`,
  ).bind(projectId).first<Record<string, unknown>>();
  if (!l) return null;
  return {
    id: Number(l.id), integration_id: Number(l.integration_id), project_id: Number(l.project_id),
    publication_id: String(l.publication_id), publication_name: (l.publication_name as string | null) ?? null,
    channel_state: l.channel_state as BeehiivLink['channel_state'], growth_channel_id: l.growth_channel_id == null ? null : Number(l.growth_channel_id),
    owner_id: Number(l.owner_id), owner_name: (l.owner_name as string | null) ?? null,
    active: l.status === 'active' && l.auth_type === 'oauth_mcp',
  };
}

/**
 * Link the venture to one of the member's publications, or change it. A link
 * another member's connection holds is never replaced (`served`). Changing the
 * publication starts its channel proposal afresh.
 */
export async function linkPublication(env: Env, p: { integrationId: number; projectId: number; userId: number; publication: BeehiivPublication }): Promise<'ok' | 'served'> {
  const r = await env.DB.prepare(
    `INSERT INTO beehiiv_publication_links (uid, integration_id, project_id, publication_id, publication_name, linked_by)
       VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       channel_state = CASE WHEN beehiiv_publication_links.publication_id = excluded.publication_id THEN beehiiv_publication_links.channel_state ELSE 'none' END,
       growth_channel_id = CASE WHEN beehiiv_publication_links.publication_id = excluded.publication_id THEN beehiiv_publication_links.growth_channel_id ELSE NULL END,
       decided_by = CASE WHEN beehiiv_publication_links.publication_id = excluded.publication_id THEN beehiiv_publication_links.decided_by ELSE NULL END,
       decided_at = CASE WHEN beehiiv_publication_links.publication_id = excluded.publication_id THEN beehiiv_publication_links.decided_at ELSE NULL END,
       publication_id = excluded.publication_id, publication_name = excluded.publication_name,
       linked_by = excluded.linked_by, linked_at = datetime('now'), updated_at = datetime('now')
     WHERE beehiiv_publication_links.integration_id = excluded.integration_id`,
  ).bind(crypto.randomUUID(), p.integrationId, p.projectId, p.publication.id, p.publication.name, p.userId).run();
  return Number(r.meta?.changes ?? 0) > 0 ? 'ok' : 'served';
}

/** Unlink the venture, only from the member's own connection. */
export async function unlinkPublication(env: Env, integrationId: number, projectId: number): Promise<boolean> {
  const r = await env.DB.prepare('DELETE FROM beehiiv_publication_links WHERE project_id = ? AND integration_id = ?').bind(projectId, integrationId).run();
  return Number(r.meta?.changes ?? 0) > 0;
}

// ═════════════════════════════════════════════════════════════ the ledger

type Store = 'beehiiv_grow_facts' | 'beehiiv_post_stats';
/** Each store's fixed liveness read, so a table name never comes from data. */
const ALIVE: Record<Store, string> = {
  beehiiv_grow_facts: 'SELECT 1 FROM beehiiv_grow_facts WHERE id = ? AND project_id = ?',
  beehiiv_post_stats: 'SELECT 1 FROM beehiiv_post_stats WHERE id = ? AND project_id = ?',
};
const LEDGER_LINK = `INSERT INTO connector_fed_items (integration_id, project_id, module, kind, external_id, local_table, local_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(integration_id, external_id) DO UPDATE SET project_id = excluded.project_id, local_table = excluded.local_table,
       local_id = excluded.local_id, last_seen_at = CURRENT_TIMESTAMP`;
const LEDGER_TOUCH = 'UPDATE connector_fed_items SET last_seen_at = CURRENT_TIMESTAMP WHERE project_id = ? AND external_id = ?';

/**
 * The ledger's word on one external item for this venture, under any Beehiiv
 * connection: `deleted` when the founder deleted its row, `linked` with the
 * row to update, or `new`.
 */
export async function ledgerState(env: Env, store: Store, projectId: number, externalId: string):
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

export interface BeehiivCounts {
  /** Figures written or updated. */
  facts: number;
  /** Figures Beehiiv did not give: not landed, never as 0. */
  missing: number;
  posts: number;
  /** Rows the founder deleted, left deleted. */
  kept_deleted: number;
  proposals: number;
  /** Something could not be read: the rest still landed. */
  partial: boolean;
}

interface SyncCtx { integrationId: number; projectId: number; publicationId: string; today: string }

const factExternal = (projectId: number, kind: string, period: string) => `beehiiv:fact:${projectId}:${kind}:${period}`;
const postExternal = (projectId: number, postId: string) => `beehiiv:post:${projectId}:${postId}`;

async function landFact(env: Env, x: SyncCtx, kind: BeehiivFactKind, v: number, counts: BeehiivCounts): Promise<void> {
  const meta = FACT_KINDS[kind];
  const externalId = factExternal(x.projectId, kind, x.today);
  const count = meta.unit === 'count' ? v : null;
  const value = meta.unit === 'rate' ? v : null;
  const known = await ledgerState(env, 'beehiiv_grow_facts', x.projectId, externalId);
  if (known.state === 'deleted') {
    await env.DB.prepare(LEDGER_TOUCH).bind(x.projectId, externalId).run();
    counts.kept_deleted += 1;
    return;
  }
  let id: number;
  if (known.state === 'linked') {
    await env.DB.prepare(`UPDATE beehiiv_grow_facts SET count = ?, value = ?, as_of = ?, integration_id = ?, publication_id = ?, updated_at = datetime('now')
      WHERE id = ? AND project_id = ?`).bind(count, value, x.today, x.integrationId, x.publicationId, known.id, x.projectId).run();
    id = known.id;
  } else {
    const row = await env.DB.prepare(
      `INSERT INTO beehiiv_grow_facts (integration_id, project_id, publication_id, module, kind, period, count, value, as_of)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, kind, period) DO UPDATE SET integration_id = excluded.integration_id, publication_id = excluded.publication_id,
         count = excluded.count, value = excluded.value, as_of = excluded.as_of, updated_at = datetime('now')
       RETURNING id`,
    ).bind(x.integrationId, x.projectId, x.publicationId, meta.module, kind, x.today, count, value, x.today).first<{ id: number }>();
    id = Number(row!.id);
  }
  await env.DB.prepare(LEDGER_LINK).bind(x.integrationId, x.projectId, meta.module, `beehiiv_${kind}`, externalId, 'beehiiv_grow_facts', id).run();
  counts.facts += 1;
}

interface PostLanding {
  id: string; title: string | null; sent_at: string | null;
  recipients: number | null; unique_opens: number | null; open_rate: number | null; unique_clicks: number | null; click_rate: number | null;
}

async function landPost(env: Env, x: SyncCtx, p: PostLanding, counts: BeehiivCounts): Promise<void> {
  const externalId = postExternal(x.projectId, p.id);
  const known = await ledgerState(env, 'beehiiv_post_stats', x.projectId, externalId);
  if (known.state === 'deleted') {
    await env.DB.prepare(LEDGER_TOUCH).bind(x.projectId, externalId).run();
    counts.kept_deleted += 1;
    return;
  }
  const vals = [p.title, p.sent_at, p.recipients, p.unique_opens, p.open_rate, p.unique_clicks, p.click_rate, x.today];
  let id: number;
  if (known.state === 'linked') {
    await env.DB.prepare(`UPDATE beehiiv_post_stats SET title = ?, sent_at = ?, recipients = ?, unique_opens = ?, open_rate = ?, unique_clicks = ?, click_rate = ?,
      as_of = ?, integration_id = ?, publication_id = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?`)
      .bind(...vals, x.integrationId, x.publicationId, known.id, x.projectId).run();
    id = known.id;
  } else {
    const row = await env.DB.prepare(
      `INSERT INTO beehiiv_post_stats (title, sent_at, recipients, unique_opens, open_rate, unique_clicks, click_rate, as_of, integration_id, project_id, publication_id, post_external_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, post_external_id) DO UPDATE SET title = excluded.title, sent_at = excluded.sent_at, recipients = excluded.recipients,
         unique_opens = excluded.unique_opens, open_rate = excluded.open_rate, unique_clicks = excluded.unique_clicks, click_rate = excluded.click_rate,
         as_of = excluded.as_of, integration_id = excluded.integration_id, publication_id = excluded.publication_id, updated_at = datetime('now')
       RETURNING id`,
    ).bind(...vals, x.integrationId, x.projectId, x.publicationId, p.id).first<{ id: number }>();
    id = Number(row!.id);
  }
  await env.DB.prepare(LEDGER_LINK).bind(x.integrationId, x.projectId, 'distribution', 'beehiiv_post', externalId, 'beehiiv_post_stats', id).run();
  await linkPublishSend(env, x.projectId, p.id, id);
  counts.posts += 1;
}

/**
 * D2407 part 3: a synced post that began as a draft Axal VC created is tied
 * to that PUBLISH send (`publish_send_id`), once, by the post id Beehiiv gave
 * the draft. The tie is what lets a sent update show its newsletter figures.
 * A failed tie leaves the post landed and untied; it is tried again next sync.
 */
async function linkPublishSend(env: Env, projectId: number, postId: string, rowId: number): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE beehiiv_post_stats SET publish_send_id = (
          SELECT s.id FROM publish_sends s WHERE s.provider_key = 'beehiiv' AND s.project_id = ? AND s.external_post_id = ? ORDER BY s.id DESC LIMIT 1)
        WHERE id = ? AND project_id = ? AND publish_send_id IS NULL`,
    ).bind(projectId, postId, rowId, projectId).run();
  } catch (e) {
    console.warn('[beehiiv] publish link failed', (e as Error)?.name);
  }
}

/**
 * One founder-pressed sync: one audience snapshot for `today` and the last 20
 * sent posts, landed through the ledger; the channel proposal raised once.
 * A post whose list answer carries no figures is read on its own while the
 * session's budget lasts; past it the post lands without figures and the
 * sync says `partial`. One failed read leaves the other's landing intact;
 * both failing throws the first failure, and nothing is written.
 */
export async function syncBeehiiv(env: Env, reads: BeehiivReads, x: SyncCtx): Promise<BeehiivCounts> {
  const counts: BeehiivCounts = { facts: 0, missing: 0, posts: 0, kept_deleted: 0, proposals: 0, partial: false };
  let audience: BeehiivAudience | null = null;
  let posts: Awaited<ReturnType<BeehiivReads['posts']>> | null = null;
  let first: unknown = null;
  try { audience = await reads.audience(x.publicationId); } catch (e) { first = e; counts.partial = true; }
  try { posts = await reads.posts(x.publicationId); } catch (e) { first ??= e; counts.partial = true; }
  if (!audience && !posts) throw first;

  if (audience) {
    for (const kind of Object.keys(FACT_KINDS) as BeehiivFactKind[]) {
      const v = audience[kind];
      if (v == null) { counts.missing += 1; continue; }
      await landFact(env, x, kind, v, counts);
    }
  }
  for (const p of posts ?? []) {
    let stats: Omit<PostLanding, 'id' | 'title' | 'sent_at'> = p;
    if (!p.has_stats) {
      if (reads.remaining > 0) {
        try { stats = await reads.postStats(x.publicationId, p.id); } catch { counts.partial = true; }
      } else counts.partial = true;
    }
    await landPost(env, x, { id: p.id, title: p.title, sent_at: p.sent_at, ...pickStats(stats) }, counts);
  }
  const raised = await env.DB.prepare(
    "UPDATE beehiiv_publication_links SET channel_state = 'pending', updated_at = datetime('now') WHERE project_id = ? AND integration_id = ? AND channel_state = 'none'",
  ).bind(x.projectId, x.integrationId).run();
  counts.proposals = Number(raised.meta?.changes ?? 0);
  return counts;
}

const pickStats = (s: Omit<PostLanding, 'id' | 'title' | 'sent_at'>) => ({
  recipients: s.recipients, unique_opens: s.unique_opens, open_rate: s.open_rate, unique_clicks: s.unique_clicks, click_rate: s.click_rate,
});

// ═════════════════════════════════════════════════════════════ the reads

interface FactRow { id: number; kind: BeehiivFactKind; period: string; count: number | null; value: number | null; as_of: string }

async function factsOf(env: Env, projectId: number, kinds: readonly string[]): Promise<FactRow[]> {
  return (await env.DB.prepare(
    `SELECT id, kind, period, count, value, as_of FROM beehiiv_grow_facts
      WHERE project_id = ? AND kind IN (SELECT value FROM json_each(?)) ORDER BY kind, period DESC`,
  ).bind(projectId, JSON.stringify(kinds)).all<FactRow>()).results || [];
}

/** Each kind's latest figure, with its change since the snapshot before it for a count; a kind with none says why. */
function figures(rows: FactRow[], kinds: readonly BeehiivFactKind[]) {
  return kinds.map((kind) => {
    const meta = FACT_KINDS[kind];
    const mine = rows.filter((r) => r.kind === kind);
    const [latest, before] = mine;
    if (!latest) return { id: null, kind, label: meta.label, unit: meta.unit, count: null, value: null, period: null, source: null, change: null, reason: `Not recorded: Beehiiv has given no ${meta.label} yet` };
    const change = meta.unit === 'count' && before && latest.count != null && before.count != null ? { since: before.period, delta: latest.count - before.count } : null;
    return { id: latest.id, kind, label: meta.label, unit: meta.unit, count: latest.count, value: latest.value, period: latest.period, source: fromBeehiiv(latest.as_of), change, reason: null };
  });
}

const rateReason = (v: number | null) => (v == null ? 'Not recorded: Beehiiv gave no figure for this post' : null);

async function postsOf(env: Env, projectId: number) {
  const rows = (await env.DB.prepare(
    `SELECT id, post_external_id, title, sent_at, recipients, unique_opens, open_rate, unique_clicks, click_rate, as_of
       FROM beehiiv_post_stats WHERE project_id = ? ORDER BY sent_at IS NULL, sent_at DESC, id DESC LIMIT 20`,
  ).bind(projectId).all<Record<string, unknown>>()).results || [];
  return rows.map((r): Record<string, unknown> & { as_of: string } => ({
    ...r, as_of: String(r.as_of), source: fromBeehiiv(String(r.as_of)),
    open_reason: rateReason(r.open_rate as number | null), click_reason: rateReason(r.click_rate as number | null),
    recipients_reason: r.recipients == null ? 'Not recorded: Beehiiv gave no recipients for this post' : null,
  }));
}

export interface PartViewer { userId: number; support: boolean; writer: boolean }

/**
 * A module's "From Beehiiv" part for one viewer. Not linked and nothing
 * landed: how to connect. Linked and nothing landed: not synced yet. Facts
 * landed: every figure with "From Beehiiv, as of <date>", or its reason.
 */
export async function beehiivPart(env: Env, projectId: number, slug: BeehiivSlug, viewer: PartViewer) {
  const link = await linkOf(env, projectId);
  const rows = await factsOf(env, projectId, PART_KINDS[slug]);
  const posts = slug === 'distribution' ? await postsOf(env, projectId) : [];
  const holder = !!link && link.owner_id === viewer.userId && link.active && !viewer.support && viewer.writer;
  const linkOut = link ? { publication_name: link.publication_name, served_by: { name: link.owner_name }, connected: link.active } : null;
  const common = {
    link: linkOut, can_sync: holder, can_delete: viewer.writer && !viewer.support,
    note: slug === 'revenue-and-traction' ? SENTENCES.not_revenue : SENTENCES.addresses,
  };
  if (!rows.length && !posts.length) {
    if (!link) return { state: 'not_linked' as const, reason: SENTENCES.not_linked, connect_href: CONNECT_HREF, ...common };
    return { state: 'not_recorded' as const, reason: SENTENCES.not_synced, ...common };
  }
  const asOf = [...rows.map((r) => r.as_of), ...posts.map((p) => p.as_of)].sort().at(-1) ?? null;
  const out: Record<string, unknown> = { state: 'ok' as const, ...common, as_of: asOf, source: fromBeehiiv(asOf), figures: figures(rows, PART_KINDS[slug]) };
  if (slug === 'distribution') {
    out.posts = posts;
    out.proposal = await proposalOf(env, link, holder);
  }
  return out;
}

async function proposalOf(env: Env, link: BeehiivLink | null, canDecide: boolean) {
  if (!link || link.channel_state === 'none' || link.channel_state === 'dismissed') return null;
  const name = link.publication_name ?? 'your publication';
  if (link.channel_state === 'pending') {
    return { state: 'pending' as const, can_decide: canDecide, sentence: `Track ${name} as a Distribution channel?`, channel: null };
  }
  const ch = link.growth_channel_id == null ? null
    : await env.DB.prepare('SELECT uid, name FROM growth_channels WHERE id = ? AND project_id = ?').bind(link.growth_channel_id, link.project_id).first<{ uid: string; name: string }>();
  return { state: 'accepted' as const, can_decide: false, sentence: null, channel: ch ? { uid: ch.uid, name: ch.name } : null };
}

// ═════════════════════════════════════════════════════════════ the decisions

export type DecideOutcome = 'ok' | 'not_found' | 'decided' | 'unknown_channel';

/**
 * Accept: link the venture's channel named by uid, or one `create` makes
 * (with the founder's UTM source). Nothing is linked before this.
 */
export async function acceptChannelProposal(env: Env, projectId: number, userId: number, body: { growth_channel_uid?: unknown },
  create: () => Promise<string>): Promise<DecideOutcome> {
  const link = await linkOf(env, projectId);
  if (!link || link.channel_state === 'none') return 'not_found';
  if (link.channel_state !== 'pending') return 'decided';
  const uid = typeof body.growth_channel_uid === 'string' && body.growth_channel_uid ? body.growth_channel_uid : await create();
  const ch = await env.DB.prepare('SELECT id FROM growth_channels WHERE uid = ? AND project_id = ?').bind(uid, projectId).first<{ id: number }>();
  if (!ch) return 'unknown_channel';
  const r = await env.DB.prepare(
    `UPDATE beehiiv_publication_links SET channel_state = 'accepted', growth_channel_id = ?, decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND channel_state = 'pending'`,
  ).bind(ch.id, userId, link.id).run();
  return Number(r.meta?.changes ?? 0) ? 'ok' : 'decided';
}

/** Dismiss: it stays dismissed through every later sync of this link. */
export async function dismissChannelProposal(env: Env, projectId: number, userId: number): Promise<DecideOutcome> {
  const link = await linkOf(env, projectId);
  if (!link || link.channel_state === 'none') return 'not_found';
  const r = await env.DB.prepare(
    `UPDATE beehiiv_publication_links SET channel_state = 'dismissed', decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND channel_state = 'pending'`,
  ).bind(userId, link.id).run();
  return Number(r.meta?.changes ?? 0) ? 'ok' : 'decided';
}

/** Delete a figure or a post; the ledger keeps it deleted through every later sync. The module's slug, or null when none was deleted. */
export async function deleteBeehiivRow(env: Env, store: Store, projectId: number, id: number): Promise<BeehiivSlug | null> {
  const row = store === 'beehiiv_grow_facts'
    ? await env.DB.prepare('DELETE FROM beehiiv_grow_facts WHERE id = ? AND project_id = ? RETURNING module').bind(id, projectId).first<{ module: string }>()
    : await env.DB.prepare('DELETE FROM beehiiv_post_stats WHERE id = ? AND project_id = ? RETURNING id').bind(id, projectId).first<{ id: number }>()
      .then((r) => (r ? { module: 'distribution' } : null));
  if (!row) return null;
  await env.DB.prepare('UPDATE connector_fed_items SET local_id = NULL WHERE project_id = ? AND local_table = ? AND local_id = ?').bind(projectId, store, id).run();
  return row.module === 'revenue_and_traction' ? 'revenue-and-traction' : 'distribution';
}

// ═════════════════════════════════════════════════════════════ Updates rows

/**
 * Why a sent update's `newsletter` is null: it was not drafted to Beehiiv
 * from Axal VC, or its post has not been synced since it was sent from
 * Beehiiv, or the founder deleted that post's figures.
 */
export const NEWSLETTER_NOT_LINKED = 'Not recorded: this update was not drafted to Beehiiv from Axal VC, or its post has not been synced since you sent it from Beehiiv.';
export const NEWSLETTER_UNREADABLE = 'Unreadable: the newsletter figures could not be read.';

export interface UpdateNewsletter { recipients: number | null; open_rate: number | null; click_rate: number | null; as_of: string | null }

/**
 * D2407 part 3: each sent update's newsletter figures, by the update's uid.
 * An update's Beehiiv draft is a PUBLISH draft from the `updates` module whose
 * source refs name `portfolio_updates:<uid>`; its send's post, once synced,
 * carries the figures. The newest synced post wins. A figure Beehiiv did not
 * give stays null, never 0. Null when the read fails.
 */
export async function newsletterByUpdate(env: Env, projectId: number): Promise<Map<string, UpdateNewsletter> | null> {
  try {
    const rows = await env.DB.prepare(
      `SELECT b.recipients, b.open_rate, b.click_rate, b.as_of, d.source_refs_json
         FROM beehiiv_post_stats b
         JOIN publish_sends s ON s.id = b.publish_send_id AND s.provider_key = 'beehiiv' AND s.project_id = b.project_id
         JOIN publish_drafts d ON d.id = s.draft_id AND d.module = 'updates'
        WHERE b.project_id = ?
        ORDER BY b.as_of DESC, b.id DESC LIMIT 100`,
    ).bind(projectId).all<{ recipients: number | null; open_rate: number | null; click_rate: number | null; as_of: string | null; source_refs_json: string }>();
    const out = new Map<string, UpdateNewsletter>();
    for (const r of rows.results || []) {
      let refs: unknown = [];
      try { refs = JSON.parse(r.source_refs_json || '[]'); } catch { refs = []; }
      for (const ref of Array.isArray(refs) ? refs : []) {
        const m = typeof ref?.ref === 'string' ? /^portfolio_updates:([^#]+)$/.exec(ref.ref) : null;
        if (m && !out.has(m[1])) out.set(m[1], { recipients: r.recipients ?? null, open_rate: r.open_rate ?? null, click_rate: r.click_rate ?? null, as_of: r.as_of ?? null });
      }
    }
    return out;
  } catch (e) {
    console.warn('[beehiiv] newsletter figures unreadable', (e as Error)?.name);
    return null;
  }
}
