/**
 * D1017 (#2854) — the cap table's record (migration 573): what was issued,
 * with a date, a source and a document, kept apart from what a scenario
 * models (D1015 §3). Routes: the `/record/:projectId` section of
 * `routes/captable.ts`, which gates every call on the venture's access first.
 *
 * WHO WRITES (owner question 2 read as A):
 *   owner      records, accepts, dismisses, voids, edits classes and the currency;
 *   cofounder  proposes only: a proposal changes nothing until the owner accepts it;
 *   admin      as the owner, and every write carries a reason the founder reads
 *              (`correction_reason`, shown by the history read).
 *
 * WHAT COUNTS. Only `recorded` rows. A void row stays, struck through, with
 * its reason; a dismissed proposal stays in the history. SAFEs and notes are
 * listed as instruments and never added into the share counts: they convert
 * only in a scenario.
 *
 *   outstanding     shares issued and held, in common and preferred classes;
 *   fully diluted   outstanding + options granted and not exercised or
 *                   cancelled + each pool's unallocated shares.
 *
 * NOTHING MISSING IS A ZERO. A block that cannot be computed says so with
 * `available: false` and a `reason`; a failed read throws, and the route
 * answers 5xx, never an empty record. Every query is fixed text with bound
 * values.
 */
import type { Env } from '../types';

export const ISSUANCE_KINDS = ['founding', 'priced', 'safe', 'note', 'grant', 'exercise', 'transfer', 'conversion', 'cancellation', 'correction'] as const;
export type IssuanceKind = typeof ISSUANCE_KINDS[number];
export const SOURCES = ['connector_carta', 'connector_mercury', 'signed', 'document', 'typed'] as const;
export const ORIGINS = ['owner', 'cofounder', 'admin', 'mercury', 'import', 'close'] as const;
export type Origin = typeof ORIGINS[number];
export const CLASS_KINDS = ['common', 'preferred', 'option_pool'] as const;

/** Kinds that move shares; SAFEs and notes are money and never do. */
const SHARE_KINDS = new Set<string>(['founding', 'priced', 'grant', 'exercise', 'transfer', 'conversion', 'cancellation', 'correction']);
const MONEY_KINDS = new Set<string>(['safe', 'note']);

/** The currency a venture with no row reads (owner question 8 read as A; no company stores one). */
export const DEFAULT_CURRENCY = 'USD';
export const HISTORY_PAGE_SIZE = 25;
export const HISTORY_PAGE_MAX = 100;
const NAME_MAX = 200;
const TEXT_MAX = 2000;

export class RecordError extends Error {
  status: number;
  code: string;
  sentence: string;
  extra: Record<string, unknown>;
  constructor(status: number, code: string, sentence: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.status = status; this.code = code; this.sentence = sentence; this.extra = extra;
  }
}

export type RecordRole = 'owner' | 'cofounder' | 'admin';
export interface RecordActor { id: number; role: RecordRole }

// ───────────────────────────────────────────────────────────── the rows

interface ClassRow {
  id: number; uid: string; name: string; kind: string; authorized_shares: number | null;
  price_per_share_micros: number | null; liquidation_multiple_bps: number; participating: number;
  conversion_ratio: number; created_at: string; updated_at: string;
}

interface IssuanceRow {
  id: number; uid: string; kind: IssuanceKind; holder_id: number | null; holder_name: string | null; holder_row_name: string | null;
  class_id: number | null; from_holder_id: number | null; from_holder_name: string | null; from_holder_row_name: string | null;
  from_class_id: number | null; related_issuance_id: number | null; shares: number | null; amount_cents: number | null;
  currency: string | null; price_per_share_micros: number | null; issued_on: string | null; cap_cents: number | null;
  discount_bps: number | null; basis: string | null; mfn: number | null; interest_bps: number | null; maturity_on: string | null;
  safe_issuance_uid: string | null; document_ref: string | null; source: string; status: string; origin: string; origin_ref: string | null;
  note: string | null; correction_reason: string | null; void_reason: string | null; dismiss_reason: string | null;
  proposed_by: number | null; recorded_by: number | null; recorded_at: string | null; voided_by: number | null; voided_at: string | null;
  dismissed_by: number | null; dismissed_at: string | null; created_at: string; updated_at: string;
  safe_amount_cents: number | null; safe_cap_cents: number | null; safe_currency: string | null; safe_envelope_status: string | null;
}

// Fixed text, bound values: each read narrows by optional bound filters, never by interpolated SQL.
const CLASS_QUERY = `SELECT id, uid, name, kind, authorized_shares, price_per_share_micros, liquidation_multiple_bps, participating,
    conversion_ratio, created_at, updated_at
  FROM cap_table_share_classes WHERE project_id = ? AND (? IS NULL OR uid = ?) ORDER BY id`;

const ISSUANCE_QUERY = `SELECT i.id, i.uid, i.kind, i.holder_id, i.holder_name, h.name AS holder_row_name, i.class_id,
    i.from_holder_id, i.from_holder_name, fh.name AS from_holder_row_name, i.from_class_id, i.related_issuance_id,
    i.shares, i.amount_cents, i.currency, i.price_per_share_micros, i.issued_on, i.cap_cents, i.discount_bps, i.basis, i.mfn,
    i.interest_bps, i.maturity_on, i.safe_issuance_uid, i.document_ref, i.source, i.status, i.origin, i.origin_ref, i.note,
    i.correction_reason, i.void_reason, i.dismiss_reason, i.proposed_by, i.recorded_by, i.recorded_at, i.voided_by, i.voided_at,
    i.dismissed_by, i.dismissed_at, i.created_at, i.updated_at,
    s.amount_cents AS safe_amount_cents, s.valuation_cap_cents AS safe_cap_cents, s.currency AS safe_currency, e.status AS safe_envelope_status
  FROM cap_table_issuances i
  LEFT JOIN cap_table_holders h ON h.id = i.holder_id
  LEFT JOIN cap_table_holders fh ON fh.id = i.from_holder_id
  LEFT JOIN safe_issuances s ON s.uid = i.safe_issuance_uid AND s.project_id = i.project_id
  LEFT JOIN esign_envelopes e ON e.id = s.envelope_id
  WHERE i.project_id = ? AND (? IS NULL OR i.uid = ?) AND (? IS NULL OR i.id IN (SELECT value FROM json_each(?)))
  ORDER BY i.id`;

async function classesOf(env: Env, projectId: number, uid: string | null = null): Promise<ClassRow[]> {
  return (await env.DB.prepare(CLASS_QUERY).bind(projectId, uid, uid).all<ClassRow>()).results || [];
}

async function issuancesOf(env: Env, projectId: number, only: { uid?: string; ids?: number[] } = {}): Promise<IssuanceRow[]> {
  const uid = only.uid ?? null;
  const ids = only.ids ? JSON.stringify(only.ids) : null;
  return (await env.DB.prepare(ISSUANCE_QUERY).bind(projectId, uid, uid, ids, ids).all<IssuanceRow>()).results || [];
}

async function issuanceByUid(env: Env, projectId: number, uid: string): Promise<IssuanceRow | null> {
  return (await issuancesOf(env, projectId, { uid }))[0] ?? null;
}

export async function currencyOf(env: Env, projectId: number): Promise<{ code: string; set: boolean }> {
  const row = await env.DB.prepare('SELECT currency FROM cap_table_currency WHERE project_id = ?').bind(projectId).first<{ currency: string }>();
  return row ? { code: row.currency, set: true } : { code: DEFAULT_CURRENCY, set: false };
}

// ───────────────────────────────────────────────────────────── the counts

const holderKey = (id: number | null, name: string | null) => (id != null ? `h-${id}` : `n:${String(name ?? '').trim().toLowerCase()}`);

interface Balances {
  /** holder key → class id → shares held. */
  shares: Map<string, Map<number, number>>;
  /** holder key → pool class id → options granted and not exercised or cancelled. */
  options: Map<string, Map<number, number>>;
  /** pool class id → options exercised (they leave the pool for good). */
  exercised: Map<number, number>;
  names: Map<string, { holder_id: number | null; name: string }>;
  shareRows: number;
}

function add(m: Map<string, Map<number, number>>, key: string, cls: number, n: number) {
  const inner = m.get(key) ?? new Map<number, number>();
  inner.set(cls, (inner.get(cls) ?? 0) + n);
  m.set(key, inner);
}

/** The recorded rows' effect, holder by holder and class by class. */
export function balancesOf(rows: Array<Pick<IssuanceRow, 'kind' | 'status' | 'holder_id' | 'holder_name' | 'holder_row_name' | 'class_id' | 'from_holder_id' | 'from_holder_name' | 'from_holder_row_name' | 'from_class_id' | 'shares'>>, classes: Array<Pick<ClassRow, 'id' | 'kind'>>): Balances {
  const pool = new Set(classes.filter((c) => c.kind === 'option_pool').map((c) => c.id));
  const b: Balances = { shares: new Map(), options: new Map(), exercised: new Map(), names: new Map(), shareRows: 0 };
  const name = (id: number | null, own: string | null, row: string | null) => {
    const key = holderKey(id, own);
    if (!b.names.has(key)) b.names.set(key, { holder_id: id, name: String(row ?? own ?? '').trim() });
    return key;
  };
  for (const r of rows) {
    if (r.status !== 'recorded' || !SHARE_KINDS.has(r.kind) || r.class_id == null || r.shares == null) continue;
    b.shareRows++;
    const to = name(r.holder_id, r.holder_name, r.holder_row_name);
    const n = Number(r.shares);
    const bucket = pool.has(r.class_id) ? b.options : b.shares;
    switch (r.kind) {
      case 'cancellation':
        add(bucket, to, r.class_id, -n);
        break;
      case 'transfer': {
        add(bucket, to, r.class_id, n);
        add(bucket, name(r.from_holder_id, r.from_holder_name, r.from_holder_row_name), r.class_id, -n);
        break;
      }
      case 'exercise':
        add(b.shares, to, r.class_id, n);
        if (r.from_class_id != null) {
          add(b.options, to, r.from_class_id, -n);
          b.exercised.set(r.from_class_id, (b.exercised.get(r.from_class_id) ?? 0) + n);
        }
        break;
      default:
        add(bucket, to, r.class_id, n);
    }
  }
  return b;
}

const sumOf = (m: Map<number, number> | undefined, filter: (cls: number) => boolean = () => true) =>
  [...(m ?? new Map()).entries()].filter(([cls]) => filter(cls)).reduce((s, [, n]) => s + n, 0);

function hasNegative(m: Map<string, Map<number, number>>) {
  for (const inner of m.values()) for (const n of inner.values()) if (n < 0) return true;
  return false;
}

const REASONS: Record<string, string> = {
  nothing_recorded: 'No issuance of shares is on record yet.',
  negative_balance: 'A holder’s recorded shares go below zero, so the record does not add up. Check the voids and corrections.',
  pool_size_not_recorded: 'An option pool’s size is not recorded, so its unallocated shares cannot be counted.',
  pool_overgranted: 'More options are recorded from a pool than its size allows.',
};
const unavailable = (reason: string) => ({ available: false, reason, sentence: REASONS[reason] });

function issuanceOut(r: IssuanceRow, classes: Map<number, ClassRow>, related: Map<number, string>) {
  const linked = r.safe_issuance_uid != null;
  return {
    uid: r.uid, kind: r.kind, status: r.status, source: r.source, origin: r.origin,
    holder: { holder_id: r.holder_id, name: r.holder_row_name ?? r.holder_name },
    from_holder: r.from_holder_id != null || r.from_holder_name != null ? { holder_id: r.from_holder_id, name: r.from_holder_row_name ?? r.from_holder_name } : null,
    class_uid: r.class_id != null ? classes.get(r.class_id)?.uid ?? null : null,
    from_class_uid: r.from_class_id != null ? classes.get(r.from_class_id)?.uid ?? null : null,
    related_uid: r.related_issuance_id != null ? related.get(r.related_issuance_id) ?? null : null,
    shares: r.shares,
    // A SAFE sent through StudioOS reads its terms from `safe_issuances`; nothing is copied.
    amount_cents: linked ? r.safe_amount_cents : r.amount_cents,
    currency: linked ? (r.safe_currency ? r.safe_currency.toUpperCase() : null) : r.currency,
    price_per_share_micros: r.price_per_share_micros, issued_on: r.issued_on,
    terms: {
      cap_cents: linked ? r.safe_cap_cents : r.cap_cents,
      discount_bps: r.discount_bps,
      basis: linked ? 'post_money' : r.basis,
      mfn: r.mfn == null ? null : r.mfn === 1,
      interest_bps: r.interest_bps, maturity_on: r.maturity_on,
    },
    safe_issuance_uid: r.safe_issuance_uid, envelope_status: linked ? r.safe_envelope_status : null,
    document_ref: r.document_ref, note: r.note,
    correction_reason: r.correction_reason, void_reason: r.void_reason, dismiss_reason: r.dismiss_reason,
    proposed_by: r.proposed_by, recorded_by: r.recorded_by, recorded_at: r.recorded_at,
    voided_by: r.voided_by, voided_at: r.voided_at, dismissed_by: r.dismissed_by, dismissed_at: r.dismissed_at,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

function classOut(c: ClassRow) {
  return {
    uid: c.uid, name: c.name, kind: c.kind, authorized_shares: c.authorized_shares, price_per_share_micros: c.price_per_share_micros,
    liquidation_multiple_bps: c.liquidation_multiple_bps, participating: c.participating === 1, conversion_ratio: c.conversion_ratio,
    created_at: c.created_at, updated_at: c.updated_at,
  };
}

/** D1022 (#2859): each register holder's kind for this venture, by id. */
async function holderKindsOf(env: Env, projectId: number): Promise<Map<number, string>> {
  const rows = (await env.DB.prepare(
    'SELECT id, kind FROM cap_table_holders WHERE project_id = ? AND kind IS NOT NULL',
  ).bind(projectId).all<{ id: number; kind: string }>()).results || [];
  return new Map(rows.map((r) => [Number(r.id), String(r.kind)]));
}

/** GET /record/:projectId — the record by holder and by class, outstanding, fully diluted, the instruments and the proposals. */
export async function readRecord(env: Env, projectId: number) {
  const [classes, rows, currency, kinds] = await Promise.all([classesOf(env, projectId), issuancesOf(env, projectId), currencyOf(env, projectId), holderKindsOf(env, projectId)]);
  const byId = new Map(classes.map((c) => [c.id, c]));
  const related = new Map(rows.map((r) => [r.id, r.uid]));
  const isPool = (cls: number) => byId.get(cls)?.kind === 'option_pool';
  const b = balancesOf(rows, classes);
  const negative = hasNegative(b.shares) || hasNegative(b.options);
  const none = b.shareRows === 0;

  const holderKeys = [...new Set([...b.shares.keys(), ...b.options.keys()])];
  const byHolder = none ? unavailable('nothing_recorded') : negative ? unavailable('negative_balance') : {
    available: true, reason: null,
    rows: holderKeys.map((k) => ({
      ...b.names.get(k)!,
      // D1022: the register row's kind (founder, investor, employee, advisor), so Who owns can group; null for a holder named only on the issuance.
      kind: kinds.get(b.names.get(k)!.holder_id ?? -1) ?? null,
      shares: sumOf(b.shares.get(k)),
      options: sumOf(b.options.get(k)),
      by_class: [...new Set([...(b.shares.get(k)?.keys() ?? []), ...(b.options.get(k)?.keys() ?? [])])]
        .map((cls) => ({ class_uid: byId.get(cls)?.uid ?? null, shares: (b.shares.get(k)?.get(cls) ?? 0) + (b.options.get(k)?.get(cls) ?? 0) }))
        .filter((x) => x.shares !== 0),
    })).filter((h) => h.shares !== 0 || h.options !== 0),
  };

  const issuedIn = (cls: number) => [...b.shares.values()].reduce((s, m) => s + (m.get(cls) ?? 0), 0);
  const grantedIn = (cls: number) => [...b.options.values()].reduce((s, m) => s + (m.get(cls) ?? 0), 0);
  const classRows = classes.map((c) => {
    const pool = c.kind === 'option_pool';
    const granted = pool ? grantedIn(c.id) : null;
    const exercised = pool ? b.exercised.get(c.id) ?? 0 : null;
    return {
      ...classOut(c),
      issued: pool ? null : issuedIn(c.id),
      options_granted: granted,
      options_exercised: exercised,
      unallocated: pool && c.authorized_shares != null ? c.authorized_shares - granted! - exercised! : null,
    };
  });
  const byClass = classes.length === 0 && none ? unavailable('nothing_recorded') : negative ? unavailable('negative_balance') : { available: true, reason: null, rows: classRows };

  const inKind = (kind: string) => [...b.shares.values()].reduce((s, m) => s + sumOf(m, (cls) => byId.get(cls)?.kind === kind), 0);
  const common = inKind('common');
  const preferred = inKind('preferred');
  const outstanding = none ? unavailable('nothing_recorded') : negative ? unavailable('negative_balance')
    : { available: true, reason: null, shares: common + preferred, common, preferred };

  const pools = classRows.filter((c) => c.kind === 'option_pool');
  const optionsGranted = [...b.options.values()].reduce((s, m) => s + sumOf(m, isPool), 0);
  let fullyDiluted: Record<string, unknown>;
  if (!outstanding.available) fullyDiluted = { ...outstanding };
  else if (pools.some((p) => p.authorized_shares == null)) fullyDiluted = unavailable('pool_size_not_recorded');
  else if (pools.some((p) => (p.unallocated ?? 0) < 0)) fullyDiluted = unavailable('pool_overgranted');
  else {
    const unallocated = pools.length ? pools.reduce((s, p) => s + (p.unallocated ?? 0), 0) : null;
    fullyDiluted = {
      available: true, reason: null,
      shares: (outstanding as { shares: number }).shares + optionsGranted + (unallocated ?? 0),
      outstanding: (outstanding as { shares: number }).shares, options_granted: optionsGranted,
      // No pool class is on record: there is no unallocated pool to count, which is not a pool of 0.
      unallocated_pool: unallocated, pool_recorded: pools.length > 0,
    };
  }

  const out = rows.map((r) => issuanceOut(r, byId, related));
  return {
    project_id: projectId,
    currency: { code: currency.code, source: currency.set ? 'set' : 'default' },
    classes: { available: true, reason: null, rows: classes.map(classOut) },
    by_holder: byHolder,
    by_class: byClass,
    outstanding,
    fully_diluted: fullyDiluted,
    // Listed, never added into the counts: they convert only in a scenario.
    instruments: { available: true, reason: null, rows: out.filter((r) => MONEY_KINDS.has(r.kind) && r.status === 'recorded') },
    issuances: { available: true, reason: null, rows: out.filter((r) => r.status === 'recorded' || r.status === 'void') },
    proposals: { available: true, reason: null, rows: out.filter((r) => r.status === 'proposed') },
  };
}

// ───────────────────────────────────────────────────────────── the history

/** GET /record/:projectId/history — issuances and the cap table's activity rows, newest first, with an exact total. */
export async function readHistory(env: Env, projectId: number, page: number, pageSize: number) {
  const offset = (page - 1) * pageSize;
  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM cap_table_issuances WHERE project_id = ?) AS issuances,
            (SELECT COUNT(*) FROM activity_logs a WHERE a.project_id = ?
               AND (a.action LIKE 'captable.%' OR a.action = 'captable_member_write_authorized')) AS activity`,
  ).bind(projectId, projectId).first<{ issuances: number; activity: number }>();
  const slice = (await env.DB.prepare(
    `SELECT type, id, at FROM (
       SELECT 'issuance' AS type, id, datetime(created_at) AS at FROM cap_table_issuances WHERE project_id = ?
       UNION ALL
       SELECT 'activity' AS type, a.id, datetime(a.created_at) AS at FROM activity_logs a
        WHERE a.project_id = ? AND (a.action LIKE 'captable.%' OR a.action = 'captable_member_write_authorized')
     ) ORDER BY at DESC, type DESC, id DESC LIMIT ? OFFSET ?`,
  ).bind(projectId, projectId, pageSize, offset).all<{ type: string; id: number; at: string }>()).results || [];
  const ids = (t: string) => JSON.stringify(slice.filter((s) => s.type === t).map((s) => s.id));
  const [classes, issuances, activity] = await Promise.all([
    classesOf(env, projectId),
    issuancesOf(env, projectId, { ids: slice.filter((x) => x.type === 'issuance').map((x) => x.id) }),
    env.DB.prepare(
      `SELECT a.id, a.action, a.details, a.user_id, u.name AS user_name, a.entity_id, a.created_at
         FROM activity_logs a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.project_id = ? AND a.id IN (SELECT value FROM json_each(?))`,
    ).bind(projectId, ids('activity')).all<{ id: number; action: string; details: string | null; user_id: number | null; user_name: string | null; entity_id: string | null; created_at: string }>(),
  ]);
  const byId = new Map(classes.map((c) => [c.id, c]));
  const relatedRows = issuances.filter((r) => r.related_issuance_id != null);
  const related = new Map<number, string>();
  if (relatedRows.length) {
    for (const r of (await env.DB.prepare('SELECT id, uid FROM cap_table_issuances WHERE project_id = ? AND id IN (SELECT value FROM json_each(?))')
      .bind(projectId, JSON.stringify(relatedRows.map((r) => r.related_issuance_id))).all<{ id: number; uid: string }>()).results || []) related.set(r.id, r.uid);
  }
  const iss = new Map(issuances.map((r) => [r.id, r]));
  const act = new Map((activity.results || []).map((r) => [r.id, r]));
  const rows = slice.map((s) => {
    if (s.type === 'issuance') {
      const r = iss.get(s.id)!;
      return { type: 'issuance', at: s.at, issuance: issuanceOut(r, byId, related) };
    }
    const a = act.get(s.id)!;
    let details: unknown = null;
    try { details = a.details ? JSON.parse(a.details) : null; } catch { details = null; }
    return { type: 'activity', at: s.at, activity: { action: a.action, user_id: a.user_id, user_name: a.user_name, entity_uid: a.entity_id, details } };
  });
  return { rows, total: Number(counts?.issuances ?? 0) + Number(counts?.activity ?? 0), page, page_size: pageSize };
}

// ───────────────────────────────────────────────────────────── the fields

interface Fields {
  kind: IssuanceKind | null;
  holder_id: number | null; holder_name: string | null;
  class_id: number | null; from_holder_id: number | null; from_holder_name: string | null; from_class_id: number | null;
  related_issuance_id: number | null;
  shares: number | null; amount_cents: number | null; price_per_share_micros: number | null; issued_on: string | null;
  cap_cents: number | null; discount_bps: number | null; basis: string | null; mfn: number | null; interest_bps: number | null; maturity_on: string | null;
  safe_issuance_uid: string | null; document_ref: string | null; source: string | null; note: string | null; correction_reason: string | null;
}

const bad = (field: string, sentence: string) => new RecordError(400, `bad_${field}`, sentence, { field });
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function text(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw bad(field, `${field} must be text.`);
  const s = v.trim();
  if (!s) return null;
  if (s.length > max) throw bad(field, `${field} is longer than ${max} characters.`);
  return s;
}
function int(v: unknown, field: string, min: number | null, max: number | null = null): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : NaN;
  if (!Number.isSafeInteger(n) || (min != null && n < min) || (max != null && n > max)) throw bad(field, `${field} must be a whole number${min != null ? ` of at least ${min}` : ''}${max != null ? ` and at most ${max}` : ''}.`);
  return n;
}
function day(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  if (!DAY.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) throw bad(field, `${field} must be a date (YYYY-MM-DD).`);
  return s;
}
function oneOf<T extends string>(v: unknown, field: string, list: readonly T[]): T | null {
  if (v === undefined || v === null || v === '') return null;
  if (!list.includes(v as T)) throw bad(field, `${field} must be one of ${list.join(', ')}.`);
  return v as T;
}

const EMPTY: Fields = {
  kind: null, holder_id: null, holder_name: null, class_id: null, from_holder_id: null, from_holder_name: null, from_class_id: null,
  related_issuance_id: null, shares: null, amount_cents: null, price_per_share_micros: null, issued_on: null, cap_cents: null,
  discount_bps: null, basis: null, mfn: null, interest_bps: null, maturity_on: null, safe_issuance_uid: null, document_ref: null,
  source: null, note: null, correction_reason: null,
};

/** The body's fields, each checked against its type and resolved against this venture. Absent keys keep `base`'s value. */
async function readFields(env: Env, projectId: number, body: Record<string, unknown>, base: Fields): Promise<Fields> {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const f: Fields = { ...base };
  if (has('kind')) f.kind = oneOf(body.kind, 'kind', ISSUANCE_KINDS);
  if (has('holder_name')) f.holder_name = text(body.holder_name, 'holder_name', NAME_MAX);
  if (has('from_holder_name')) f.from_holder_name = text(body.from_holder_name, 'from_holder_name', NAME_MAX);
  if (has('shares')) f.shares = int(body.shares, 'shares', null);
  if (has('amount_cents')) f.amount_cents = int(body.amount_cents, 'amount_cents', 0);
  if (has('price_per_share_micros')) f.price_per_share_micros = int(body.price_per_share_micros, 'price_per_share_micros', 0);
  if (has('issued_on')) f.issued_on = day(body.issued_on, 'issued_on');
  if (has('cap_cents')) f.cap_cents = int(body.cap_cents, 'cap_cents', 1);
  if (has('discount_bps')) f.discount_bps = int(body.discount_bps, 'discount_bps', 0, 9999);
  if (has('basis')) f.basis = oneOf(body.basis, 'basis', ['post_money', 'pre_money'] as const);
  if (has('mfn')) {
    if (body.mfn !== null && typeof body.mfn !== 'boolean') throw bad('mfn', 'mfn must be true, false or null.');
    f.mfn = body.mfn == null ? null : body.mfn ? 1 : 0;
  }
  if (has('interest_bps')) f.interest_bps = int(body.interest_bps, 'interest_bps', 0);
  if (has('maturity_on')) f.maturity_on = day(body.maturity_on, 'maturity_on');
  if (has('source')) f.source = oneOf(body.source, 'source', SOURCES);
  if (has('note')) f.note = text(body.note, 'note', TEXT_MAX);
  if (has('reason')) f.correction_reason = text(body.reason, 'reason', TEXT_MAX);

  const holder = async (v: unknown, field: string) => {
    const id = int(v, field, 1);
    if (id == null) return null;
    const row = await env.DB.prepare('SELECT id FROM cap_table_holders WHERE id = ? AND project_id = ?').bind(id, projectId).first();
    if (!row) throw new RecordError(400, 'unknown_holder', 'That holder is not on this venture’s cap table.', { field });
    return id;
  };
  const cls = async (v: unknown, field: string) => {
    const uid = text(v, field, 64);
    if (uid == null) return null;
    const row = await env.DB.prepare('SELECT id FROM cap_table_share_classes WHERE uid = ? AND project_id = ?').bind(uid, projectId).first<{ id: number }>();
    if (!row) throw new RecordError(400, 'unknown_class', 'That share class is not this venture’s.', { field });
    return row.id;
  };
  if (has('holder_id')) f.holder_id = await holder(body.holder_id, 'holder_id');
  if (has('from_holder_id')) f.from_holder_id = await holder(body.from_holder_id, 'from_holder_id');
  if (has('class_uid')) f.class_id = await cls(body.class_uid, 'class_uid');
  if (has('from_class_uid')) f.from_class_id = await cls(body.from_class_uid, 'from_class_uid');
  if (has('related_uid')) {
    const uid = text(body.related_uid, 'related_uid', 64);
    if (uid == null) f.related_issuance_id = null;
    else {
      const row = await env.DB.prepare('SELECT id FROM cap_table_issuances WHERE uid = ? AND project_id = ?').bind(uid, projectId).first<{ id: number }>();
      if (!row) throw new RecordError(400, 'unknown_issuance', 'That issuance is not on this venture’s record.', { field: 'related_uid' });
      f.related_issuance_id = row.id;
    }
  }
  if (has('safe_issuance_uid')) {
    const uid = text(body.safe_issuance_uid, 'safe_issuance_uid', 64);
    if (uid != null && !(await env.DB.prepare('SELECT id FROM safe_issuances WHERE uid = ? AND project_id = ?').bind(uid, projectId).first())) {
      throw new RecordError(400, 'unknown_safe', 'That SAFE was not sent through StudioOS for this venture.', { field: 'safe_issuance_uid' });
    }
    f.safe_issuance_uid = uid;
  }
  if (has('document_ref')) {
    const ref = text(body.document_ref, 'document_ref', 64);
    if (ref != null) {
      const m = /^(legal_documents|data_room_files):([1-9]\d{0,15})$/.exec(ref);
      if (!m) throw bad('document_ref', 'document_ref must be legal_documents:<id> or data_room_files:<id>.');
      const found = m[1] === 'data_room_files'
        ? await env.DB.prepare('SELECT id FROM data_room_files WHERE id = ? AND project_id = ?').bind(Number(m[2]), projectId).first()
        : await env.DB.prepare('SELECT ld.id FROM legal_documents ld JOIN deals d ON d.id = ld.deal_id WHERE ld.id = ? AND d.project_id = ?').bind(Number(m[2]), projectId).first();
      if (!found) throw new RecordError(400, 'unknown_document', 'That document is not this venture’s.', { field: 'document_ref' });
    }
    f.document_ref = ref;
  }
  return f;
}

/** What no row may carry, proposed or recorded: shares on money, a non-positive share count but a correction's. */
function checkShape(f: Fields) {
  if (!f.kind) return;
  if (MONEY_KINDS.has(f.kind)) {
    if (f.shares != null) throw new RecordError(400, 'bad_shares', 'A SAFE or a note is money, never shares: it converts only in a scenario.');
    if (f.class_id != null) throw new RecordError(400, 'bad_class_uid', 'A SAFE or a note has no share class until it converts.');
  } else if (f.shares != null && (f.kind === 'correction' ? f.shares === 0 : f.shares <= 0)) {
    throw bad('shares', f.kind === 'correction' ? 'A correction changes a share count by more than 0.' : 'shares must be above 0.');
  }
}

/** What a recorded row must carry. Missing ones are listed; a field that cannot belong to the kind is refused. */
async function checkComplete(env: Env, projectId: number, f: Fields, actor: RecordActor) {
  checkShape(f);
  const missing: string[] = [];
  if (!f.kind) missing.push('kind');
  if (f.holder_id == null && f.holder_name == null) missing.push('holder');
  if (!f.source) missing.push('source');
  if (actor.role === 'admin' && !f.correction_reason) missing.push('reason');
  const kind = f.kind;
  if (kind && SHARE_KINDS.has(kind)) {
    if (f.issued_on == null) missing.push('issued_on');
    if (f.class_id == null) missing.push('class_uid');
    if (f.shares == null) missing.push('shares');
    if (kind === 'priced' && f.price_per_share_micros == null) missing.push('price_per_share_micros');
    if (kind === 'transfer' && f.from_holder_id == null && f.from_holder_name == null) missing.push('from_holder');
    if (kind === 'exercise' && f.from_class_id == null) missing.push('from_class_uid');
    if (kind === 'conversion' && f.related_issuance_id == null) missing.push('related_uid');
    if (kind === 'correction' && !f.correction_reason) missing.push('reason');
    if (f.safe_issuance_uid != null) throw new RecordError(400, 'bad_safe_issuance_uid', 'Only a SAFE links a SAFE sent through StudioOS.');
  }
  if (kind && MONEY_KINDS.has(kind)) {
    if (f.safe_issuance_uid != null) {
      if (kind !== 'safe') throw new RecordError(400, 'bad_safe_issuance_uid', 'Only a SAFE links a SAFE sent through StudioOS.');
      if (f.amount_cents != null || f.cap_cents != null || f.basis != null) {
        throw new RecordError(400, 'linked_terms', 'A SAFE sent through StudioOS keeps its terms there; they are read, never copied.');
      }
    } else if (f.amount_cents == null) missing.push('amount_cents');
  }
  if (missing.length) throw new RecordError(400, 'incomplete', 'This issuance is missing what the record needs.', { missing });

  if (kind && SHARE_KINDS.has(kind)) {
    const kinds = new Map(((await env.DB.prepare('SELECT id, kind FROM cap_table_share_classes WHERE project_id = ?').bind(projectId).all<{ id: number; kind: string }>()).results || []).map((c) => [c.id, c.kind]));
    const pool = (id: number | null) => id != null && kinds.get(id) === 'option_pool';
    if (kind === 'grant' && !pool(f.class_id)) throw new RecordError(400, 'bad_class_uid', 'A grant is made from an option pool.');
    if (['founding', 'priced', 'exercise', 'transfer', 'conversion'].includes(kind) && pool(f.class_id)) {
      throw new RecordError(400, 'bad_class_uid', 'Shares are issued in a common or preferred class, not in an option pool.');
    }
    if (kind === 'exercise' && !pool(f.from_class_id)) throw new RecordError(400, 'bad_from_class_uid', 'An exercise draws on an option pool.');
    if (kind === 'conversion') {
      const conv = await env.DB.prepare('SELECT kind, status FROM cap_table_issuances WHERE id = ? AND project_id = ?').bind(f.related_issuance_id, projectId).first<{ kind: string; status: string }>();
      if (!conv || !MONEY_KINDS.has(conv.kind) || conv.status !== 'recorded') throw new RecordError(400, 'bad_related_uid', 'A conversion converts a recorded SAFE or note.');
    }
  }
}

/** A row that takes shares from someone must find them there. */
async function checkBalance(env: Env, projectId: number, f: Fields, excludeId: number | null) {
  const kind = f.kind;
  const taking = kind === 'cancellation' || kind === 'transfer' || kind === 'exercise' || (kind === 'correction' && (f.shares ?? 0) < 0);
  if (!taking) return;
  const [classes, rows] = await Promise.all([classesOf(env, projectId), issuancesOf(env, projectId)]);
  const b = balancesOf(rows.filter((r) => r.id !== excludeId), classes);
  const pool = classes.find((c) => c.id === f.class_id)?.kind === 'option_pool';
  const from = kind === 'transfer' ? holderKey(f.from_holder_id, f.from_holder_name) : holderKey(f.holder_id, f.holder_name);
  const cls = kind === 'exercise' ? f.from_class_id! : f.class_id!;
  const bucket = kind === 'exercise' || pool ? b.options : b.shares;
  const held = bucket.get(from)?.get(cls) ?? 0;
  if (held < Math.abs(f.shares ?? 0)) {
    throw new RecordError(409, 'insufficient_shares', 'The record does not show that many shares held there.', { held });
  }
}

// ───────────────────────────────────────────────────────────── the writes

const newUid = () => crypto.randomUUID().replace(/-/g, '');

function auditStmt(env: Env, projectId: number, actor: { id: number }, action: string, uid: string, details: Record<string, unknown>, guarded = false) {
  return env.DB.prepare(
    `INSERT INTO activity_logs (project_id, user_id, action, details, actor, entity_type, entity_id)
     SELECT ?, ?, ?, ?, ?, 'cap_table_issuance', ? WHERE ? = 0 OR changes() = 1`,
  ).bind(projectId, actor.id, action, JSON.stringify(details), `user:${actor.id}`, uid, guarded ? 1 : 0);
}

function insertStmt(env: Env, projectId: number, uid: string, f: Fields, a: { status: 'proposed' | 'recorded'; origin: Origin; originRef: string | null; actorId: number; currency: string | null }) {
  return env.DB.prepare(
    `INSERT INTO cap_table_issuances (uid, project_id, kind, holder_id, holder_name, class_id, from_holder_id, from_holder_name, from_class_id,
       related_issuance_id, shares, amount_cents, currency, price_per_share_micros, issued_on, cap_cents, discount_bps, basis, mfn, interest_bps,
       maturity_on, safe_issuance_uid, document_ref, source, status, origin, origin_ref, note, correction_reason, proposed_by, recorded_by, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'recorded' THEN datetime('now') END)`,
  ).bind(uid, projectId, f.kind, f.holder_id, f.holder_name, f.class_id, f.from_holder_id, f.from_holder_name, f.from_class_id,
    f.related_issuance_id, f.shares, f.amount_cents, a.currency, f.price_per_share_micros, f.issued_on, f.cap_cents, f.discount_bps, f.basis, f.mfn,
    f.interest_bps, f.maturity_on, f.safe_issuance_uid, f.document_ref, f.source, a.status, a.origin, a.originRef, f.note, f.correction_reason,
    a.actorId, a.status === 'recorded' ? a.actorId : null, a.status);
}

const isUniqueViolation = (e: unknown) => /UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e));
const ALREADY = () => new RecordError(409, 'already_on_record', 'That item is already proposed or on the record.');

async function currencyFor(env: Env, projectId: number, f: Fields) {
  return f.amount_cents != null ? (await currencyOf(env, projectId)).code : null;
}

async function issuanceOrThrow(env: Env, projectId: number, uid: string) {
  const row = await issuanceByUid(env, projectId, uid);
  if (!row) throw new RecordError(404, 'unknown_issuance', 'That issuance is not on this venture’s record.');
  return row;
}

async function answerRow(env: Env, projectId: number, uid: string) {
  const [row, classes] = await Promise.all([issuanceByUid(env, projectId, uid), classesOf(env, projectId)]);
  const related = new Map<number, string>();
  if (row?.related_issuance_id != null) {
    const r = await env.DB.prepare('SELECT uid FROM cap_table_issuances WHERE id = ?').bind(row.related_issuance_id).first<{ uid: string }>();
    if (r) related.set(row.related_issuance_id, r.uid);
  }
  return issuanceOut(row!, new Map(classes.map((c) => [c.id, c])), related);
}

/** POST /record/:projectId/proposals — anyone who may write proposes; nothing counts until it is accepted. */
export async function propose(env: Env, projectId: number, actor: RecordActor, body: Record<string, unknown>) {
  const f = await readFields(env, projectId, body, { ...EMPTY, source: 'typed' });
  if (!f.kind) throw new RecordError(400, 'incomplete', 'Say what kind of issuance this is.', { missing: ['kind'] });
  if (f.holder_id == null && f.holder_name == null) throw new RecordError(400, 'incomplete', 'Say who holds it.', { missing: ['holder'] });
  checkShape(f);
  if (actor.role === 'admin' && !f.correction_reason) throw new RecordError(400, 'reason_required', 'An admin’s change to a founder’s record carries a reason the founder reads.');
  const uid = newUid();
  try {
    await env.DB.batch([
      insertStmt(env, projectId, uid, f, { status: 'proposed', origin: actor.role, originRef: null, actorId: actor.id, currency: await currencyFor(env, projectId, f) }),
      auditStmt(env, projectId, actor, 'captable.proposal.created', uid, { kind: f.kind, origin: actor.role, reason: f.correction_reason }),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) throw ALREADY();
    throw e;
  }
  return answerRow(env, projectId, uid);
}

/** POST /record/:projectId/issuances — the owner (or an admin, with a reason) records one directly. */
export async function recordIssuance(env: Env, projectId: number, actor: RecordActor, body: Record<string, unknown>) {
  const f = await readFields(env, projectId, body, { ...EMPTY, source: 'typed' });
  await checkComplete(env, projectId, f, actor);
  await checkBalance(env, projectId, f, null);
  const uid = newUid();
  try {
    await env.DB.batch([
      insertStmt(env, projectId, uid, f, { status: 'recorded', origin: actor.role, originRef: null, actorId: actor.id, currency: await currencyFor(env, projectId, f) }),
      auditStmt(env, projectId, actor, 'captable.issuance.recorded', uid, { kind: f.kind, origin: actor.role, reason: f.correction_reason }),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) throw ALREADY();
    throw e;
  }
  return answerRow(env, projectId, uid);
}

/**
 * A connector's item, recorded on a person's Accept (Mercury's SAFE requests,
 * D840 part 2). One live row per `originRef`; the audit row is in the same
 * batch. Answers the row's id and uid so the caller can undo it whole.
 */
export async function recordFromSource(env: Env, a: { projectId: number; actorId: number; origin: Origin; originRef: string; body: Record<string, unknown> }) {
  const f = await readFields(env, a.projectId, a.body, EMPTY);
  await checkComplete(env, a.projectId, f, { id: a.actorId, role: 'owner' });
  const uid = newUid();
  try {
    await env.DB.batch([
      insertStmt(env, a.projectId, uid, f, { status: 'recorded', origin: a.origin, originRef: a.originRef, actorId: a.actorId, currency: await currencyFor(env, a.projectId, f) }),
      auditStmt(env, a.projectId, { id: a.actorId }, 'captable.issuance.recorded', uid, { kind: f.kind, origin: a.origin }),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) throw ALREADY();
    throw e;
  }
  const row = await env.DB.prepare('SELECT id FROM cap_table_issuances WHERE uid = ?').bind(uid).first<{ id: number }>();
  return { id: Number(row?.id), uid };
}

/** Undo `recordFromSource` when the rest of its caller's write fails: the row and its audit row go together. */
export async function unrecordFromSource(env: Env, projectId: number, uid: string) {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM activity_logs WHERE project_id = ? AND entity_type = 'cap_table_issuance' AND entity_id = ?`).bind(projectId, uid),
    env.DB.prepare('DELETE FROM cap_table_issuances WHERE project_id = ? AND uid = ?').bind(projectId, uid),
  ]);
}

const NOT_PROPOSED = () => new RecordError(409, 'not_proposed', 'That proposal was already decided.');

function rowFields(r: IssuanceRow): Fields {
  return {
    kind: r.kind, holder_id: r.holder_id, holder_name: r.holder_name, class_id: r.class_id, from_holder_id: r.from_holder_id,
    from_holder_name: r.from_holder_name, from_class_id: r.from_class_id, related_issuance_id: r.related_issuance_id, shares: r.shares,
    amount_cents: r.amount_cents, price_per_share_micros: r.price_per_share_micros, issued_on: r.issued_on, cap_cents: r.cap_cents,
    discount_bps: r.discount_bps, basis: r.basis, mfn: r.mfn, interest_bps: r.interest_bps, maturity_on: r.maturity_on,
    safe_issuance_uid: r.safe_issuance_uid, document_ref: r.document_ref, source: r.source, note: r.note, correction_reason: null,
  };
}

/**
 * POST /record/:projectId/proposals/:uid/accept — the owner (or an admin, with
 * a reason) records a proposal. The body may fill what the proposal left
 * empty (a close or a document read leaves the money to a person, #2431).
 * The UPDATE is guarded on `proposed`, and its one audit row is written only
 * if it changed the row.
 */
export async function acceptProposal(env: Env, projectId: number, actor: RecordActor, uid: string, body: Record<string, unknown>) {
  const row = await issuanceOrThrow(env, projectId, uid);
  if (row.status !== 'proposed') throw NOT_PROPOSED();
  const f = await readFields(env, projectId, body, rowFields(row));
  await checkComplete(env, projectId, f, actor);
  await checkBalance(env, projectId, f, row.id);
  const currency = f.amount_cents != null ? row.currency ?? (await currencyOf(env, projectId)).code : null;
  const [upd] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE cap_table_issuances SET kind = ?, holder_id = ?, holder_name = ?, class_id = ?, from_holder_id = ?, from_holder_name = ?,
         from_class_id = ?, related_issuance_id = ?, shares = ?, amount_cents = ?, currency = ?, price_per_share_micros = ?, issued_on = ?,
         cap_cents = ?, discount_bps = ?, basis = ?, mfn = ?, interest_bps = ?, maturity_on = ?, safe_issuance_uid = ?, document_ref = ?,
         source = ?, note = ?, correction_reason = ?, status = 'recorded', recorded_by = ?, recorded_at = datetime('now'), updated_at = datetime('now')
       WHERE project_id = ? AND uid = ? AND status = 'proposed'`,
    ).bind(f.kind, f.holder_id, f.holder_name, f.class_id, f.from_holder_id, f.from_holder_name, f.from_class_id, f.related_issuance_id,
      f.shares, f.amount_cents, currency, f.price_per_share_micros, f.issued_on, f.cap_cents, f.discount_bps, f.basis, f.mfn, f.interest_bps,
      f.maturity_on, f.safe_issuance_uid, f.document_ref, f.source, f.note, f.correction_reason, actor.id, projectId, uid),
    auditStmt(env, projectId, actor, 'captable.proposal.accepted', uid, { kind: f.kind, origin: row.origin, reason: f.correction_reason }, true),
  ]);
  if (!upd.meta?.changes) throw NOT_PROPOSED();
  return answerRow(env, projectId, uid);
}

/** POST /record/:projectId/proposals/:uid/dismiss — the proposal stays in the history, recorded as dismissed. */
export async function dismissProposal(env: Env, projectId: number, actor: RecordActor, uid: string, body: Record<string, unknown>) {
  const row = await issuanceOrThrow(env, projectId, uid);
  if (row.status !== 'proposed') throw NOT_PROPOSED();
  const reason = text(body.reason, 'reason', TEXT_MAX);
  if (actor.role === 'admin' && !reason) throw new RecordError(400, 'reason_required', 'An admin’s change to a founder’s record carries a reason the founder reads.');
  const [upd] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE cap_table_issuances SET status = 'dismissed', dismiss_reason = ?, dismissed_by = ?, dismissed_at = datetime('now'), updated_at = datetime('now')
        WHERE project_id = ? AND uid = ? AND status = 'proposed'`,
    ).bind(reason, actor.id, projectId, uid),
    auditStmt(env, projectId, actor, 'captable.proposal.dismissed', uid, { kind: row.kind, origin: row.origin, reason }, true),
  ]);
  if (!upd.meta?.changes) throw NOT_PROPOSED();
  return answerRow(env, projectId, uid);
}

/** POST /record/:projectId/issuances/:uid/void — the row stays, struck through, with its required reason. */
export async function voidIssuance(env: Env, projectId: number, actor: RecordActor, uid: string, body: Record<string, unknown>) {
  const row = await issuanceOrThrow(env, projectId, uid);
  if (row.status !== 'recorded') throw new RecordError(409, 'not_recorded', 'Only a recorded issuance is voided.');
  const reason = text(body.reason, 'reason', TEXT_MAX);
  if (!reason) throw new RecordError(400, 'reason_required', 'Say why this issuance is void.');
  const [upd] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE cap_table_issuances SET status = 'void', void_reason = ?, voided_by = ?, voided_at = datetime('now'), updated_at = datetime('now')
        WHERE project_id = ? AND uid = ? AND status = 'recorded'`,
    ).bind(reason, actor.id, projectId, uid),
    auditStmt(env, projectId, actor, 'captable.issuance.voided', uid, { kind: row.kind, reason, by: actor.role }, true),
  ]);
  if (!upd.meta?.changes) throw new RecordError(409, 'not_recorded', 'Only a recorded issuance is voided.');
  return answerRow(env, projectId, uid);
}

// ───────────────────────────────────────────────────────────── classes and currency

async function classFields(body: Record<string, unknown>, creating: boolean) {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  if (!creating && has('kind')) throw bad('kind', 'A class’s kind does not change once it exists.');
  const out: Record<string, unknown> = {};
  if (creating || has('name')) {
    const name = text(body.name, 'name', NAME_MAX);
    if (!name) throw new RecordError(400, 'incomplete', 'Name the class.', { missing: ['name'] });
    out.name = name;
  }
  if (creating) {
    const kind = oneOf(body.kind, 'kind', CLASS_KINDS);
    if (!kind) throw new RecordError(400, 'incomplete', 'Say what kind of class this is.', { missing: ['kind'] });
    out.kind = kind;
  }
  if (has('authorized_shares')) out.authorized_shares = int(body.authorized_shares, 'authorized_shares', 0);
  if (has('price_per_share_micros')) out.price_per_share_micros = int(body.price_per_share_micros, 'price_per_share_micros', 0);
  if (has('liquidation_multiple_bps')) out.liquidation_multiple_bps = int(body.liquidation_multiple_bps, 'liquidation_multiple_bps', 0) ?? 10000;
  if (has('participating')) {
    if (typeof body.participating !== 'boolean') throw bad('participating', 'participating must be true or false.');
    out.participating = body.participating ? 1 : 0;
  }
  if (has('conversion_ratio')) {
    const r = body.conversion_ratio;
    if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0) throw bad('conversion_ratio', 'conversion_ratio must be a number above 0.');
    out.conversion_ratio = r;
  }
  return out;
}

function adminReason(actor: RecordActor, body: Record<string, unknown>) {
  const reason = text(body.reason, 'reason', TEXT_MAX);
  if (actor.role === 'admin' && !reason) throw new RecordError(400, 'reason_required', 'An admin’s change to a founder’s record carries a reason the founder reads.');
  return reason;
}

function classAudit(env: Env, projectId: number, actor: RecordActor, action: string, uid: string, details: Record<string, unknown>, guarded = false) {
  return env.DB.prepare(
    `INSERT INTO activity_logs (project_id, user_id, action, details, actor, entity_type, entity_id)
     SELECT ?, ?, ?, ?, ?, 'cap_table_share_class', ? WHERE ? = 0 OR changes() = 1`,
  ).bind(projectId, actor.id, action, JSON.stringify(details), `user:${actor.id}`, uid, guarded ? 1 : 0);
}

/** POST /record/:projectId/classes */
export async function createClass(env: Env, projectId: number, actor: RecordActor, body: Record<string, unknown>) {
  const reason = adminReason(actor, body);
  const c = await classFields(body, true);
  const uid = newUid();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO cap_table_share_classes (uid, project_id, name, kind, authorized_shares, price_per_share_micros, liquidation_multiple_bps, participating, conversion_ratio, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(uid, projectId, c.name, c.kind, c.authorized_shares ?? null, c.price_per_share_micros ?? null, c.liquidation_multiple_bps ?? 10000,
        c.participating ?? 0, c.conversion_ratio ?? 1, actor.id),
      classAudit(env, projectId, actor, 'captable.class.created', uid, { kind: c.kind, reason }),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) throw new RecordError(409, 'class_name_taken', 'This venture already has a class by that name.');
    throw e;
  }
  return classOut((await classesOf(env, projectId, uid))[0]);
}

/** PATCH /record/:projectId/classes/:uid — any field but its kind. */
export async function updateClass(env: Env, projectId: number, actor: RecordActor, uid: string, body: Record<string, unknown>) {
  const reason = adminReason(actor, body);
  const c = await classFields(body, false);
  const row = (await classesOf(env, projectId, uid))[0];
  if (!row) throw new RecordError(404, 'unknown_class', 'That share class is not this venture’s.');
  const v = { ...row, ...c } as ClassRow;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE cap_table_share_classes SET name = ?, authorized_shares = ?, price_per_share_micros = ?, liquidation_multiple_bps = ?, participating = ?,
           conversion_ratio = ?, updated_at = datetime('now') WHERE project_id = ? AND uid = ?`,
      ).bind(v.name, v.authorized_shares, v.price_per_share_micros, v.liquidation_multiple_bps, v.participating, v.conversion_ratio, projectId, uid),
      classAudit(env, projectId, actor, 'captable.class.updated', uid, { fields: Object.keys(c), reason }, true),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) throw new RecordError(409, 'class_name_taken', 'This venture already has a class by that name.');
    throw e;
  }
  return classOut((await classesOf(env, projectId, uid))[0]);
}

/** PUT /record/:projectId/currency — `{ currency: 'EUR' }`. A recorded amount keeps the currency it was recorded in. */
export async function setCurrency(env: Env, projectId: number, actor: RecordActor, body: Record<string, unknown>) {
  const reason = adminReason(actor, body);
  const code = typeof body.currency === 'string' ? body.currency : '';
  if (!/^[A-Z]{3}$/.test(code)) throw bad('currency', 'currency must be a three-letter ISO 4217 code, such as USD or EUR.');
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO cap_table_currency (project_id, currency, set_by, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(project_id) DO UPDATE SET currency = excluded.currency, set_by = excluded.set_by, updated_at = excluded.updated_at`,
    ).bind(projectId, code, actor.id),
    env.DB.prepare(
      `INSERT INTO activity_logs (project_id, user_id, action, details, actor, entity_type, entity_id) VALUES (?, ?, 'captable.currency.set', ?, ?, 'cap_table_currency', ?)`,
    ).bind(projectId, actor.id, JSON.stringify({ currency: code, reason }), `user:${actor.id}`, String(projectId)),
  ]);
  return { code, source: 'set' as const };
}

// ───────────────────────────────────────────────────────────── a spreadsheet import (D1026)

export const IMPORT_ROWS_MAX = 500;
const IMPORT_FIELDS = ['kind', 'holder_name', 'class_uid', 'shares', 'amount_cents', 'price_per_share_micros', 'issued_on', 'cap_cents', 'discount_bps', 'basis', 'note'] as const;

/**
 * POST /record/:projectId/proposals/import — a spreadsheet's rows, each a
 * proposal (`origin: 'import'`), never on the record (D1020 §5, D1026). Every
 * row is checked before any is written; one that fails refuses the import with
 * its row number, and nothing lands. `file_ref` is the file's SHA-256, so the
 * same file's rows are proposed once (`origin_ref` is `<file_ref>:<row>`).
 * One audit row for the import.
 */
export async function proposeImport(env: Env, projectId: number, actor: RecordActor, body: Record<string, unknown>) {
  const fileRef = typeof body.file_ref === 'string' && /^[0-9a-f]{64}$/.test(body.file_ref) ? body.file_ref : null;
  if (!fileRef) throw bad('file_ref', 'file_ref is the file’s SHA-256, in hex.');
  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!rows || rows.length === 0) throw new RecordError(400, 'nothing_to_import', 'No rows were sent to propose.');
  if (rows.length > IMPORT_ROWS_MAX) throw new RecordError(400, 'too_many_rows', `At most ${IMPORT_ROWS_MAX} rows are proposed at once.`);
  const reason = text(body.reason, 'reason', TEXT_MAX);
  if (actor.role === 'admin' && !reason) throw new RecordError(400, 'reason_required', 'An admin’s change to a founder’s record carries a reason the founder reads.');
  const seen = new Set<number>();
  const checked: Array<{ row: number; f: Fields }> = [];
  for (const raw of rows) {
    const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
    const row = typeof r.row === 'number' && Number.isSafeInteger(r.row) && r.row > 0 ? r.row : null;
    if (row == null || seen.has(row)) throw new RecordError(400, 'bad_row', 'Each row carries its own row number, once.', { row: r.row ?? null });
    seen.add(row);
    const fields: Record<string, unknown> = {};
    for (const k of IMPORT_FIELDS) if (Object.prototype.hasOwnProperty.call(r, k)) fields[k] = r[k];
    try {
      const f = await readFields(env, projectId, fields, { ...EMPTY, source: 'document' });
      if (!f.kind) throw new RecordError(400, 'incomplete', 'Say what kind of issuance this is.', { missing: ['kind'] });
      if (f.holder_name == null) throw new RecordError(400, 'incomplete', 'Say who holds it.', { missing: ['holder'] });
      checkShape(f);
      f.correction_reason = reason;
      checked.push({ row, f });
    } catch (e) {
      if (e instanceof RecordError) throw new RecordError(e.status, e.code, `Row ${row}: ${e.sentence}`, { ...e.extra, row });
      throw e;
    }
  }
  const currency = (await currencyOf(env, projectId)).code;
  const uids = checked.map(() => newUid());
  try {
    await env.DB.batch([
      ...checked.map(({ row, f }, i) => insertStmt(env, projectId, uids[i], f, {
        status: 'proposed', origin: 'import', originRef: `${fileRef}:${row}`, actorId: actor.id, currency: f.amount_cents != null ? currency : null,
      })),
      env.DB.prepare(
        `INSERT INTO activity_logs (project_id, user_id, action, details, actor, entity_type, entity_id) VALUES (?, ?, 'captable.import.proposed', ?, ?, 'cap_table_import', ?)`,
      ).bind(projectId, actor.id, JSON.stringify({ rows: checked.length, file_ref: fileRef, reason }), `user:${actor.id}`, fileRef),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) throw new RecordError(409, 'already_imported', 'Rows of this file are already proposed or on the record. Dismiss them first to import it again.');
    throw e;
  }
  return { proposed: checked.length, uids };
}

// ───────────────────────────────────────────────────────────── the spreadsheet with history (D1026)

/**
 * The record and its history as one CSV: the issuances (every status, a void
 * one with its reason), then the history rows, newest first. A missing value
 * is an empty cell, never 0, and `cell` neutralises a formula. The caller
 * writes the audit row; no audit row, no export (D1020 §4).
 */
export async function recordCsv(env: Env, projectId: number, cell: (v: unknown) => string, asOf: string) {
  const record = await readRecord(env, projectId);
  const history: Array<Record<string, any>> = [];
  let total = 0;
  for (let page = 1; page <= 50; page++) {
    const h = await readHistory(env, projectId, page, HISTORY_PAGE_MAX);
    history.push(...h.rows);
    total = h.total;
    if (history.length >= total || h.rows.length === 0) break;
  }
  const classes = new Map((record.classes.rows || []).map((c: any) => [c.uid, c.name]));
  const line = (vals: unknown[]) => vals.map(cell).join(',');
  const out: string[] = [line([`Cap table record, as of ${asOf}`]), line([`Currency: ${record.currency.code}`]), ''];
  out.push(line(['Issuances']));
  out.push(line(['Kind', 'Status', 'Holder', 'From', 'Class', 'Shares', 'Amount (minor units)', 'Currency', 'Price per share (micros)', 'Issued on', 'Cap (minor units)', 'Discount (bps)', 'Basis', 'MFN', 'Interest (bps)', 'Maturity', 'Source', 'Origin', 'Void reason', 'Admin reason']));
  const all = [...(record.issuances.rows || []), ...(record.proposals.rows || [])];
  for (const i of all as any[]) {
    out.push(line([
      i.kind, i.status, i.holder?.name, i.from_holder?.name, i.class_uid ? classes.get(i.class_uid) : null, i.shares, i.amount_cents, i.currency,
      i.price_per_share_micros, i.issued_on, i.terms?.cap_cents, i.terms?.discount_bps, i.terms?.basis,
      i.terms?.mfn == null ? null : i.terms.mfn ? 'yes' : 'no', i.terms?.interest_bps, i.terms?.maturity_on, i.source, i.origin, i.void_reason, i.correction_reason,
    ]));
  }
  out.push('', line(['History']), line(['When', 'Type', 'What', 'Who', 'Reason']));
  for (const h of history) {
    if (h.type === 'issuance') out.push(line([h.at, 'issuance', `${h.issuance.kind} · ${h.issuance.status}`, h.issuance.holder?.name, h.issuance.correction_reason ?? h.issuance.void_reason]));
    else out.push(line([h.at, 'activity', h.activity.action, h.activity.user_name, h.activity.details?.reason ?? null]));
  }
  return { csv: out.join('\r\n') + '\r\n', issuances: all.length, history: history.length, complete: history.length >= total };
}

export function historyPage(raw: { page?: string; page_size?: string }) {
  const page = raw.page == null || raw.page === '' ? 1 : Number(raw.page);
  const size = raw.page_size == null || raw.page_size === '' ? HISTORY_PAGE_SIZE : Number(raw.page_size);
  if (!Number.isSafeInteger(page) || page < 1) throw bad('page', 'page must be a whole number of at least 1.');
  if (!Number.isSafeInteger(size) || size < 1 || size > HISTORY_PAGE_MAX) throw bad('page_size', `page_size must be between 1 and ${HISTORY_PAGE_MAX}.`);
  return { page, size };
}

