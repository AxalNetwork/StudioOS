/**
 * D1158 (#3065) — `GET /api/fund-admin/lps`, FND5: every LP of every
 * administered fund in one table.
 *
 * ONE ROW PER LP PER FUND (a `limited_partners` row is already per fund). Its
 * money comes from the call ledger (`readFundCalls`, the same lines the
 * overview totals), paid distributions from `fund_distributions`, the last
 * notice from D716's `legal_notices`, and the booklet through the LP's
 * application: `limited_partners.user_id` + the fund's slug →
 * `lp_applications` → `fund_subscription_booklets`.
 *
 * NEVER A ZERO FOR A MISSING VALUE. Each figure no store holds is null, and
 * the row's `unavailable` map says why under the same key: an LP with no
 * ledger line has no called, received or outstanding figure, not 0. A store
 * that cannot be read makes only its own figures null, with `Unreadable`.
 *
 * FILTERS, SEARCH, SORT, PAGES AND TOTALS are applied here, on the Worker,
 * after the rows are read; nothing the caller sends reaches SQL but the bound
 * fund ids. `totals` are the sums of every row the filters keep (all pages),
 * each over the rows that hold the figure, with the count of rows that do not.
 *
 * IT IS AUDITED FIRST: names, emails and identity states are an admin read of
 * members, so #1775's fail-closed `auditRead` row (`fund_lps_read`) is
 * written before any row is read.
 */
import type { Env, User } from '../types';
import { auditRead } from './mercury/access';
import { administeredFunds } from './fundReportBuild';
import { readFundCalls } from './fundCallLedger';

export const UNREADABLE = 'Unreadable: this store could not be read. Try again.';
export const NO_LEDGER_LINE = 'No capital call line has been issued to this LP.';
export const LEDGER_TRUNCATED = 'This fund has more call lines than one read returns; its per-LP figures are withheld.';
const NO_COMMITMENT = 'No commitment is recorded for this LP.';
const NO_DISTRIBUTION = 'No paid distribution is recorded for this LP.';
const NO_ACCOUNT_KYC = 'This LP has no account, so no identity check is recorded.';
const NO_KYC = 'No identity check is recorded for this LP\'s account.';
const NO_LP_TYPE = 'No LP type is recorded.';
const NO_NOTICE = 'No notice has been issued to this LP.';
const NO_ACCOUNT_BOOKLET = 'This LP has no account, so no application links it to a booklet.';
const NO_FUND_SLUG = 'This fund takes no applications, so it has no booklet.';
const NO_APPLICATION = 'No LP application links this LP to the fund.';

export const SORTS = ['name', 'fund', 'commitment', 'called', 'received', 'outstanding', 'distributed', 'last_notice'] as const;
export const BOOKLET_STATES = ['not_started', 'open', 'submitted', 'withdrawn', 'not_recorded'] as const;
export const PER_PAGE_MAX = 200;

export type LpQuery = {
  fund_id: number | null;
  lpa: 'signed' | 'unsigned' | null;
  identity: string | null;
  booklet: typeof BOOKLET_STATES[number] | null;
  outstanding: boolean;
  overdue: boolean;
  q: string;
  sort: typeof SORTS[number];
  dir: 'asc' | 'desc';
  page: number;
  per_page: number;
};

/** The query string, checked; a string naming what is wrong when it is not. */
export function parseLpQuery(get: (k: string) => string | undefined): LpQuery | string {
  const int = (k: string, dflt: number, min: number, max: number) => {
    const raw = get(k);
    if (raw === undefined || raw === '') return dflt;
    if (!/^\d{1,9}$/.test(raw) || Number(raw) < min || Number(raw) > max) return null;
    return Number(raw);
  };
  const flag = (k: string) => { const v = get(k); return v === undefined || v === '' || v === '0' ? false : v === '1' ? true : null; };
  const fund = get('fund');
  const fundId = fund === undefined || fund === '' ? null : /^\d{1,9}$/.test(fund) && Number(fund) > 0 ? Number(fund) : NaN;
  if (Number.isNaN(fundId)) return 'fund';
  const lpa = get('lpa') || null;
  if (lpa !== null && lpa !== 'signed' && lpa !== 'unsigned') return 'lpa';
  const identity = get('identity') || null;
  if (identity !== null && !/^[a-z_]{1,32}$/.test(identity)) return 'identity';
  const booklet = (get('booklet') || null) as LpQuery['booklet'];
  if (booklet !== null && !BOOKLET_STATES.includes(booklet)) return 'booklet';
  const outstanding = flag('outstanding'), overdue = flag('overdue');
  if (outstanding === null) return 'outstanding';
  if (overdue === null) return 'overdue';
  const q = (get('q') ?? '').trim().toLowerCase();
  if (q.length > 100) return 'q';
  const sort = (get('sort') || 'name') as LpQuery['sort'];
  if (!SORTS.includes(sort)) return 'sort';
  const dir = get('dir') || 'asc';
  if (dir !== 'asc' && dir !== 'desc') return 'dir';
  const page = int('page', 1, 1, 100000), perPage = int('per_page', 50, 1, PER_PAGE_MAX);
  if (page === null) return 'page';
  if (perPage === null) return 'per_page';
  return { fund_id: fundId, lpa, identity, booklet, outstanding, overdue, q, sort, dir, page, per_page: perPage };
}

const rows = async <T>(env: Env, sql: string, ...binds: unknown[]): Promise<T[]> => {
  const res = await env.DB.prepare(sql).bind(...binds).all<T>();
  if (res && (res as any).success === false) throw new Error('read failed');
  return (res?.results || []) as T[];
};

/** One store's rows keyed by LP id, or null when the store could not be read. */
async function keyed<T extends { lp_id: number }>(name: string, read: () => Promise<T[]>): Promise<Map<number, T> | null> {
  try {
    return new Map((await read()).map((r) => [Number(r.lp_id), r]));
  } catch (e) {
    console.warn('[fundAdminLps] store unreadable', name, (e as Error).message);
    return null;
  }
}

type Ledger = { called: number; received: number; outstanding: number; overdue: number; lines: number };

async function ledgerFor(env: Env, fundId: number, today: string): Promise<Map<number, Ledger> | 'unreadable' | 'truncated'> {
  try {
    const read = await readFundCalls(env, fundId, today);
    if (read.truncated) return 'truncated';
    const by = new Map<number, Ledger>();
    for (const line of [...read.calls.flatMap((c: any) => c.lines), ...read.unnumbered]) {
      const id = Number(line.limited_partner_id);
      const l = by.get(id) || { called: 0, received: 0, outstanding: 0, overdue: 0, lines: 0 };
      l.called += Number(line.owed_cents); l.received += Number(line.received_cents);
      l.outstanding += Number(line.outstanding_cents); l.lines += 1;
      if (line.state === 'overdue') l.overdue += 1;
      by.set(id, l);
    }
    return by;
  } catch (e) {
    console.warn('[fundAdminLps] ledger unreadable', fundId, (e as Error).message);
    return 'unreadable';
  }
}

const MONEY = ['commitment_cents', 'called_cents', 'received_cents', 'outstanding_cents', 'distributed_cents'] as const;

/**
 * The roster, or `null` when its audit row could not be written, or
 * `'fund_not_administered'` when `fund` names a fund the console does not
 * administer. The caller has passed `requireFundAdminReader`.
 */
export async function fundAdminLps(env: Env, user: User, query: LpQuery, today: string) {
  if (!await auditRead(env, user, 'fund_lps_read', { surface: 'fund_admin.lps', fund_id: query.fund_id })) return null;
  const administered = await administeredFunds(env);
  const funds = query.fund_id === null ? administered : administered.filter((f) => f.id === query.fund_id);
  if (query.fund_id !== null && !funds.length) return 'fund_not_administered' as const;
  const ids = JSON.stringify(funds.map((f) => f.id));

  const base = await rows<any>(env,
    `SELECT lp.id, lp.fund_id, f.name AS fund_name, f.slug AS fund_slug, lp.user_id,
            COALESCE(u.name, lp.name) AS name, COALESCE(u.email, lp.email) AS email,
            CAST(ROUND(lp.commitment_amount * 100) AS INTEGER) AS commitment_cents,
            lp.lpa_signed, lp.lpa_signed_at, lp.status, u.kyc_status
       FROM limited_partners lp
       JOIN vc_funds f ON f.id = lp.fund_id
       LEFT JOIN users u ON u.id = lp.user_id
      WHERE lp.fund_id IN (SELECT value FROM json_each(?))
      ORDER BY lp.id`, ids);
  const lpTypes = await keyed<any>('lp_type', () => rows(env,
    `SELECT lp.id AS lp_id, lp.lp_type FROM limited_partners lp WHERE lp.fund_id IN (SELECT value FROM json_each(?))`, ids));
  const distributions = await keyed<any>('distributions', () => rows(env,
    `SELECT d.lp_id, SUM(d.amount_cents) AS cents FROM fund_distributions d
      WHERE d.fund_id IN (SELECT value FROM json_each(?)) AND d.status = 'paid' GROUP BY d.lp_id`, ids));
  const notices = await keyed<any>('notices', () => rows(env,
    `SELECT n.limited_partner_id AS lp_id, n.uid, n.notice_type, n.reference, n.amount_cents, n.created_at
       FROM legal_notices n
      WHERE n.id = (SELECT m.id FROM legal_notices m WHERE m.limited_partner_id = n.limited_partner_id
                     ORDER BY m.created_at DESC, m.id DESC LIMIT 1)
        AND n.fund_id IN (SELECT value FROM json_each(?))`, ids));
  const booklets = await keyed<any>('booklets', () => rows(env,
    `SELECT lp.id AS lp_id, a.status AS application_status,
            (SELECT b.status FROM fund_subscription_booklets b WHERE b.application_id = a.id
              ORDER BY b.status = 'withdrawn', b.id DESC LIMIT 1) AS booklet_status,
            (SELECT b.submitted_at FROM fund_subscription_booklets b WHERE b.application_id = a.id
              ORDER BY b.status = 'withdrawn', b.id DESC LIMIT 1) AS submitted_at
       FROM limited_partners lp
       JOIN vc_funds f ON f.id = lp.fund_id
       JOIN lp_applications a ON a.user_id = lp.user_id AND a.fund_slug = f.slug
      WHERE lp.fund_id IN (SELECT value FROM json_each(?))`, ids));
  const ledgers = new Map<number, Awaited<ReturnType<typeof ledgerFor>>>();
  for (const f of funds) ledgers.set(f.id, await ledgerFor(env, f.id, today));

  const all = base.map((lp: any) => {
    const unavailable: Record<string, string> = {};
    const commitment = Number(lp.commitment_cents) > 0 ? Number(lp.commitment_cents) : null;
    if (commitment === null) unavailable.commitment_cents = NO_COMMITMENT;

    const ledger = ledgers.get(Number(lp.fund_id));
    const own = ledger instanceof Map ? ledger.get(Number(lp.id)) ?? null : null;
    const ledgerReason = ledger === 'unreadable' ? UNREADABLE : ledger === 'truncated' ? LEDGER_TRUNCATED : own ? null : NO_LEDGER_LINE;
    if (ledgerReason) for (const k of ['called_cents', 'received_cents', 'outstanding_cents', 'overdue_lines']) unavailable[k] = ledgerReason;

    const dist = distributions?.get(Number(lp.id));
    const distributed = dist && dist.cents != null ? Number(dist.cents) : null;
    if (distributed === null) unavailable.distributed_cents = distributions ? NO_DISTRIBUTION : UNREADABLE;

    const hasAccount = lp.user_id != null;
    const kyc = lp.kyc_status ?? null; // the LEFT JOIN leaves it null with no account
    if (kyc === null) unavailable.kyc_status = hasAccount ? NO_KYC : NO_ACCOUNT_KYC;

    const lpType = lpTypes?.get(Number(lp.id))?.lp_type ?? null;
    if (lpType === null) unavailable.lp_type = lpTypes ? NO_LP_TYPE : UNREADABLE;

    const n = notices?.get(Number(lp.id));
    const lastNotice = n ? { uid: n.uid, notice_type: n.notice_type, reference: n.reference ?? null,
      amount_cents: n.amount_cents == null ? null : Number(n.amount_cents), issued_at: n.created_at } : null;
    if (!lastNotice) unavailable.last_notice = notices ? NO_NOTICE : UNREADABLE;

    const b = booklets?.get(Number(lp.id));
    const booklet = b ? { state: (b.booklet_status ?? 'not_started') as string, application_status: b.application_status ?? null,
      submitted_at: b.submitted_at ?? null } : null;
    if (!booklet) unavailable.booklet = !booklets ? UNREADABLE : !hasAccount ? NO_ACCOUNT_BOOKLET : !lp.fund_slug ? NO_FUND_SLUG : NO_APPLICATION;

    return {
      limited_partner_id: Number(lp.id),
      fund_id: Number(lp.fund_id),
      fund_name: lp.fund_name ?? null,
      name: lp.name ?? null,
      email: lp.email ?? null,
      has_account: hasAccount,
      status: lp.status ?? null,
      lp_type: lpType,
      lpa_signed: Number(lp.lpa_signed) === 1,
      lpa_signed_at: lp.lpa_signed_at ?? null,
      kyc_status: kyc,
      commitment_cents: commitment,
      called_cents: own && !ledgerReason ? own.called : null,
      received_cents: own && !ledgerReason ? own.received : null,
      outstanding_cents: own && !ledgerReason ? own.outstanding : null,
      distributed_cents: distributed,
      overdue_lines: own && !ledgerReason ? own.overdue : null,
      last_notice: lastNotice,
      booklet,
      unavailable,
    };
  });

  type Row = typeof all[number];
  const keep = (r: Row) =>
    (query.lpa === null || r.lpa_signed === (query.lpa === 'signed'))
    && (query.identity === null || (query.identity === 'not_recorded' ? r.kyc_status === null : r.kyc_status === query.identity))
    && (query.booklet === null || (query.booklet === 'not_recorded' ? r.booklet === null : r.booklet?.state === query.booklet))
    && (!query.outstanding || (r.outstanding_cents ?? 0) > 0)
    && (!query.overdue || (r.overdue_lines ?? 0) > 0)
    && (!query.q || [r.name, r.email].some((v) => typeof v === 'string' && v.toLowerCase().includes(query.q)));
  const filtered = all.filter(keep);

  const sortKey: Record<LpQuery['sort'], (r: Row) => string | number | null> = {
    name: (r) => r.name?.toLowerCase() ?? null,
    fund: (r) => r.fund_name?.toLowerCase() ?? null,
    commitment: (r) => r.commitment_cents,
    called: (r) => r.called_cents,
    received: (r) => r.received_cents,
    outstanding: (r) => r.outstanding_cents,
    distributed: (r) => r.distributed_cents,
    last_notice: (r) => r.last_notice?.issued_at ?? null,
  };
  const key = sortKey[query.sort], sign = query.dir === 'asc' ? 1 : -1;
  // A row with no value sorts last either way; ties fall back to the LP id.
  filtered.sort((a, b) => {
    const x = key(a), y = key(b);
    if (x === null || y === null) return x === y ? a.limited_partner_id - b.limited_partner_id : x === null ? 1 : -1;
    if (x !== y) return (x < y ? -1 : 1) * sign;
    return a.limited_partner_id - b.limited_partner_id;
  });

  const totals: Record<string, number | null> & { rows: number; not_recorded: Record<string, number> } =
    { rows: filtered.length, not_recorded: {} } as any;
  for (const k of MONEY) {
    const held = filtered.filter((r) => r[k] !== null);
    totals[k] = held.length ? held.reduce((s, r) => s + (r[k] as number), 0) : null;
    if (filtered.length - held.length) totals.not_recorded[k] = filtered.length - held.length;
  }

  const start = (query.page - 1) * query.per_page;
  return {
    as_of: today,
    funds: funds.map((f) => ({ id: f.id, name: f.name })),
    query,
    page: query.page,
    per_page: query.per_page,
    pages: Math.max(1, Math.ceil(filtered.length / query.per_page)),
    total_rows: filtered.length,
    totals,
    items: filtered.slice(start, start + query.per_page),
  };
}
