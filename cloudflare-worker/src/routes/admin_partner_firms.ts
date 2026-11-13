/**
 * D979 / #2765 — Advisors & Partners part 7: the Firms tab's two reads.
 *
 * Mounted at `/api/admin/partners`, before `admin_partners.ts`. Both routes
 * are requireAdmin and READ ONLY. The writes the tab makes already exist:
 * `POST /api/admin/partners/:id/directory` (the directory switches) and
 * `POST /api/admin/partners/links` (attach and detach, D952).
 *
 *   GET /firms        — AP5: every firm, searched, filtered, sorted and paged
 *                       here, with an exact `total`. No first-500 cut.
 *   GET /firms/:id    — AP6: one firm's drawer.
 *
 * A firm's deals are its accounts' deals: a deal belongs to the partner
 * account that signed it, and the account's firm is `users.partner_id` (D57),
 * as D972's table and D973's overview read it.
 *
 * Every block uses D973's shape: `{ available: true, recorded: true, value }`,
 * `{ available: true, recorded: false, reason }` for a figure no store holds,
 * `{ available: false, reason }` for a read that failed. Each store has its own
 * statement and catch, so one failed store costs only its column. A filter or
 * sort that needs a failed store is a 503, never a false empty list.
 *
 * Settlements are HQ's (D973): on a branch they are "kept by HQ" and no
 * settlement statement runs. No email, motivation, prior deals, chat, proposal
 * JSON, memo or referral code is selected.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { branchOf } from '../util/branch';
import { refuse } from '../util/refusal';
import { COHORT_TZ } from '../services/cohortTiming';
import { ALL_PARTNER_DEAL_TYPES } from '../services/partnerDeals';

type Row = Record<string, any>;
type Read<T> = { available: true; recorded: true; value: T } | { available: true; recorded: false; reason: string } | { available: false; reason: string };
const ok = <T>(value: T): Read<T> => ({ available: true, recorded: true, value });
const missing = (reason: string): Read<never> => ({ available: true, recorded: false, reason });
const unreadable = (reason: string): Read<never> => ({ available: false, reason });
const has = <T>(block: Read<T>): block is { available: true; recorded: true; value: T } => block.available && block.recorded;
const rowsOf = (block: Read<Row[]>): Row[] => (has(block) ? block.value : []);

const DAY = 86_400_000;
export const ENDS_WITHIN = [30, 60, 90] as const;
export const DIRECTORY = ['listed', 'featured', 'not_listed'] as const;
export const SORTS = ['name_asc', 'name_desc', 'accounts_desc', 'deal_ends_asc', 'rating_desc'] as const;
export const DRAWER_ROWS = 50;
const HQ_SETTLEMENTS = 'Settlements are kept by HQ.';

const route = new Hono<{ Bindings: Env }>();

async function read(db: D1Database, key: string, sql: string, args: unknown[] = []): Promise<Read<Row[]>> {
  try {
    const result = await db.prepare(sql).bind(...args).all<Row>();
    if (('success' in result && !result.success) || !Array.isArray(result.results)) throw new Error('rows were not returned');
    return ok(result.results);
  } catch (e) {
    console.warn('[admin_partner_firms] unreadable block', key, (e as Error)?.message);
    return unreadable(`The ${key} could not be read. That is not the same as none.`);
  }
}

/** D1's zone-less stamps are UTC (`ui/parseStamp.js`). */
function stamp(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return NaN;
  const v = value.trim();
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(v) ? v : v.replace(' ', 'T') + (v.length === 10 ? 'T00:00:00Z' : 'Z'));
}
/** Today's date on the Lab's clock (ET), as `due_on` is a calendar day. */
function etDay(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: COHORT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ms);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

function byKey(block: Read<Row[]>, key: string): Map<number, Row[]> {
  const out = new Map<number, Row[]>();
  if (!has(block)) return out;
  for (const row of block.value) {
    if (row[key] == null) continue;
    const id = Number(row[key]);
    const list = out.get(id) ?? [];
    list.push(row);
    out.set(id, list);
  }
  return out;
}
/** A column from one store: the store's failure, or the value for this firm. */
function column<T>(block: Read<Row[]>, fn: () => T): Read<T> {
  if (!has(block)) return block as Read<T>;
  try { return ok(fn()); } catch { return unreadable('Stored values could not be read.'); }
}
const ratingOf = (rows: Row[]) => {
  const n = rows.reduce((s, r) => s + Number(r.n || 0), 0);
  const sum = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  // No ratings is "No ratings yet", never an average of zero (D976).
  return { count: n, average: n ? Math.round((sum / n) * 10) / 10 : null };
};
const directoryOf = (f: Row) => ({ listed: Number(f.directory_listed) === 1, featured: Number(f.directory_featured) === 1 });

/** The firm-wide stores AP5's columns come from, each read alone. */
async function stores(env: Env, now: number) {
  const branch = branchOf(env);
  const today = etDay(now);
  const [firms, accounts, deals, redemptions, ratings, settlements] = await Promise.all([
    read(env.DB, 'firms', `SELECT id, name, company, specialization, status,
        COALESCE(directory_listed, 0) AS directory_listed, COALESCE(directory_featured, 0) AS directory_featured
        FROM partners`),
    read(env.DB, 'accounts', `SELECT partner_id, COUNT(*) AS n FROM users WHERE partner_id IS NOT NULL GROUP BY partner_id`),
    read(env.DB, 'deals', `SELECT u.partner_id, d.id, d.deal_type, d.expires_at
        FROM partner_deals d JOIN users u ON u.id = d.user_id
        WHERE d.status = 'active' AND u.partner_id IS NOT NULL`),
    read(env.DB, 'redemptions', `SELECT u.partner_id, COUNT(*) AS n
        FROM partner_referral_redemptions r
        JOIN partner_deals d ON d.id = r.partner_deal_id
        JOIN users u ON u.id = d.user_id
        WHERE d.status = 'active' AND u.partner_id IS NOT NULL GROUP BY u.partner_id`),
    read(env.DB, 'ratings', `SELECT partner_id, COUNT(*) AS n, SUM(rating) AS total FROM partner_booking_ratings
        WHERE rating BETWEEN 1 AND 5 AND rating = CAST(rating AS INTEGER) GROUP BY partner_id`),
    branch
      ? Promise.resolve(missing(HQ_SETTLEMENTS))
      : read(env.DB, 'settlements', `SELECT u.partner_id, s.direction, COUNT(*) AS n, SUM(s.amount_cents) AS cents
          FROM partner_deal_settlements s
          JOIN partner_deals d ON d.id = s.partner_deal_id
          JOIN users u ON u.id = d.user_id
          WHERE s.state = 'issued' AND u.partner_id IS NOT NULL AND date(s.due_on) >= date(?) AND date(s.due_on) <= date(?)
          GROUP BY u.partner_id, s.direction`, [today, addDays(today, 30)]),
  ]);
  return { branch, firms, accounts, deals, redemptions, ratings, settlements };
}

function itemOf(f: Row, s: Awaited<ReturnType<typeof stores>>, idx: Record<string, Map<number, Row[]>>, now: number) {
  const id = Number(f.id);
  return {
    id,
    name: f.name ?? null,
    company: f.company ?? null,
    specialization: f.specialization ?? null,
    status: f.status ?? null,
    directory: directoryOf(f),
    accounts: column(s.accounts, () => Number(idx.accounts.get(id)?.[0]?.n || 0)),
    deal: column(s.deals, () => {
      const list = idx.deals.get(id) ?? [];
      const ends = list.map((d) => stamp(d.expires_at)).filter(Number.isFinite).sort((a, b) => a - b);
      const soonest = ends[0];
      return {
        count: list.length,
        types: [...new Set(list.map((d) => String(d.deal_type)))].sort(),
        // A missing end is null, never a guessed term (D973).
        soonest_end: soonest != null ? new Date(soonest).toISOString() : null,
        ending_soon: soonest != null && soonest >= now && soonest <= now + 30 * DAY,
      };
    }),
    redemptions: column(s.redemptions, () => Number(idx.redemptions.get(id)?.[0]?.n || 0)),
    rating: column(s.ratings, () => ratingOf(idx.ratings.get(id) ?? [])),
    settlements_due: s.settlements.available && !s.settlements.recorded
      ? s.settlements
      : column(s.settlements, () => {
        const rows = idx.settlements.get(id) ?? [];
        const sum = (dir: string) => rows.filter((r) => r.direction === dir).reduce((t, r) => t + Number(r.cents || 0), 0);
        return { currency: 'usd', count: rows.reduce((t, r) => t + Number(r.n || 0), 0), to_member_cents: sum('to_member'), from_member_cents: sum('from_member') };
      }),
  };
}
type Item = ReturnType<typeof itemOf>;

function flag(raw: string | undefined): boolean | null | 'bad' {
  if (raw == null || raw === '') return null;
  const v = raw.toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return 'bad';
}
function int(raw: string | undefined, fallback: number, min: number, max: number): number | null {
  if (raw == null || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}
const nameKey = (i: Item) => String(i.company || i.name || '').toLowerCase();
const value = <T>(b: Read<T>): T | null => (has(b) ? b.value : null);

route.get('/firms', async (c) => {
  await requireAdmin(c);
  const q = String(c.req.query('q') || '').trim();
  if (q.length > 200) return refuse(c, 400, { code: 'invalid_query', message: 'A search is at most 200 characters.' });
  const directory = c.req.query('directory') || null;
  if (directory && !(DIRECTORY as readonly string[]).includes(directory)) return refuse(c, 400, { code: 'invalid_directory', message: 'Directory is listed, featured or not_listed.' });
  const dealType = c.req.query('deal_type') || null;
  if (dealType && !(ALL_PARTNER_DEAL_TYPES as string[]).includes(dealType)) return refuse(c, 400, { code: 'invalid_deal_type', message: 'That is not a partner deal type.' });
  const endsRaw = c.req.query('ends_within');
  const endsWithin = endsRaw ? Number(endsRaw) : null;
  if (endsRaw && !(ENDS_WITHIN as readonly number[]).includes(endsWithin as number)) return refuse(c, 400, { code: 'invalid_ends_within', message: 'Deal ends within is 30, 60 or 90 days.' });
  const noAccounts = flag(c.req.query('no_accounts'));
  if (noAccounts === 'bad') return refuse(c, 400, { code: 'invalid_no_accounts', message: 'Has no accounts is true or false.' });
  const sort = c.req.query('sort') || 'name_asc';
  if (!(SORTS as readonly string[]).includes(sort)) return refuse(c, 400, { code: 'invalid_sort', message: 'That is not a sort this list has.' });
  const limit = int(c.req.query('limit'), 25, 1, 100);
  const offset = int(c.req.query('offset'), 0, 0, 1_000_000);
  if (limit == null || offset == null) return refuse(c, 400, { code: 'invalid_page', message: 'Limit is 1 to 100 and offset 0 or more.' });

  const now = Date.now();
  const s = await stores(c.env, now);
  if (!has(s.firms)) return refuse(c, 503, { code: 'firms_unreadable', message: 'The firms could not be read. That is not the same as no firms.' });
  // A filter or sort is answered only from a store that was read.
  const needs: Array<[boolean, Read<Row[]>, string]> = [
    [noAccounts != null || sort === 'accounts_desc', s.accounts, 'accounts'],
    [!!dealType || endsWithin != null || sort === 'deal_ends_asc', s.deals, 'deals'],
    [sort === 'rating_desc', s.ratings, 'ratings'],
  ];
  const blocked = needs.find(([wanted, block]) => wanted && !has(block));
  if (blocked) return refuse(c, 503, { code: 'filter_unreadable', message: `The ${blocked[2]} could not be read, so this filter or sort cannot be answered. That is not the same as no firms.`, extra: { source: blocked[2] } });

  const idx = {
    accounts: byKey(s.accounts, 'partner_id'),
    deals: byKey(s.deals, 'partner_id'),
    redemptions: byKey(s.redemptions, 'partner_id'),
    ratings: byKey(s.ratings, 'partner_id'),
    settlements: byKey(s.settlements, 'partner_id'),
  };
  let items = s.firms.value.map((f) => itemOf(f, s, idx, now));

  const needle = q.toLowerCase();
  if (needle) items = items.filter((i) => [i.name, i.company, i.specialization].some((v) => String(v || '').toLowerCase().includes(needle)));
  if (directory === 'featured') items = items.filter((i) => i.directory.featured);
  if (directory === 'listed') items = items.filter((i) => i.directory.listed);
  if (directory === 'not_listed') items = items.filter((i) => !i.directory.listed);
  if (noAccounts != null) items = items.filter((i) => (value(i.accounts) === 0) === noAccounts);
  if (dealType) items = items.filter((i) => value(i.deal)!.types.includes(dealType));
  if (endsWithin != null) {
    items = items.filter((i) => {
      const end = stamp(value(i.deal)!.soonest_end);
      return Number.isFinite(end) && end >= now && end <= now + endsWithin * DAY;
    });
  }

  // Missing values sort last; the firm id is the stable tie-break.
  const last = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? Infinity : n);
  const cmp: Record<string, (a: Item, b: Item) => number> = {
    name_asc: (a, b) => nameKey(a).localeCompare(nameKey(b)),
    name_desc: (a, b) => nameKey(b).localeCompare(nameKey(a)),
    accounts_desc: (a, b) => (value(b.accounts) ?? 0) - (value(a.accounts) ?? 0),
    deal_ends_asc: (a, b) => last(stamp(value(a.deal)?.soonest_end)) - last(stamp(value(b.deal)?.soonest_end)),
    rating_desc: (a, b) => last(-(value(a.rating)?.average ?? NaN)) - last(-(value(b.rating)?.average ?? NaN)),
  };
  items.sort((a, b) => cmp[sort](a, b) || a.id - b.id);

  return c.json({
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit, offset, sort,
    as_of: new Date(now).toISOString(),
    scope: s.branch || 'hq',
    filters: { directory: DIRECTORY, deal_types: ALL_PARTNER_DEAL_TYPES, ends_within: ENDS_WITHIN, sorts: SORTS },
    unreadable: (['accounts', 'deals', 'redemptions', 'ratings', 'settlements'] as const).filter((k) => !s[k].available),
  });
});

route.get('/firms/:id{[0-9]+}', async (c) => {
  await requireAdmin(c);
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id < 1) return refuse(c, 404, { code: 'not_found', message: 'This firm no longer exists.' });
  const branch = branchOf(c.env);
  const firmRead = await read(c.env.DB, 'firm', `SELECT id, name, company, specialization, status,
      COALESCE(directory_listed, 0) AS directory_listed, COALESCE(directory_featured, 0) AS directory_featured,
      directory_decided_at, oh_when_to_book, oh_stage_fit, oh_session_outcome
      FROM partners WHERE id = ?`, [id]);
  if (!has(firmRead)) return refuse(c, 503, { code: 'firm_unreadable', message: 'This firm could not be read. Try again.' });
  const f = firmRead.value[0];
  if (!f) return refuse(c, 404, { code: 'not_found', message: 'This firm no longer exists.' });

  const [accounts, deals, settlements, profiles, ratings, host] = await Promise.all([
    read(c.env.DB, 'accounts', `SELECT id, name, headline, is_active FROM users WHERE partner_id = ? ORDER BY lower(COALESCE(name, '')), id`, [id]),
    read(c.env.DB, 'deals', `SELECT d.id, d.user_id, d.deal_type, d.status, d.term_months, d.activated_at, d.expires_at,
        d.granted_tier_founder, d.granted_tier_investor,
        (SELECT COUNT(*) FROM partner_referral_redemptions r WHERE r.partner_deal_id = d.id) AS redemptions
        FROM partner_deals d JOIN users u ON u.id = d.user_id
        WHERE u.partner_id = ? ORDER BY d.id DESC LIMIT ?`, [id, DRAWER_ROWS + 1]),
    branch
      ? Promise.resolve(missing(HQ_SETTLEMENTS))
      : read(c.env.DB, 'settlements', `SELECT s.id, s.partner_deal_id, s.kind, s.direction, s.amount_cents, s.currency, s.due_on, s.state
          FROM partner_deal_settlements s JOIN partner_deals d ON d.id = s.partner_deal_id JOIN users u ON u.id = d.user_id
          WHERE u.partner_id = ? ORDER BY s.due_on DESC, s.id DESC LIMIT ?`, [id, DRAWER_ROWS + 1]),
    read(c.env.DB, 'partner profiles', `SELECT p.user_id, p.organization, p.role_title, p.expertise, p.sectors, p.geography,
        p.capacity_per_month, p.capital_capacity_usd, p.updated_at
        FROM partner_profiles p JOIN users u ON u.id = p.user_id
        WHERE u.partner_id = ? ORDER BY p.updated_at DESC, p.user_id`, [id]),
    read(c.env.DB, 'ratings', `SELECT COUNT(*) AS n, SUM(rating) AS total FROM partner_booking_ratings
        WHERE partner_id = ? AND rating BETWEEN 1 AND 5 AND rating = CAST(rating AS INTEGER)`, [id]),
    read(c.env.DB, 'Lab host status', `SELECT status, reviewed_at FROM lab_host_applications
        WHERE host_kind = 'partner' AND host_id = ? ORDER BY id DESC LIMIT 1`, [id]),
  ]);

  const capped = (block: Read<Row[]>) => column(block, () => ({ rows: rowsOf(block).slice(0, DRAWER_ROWS), more: rowsOf(block).length > DRAWER_ROWS }));
  const text = (v: unknown, label: string): Read<string> => (v == null || String(v).trim() === '' ? missing(`${label} not recorded.`) : ok(String(v).trim()));
  const list = (v: unknown, label: string): Read<string[]> => {
    const items = String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    return items.length ? ok([...new Set(items)]) : missing(`${label} not recorded.`);
  };
  const capital = (v: unknown): Read<{ amount_cents: number; currency: 'usd' }> => {
    if (v == null) return missing('Capital capacity not recorded.');
    const cents = Number(v) * 100;
    return Number.isSafeInteger(cents) && cents >= 0 ? ok({ amount_cents: cents, currency: 'usd' }) : unreadable('Capital capacity could not be read.');
  };

  return c.json({
    firm: { id, name: f.name ?? null, company: f.company ?? null, specialization: f.specialization ?? null, status: f.status ?? null },
    scope: branch || 'hq',
    accounts: column(accounts, () => rowsOf(accounts).map((a: Row) => ({
      id: Number(a.id), name: a.name ?? null, headline: a.headline ?? null, active: a.is_active == null ? null : Number(a.is_active) === 1,
    }))),
    directory: { ...directoryOf(f), decided_at: f.directory_decided_at ?? null },
    deals: capped(deals),
    settlements: settlements.available && !settlements.recorded ? settlements : capped(settlements),
    profiles: column(profiles, () => rowsOf(profiles).map((p: Row) => ({
      user_id: Number(p.user_id),
      organization: text(p.organization, 'Organisation'),
      role_title: text(p.role_title, 'Role title'),
      expertise: list(p.expertise, 'Expertise'),
      sectors: list(p.sectors, 'Sectors'),
      geography: text(p.geography, 'Geography'),
      capacity_per_month: text(p.capacity_per_month, 'Capacity per month'),
      capital_capacity: capital(p.capital_capacity_usd),
      updated_at: p.updated_at ?? null,
    }))),
    office_hours: {
      when_to_book: text(f.oh_when_to_book, 'When to book'),
      stage_fit: text(f.oh_stage_fit, 'Stage fit'),
      session_outcome: text(f.oh_session_outcome, 'Session outcome'),
      rating: column(ratings, () => ratingOf(rowsOf(ratings))),
      lab_host: column(host, () => ({ status: rowsOf(host)[0]?.status ?? null, decided_at: rowsOf(host)[0]?.reviewed_at ?? null })),
    },
  });
});

export default route;
