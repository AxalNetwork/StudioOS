/**
 * D7674 (#7674): reads and reviewed publication for the shared Network directory (#7672's tables).
 *
 * Members read only published entries that are not withdrawn, through one professional projection: no
 * account link, no private source cell, no review item and no duplicate candidate leaves this file
 * through a member read. Operators review readiness and publish organisations; a person is never
 * published here, because the owner has not authorised the people-record import (#7739 Q3 B).
 * Nothing in this file creates an account, a membership, a relationship, a notice or an outreach.
 */
import type { Env } from '../types';

export type Kind = 'person' | 'organization';
export const PAGE_MAX = 50;
export const PAGE_DEFAULT = 25;
export const NOTE_MAX = 2000;
export const QUERY_MAX = 100;

export class DirectoryRefusal extends Error {
  status: number;
  code: string;
  /** Our own sentence for the member, kept apart from Error.message so no thrown text can stand in for it. */
  sentence: string;
  extra: Record<string, unknown>;
  constructor(status: number, code: string, sentence: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.sentence = sentence;
    this.extra = extra;
  }
}

const refuse = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  new DirectoryRefusal(status, code, message, extra);

/** The member-visible rule, in one place: published, and not withdrawn. */
const VISIBLE = "e.publication_status = 'published' AND e.verification_status <> 'withdrawn'";

const parseList = (v: unknown): string[] => {
  try { const a = JSON.parse(String(v ?? '[]')); return Array.isArray(a) ? a.filter(x => typeof x === 'string') : []; }
  catch { return []; }
};

/** The professional projection. Account links, source row ids and raw cells are not in it. */
export function projectEntry(row: any) {
  return {
    uid: row.uid,
    kind: row.kind as Kind,
    name: row.display_name,
    first_name: row.first_name ?? null,
    last_name: row.last_name ?? null,
    profile_url: row.profile_url ?? null,
    website: row.website ?? null,
    geography: row.geography ?? null,
    sectors: parseList(row.sectors_json),
    stages: parseList(row.stages_json),
    source_categories: parseList(row.source_categories_json),
    // NULL is "the source did not say", distinct from the source's No.
    currently_investing: row.currently_investing === null || row.currently_investing === undefined ? null : Number(row.currently_investing) === 1,
    previous_investments_source_text: row.previous_investments_raw ?? null,
    verification: row.verification_status,
    source: { name: row.source_name ?? null, observed_at: row.observed_at },
  };
}

const ENTRY_COLUMNS = `e.uid, e.kind, e.display_name, e.first_name, e.last_name, e.profile_url, e.website, e.geography,
  e.sectors_json, e.stages_json, e.source_categories_json, e.currently_investing, e.previous_investments_raw,
  e.verification_status, e.publication_status, e.observed_at, s.name AS source_name`;

type Cursor = { n: string; u: string };
export function encodeCursor(c: Cursor): string { return btoa(unescape(encodeURIComponent(JSON.stringify(c)))); }
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(decodeURIComponent(escape(atob(raw))));
    if (typeof c?.n === 'string' && typeof c?.u === 'string') return c;
  } catch { /* fall through */ }
  throw refuse(400, 'invalid_cursor', 'That page link is no longer valid. Start the list again.');
}

export function pageSize(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw === '') return PAGE_DEFAULT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > PAGE_MAX) throw refuse(400, 'invalid_limit', `A page holds 1 to ${PAGE_MAX} entries.`);
  return n;
}

export function kindFilter(raw: string | null | undefined): Kind | null {
  if (!raw) return null;
  if (raw === 'person' || raw === 'organization') return raw;
  throw refuse(400, 'invalid_kind', 'Kind is person or organization.');
}

/** A search term matches anywhere in the name; % and _ are matched as typed. */
export function likeTerm(raw: string | null | undefined): string | null {
  const q = String(raw ?? '').trim();
  if (!q) return null;
  if (q.length > QUERY_MAX) throw refuse(400, 'query_too_long', `A search is at most ${QUERY_MAX} characters.`);
  return '%' + q.replace(/[\\%_]/g, ch => '\\' + ch) + '%';
}

/** The member directory: one page and the true total under the same WHERE. */
export async function searchDirectory(env: Env, opts: { q?: string | null; kind?: string | null; cursor?: string | null; limit?: string | null }) {
  const term = likeTerm(opts.q);
  const kind = kindFilter(opts.kind);
  const limit = pageSize(opts.limit);
  const cursor = decodeCursor(opts.cursor);
  const where = [VISIBLE];
  const binds: unknown[] = [];
  if (kind) { where.push('e.kind = ?'); binds.push(kind); }
  // A search also matches an organisation's active, operator-reviewed alias (D7674 part 3).
  if (term) {
    where.push(`(e.display_name LIKE ? ESCAPE '\\' OR (e.kind = 'organization' AND EXISTS (
      SELECT 1 FROM network_directory_aliases al WHERE al.status = 'active' AND al.alias LIKE ? ESCAPE '\\'
         AND (al.entry_uid = e.uid OR al.entry_uid IN (SELECT rd.from_uid FROM network_directory_redirects rd WHERE rd.to_uid = e.uid)))))`);
    binds.push(term, term);
  }
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM network_directory_entries e WHERE ${where.join(' AND ')}`)
    .bind(...binds).first<{ n: number }>();
  const pageWhere = [...where];
  const pageBinds = [...binds];
  if (cursor) { pageWhere.push('(e.display_name > ? OR (e.display_name = ? AND e.uid > ?))'); pageBinds.push(cursor.n, cursor.n, cursor.u); }
  const rows = (await env.DB.prepare(
    `SELECT ${ENTRY_COLUMNS} FROM network_directory_entries e JOIN network_directory_sources s ON s.uid = e.source_uid
     WHERE ${pageWhere.join(' AND ')} ORDER BY e.display_name, e.uid LIMIT ?`,
  ).bind(...pageBinds, limit + 1).all<any>()).results ?? [];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    entries: page.map(projectEntry),
    total: Number(total?.n ?? 0),
    next_cursor: rows.length > limit && last ? encodeCursor({ n: last.display_name, u: last.uid }) : null,
  };
}

/**
 * The canonical uid for a reference: a merged-away entry's stable redirect target, else the uid itself
 * (D7674 part 3). Redirects are kept one hop, so one read answers.
 */
export async function canonicalUid(env: Env, uid: string): Promise<string> {
  const r = await env.DB.prepare('SELECT to_uid FROM network_directory_redirects WHERE from_uid = ?').bind(uid).first<{ to_uid: string }>();
  return r?.to_uid ?? uid;
}

/**
 * Associations of an entry and of every entry merged into it, each to the other side's canonical entry, which
 * must itself be visible. One static statement per side, so no column name is interpolated.
 */
const LINKS_SQL = {
  person: `SELECT a.title, a.relation_kind, a.is_current, a.start_date, a.end_date, a.verification_status, a.observed_at,
            e.uid AS other_uid, e.display_name AS other_name
       FROM network_directory_affiliations a
       JOIN network_directory_entries e ON e.uid = COALESCE(
         (SELECT rd.to_uid FROM network_directory_redirects rd WHERE rd.from_uid = a.organization_uid), a.organization_uid)
      WHERE (a.person_uid = ? OR a.person_uid IN (SELECT from_uid FROM network_directory_redirects WHERE to_uid = ?))
        AND a.verification_status <> 'withdrawn'
        AND e.publication_status = 'published' AND e.verification_status <> 'withdrawn'
      ORDER BY e.display_name, e.uid, a.observed_at DESC, a.uid`,
  organization: `SELECT a.title, a.relation_kind, a.is_current, a.start_date, a.end_date, a.verification_status, a.observed_at,
            e.uid AS other_uid, e.display_name AS other_name
       FROM network_directory_affiliations a
       JOIN network_directory_entries e ON e.uid = COALESCE(
         (SELECT rd.to_uid FROM network_directory_redirects rd WHERE rd.from_uid = a.person_uid), a.person_uid)
      WHERE (a.organization_uid = ? OR a.organization_uid IN (SELECT from_uid FROM network_directory_redirects WHERE to_uid = ?))
        AND a.verification_status <> 'withdrawn'
        AND e.publication_status = 'published' AND e.verification_status <> 'withdrawn'
      ORDER BY e.display_name, e.uid, a.observed_at DESC, a.uid`,
} as const;

/**
 * One published entry with its sourced associations; an association to a hidden entry is left out. A merged-away
 * uid answers its canonical entry with `redirected_from`, and only while that entry is visible (D7674 part 3).
 */
export async function readEntry(env: Env, requested: string) {
  const uid = await canonicalUid(env, requested);
  const row = await env.DB.prepare(
    `SELECT ${ENTRY_COLUMNS} FROM network_directory_entries e JOIN network_directory_sources s ON s.uid = e.source_uid
     WHERE e.uid = ? AND ${VISIBLE}`,
  ).bind(uid).first<any>();
  if (!row) throw refuse(404, 'entry_not_found', 'There is no published directory entry with that reference.');
  const entry = projectEntry(row);
  const kind: Kind = row.kind === 'person' ? 'person' : 'organization';
  const links = (await env.DB.prepare(LINKS_SQL[kind]).bind(uid, uid).all<any>()).results ?? [];
  const seen = new Set<string>();
  const affiliations = [];
  for (const a of links) {
    // An affiliation the source did not date is unknown, never assumed current.
    const current = a.is_current === null || a.is_current === undefined ? 'unknown' : Number(a.is_current) === 1 ? 'current' : 'former';
    // The same claim held by an entry and by one merged into it is listed once, from its latest observation.
    const k = JSON.stringify([a.other_uid, a.relation_kind, a.title ?? null, current, a.start_date ?? null, a.end_date ?? null]);
    if (seen.has(k)) continue;
    seen.add(k);
    affiliations.push({
      [kind === 'person' ? 'organization' : 'person']: { uid: a.other_uid, name: a.other_name },
      title: a.title ?? null,
      relation: a.relation_kind,
      current,
      start_date: a.start_date ?? null,
      end_date: a.end_date ?? null,
      verification: a.verification_status,
      observed_at: a.observed_at,
    });
  }
  // Active aliases of the entry and of every organisation merged into it, one per name.
  const aliasRows = kind === 'organization'
    ? (await env.DB.prepare(
      `SELECT alias, alias_key FROM network_directory_aliases
        WHERE status = 'active' AND (entry_uid = ? OR entry_uid IN (SELECT from_uid FROM network_directory_redirects WHERE to_uid = ?))
        ORDER BY alias_key, uid`,
    ).bind(uid, uid).all<{ alias: string; alias_key: string }>()).results ?? []
    : [];
  const aliasKeys = new Set<string>();
  const aliases = aliasRows.filter(a => !aliasKeys.has(a.alias_key) && !!aliasKeys.add(a.alias_key)).map(a => a.alias);
  return { entry, affiliations, aliases, redirected_from: uid === requested ? null : requested };
}

/* ---------------------------------------------------------------- the member's private overlay */

/** The visible person an overlay is kept on, after following a merge redirect. */
async function overlayTarget(env: Env, requested: string) {
  const uid = await canonicalUid(env, requested);
  const row = await env.DB.prepare(
    `SELECT e.uid, e.kind FROM network_directory_entries e WHERE e.uid = ? AND ${VISIBLE}`,
  ).bind(uid).first<{ uid: string; kind: Kind }>();
  if (!row) throw refuse(404, 'entry_not_found', 'There is no published directory entry with that reference.');
  if (row.kind !== 'person') throw refuse(409, 'overlay_person_only', 'A private note is kept on a person, not on an organization.');
  return row;
}

const overlayShape = (r: any) => r ? { saved: Number(r.saved) === 1, private_note: r.private_note ?? null, updated_at: r.updated_at } : null;

/** The caller's own overlay. Nobody else's is ever selected: the owner is the caller's id in every statement. */
export async function readOverlay(env: Env, userId: number, requested: string) {
  const { uid } = await overlayTarget(env, requested);
  const r = await env.DB.prepare(
    'SELECT saved, private_note, updated_at FROM network_directory_overlays WHERE owner_user_id = ? AND entry_uid = ?',
  ).bind(userId, uid).first<any>();
  // The caller's own overlays on entries merged into this one stay where they were written and are shown here.
  const merged = (await env.DB.prepare(
    `SELECT o.entry_uid, o.saved, o.private_note, o.updated_at FROM network_directory_overlays o
      WHERE o.owner_user_id = ? AND o.entry_uid IN (SELECT from_uid FROM network_directory_redirects WHERE to_uid = ?)
      ORDER BY o.updated_at DESC, o.entry_uid`,
  ).bind(userId, uid).all<any>()).results ?? [];
  return { overlay: overlayShape(r), merged_overlays: merged.map(m => ({ merged_from: m.entry_uid, ...overlayShape(m) })) };
}

export function overlayInput(body: Record<string, unknown>) {
  const out: { saved?: number; private_note?: string | null } = {};
  if ('saved' in body) {
    if (typeof body.saved !== 'boolean') throw refuse(400, 'invalid_saved', 'Saved is true or false.');
    out.saved = body.saved ? 1 : 0;
  }
  if ('private_note' in body) {
    const n = body.private_note;
    if (n !== null && typeof n !== 'string') throw refuse(400, 'invalid_note', 'A note is text.');
    const t = typeof n === 'string' ? n.trim() : '';
    if (t.length > NOTE_MAX) throw refuse(400, 'note_too_long', `A note is at most ${NOTE_MAX} characters.`);
    out.private_note = t ? t : null;
  }
  if (!('saved' in out) && !('private_note' in out)) throw refuse(400, 'nothing_to_change', 'Send saved, a private note, or both.');
  return out;
}

export async function writeOverlay(env: Env, userId: number, requested: string, input: { saved?: number; private_note?: string | null }) {
  const { uid } = await overlayTarget(env, requested);
  await env.DB.prepare(
    `INSERT INTO network_directory_overlays (owner_user_id, entry_uid, entry_kind, saved, private_note, updated_at)
     VALUES (?, ?, 'person', ?, ?, datetime('now'))
     ON CONFLICT (owner_user_id, entry_uid) DO UPDATE SET
       saved = CASE WHEN ? THEN excluded.saved ELSE network_directory_overlays.saved END,
       private_note = CASE WHEN ? THEN excluded.private_note ELSE network_directory_overlays.private_note END,
       updated_at = datetime('now')`,
  ).bind(userId, uid, input.saved ?? 0, input.private_note ?? null, 'saved' in input ? 1 : 0, 'private_note' in input ? 1 : 0).run();
  return readOverlay(env, userId, uid);
}

/** Clears the caller's own overlay on the entry and on every entry merged into it; nobody else's row is touched. */
export async function deleteOverlay(env: Env, userId: number, requested: string) {
  const uid = await canonicalUid(env, requested);
  await env.DB.prepare(
    `DELETE FROM network_directory_overlays WHERE owner_user_id = ?
       AND (entry_uid = ? OR entry_uid IN (SELECT from_uid FROM network_directory_redirects WHERE to_uid = ?))`,
  ).bind(userId, uid, uid).run();
  return { overlay: null, merged_overlays: [] };
}

/* ---------------------------------------------------------------- operator review and publication */

export type Readiness = { ready: boolean; blockers: string[]; checked_source_record_uid: string | null };

/**
 * Whether an entry may be published now, read from the LATEST observation of every source row behind it.
 * Finding an accepted snapshot is not enough (14:27Z note on #7674): a later held or skipped observation of
 * the same source row, two different observations at the same time, or an open review on any of them blocks it.
 */
export async function readiness(env: Env, uid: string): Promise<Readiness> {
  // The entity is this entry and every entry merged into it (D7674 part 3): all their source rows count.
  const merged = ((await env.DB.prepare('SELECT from_uid FROM network_directory_redirects WHERE to_uid = ?')
    .bind(uid).all<{ from_uid: string }>()).results ?? []).map(r => r.from_uid);
  const group = new Set([uid, ...merged]);
  const identities = (await env.DB.prepare(
    `SELECT DISTINCT source_uid, external_record_id FROM network_directory_source_records
      WHERE entry_uid = ? OR entry_uid IN (SELECT from_uid FROM network_directory_redirects WHERE to_uid = ?)
      ORDER BY source_uid, external_record_id`,
  ).bind(uid, uid).all<{ source_uid: string; external_record_id: string }>()).results ?? [];
  if (!identities.length) return { ready: false, blockers: ['no_source_record'], checked_source_record_uid: null };
  const blockers = new Set<string>();
  let checked: string | null = null;
  let checkedOwn = false;
  for (const id of identities) {
    const obs = (await env.DB.prepare(
      `SELECT uid, entry_uid, disposition, content_hash, decision_hash, observed_at FROM network_directory_source_records
        WHERE source_uid = ? AND external_record_id = ? ORDER BY observed_at DESC, uid`,
    ).bind(id.source_uid, id.external_record_id).all<any>()).results ?? [];
    const latestAt = obs[0]?.observed_at;
    const latest = obs.filter(o => o.observed_at === latestAt);
    if (new Set(latest.map(o => o.content_hash + ':' + o.decision_hash)).size > 1) blockers.add('same_time_conflict');
    const head = latest[0];
    if (!head || head.disposition !== 'accept' || !group.has(head.entry_uid)) blockers.add('latest_observation_not_accepted');
    // The checked observation is the entry's own where it has one, else one merged into it.
    else if (!checked || (!checkedOwn && head.entry_uid === uid)) { checked = head.uid; checkedOwn = head.entry_uid === uid; }
  }
  // One bound value however many observations a source row has (D1 allows 100 per statement).
  const open = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM network_directory_reviews r WHERE r.status = 'pending' AND EXISTS (
       SELECT 1 FROM network_directory_source_records o
        WHERE (o.uid = r.source_record_uid OR o.uid = r.candidate_record_uid)
          AND (o.source_uid, o.external_record_id) IN (
            SELECT source_uid, external_record_id FROM network_directory_source_records
             WHERE entry_uid = ? OR entry_uid IN (SELECT from_uid FROM network_directory_redirects WHERE to_uid = ?)))`,
  ).bind(uid, uid).first<{ n: number }>();
  if (Number(open?.n ?? 0) > 0) blockers.add('open_review');
  const list = [...blockers].sort();
  return { ready: list.length === 0, blockers: list, checked_source_record_uid: list.length ? null : checked };
}

const PUBLICATION_FILTER = new Set(['staged', 'published', 'suppressed', 'archived', 'all']);

/** Operator list: every entry under a publication status with its readiness; no raw source cell. */
export async function operatorEntries(env: Env, opts: { status?: string | null; kind?: string | null; cursor?: string | null; limit?: string | null }) {
  const status = opts.status || 'staged';
  if (!PUBLICATION_FILTER.has(status)) throw refuse(400, 'invalid_status', 'Status is staged, published, suppressed, archived or all.');
  const kind = kindFilter(opts.kind);
  const limit = pageSize(opts.limit);
  const cursor = decodeCursor(opts.cursor);
  const where: string[] = ['1 = 1'];
  const binds: unknown[] = [];
  if (status !== 'all') { where.push('e.publication_status = ?'); binds.push(status); }
  if (kind) { where.push('e.kind = ?'); binds.push(kind); }
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM network_directory_entries e WHERE ${where.join(' AND ')}`).bind(...binds).first<{ n: number }>();
  if (cursor) { where.push('(e.display_name > ? OR (e.display_name = ? AND e.uid > ?))'); binds.push(cursor.n, cursor.n, cursor.u); }
  const rows = (await env.DB.prepare(
    `SELECT ${ENTRY_COLUMNS} FROM network_directory_entries e JOIN network_directory_sources s ON s.uid = e.source_uid
      WHERE ${where.join(' AND ')} ORDER BY e.display_name, e.uid LIMIT ?`,
  ).bind(...binds, limit + 1).all<any>()).results ?? [];
  const page = rows.slice(0, limit);
  const entries = [];
  for (const r of page) {
    entries.push({ ...projectEntry(r), publication_status: r.publication_status, readiness: await readiness(env, r.uid),
      people_publication_held: r.kind === 'person' });
  }
  const last = page[page.length - 1];
  return { entries, total: Number(total?.n ?? 0), next_cursor: rows.length > limit && last ? encodeCursor({ n: last.display_name, u: last.uid }) : null };
}

const REVIEW_FILTER = new Set(['pending', 'kept_separate', 'resolved', 'dismissed', 'all']);

/** Review items stay inspectable: the reason and the two source rows' kinds, dispositions and dates. */
export async function operatorReviews(env: Env, opts: { status?: string | null; limit?: string | null; after?: string | null }) {
  const status = opts.status || 'pending';
  if (!REVIEW_FILTER.has(status)) throw refuse(400, 'invalid_status', 'Status is pending, kept_separate, resolved, dismissed or all.');
  const limit = pageSize(opts.limit);
  const where: string[] = ['1 = 1'];
  const binds: unknown[] = [];
  if (status !== 'all') { where.push('r.status = ?'); binds.push(status); }
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM network_directory_reviews r WHERE ${where.join(' AND ')}`).bind(...binds).first<{ n: number }>();
  if (opts.after) { where.push('r.uid > ?'); binds.push(opts.after); }
  const rows = (await env.DB.prepare(
    `SELECT r.uid, r.reason, r.status, r.created_at,
            a.uid AS a_uid, a.source_uid AS a_source, a.disposition AS a_disposition, a.entry_kind AS a_kind, a.observed_at AS a_observed,
            b.uid AS b_uid, b.source_uid AS b_source, b.disposition AS b_disposition, b.entry_kind AS b_kind, b.observed_at AS b_observed
       FROM network_directory_reviews r
       JOIN network_directory_source_records a ON a.uid = r.source_record_uid
       LEFT JOIN network_directory_source_records b ON b.uid = r.candidate_record_uid
      WHERE ${where.join(' AND ')} ORDER BY r.uid LIMIT ?`,
  ).bind(...binds, limit + 1).all<any>()).results ?? [];
  const page = rows.slice(0, limit);
  const side = (r: any, p: 'a' | 'b') => r[p + '_uid'] ? { source_record_uid: r[p + '_uid'], source: r[p + '_source'], disposition: r[p + '_disposition'], entry_kind: r[p + '_kind'] ?? null, observed_at: r[p + '_observed'] } : null;
  return {
    reviews: page.map(r => ({ uid: r.uid, reason: r.reason, status: r.status, created_at: r.created_at, record: side(r, 'a'), candidate: side(r, 'b') })),
    total: Number(total?.n ?? 0),
    next_after: rows.length > limit ? page[page.length - 1].uid : null,
  };
}

const KEY = /^[A-Za-z0-9_.:-]{8,120}$/;

export function changeInput(body: Record<string, unknown>) {
  const key = body.idempotency_key;
  if (typeof key !== 'string' || !KEY.test(key)) throw refuse(400, 'invalid_idempotency_key', 'Send an idempotency key of 8 to 120 letters, digits or . _ : -.');
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 3 || reason.length > 500) throw refuse(400, 'invalid_reason', 'Give a reason of 3 to 500 characters.');
  return { key, reason };
}

async function eventByKey(env: Env, key: string) {
  return env.DB.prepare(
    'SELECT uid, entry_uid, action, from_status, to_status, checked_source_record_uid, reason, actor_user_id, created_at FROM network_directory_publication_events WHERE idempotency_key = ?',
  ).bind(key).first<any>();
}

async function entryRow(env: Env, uid: string) {
  return env.DB.prepare('SELECT uid, kind, publication_status, verification_status FROM network_directory_entries WHERE uid = ?')
    .bind(uid).first<{ uid: string; kind: Kind; publication_status: string; verification_status: string }>();
}

/** A replayed key returns its first answer; a key reused for another change is refused. */
async function replayed(env: Env, key: string, uid: string, action: 'publish' | 'suppress') {
  const prior = await eventByKey(env, key);
  if (!prior) return null;
  if (prior.entry_uid !== uid || prior.action !== action) {
    throw refuse(409, 'idempotency_key_reused', 'That idempotency key was already used for a different change.');
  }
  return { event: prior, entry: await entryRow(env, uid), replayed: true };
}

/**
 * Publish one organisation. The event is written first, conditioned on the entry still being staged, and the
 * entry is moved only when that event exists, in one batch: a concurrent second request finds the entry no
 * longer staged and writes nothing. The answer is read back from the database, not assumed.
 */
export async function publishEntry(env: Env, actorId: number, uid: string, input: { key: string; reason: string }) {
  const prior = await replayed(env, input.key, uid, 'publish');
  if (prior) return prior;
  const entry = await entryRow(env, uid);
  if (!entry) throw refuse(404, 'entry_not_found', 'There is no directory entry with that reference.');
  if (entry.kind === 'person') {
    throw refuse(409, 'people_publication_held', 'People are not published from this directory: the owner has not authorised the people-record import (#7739). Organisations can be published.');
  }
  if (entry.verification_status === 'withdrawn') throw refuse(409, 'entry_withdrawn', 'A withdrawn entry cannot be published.');
  if (entry.publication_status === 'published') throw refuse(409, 'already_published', 'This entry is already published.');
  if (entry.publication_status !== 'staged') throw refuse(409, 'entry_not_staged', 'Only a staged entry can be published. A suppressed or archived entry stays as it is.');
  const ready = await readiness(env, uid);
  if (!ready.ready) throw refuse(409, 'publication_not_ready', 'This entry is not ready to publish: its latest source observation or an open review blocks it.', { blockers: ready.blockers });
  const eventUid = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO network_directory_publication_events (uid, idempotency_key, entry_uid, action, from_status, to_status, checked_source_record_uid, reason, actor_user_id)
       SELECT ?, ?, uid, 'publish', 'staged', 'published', ?, ?, ? FROM network_directory_entries
        WHERE uid = ? AND kind = 'organization' AND publication_status = 'staged' AND verification_status <> 'withdrawn'`,
    ).bind(eventUid, input.key, ready.checked_source_record_uid, input.reason, actorId, uid),
    env.DB.prepare(
      `UPDATE network_directory_entries SET publication_status = 'published'
        WHERE uid = ? AND publication_status = 'staged'
          AND EXISTS (SELECT 1 FROM network_directory_publication_events WHERE uid = ? AND idempotency_key = ?)`,
    ).bind(uid, eventUid, input.key),
  ]);
  const written = await eventByKey(env, input.key);
  if (!written) {
    const again = await replayed(env, input.key, uid, 'publish');
    if (again) return again;
    throw refuse(409, 'entry_changed', 'The entry changed while this was being published. Read it again before retrying.');
  }
  return { event: written, entry: await entryRow(env, uid), replayed: false };
}

/** Suppress hides an entry from members (a person or an organisation). Its sources, overlays and history stay. */
export async function suppressEntry(env: Env, actorId: number, uid: string, input: { key: string; reason: string }) {
  const prior = await replayed(env, input.key, uid, 'suppress');
  if (prior) return prior;
  const entry = await entryRow(env, uid);
  if (!entry) throw refuse(404, 'entry_not_found', 'There is no directory entry with that reference.');
  if (entry.publication_status === 'suppressed') throw refuse(409, 'already_suppressed', 'This entry is already suppressed.');
  if (entry.publication_status === 'archived') throw refuse(409, 'entry_archived', 'An archived entry is not shown and cannot be suppressed.');
  const eventUid = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO network_directory_publication_events (uid, idempotency_key, entry_uid, action, from_status, to_status, reason, actor_user_id)
       SELECT ?, ?, uid, 'suppress', publication_status, 'suppressed', ?, ? FROM network_directory_entries
        WHERE uid = ? AND publication_status IN ('staged', 'published')`,
    ).bind(eventUid, input.key, input.reason, actorId, uid),
    env.DB.prepare(
      `UPDATE network_directory_entries SET publication_status = 'suppressed'
        WHERE uid = ? AND publication_status IN ('staged', 'published')
          AND EXISTS (SELECT 1 FROM network_directory_publication_events WHERE uid = ? AND idempotency_key = ?)`,
    ).bind(uid, eventUid, input.key),
  ]);
  const written = await eventByKey(env, input.key);
  if (!written) {
    const again = await replayed(env, input.key, uid, 'suppress');
    if (again) return again;
    throw refuse(409, 'entry_changed', 'The entry changed while this was being suppressed. Read it again before retrying.');
  }
  return { event: written, entry: await entryRow(env, uid), replayed: false };
}
