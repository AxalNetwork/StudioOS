/**
 * My funds (D7168, #7168): a founder's saved funds searched and paged past 500, the counts over every saved row, the identity of each row, and the public record a linked row points to.
 *
 * EVERY QUERY IS OWNER-SCOPED. The owner is the first bound value of each
 * statement here, and nothing in this file reads another member's rows.
 *
 * THE COUNTS ARE OVER ALL SAVED ROWS, never over the page. Search, the filter
 * chips and paging narrow the list and its `total`; the counts stay the same,
 * so "212 right stage" means 212 of everything saved, whatever is on screen.
 *
 * NO SQL IS BUILT FROM A REQUEST. Each statement is one literal; a filter that
 * is not set is a bound '' that switches its clause off.
 */
import type { Env } from '../types';
import { citeSource, getFund, loadFundSources, SERVED_FUNDS } from './researchFundDirectory';
import { SOURCE_WITHDRAWN_MESSAGE } from './researchFundProfile';

export const MY_FUNDS_LIMIT_DEFAULT = 50;
export const MY_FUNDS_LIMIT_MAX = 100;
const OFFSET_MAX = 1_000_000;
const Q_MAX = 120;

export const MY_FUNDS_SORTS = ['updated', 'saved', 'name'] as const;
export const MY_FUNDS_FILTERS = ['right', 'warm', 'passed'] as const;
export const MY_FUNDS_IDENTITIES = ['linked', 'own', 'legacy'] as const;
/** D4613: a fund-directory uid, as the directory writes them. */
export const CATALOGUE_UID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;

export type MyFundsQuery = {
  q: string; limit: number; offset: number;
  sort: (typeof MY_FUNDS_SORTS)[number];
  filter: '' | (typeof MY_FUNDS_FILTERS)[number];
  identity: '' | (typeof MY_FUNDS_IDENTITIES)[number];
  catalogueUid: string;
};

export class MyFundsQueryError extends Error {
  field: string;
  reason: string;
  constructor(field: string, reason: string) { super(reason); this.field = field; this.reason = reason; }
}

/** The identity a row has: linked to a catalogue vehicle, your own record, or a legacy entry waiting for a choice. */
export function fundIdentity(r: { catalogue_uid?: string | null; own_record_at?: string | null }): 'linked' | 'own' | 'legacy' {
  if (r.catalogue_uid) return 'linked';
  return r.own_record_at ? 'own' : 'legacy';
}

/** Reads and checks the list's query string. A bad value is a 400 naming its field, never a silent default. */
export function parseMyFundsQuery(get: (k: string) => string | undefined): MyFundsQuery {
  const text = (k: string) => String(get(k) ?? '').trim();
  const int = (k: string, dflt: number, min: number, max: number) => {
    const raw = text(k);
    if (!raw) return dflt;
    if (!/^\d+$/.test(raw)) throw new MyFundsQueryError(k, `${k} must be a whole number`);
    const n = Number(raw);
    if (n < min || n > max) throw new MyFundsQueryError(k, `${k} must be between ${min} and ${max}`);
    return n;
  };
  const oneOf = <T extends string>(k: string, values: readonly T[], dflt: T | ''): T | '' => {
    const raw = text(k).toLowerCase();
    if (!raw || (raw === 'all' && k !== 'sort')) return dflt;
    if (!(values as readonly string[]).includes(raw)) throw new MyFundsQueryError(k, `${k} must be one of ${values.join(', ')}`);
    return raw as T;
  };
  const q = text('q');
  if (q.length > Q_MAX) throw new MyFundsQueryError('q', `q must be at most ${Q_MAX} characters`);
  const catalogueUid = text('catalogue_uid');
  if (catalogueUid && !CATALOGUE_UID_RE.test(catalogueUid)) throw new MyFundsQueryError('catalogue_uid', 'catalogue_uid is not a catalogue identifier');
  return {
    q,
    limit: int('limit', MY_FUNDS_LIMIT_DEFAULT, 1, MY_FUNDS_LIMIT_MAX),
    offset: int('offset', 0, 0, OFFSET_MAX),
    sort: (oneOf('sort', MY_FUNDS_SORTS, 'updated') || 'updated') as MyFundsQuery['sort'],
    filter: oneOf('filter', MY_FUNDS_FILTERS, '') as MyFundsQuery['filter'],
    identity: oneOf('identity', MY_FUNDS_IDENTITIES, '') as MyFundsQuery['identity'],
    catalogueUid,
  };
}

const likeOf = (q: string) => (q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : '');

// The one WHERE clause both the page and its total use. Each optional clause
// is switched off by its bound '' (the order of binds is `whereBinds`).
const WHERE = `
 WHERE owner_user_id = ?
   AND (? = '' OR (? = 'right' AND stage_fit = 'right') OR (? = 'warm' AND path = 'warm') OR (? = 'passed' AND status = 'passed'))
   AND (? = '' OR (? = 'linked' AND catalogue_uid IS NOT NULL)
               OR (? = 'own' AND catalogue_uid IS NULL AND own_record_at IS NOT NULL)
               OR (? = 'legacy' AND catalogue_uid IS NULL AND own_record_at IS NULL))
   AND (? = '' OR name LIKE ? ESCAPE '\\' OR catalogue_uid LIKE ? ESCAPE '\\')
   AND (? = '' OR catalogue_uid = ?)`;

const whereBinds = (owner: number, q: MyFundsQuery) => {
  const like = likeOf(q.q);
  return [
    owner,
    q.filter, q.filter, q.filter, q.filter,
    q.identity, q.identity, q.identity, q.identity,
    like, like, like,
    q.catalogueUid, q.catalogueUid,
  ];
};

const PAGE_SQL = `SELECT * FROM research_funds${WHERE}
 ORDER BY CASE WHEN ? = 'name' THEN name END COLLATE NOCASE ASC,
          CASE WHEN ? = 'updated' THEN updated_at END DESC,
          created_at DESC, id DESC
 LIMIT ? OFFSET ?`;

const TOTAL_SQL = `SELECT COUNT(*) AS n FROM research_funds${WHERE}`;

// Every figure over every saved row. `?` is the active company's raise target
// in cents, or NULL, in which case the whole-round count is not taken. The
// whole-round and allocation counts treat a missing low end as 0 and a missing
// high end as open, as the list always has; a range with neither end is never
// counted. Cheque ranges and allocations are both USD cents, so they compare.
const COUNTS_SQL = `SELECT
   COUNT(*) AS saved,
   SUM(CASE WHEN stage_fit = 'right' THEN 1 ELSE 0 END) AS right_stage,
   SUM(CASE WHEN path = 'warm' THEN 1 ELSE 0 END) AS warm_path,
   SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) AS passed,
   SUM(CASE WHEN status = 'passed' AND TRIM(COALESCE(pass_reason, '')) = '' THEN 1 ELSE 0 END) AS passed_without_reason,
   SUM(CASE WHEN catalogue_uid IS NOT NULL THEN 1 ELSE 0 END) AS linked,
   SUM(CASE WHEN catalogue_uid IS NULL AND own_record_at IS NOT NULL THEN 1 ELSE 0 END) AS own,
   SUM(CASE WHEN catalogue_uid IS NULL AND own_record_at IS NULL THEN 1 ELSE 0 END) AS legacy,
   SUM(CASE WHEN intended_allocation_cents IS NOT NULL THEN 1 ELSE 0 END) AS allocation_set,
   SUM(CASE WHEN intended_allocation_cents IS NOT NULL
             AND (cheque_min_cents IS NOT NULL OR cheque_max_cents IS NOT NULL)
             AND intended_allocation_cents >= COALESCE(cheque_min_cents, 0)
             AND (cheque_max_cents IS NULL OR intended_allocation_cents <= cheque_max_cents)
            THEN 1 ELSE 0 END) AS allocation_inside,
   SUM(CASE WHEN ? IS NOT NULL
             AND (cheque_min_cents IS NOT NULL OR cheque_max_cents IS NOT NULL)
             AND ? >= COALESCE(cheque_min_cents, 0)
             AND (cheque_max_cents IS NULL OR ? <= cheque_max_cents)
            THEN 1 ELSE 0 END) AS round_inside
 FROM research_funds WHERE owner_user_id = ?`;

const LINKS_SQL = `SELECT uid, catalogue_uid FROM research_funds
 WHERE owner_user_id = ? AND catalogue_uid IS NOT NULL ORDER BY id`;

export type MyFundsCounts = {
  saved: number; right_stage: number; warm_path: number; passed: number; passed_without_reason: number;
  linked: number; own: number; legacy: number; allocation_set: number; allocation_inside: number;
  /** null when no raise target is recorded: the question cannot be asked yet. */
  round_inside: number | null;
};

/** One page of the owner's rows, the page's total, and the counts over all of them. */
export async function listMyFunds<Row>(env: Env, owner: number, q: MyFundsQuery, askCents: number | null) {
  const binds = whereBinds(owner, q);
  const [page, total, counts, links] = await Promise.all([
    env.DB.prepare(PAGE_SQL).bind(...binds, q.sort, q.sort, q.limit, q.offset).all<Row>(),
    env.DB.prepare(TOTAL_SQL).bind(...binds).first<{ n: number }>(),
    env.DB.prepare(COUNTS_SQL).bind(askCents, askCents, askCents, owner).first<Record<string, number | null>>(),
    env.DB.prepare(LINKS_SQL).bind(owner).all<{ uid: string; catalogue_uid: string }>(),
  ]);
  const n = (k: string) => Number(counts?.[k] ?? 0);
  const c: MyFundsCounts = {
    saved: n('saved'), right_stage: n('right_stage'), warm_path: n('warm_path'), passed: n('passed'),
    passed_without_reason: n('passed_without_reason'), linked: n('linked'), own: n('own'), legacy: n('legacy'),
    allocation_set: n('allocation_set'), allocation_inside: n('allocation_inside'),
    round_inside: askCents === null ? null : n('round_inside'),
  };
  return {
    rows: page.results || [],
    total: Number(total?.n ?? 0),
    counts: c,
    // Every linked row, by catalogue uid: how the Directory opens the dossier
    // a vehicle is linked to, whatever page of the list holds it. A legacy row
    // is not here: it is never matched by name.
    catalogue_links: (links.results || []).map((l) => ({ catalogue_uid: l.catalogue_uid, uid: l.uid })),
  };
}

/** The member's other row that already holds a catalogue uid, if any. */
export async function catalogueHolder(env: Env, owner: number, catalogueUid: string, exceptUid: string) {
  return env.DB.prepare(
    `SELECT uid, name FROM research_funds WHERE owner_user_id = ? AND catalogue_uid = ? AND uid <> ?`,
  ).bind(owner, catalogueUid, exceptUid).first<{ uid: string; name: string }>();
}

export type PublicRecord =
  | { state: 'not_linked'; record: null; reason: string }
  | { state: 'ok'; catalogue_uid: string; record: Record<string, unknown> }
  | { state: 'not_found'; catalogue_uid: string; record: null; reason: string }
  | { state: 'withdrawn'; catalogue_uid: string; record: null; status: 410; reason: string; removed: unknown }
  | { state: 'unavailable'; catalogue_uid: string; record: null; reason: string };

/**
 * The catalogue row a saved fund is linked to, read-only and kept apart from
 * the member's private fields. It never borrows a record by name: a row with
 * no catalogue uid has no public record. A failed read is Unavailable, and a
 * list taken down for its terms is the directory's own 410, never its fields.
 */
export async function publicRecordFor(env: Env, catalogueUid: string | null | undefined): Promise<PublicRecord> {
  if (!catalogueUid) {
    return { state: 'not_linked', record: null, reason: 'Not linked to a catalogue vehicle, so no public facts are shown. Nothing is borrowed from a similar name.' };
  }
  let found: Awaited<ReturnType<typeof getFund>>;
  try {
    found = await getFund(env, catalogueUid);
  } catch {
    return { state: 'unavailable', catalogue_uid: catalogueUid, record: null, reason: 'The catalogue could not be read. Your private dossier loads separately.' };
  }
  if (!found) {
    return { state: 'not_found', catalogue_uid: catalogueUid, record: null, reason: 'The catalogue no longer holds this vehicle.' };
  }
  if ('removed' in found && found.removed) {
    return {
      state: 'withdrawn', catalogue_uid: catalogueUid, record: null, status: 410, removed: found.removed,
      reason: 'This fund’s list was taken down for its terms. Its facts are no longer shown. Your private dossier is unchanged.',
    };
  }
  return { state: 'ok', catalogue_uid: catalogueUid, record: (found as { item: Record<string, unknown> }).item };
}

/** D7845: all-or-nothing shortlist saves. Persist only dossier ids, never a second catalogue reference or a cached answer. */
export const FUND_SHORTLIST_MAX = 50;
export const FUND_SAVE_REQUEST_RE = /^[A-Za-z0-9-]{8,64}$/;
/** #7738 Q11 A: every served kind may be saved. A later owner choice B can narrow this list without trusting the request. */
export const FUND_SHORTLIST_ALLOWED_KINDS: readonly string[] | null = null;
export class FundShortlistError extends Error {
  readonly status: number;
  readonly code: string;
  readonly sentence: string;
  readonly extra: Record<string, unknown>;
  constructor(status: number, code: string, sentence: string, extra: Record<string, unknown> = {}) {
    super(sentence); this.status = status; this.code = code; this.sentence = sentence; this.extra = extra;
  }
}
type FundSaveRequest = { ids_digest: string; created_dossier_ids: string; already_dossier_ids: string };
type ShortlistRow = { asked_uid: string; canonical_uid: string; withdrawn_source: string | null; uid: string | null; name: string | null; kind?: string | null };

export function fundSaveRequestId(raw: unknown): string {
  if (typeof raw !== 'string' || !FUND_SAVE_REQUEST_RE.test(raw)) throw new FundShortlistError(400, 'invalid_request_id', 'Use a request id of 8–64 letters, digits or hyphens.');
  return raw;
}
function shortlistIds(raw: unknown): string[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > FUND_SHORTLIST_MAX || raw.some(id => typeof id !== 'string' || !CATALOGUE_UID_RE.test(id))) {
    throw new FundShortlistError(400, 'invalid_catalogue_ids', 'Choose between 1 and 50 catalogue ids. Nothing was saved.');
  }
  return [...new Set(raw as string[])].sort();
}
async function shortlistDigest(ids: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(ids)));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function savedFundRequest(env: Env, owner: number, requestId: string): Promise<FundSaveRequest | null> {
  return env.DB.prepare('SELECT ids_digest, created_dossier_ids, already_dossier_ids FROM research_fund_save_requests WHERE owner_user_id = ? AND request_id = ?')
    .bind(owner, requestId).first<FundSaveRequest>();
}
function storedDossierIds(raw: string): number[] {
  const ids = JSON.parse(raw);
  if (!Array.isArray(ids) || ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) throw new Error('fund_save_request_invalid');
  return ids;
}
async function fundSaveAnswer(env: Env, owner: number, requestId: string, row: FundSaveRequest) {
  const created = storedDossierIds(row.created_dossier_ids), already = storedDossierIds(row.already_dossier_ids);
  const read = await env.DB.prepare('SELECT id, uid, name FROM research_funds WHERE owner_user_id = ? AND id IN (SELECT value FROM json_each(?))')
    .bind(owner, JSON.stringify([...created, ...already])).all<{ id: number; uid: string; name: string }>();
  const held = new Map((read.results || []).map(item => [item.id, item]));
  const outcome = (ids: number[], state: 'saved' | 'already_saved') => ids.map(id => held.has(id)
    ? { ...held.get(id)!, state }
    : { id, state: 'no_longer_held' as const });
  return { state: 'saved' as const, request_id: requestId, saved: outcome(created, 'saved'), already_saved: outcome(already, 'already_saved') };
}
/** Request ids are private to the caller. A deleted dossier is reported, never re-created. */
export async function readFundShortlistSave(env: Env, owner: number, rawRequestId: unknown) {
  const requestId = fundSaveRequestId(rawRequestId);
  const row = await savedFundRequest(env, owner, requestId);
  return row ? fundSaveAnswer(env, owner, requestId, row) : { state: 'not_found' as const, request_id: requestId };
}

// Only immutable, server-owned SQL relations are composed here. Every request value is bound.
const SHORTLIST_ROWS = `SELECT asked.value AS asked_uid,
  COALESCE(original.uid, move.new_uid, asked.value) AS canonical_uid,
  withdrawn.source_name AS withdrawn_source, served.*
 FROM json_each(?) asked
 LEFT JOIN research_fund_directory original ON original.uid = asked.value
 LEFT JOIN research_fund_directory_uid_moves move ON move.old_uid = asked.value AND original.uid IS NULL
 LEFT JOIN research_fund_directory hidden ON hidden.uid = COALESCE(original.uid, move.new_uid, asked.value)
 LEFT JOIN research_fund_sources withdrawn ON withdrawn.source_name = hidden.source_name AND withdrawn.verdict = 'not allowed'
 LEFT JOIN ${SERVED_FUNDS} served ON served.uid = hidden.uid`;
async function shortlistRows(env: Env, ids: string[], allowedKinds: readonly string[] | null) {
  const [found, sources] = await Promise.all([
    env.DB.prepare(SHORTLIST_ROWS).bind(JSON.stringify(ids)).all<ShortlistRow>(), loadFundSources(env),
  ]);
  const rows = found.results || [];
  const withdrawn = rows.filter(row => row.withdrawn_source !== null);
  if (withdrawn.length) throw new FundShortlistError(410, 'source_withdrawn', SOURCE_WITHDRAWN_MESSAGE, {
    withdrawals: [...new Set(withdrawn.map(row => row.withdrawn_source!))].map(source => ({
      ids: withdrawn.filter(row => row.withdrawn_source === source).map(row => row.asked_uid),
      removed: citeSource(source, sources.get(source)?.published_url ?? null, sources.get(source)),
    })),
  });
  const missing = rows.filter(row => row.uid === null).map(row => row.asked_uid);
  if (missing.length || rows.length !== ids.length) throw new FundShortlistError(404, 'not_in_directory', 'The directory does not hold every selected record. Nothing was saved.', { ids: missing });
  if (allowedKinds !== null) {
    const refused = rows.filter(row => !row.kind || !allowedKinds.includes(row.kind));
    if (refused.length) throw new FundShortlistError(409, 'record_kind_refused', 'A selected record kind cannot be saved under the current policy. Nothing was saved.', { ids: refused.map(row => row.asked_uid) });
  }
  return [...new Set(rows.map(row => row.canonical_uid))].sort();
}
const INSERT_SHORTLIST_FUND = `INSERT INTO research_funds (uid, owner_user_id, name, catalogue_uid)
 SELECT ?, ?, served.name, served.uid FROM ${SERVED_FUNDS} served WHERE served.uid = ?
 AND NOT EXISTS (SELECT 1 FROM research_fund_save_requests WHERE owner_user_id = ? AND request_id = ?)
 ON CONFLICT (owner_user_id, catalogue_uid) WHERE catalogue_uid IS NOT NULL DO NOTHING`;
// A failed completeness condition supplies NULL to a NOT NULL column: D1 rolls back the ENTIRE batch.
// Check the served relation again inside that batch, including a source withdrawn since the preflight.
const INSERT_FUND_SAVE_REQUEST = `INSERT INTO research_fund_save_requests
 (owner_user_id, request_id, ids_digest, created_dossier_ids, already_dossier_ids)
 SELECT ?, ?, ?, CASE WHEN
   (SELECT COUNT(*) FROM ${SERVED_FUNDS} served WHERE served.uid IN (SELECT value FROM json_each(?))) = ?
   AND (SELECT COUNT(*) FROM research_funds WHERE owner_user_id = ? AND catalogue_uid IN (SELECT value FROM json_each(?))) = ?
 THEN (SELECT json_group_array(id) FROM (SELECT id FROM research_funds WHERE owner_user_id = ?
       AND uid IN (SELECT value FROM json_each(?)) ORDER BY id)) ELSE NULL END,
 (SELECT json_group_array(id) FROM (SELECT id FROM research_funds WHERE owner_user_id = ?
       AND catalogue_uid IN (SELECT value FROM json_each(?)) AND uid NOT IN (SELECT value FROM json_each(?)) ORDER BY id))
 WHERE NOT EXISTS (SELECT 1 FROM research_fund_save_requests WHERE owner_user_id = ? AND request_id = ?)`;

/** One atomic batch, idempotent even across concurrent attempts or a response lost after commit. */
export async function saveFundShortlist(env: Env, owner: number, rawIds: unknown, rawRequestId: unknown,
  allowedKinds: readonly string[] | null = FUND_SHORTLIST_ALLOWED_KINDS) {
  const requestId = fundSaveRequestId(rawRequestId), ids = shortlistIds(rawIds), digest = await shortlistDigest(ids);
  const replay = async (row: FundSaveRequest) => {
    if (row.ids_digest !== digest) throw new FundShortlistError(409, 'request_id_reused', 'This request id was already used for a different selection. Nothing changed.');
    return { ...await fundSaveAnswer(env, owner, requestId, row), repeat: true };
  };
  const previous = await savedFundRequest(env, owner, requestId);
  if (previous) return replay(previous);
  const canonical = await shortlistRows(env, ids, allowedKinds);
  const candidates = canonical.map(() => `fund-${crypto.randomUUID()}`), catalogueJson = JSON.stringify(canonical), candidateJson = JSON.stringify(candidates);
  let wroteRequest = false;
  try {
    const writes = await env.DB.batch([
      ...canonical.map((uid, index) => env.DB.prepare(INSERT_SHORTLIST_FUND).bind(candidates[index], owner, uid, owner, requestId)),
      env.DB.prepare(INSERT_FUND_SAVE_REQUEST).bind(owner, requestId, digest, catalogueJson, canonical.length,
        owner, catalogueJson, canonical.length, owner, candidateJson, owner, catalogueJson, candidateJson, owner, requestId),
    ]);
    wroteRequest = Number(writes.at(-1)?.meta?.changes) === 1;
  } catch {
    let after: FundSaveRequest | null;
    try { after = await savedFundRequest(env, owner, requestId); }
    catch { throw new FundShortlistError(503, 'save_outcome_unknown', 'The save outcome could not be read. Check this request id before trying again.'); }
    if (after) return replay(after);
    // Restore a named withdrawal/missing/kind refusal when the catalogue changed before commit.
    await shortlistRows(env, ids, allowedKinds);
    let remaining: { n: number } | null;
    try {
      remaining = await env.DB.prepare('SELECT COUNT(*) AS n FROM research_funds WHERE owner_user_id = ? AND uid IN (SELECT value FROM json_each(?))')
        .bind(owner, candidateJson).first<{ n: number }>();
    } catch { throw new FundShortlistError(503, 'save_outcome_unknown', 'The save outcome could not be read. Check this request id before trying again.'); }
    if (remaining?.n !== 0) throw new FundShortlistError(503, 'save_outcome_unknown', 'The save outcome could not be verified. Check this request id before trying again.');
    throw new FundShortlistError(503, 'save_failed', 'The selection was not saved. Try again with the same request id.', { rolled_back: true });
  }
  const saved = await savedFundRequest(env, owner, requestId);
  if (!saved) throw new FundShortlistError(503, 'save_outcome_unknown', 'The save outcome could not be read. Check this request id before trying again.');
  if (saved.ids_digest !== digest) return replay(saved);
  return { ...await fundSaveAnswer(env, owner, requestId, saved), repeat: !wroteRequest };
}
