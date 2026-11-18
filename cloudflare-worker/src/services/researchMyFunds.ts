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
import { getFund } from './researchFundDirectory';

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
