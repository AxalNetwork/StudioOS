/**
 * D7674 part 3 (#7674): reviewed merge, stable redirects, organisation aliases and review decisions for the shared
 * Network directory (#7672's tables).
 *
 * A merge rewrites no evidence. The merged-away entry keeps its source observations, private source rows,
 * affiliations, members' private overlays, introduction requests, book links and Research links exactly as they were;
 * it is archived (so members no longer list it) and gets a one-hop redirect to the canonical entry, which readers in
 * `services/networkDirectory.ts` follow. The two entries must be the same kind, so a person and an organisation that
 * share an identifier stay a review item. An entry carrying a verified account or company link is never merged away.
 *
 * Review items stay inspectable: a decision is a new row in `network_directory_review_decisions` and moves the
 * review's status; the review and both observations it names are kept. Aliases are organisation-only and operator
 * entered; an alias that names another organisation, or is that organisation's alias, is refused as competing.
 *
 * Every write here is an idempotent, write-barred Super Admin action: the row is inserted only while the entries
 * are still in the state that was checked, and the answer is read back from the database. Nothing here reads
 * `network_directory_private_sources` or a member's note, creates an account, a membership, a relationship, a
 * notice or an outreach, or publishes an entry.
 */
import type { Env } from '../types';
import { DirectoryRefusal, changeInput, readiness, type Kind } from './networkDirectory';

const refuse = (status: number, code: string, sentence: string, extra: Record<string, unknown> = {}) =>
  new DirectoryRefusal(status, code, sentence, extra);

const UID = /^[A-Za-z0-9_.:-]{1,200}$/;
export const ALIAS_MAX = 300;

/**
 * A write that lost a race to a concurrent one hits a uniqueness index and writes nothing; the caller then reads
 * back by its key and answers from what is stored. Any other failure is not a race and is thrown.
 */
function lostRace(e: unknown, what: string) {
  if (!/UNIQUE constraint failed/i.test(String((e as Error)?.message ?? ''))) throw e;
  console.warn('[network_directory] ' + what + ' lost a concurrent write');
}

type EntryState = { uid: string; kind: Kind; display_name: string; publication_status: string; linked: number; merged_into: string | null };

async function entryState(env: Env, uid: string): Promise<EntryState | null> {
  return env.DB.prepare(
    `SELECT e.uid, e.kind, e.display_name, e.publication_status,
            (e.linked_user_id IS NOT NULL OR e.linked_company_id IS NOT NULL) AS linked,
            (SELECT to_uid FROM network_directory_redirects WHERE from_uid = e.uid) AS merged_into
       FROM network_directory_entries e WHERE e.uid = ?`,
  ).bind(uid).first<EntryState>();
}

/** Counts of what a merged-away entry keeps. Counted, never selected: no member note leaves here. */
async function preserved(env: Env, uid: string) {
  const r = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM network_directory_source_records WHERE entry_uid = ?1) AS source_records,
       (SELECT COUNT(*) FROM network_directory_affiliations WHERE person_uid = ?1 OR organization_uid = ?1) AS affiliations,
       (SELECT COUNT(*) FROM network_directory_overlays WHERE entry_uid = ?1) AS overlays,
       (SELECT COUNT(*) FROM network_intro_requests WHERE target_entry_uid = ?1 OR organization_entry_uid = ?1) AS intro_requests,
       (SELECT COUNT(*) FROM network_directory_book_links WHERE person_uid = ?1) AS book_links,
       (SELECT COUNT(*) FROM network_directory_research_links WHERE organization_uid = ?1) AS research_links`,
  ).bind(uid).first<Record<string, number>>();
  return Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, Number(v)]));
}

/* ---------------------------------------------------------------- reviewed merge */

export function mergeInput(body: Record<string, unknown>) {
  const { key, reason } = changeInput(body);
  const into = body.into_uid;
  if (typeof into !== 'string' || !UID.test(into)) throw refuse(400, 'invalid_into_uid', 'Name the directory entry to merge into.');
  const review = body.review_uid;
  if (review !== undefined && review !== null && (typeof review !== 'string' || !UID.test(review))) {
    throw refuse(400, 'invalid_review_uid', 'A review reference is letters, digits or . _ : -.');
  }
  return { key, reason, into, review: typeof review === 'string' ? review : null };
}


async function mergeByKey(env: Env, key: string) {
  return env.DB.prepare(`SELECT uid, kind, from_uid, to_uid, from_publication_status, review_uid, reason, actor_user_id, created_at FROM network_directory_merges WHERE idempotency_key = ?`).bind(key).first<any>();
}

/**
 * Merge `fromUid` into `input.into`. Refusals write nothing. The merge row is inserted only while both entries are
 * still mergeable; every other statement in the batch runs only when that row exists, so the batch is all or nothing.
 */
export async function mergeEntries(env: Env, actorId: number, fromUid: string, input: ReturnType<typeof mergeInput>) {
  const prior = await mergeByKey(env, input.key);
  if (prior) {
    if (prior.from_uid !== fromUid || prior.to_uid !== input.into || (prior.review_uid ?? null) !== input.review) {
      throw refuse(409, 'idempotency_key_reused', 'That idempotency key was already used for a different change.');
    }
    return { merge: prior, preserved: await preserved(env, fromUid), replayed: true };
  }
  if (fromUid === input.into) throw refuse(400, 'merge_into_self', 'An entry cannot be merged into itself.');
  const from = await entryState(env, fromUid);
  if (!from) throw refuse(404, 'entry_not_found', 'There is no directory entry with that reference.');
  const to = await entryState(env, input.into);
  if (!to) throw refuse(404, 'merge_target_not_found', 'There is no directory entry to merge into with that reference.');
  if (from.kind !== to.kind) {
    throw refuse(409, 'kind_mismatch', 'A person and an organisation are never merged. Keep them separate or correct the source.');
  }
  if (from.merged_into || from.publication_status === 'archived') {
    throw refuse(409, 'already_merged', 'This entry was already merged or archived.', { merged_into: from.merged_into });
  }
  if (to.merged_into) {
    throw refuse(409, 'merge_target_merged', 'The entry to merge into was itself merged. Merge into its canonical entry.', { canonical_uid: to.merged_into });
  }
  if (to.publication_status === 'archived') throw refuse(409, 'merge_target_archived', 'An archived entry cannot receive a merge.');
  if (Number(from.linked) === 1) {
    throw refuse(409, 'merge_source_linked', 'An entry with a verified account or company link is never merged away. Merge the other entry into it.');
  }
  if (input.review) {
    const review = await env.DB.prepare('SELECT status FROM network_directory_reviews WHERE uid = ?').bind(input.review).first<{ status: string }>();
    if (!review) throw refuse(404, 'review_not_found', 'There is no review item with that reference.');
    if (review.status !== 'pending') throw refuse(409, 'review_not_pending', 'That review item was already decided.');
    const about = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM network_directory_reviews r
         JOIN network_directory_source_records o ON o.uid IN (r.source_record_uid, r.candidate_record_uid)
        WHERE r.uid = ? AND (o.source_uid, o.external_record_id) IN (
          SELECT source_uid, external_record_id FROM network_directory_source_records WHERE entry_uid IN (?, ?))`,
    ).bind(input.review, fromUid, input.into).first<{ n: number }>();
    if (!Number(about?.n ?? 0)) {
      throw refuse(409, 'review_not_about_entries', 'That review item names neither entry’s source rows, so this merge cannot resolve it.');
    }
  }
  const mergeUid = crypto.randomUUID();
  const statements = [
    env.DB.prepare(
      `INSERT INTO network_directory_merges (uid, idempotency_key, kind, from_uid, to_uid, from_publication_status, review_uid, reason, actor_user_id)
       SELECT ?, ?, f.kind, f.uid, t.uid, f.publication_status, ?, ?, ?
         FROM network_directory_entries f JOIN network_directory_entries t ON t.uid = ?
        WHERE f.uid = ? AND f.kind = t.kind AND f.publication_status IN ('staged', 'published', 'suppressed')
          AND t.publication_status <> 'archived' AND f.linked_user_id IS NULL AND f.linked_company_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM network_directory_redirects WHERE from_uid IN (f.uid, t.uid))
          AND (? IS NULL OR EXISTS (SELECT 1 FROM network_directory_reviews WHERE uid = ? AND status = 'pending'))`,
    ).bind(mergeUid, input.key, input.review, input.reason, actorId, input.into, fromUid, input.review, input.review),
    // Redirects stay one hop: entries already merged into the merged-away entry now point at the canonical one.
    env.DB.prepare(
      `UPDATE network_directory_redirects SET to_uid = ?, updated_at = datetime('now') WHERE to_uid = ? AND EXISTS (SELECT 1 FROM network_directory_merges WHERE uid = ? AND idempotency_key = ?)`,
    ).bind(input.into, fromUid, mergeUid, input.key),
    env.DB.prepare(
      `INSERT INTO network_directory_redirects (from_uid, to_uid, merge_uid)
       SELECT from_uid, to_uid, uid FROM network_directory_merges WHERE uid = ? AND idempotency_key = ?`,
    ).bind(mergeUid, input.key),
    env.DB.prepare(
      `UPDATE network_directory_entries SET publication_status = 'archived' WHERE uid = ? AND EXISTS (SELECT 1 FROM network_directory_merges WHERE uid = ? AND idempotency_key = ?)`,
    ).bind(fromUid, mergeUid, input.key),
  ];
  // An organisation keeps the merged-away name as an alias, so a search by it still finds the canonical entry.
  const fromKey = aliasKey(from.display_name);
  if (from.kind === 'organization' && fromKey && fromKey !== aliasKey(to.display_name)) {
    statements.push(env.DB.prepare(
      `INSERT INTO network_directory_aliases (uid, idempotency_key, entry_uid, alias, alias_key, origin, merge_uid, reason, created_by)
       SELECT ?, ?, m.to_uid, f.display_name, ?, 'merge', m.uid, m.reason, m.actor_user_id
         FROM network_directory_merges m JOIN network_directory_entries f ON f.uid = m.from_uid
        WHERE m.uid = ? AND m.idempotency_key = ? AND m.kind = 'organization'
       ON CONFLICT DO NOTHING`,
    ).bind(crypto.randomUUID(), 'merge-alias:' + mergeUid, fromKey, mergeUid, input.key));
  }
  if (input.review) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO network_directory_review_decisions (uid, idempotency_key, review_uid, decision, merge_uid, reason, actor_user_id)
         SELECT ?, ?, r.uid, 'resolved', m.uid, m.reason, m.actor_user_id
           FROM network_directory_reviews r JOIN network_directory_merges m ON m.uid = ? AND m.idempotency_key = ?
          WHERE r.uid = ? AND r.status = 'pending'`,
      ).bind(crypto.randomUUID(), 'merge-review:' + mergeUid, mergeUid, input.key, input.review),
      env.DB.prepare(
        `UPDATE network_directory_reviews SET status = 'resolved'
          WHERE uid = ? AND status = 'pending'
            AND EXISTS (SELECT 1 FROM network_directory_review_decisions WHERE review_uid = ? AND merge_uid = ?)`,
      ).bind(input.review, input.review, mergeUid),
    );
  }
  try { await env.DB.batch(statements); }
  catch (e) {
    // A concurrent merge of the same entry under another key hits the one-merge-per-entry index: nothing was written.
    lostRace(e, 'merge batch');
  }
  const written = await mergeByKey(env, input.key);
  if (!written) throw refuse(409, 'entry_changed', 'One of the entries changed while this merge was checked. Read them again before retrying.');
  return { merge: written, preserved: await preserved(env, fromUid), replayed: false };
}

/* ---------------------------------------------------------------- review decisions */

const DECISIONS = new Set(['kept_separate', 'dismissed']);

export function decisionInput(body: Record<string, unknown>) {
  const { key, reason } = changeInput(body);
  const decision = body.decision;
  if (typeof decision !== 'string' || !DECISIONS.has(decision)) {
    throw refuse(400, 'invalid_decision', 'A decision is kept_separate or dismissed. A review is resolved by the merge that names it.');
  }
  return { key, reason, decision: decision as 'kept_separate' | 'dismissed' };
}

async function decisionByKey(env: Env, key: string) {
  return env.DB.prepare(
    'SELECT uid, review_uid, decision, merge_uid, reason, actor_user_id, created_at FROM network_directory_review_decisions WHERE idempotency_key = ?',
  ).bind(key).first<any>();
}

/** Record an operator's decision on one pending review item. The review and its observations stay. */
export async function decideReview(env: Env, actorId: number, reviewUid: string, input: ReturnType<typeof decisionInput>) {
  const prior = await decisionByKey(env, input.key);
  if (prior) {
    if (prior.review_uid !== reviewUid || prior.decision !== input.decision) {
      throw refuse(409, 'idempotency_key_reused', 'That idempotency key was already used for a different change.');
    }
    return { decision: prior, replayed: true };
  }
  const review = await env.DB.prepare('SELECT status FROM network_directory_reviews WHERE uid = ?').bind(reviewUid).first<{ status: string }>();
  if (!review) throw refuse(404, 'review_not_found', 'There is no review item with that reference.');
  if (review.status !== 'pending') throw refuse(409, 'review_not_pending', 'That review item was already decided.');
  const uid = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO network_directory_review_decisions (uid, idempotency_key, review_uid, decision, reason, actor_user_id)
         SELECT ?, ?, uid, ?, ?, ? FROM network_directory_reviews WHERE uid = ? AND status = 'pending'`,
      ).bind(uid, input.key, input.decision, input.reason, actorId, reviewUid),
      env.DB.prepare(
        `UPDATE network_directory_reviews SET status = ?
          WHERE uid = ? AND status = 'pending'
            AND EXISTS (SELECT 1 FROM network_directory_review_decisions WHERE uid = ? AND idempotency_key = ?)`,
      ).bind(input.decision, reviewUid, uid, input.key),
    ]);
  } catch (e) {
    lostRace(e, 'review decision');
  }
  const written = await decisionByKey(env, input.key);
  if (!written) throw refuse(409, 'review_changed', 'The review item changed while this was being decided. Read it again before retrying.');
  return { decision: written, replayed: false };
}

/* ---------------------------------------------------------------- organisation aliases */

/** The comparison form of a name: trimmed, single-spaced, ASCII letters lower-cased (as SQLite's lower() does). */
export function aliasKey(raw: string): string {
  return String(raw ?? '').trim().replace(/\s+/g, ' ').replace(/[A-Z]/g, ch => ch.toLowerCase());
}

const CONTACT_LIKE = /@|:\/\/|^www\.|\+?\d[\d\s().-]{6,}\d/i;

export function aliasInput(body: Record<string, unknown>) {
  const { key, reason } = changeInput(body);
  const raw = body.alias;
  const alias = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!alias || alias.length > ALIAS_MAX) throw refuse(400, 'invalid_alias', `An alias is 1 to ${ALIAS_MAX} characters.`);
  // An alias is a name. An address, a link or a number is a contact channel or an identifier, never an alias.
  if (CONTACT_LIKE.test(alias)) throw refuse(400, 'alias_not_a_name', 'An alias is another name for the organisation, not an address, link or number.');
  return { key, reason, alias, alias_key: aliasKey(alias) };
}


async function aliasWhere(env: Env, column: 'idempotency_key' | 'withdrawn_key' | 'uid', value: string) {
  const sql = {
    idempotency_key: `SELECT uid, entry_uid, alias, origin, merge_uid, reason, status, created_by, created_at, withdrawn_by, withdrawn_reason, withdrawn_at FROM network_directory_aliases WHERE idempotency_key = ?`,
    withdrawn_key: `SELECT uid, entry_uid, alias, origin, merge_uid, reason, status, created_by, created_at, withdrawn_by, withdrawn_reason, withdrawn_at FROM network_directory_aliases WHERE withdrawn_key = ?`,
    uid: `SELECT uid, entry_uid, alias, origin, merge_uid, reason, status, created_by, created_at, withdrawn_by, withdrawn_reason, withdrawn_at FROM network_directory_aliases WHERE uid = ?`,
  }[column];
  return env.DB.prepare(sql).bind(value).first<any>();
}

/**
 * Add an operator-reviewed alias to an organisation. A name another organisation already carries, as its own name
 * or as an active alias, is a competing identifier: it is refused and names the other entries for review.
 */
export async function addAlias(env: Env, actorId: number, entryUid: string, input: ReturnType<typeof aliasInput>) {
  const prior = await aliasWhere(env, 'idempotency_key', input.key);
  if (prior) {
    if (prior.entry_uid !== entryUid || aliasKey(prior.alias) !== input.alias_key) {
      throw refuse(409, 'idempotency_key_reused', 'That idempotency key was already used for a different change.');
    }
    return { alias: prior, replayed: true };
  }
  const entry = await entryState(env, entryUid);
  if (!entry) throw refuse(404, 'entry_not_found', 'There is no directory entry with that reference.');
  if (entry.kind !== 'organization') throw refuse(409, 'alias_organisation_only', 'Aliases are kept for organisations only.');
  if (entry.merged_into || entry.publication_status === 'archived') {
    throw refuse(409, 'alias_on_merged_entry', 'This entry was merged or archived. Add the alias to its canonical entry.', { canonical_uid: entry.merged_into });
  }
  if (aliasKey(entry.display_name) === input.alias_key) throw refuse(409, 'alias_is_name', 'That is already the organisation’s name.');
  const competing = (await env.DB.prepare(
    `SELECT uid FROM network_directory_entries
      WHERE kind = 'organization' AND uid <> ? AND publication_status <> 'archived' AND lower(trim(display_name)) = ?
     UNION
     SELECT COALESCE((SELECT rd.to_uid FROM network_directory_redirects rd WHERE rd.from_uid = al.entry_uid), al.entry_uid) AS uid
       FROM network_directory_aliases al WHERE al.status = 'active' AND al.alias_key = ?
     ORDER BY uid LIMIT 20`,
  ).bind(entryUid, input.alias_key, input.alias_key).all<{ uid: string }>()).results ?? [];
  if (competing.some(r => r.uid === entryUid)) throw refuse(409, 'alias_exists', 'This organisation already has that alias.');
  if (competing.length) {
    throw refuse(409, 'alias_conflict', 'Another organisation already carries that name. Review the two entries (merge or keep separate) before adding it.',
      { conflicting_uids: competing.map(r => r.uid) });
  }
  const uid = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO network_directory_aliases (uid, idempotency_key, entry_uid, alias, alias_key, origin, reason, created_by)
       SELECT ?, ?, e.uid, ?, ?, 'operator', ?, ? FROM network_directory_entries e
        WHERE e.uid = ? AND e.kind = 'organization' AND e.publication_status <> 'archived'
          AND NOT EXISTS (SELECT 1 FROM network_directory_redirects WHERE from_uid = e.uid)`,
    ).bind(uid, input.key, input.alias, input.alias_key, input.reason, actorId, entryUid).run();
  } catch (e) {
    lostRace(e, 'alias insert');
  }
  const written = await aliasWhere(env, 'idempotency_key', input.key);
  if (!written) throw refuse(409, 'entry_changed', 'The entry changed while this alias was being added. Read it again before retrying.');
  return { alias: written, replayed: false };
}

/** Withdraw an alias (an operator's or a merge's). The row stays, withdrawn, with who and why. */
export async function withdrawAlias(env: Env, actorId: number, aliasUid: string, input: { key: string; reason: string }) {
  const prior = await aliasWhere(env, 'withdrawn_key', input.key);
  if (prior) {
    if (prior.uid !== aliasUid) throw refuse(409, 'idempotency_key_reused', 'That idempotency key was already used for a different change.');
    return { alias: prior, replayed: true };
  }
  const alias = await aliasWhere(env, 'uid', aliasUid);
  if (!alias) throw refuse(404, 'alias_not_found', 'There is no alias with that reference.');
  if (alias.status !== 'active') throw refuse(409, 'alias_already_withdrawn', 'That alias was already withdrawn.');
  try {
    await env.DB.prepare(
      `UPDATE network_directory_aliases SET status = 'withdrawn', withdrawn_key = ?, withdrawn_by = ?, withdrawn_reason = ?, withdrawn_at = datetime('now')
        WHERE uid = ? AND status = 'active'`,
    ).bind(input.key, actorId, input.reason, aliasUid).run();
  } catch (e) {
    lostRace(e, 'alias withdrawal');
  }
  const written = await aliasWhere(env, 'withdrawn_key', input.key);
  if (!written) throw refuse(409, 'alias_changed', 'The alias changed while it was being withdrawn. Read it again before retrying.');
  return { alias: written, replayed: false };
}

/* ---------------------------------------------------------------- operator detail */

const parseList = (v: unknown): string[] => {
  try { const a = JSON.parse(String(v ?? '[]')); return Array.isArray(a) ? a.filter(x => typeof x === 'string') : []; }
  catch { return []; }
};

/**
 * Everything an operator needs to review one entry: its state and readiness, whether it carries a verified link
 * (a yes or no, not the account), its merges and redirects, every observation of its source rows and of those of
 * entries merged into it, the review items naming them with any decision, its aliases, and what it keeps.
 * No raw source cell and no member's note is read.
 */
export async function operatorEntry(env: Env, uid: string) {
  const entry = await env.DB.prepare(
    `SELECT e.uid, e.kind, e.display_name, e.source_uid, e.source_external_id, e.publication_status, e.verification_status, e.observed_at,
            (e.linked_user_id IS NOT NULL) AS account_linked, (e.linked_company_id IS NOT NULL) AS company_linked
       FROM network_directory_entries e WHERE e.uid = ?`,
  ).bind(uid).first<any>();
  if (!entry) throw refuse(404, 'entry_not_found', 'There is no directory entry with that reference.');
  const mergedInto = (await env.DB.prepare('SELECT to_uid FROM network_directory_redirects WHERE from_uid = ?').bind(uid).first<{ to_uid: string }>())?.to_uid ?? null;
  const mergedFrom = ((await env.DB.prepare('SELECT from_uid FROM network_directory_redirects WHERE to_uid = ? ORDER BY from_uid')
    .bind(uid).all<{ from_uid: string }>()).results ?? []).map(r => r.from_uid);
  const merges = (await env.DB.prepare(
    `SELECT uid, kind, from_uid, to_uid, from_publication_status, review_uid, reason, actor_user_id, created_at FROM network_directory_merges WHERE from_uid = ? OR to_uid = ? ORDER BY created_at, uid`,
  ).bind(uid, uid).all<any>()).results ?? [];
  const observations = (await env.DB.prepare(
    `SELECT o.uid, o.source_uid, o.external_record_id, o.entry_uid, o.entry_kind, o.disposition, o.reasons_json, o.observed_at
       FROM network_directory_source_records o
      WHERE (o.source_uid, o.external_record_id) IN (
        SELECT source_uid, external_record_id FROM network_directory_source_records
         WHERE entry_uid = ? OR entry_uid IN (SELECT from_uid FROM network_directory_redirects WHERE to_uid = ?))
      ORDER BY o.source_uid, o.external_record_id, o.observed_at DESC, o.uid`,
  ).bind(uid, uid).all<any>()).results ?? [];
  const reviews = (await env.DB.prepare(
    `SELECT r.uid, r.reason, r.status, r.source_record_uid, r.candidate_record_uid, r.created_at,
            d.decision, d.merge_uid, d.reason AS decision_reason, d.actor_user_id AS decided_by, d.created_at AS decided_at
       FROM network_directory_reviews r LEFT JOIN network_directory_review_decisions d ON d.review_uid = r.uid
      WHERE EXISTS (SELECT 1 FROM network_directory_source_records o
                     WHERE o.uid IN (r.source_record_uid, r.candidate_record_uid)
                       AND (o.source_uid, o.external_record_id) IN (
                         SELECT source_uid, external_record_id FROM network_directory_source_records
                          WHERE entry_uid = ? OR entry_uid IN (SELECT from_uid FROM network_directory_redirects WHERE to_uid = ?)))
      ORDER BY r.uid`,
  ).bind(uid, uid).all<any>()).results ?? [];
  const aliases = (await env.DB.prepare(
    `SELECT uid, entry_uid, alias, origin, merge_uid, reason, status, created_by, created_at, withdrawn_by, withdrawn_reason, withdrawn_at FROM network_directory_aliases
      WHERE entry_uid = ? OR entry_uid IN (SELECT from_uid FROM network_directory_redirects WHERE to_uid = ?)
      ORDER BY status, alias_key, uid`,
  ).bind(uid, uid).all<any>()).results ?? [];
  return {
    entry: {
      uid: entry.uid, kind: entry.kind, name: entry.display_name, source_uid: entry.source_uid, source_external_id: entry.source_external_id,
      publication_status: entry.publication_status, verification: entry.verification_status, observed_at: entry.observed_at,
      account_linked: Number(entry.account_linked) === 1, company_linked: Number(entry.company_linked) === 1,
    },
    readiness: mergedInto ? null : await readiness(env, uid),
    merged_into: mergedInto,
    merged_from: mergedFrom,
    merges,
    observations: observations.map(o => ({ ...o, reasons: parseList(o.reasons_json), reasons_json: undefined })),
    reviews: reviews.map(r => ({
      uid: r.uid, reason: r.reason, status: r.status, source_record_uid: r.source_record_uid, candidate_record_uid: r.candidate_record_uid, created_at: r.created_at,
      decision: r.decision ? { decision: r.decision, merge_uid: r.merge_uid ?? null, reason: r.decision_reason, decided_by: r.decided_by, decided_at: r.decided_at } : null,
    })),
    aliases,
    preserved: await preserved(env, uid),
  };
}
