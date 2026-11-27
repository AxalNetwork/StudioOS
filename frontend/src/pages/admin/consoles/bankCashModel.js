/**
 * D1186 (#3115, part 5 of #2389) — Bank accounts › Cash as pure functions
 * (BNK3, BNK4): the four tiles, cash by entity over 30 days, 90 days or 12
 * months, and money in and out by month. No React here, so `node --test`
 * loads it alone.
 *
 * ONE READ, ONE FIGURE. The tiles, the chart's legend and the Balances table
 * all come from `GET /api/admin/mercury/accounts`, the read Fund admin ›
 * Banking draws its Accounts table from, and the page reads it once. So the
 * Fund's cash here is the figure Fund admin shows, by construction.
 *
 * A GAP IS NEVER A ZERO. `GET /api/admin/mercury/balances` (D1183) sends no
 * point for a day with no snapshot. A day on which any entity in the chart
 * has no snapshot (or a snapshot with no Current) is a gap for the whole
 * stack, drawn as "Not recorded", never as a drop to 0. A month with no
 * posted line is absent from `/monthly`; it is drawn as "Not recorded".
 */
import { formatCents } from '../../investor/fundCallsModel.js';

export const ENTITY_ORDER = ['holdings', 'management', 'gp', 'fund'];
export const ENTITY_SHORT = { holdings: 'Holdings', management: 'Management', gp: 'GP', fund: 'Fund I' };
export const RANGES = [['30d', '30 days'], ['90d', '90 days'], ['12m', '12 months']];
export const DEFAULT_RANGE = '90d';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86_400_000;
const list = (v) => (Array.isArray(v) ? v : []);
const known = (m) => m != null && m.cents != null && Number.isSafeInteger(Number(m.cents));
const notRecorded = (reason) => ({ value: 'Not recorded', missing: true, note: reason });

/** "21 Oct 2026, 08:00 UTC" from an ISO time; null for anything else. */
export function timeText(iso) {
  const ms = Date.parse(typeof iso === 'string' ? (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`) : '');
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0'), mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

/** "21 Oct" from a `YYYY-MM-DD` day. */
export const dayText = (day) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : 'Not recorded';
};
/** "Oct" or "Oct 2026" from `YYYY-MM`. */
export const monthText = (month, withYear = false) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]}${withYear ? ` ${m[1]}` : ''}` : 'Not recorded';
};

/** The registered accounts of the accounts read: the registry's, as the canvas counts them. */
export const registeredOf = (items) => list(items).filter((a) => a?.registered === true || a?.registered === 1);

/**
 * One entity's cash: the sum of Current over its registered accounts, or null
 * when it has none or any of them has no Current. A partial sum is never
 * shown as the entity's cash.
 */
export function entityCash(items, key) {
  const mine = registeredOf(items).filter((a) => a.entity_key === key);
  if (!mine.length || !mine.every((a) => known(a.current))) return null;
  return mine.reduce((s, a) => s + Number(a.current.cents), 0);
}

/**
 * The four tiles (BNK3): cash across entities, available, unmatched receipts
 * and accounts without a balance. `accounts` is the accounts read
 * (`{ status, data }`); `unmatched` is `{ status, byEntity }` from
 * `unmatchedOf`.
 */
export function cashTiles(accounts, unmatched) {
  const loading = (k) => ({ k, value: 'Reading…', loading: true });
  const unreadable = (k, note) => ({ k, value: 'Unreadable', missing: true, note });
  let cash, available, without;
  if (accounts?.status !== 'ready') {
    const failed = accounts?.status === 'unreadable';
    cash = failed ? unreadable('Cash across entities', 'The entity accounts could not be read.') : loading('Cash across entities');
    available = failed ? unreadable('Available', 'The entity accounts could not be read.') : loading('Available');
    without = failed ? unreadable('Accounts without a balance', 'The entity accounts could not be read.') : loading('Accounts without a balance');
  } else {
    const reg = registeredOf(accounts.data?.items);
    const withCur = reg.filter((a) => known(a.current));
    const withAvail = reg.filter((a) => known(a.available));
    const latest = withCur.map((a) => a.balance_read_at).filter(Boolean).sort().pop();
    const asOf = latest ? timeText(latest) : null;
    cash = !reg.length ? { k: 'Cash across entities', ...notRecorded('No account in the registry has been read from Mercury.') }
      : !withCur.length ? { k: 'Cash across entities', ...notRecorded('Mercury sent no Current balance for any registered account.') }
        : { k: 'Cash across entities', value: formatCents(withCur.reduce((s, a) => s + Number(a.current.cents), 0)),
          note: `Registered accounts, ${withCur.length} of ${reg.length} read${asOf ? ` · as of ${asOf}` : ''}` };
    available = !withAvail.length ? { k: 'Available', ...notRecorded(reg.length ? 'Mercury sent no Available balance for any registered account.' : 'No account in the registry has been read from Mercury.') }
      : { k: 'Available', value: formatCents(withAvail.reduce((s, a) => s + Number(a.available.cents), 0)),
        note: `Excludes pending debits${withAvail.length < reg.length ? ` · ${withAvail.length} of ${reg.length} accounts` : ''}` };
    const missing = reg.filter((a) => !known(a.current));
    without = !reg.length ? { k: 'Accounts without a balance', ...notRecorded('No account in the registry has been read from Mercury.') }
      : { k: 'Accounts without a balance', value: String(missing.length),
        note: missing.length
          ? missing.map((a) => `${ENTITY_SHORT[a.entity_key] || a.entity_key} ••••${a.last_four || '····'}: ${a.current?.reason === 'unreadable' ? 'could not be read' : 'Mercury sent no balance'}`).join(' · ')
          : 'Every registered account has a balance' };
  }
  return [cash, available, unmatchedTile(unmatched), without];
}

/**
 * Every unmatched receipt, counted: each connected entity's
 * `transactions?match=none&direction=credit` total, which counts every
 * credit, not the page of five the registry shows. An entity whose read
 * failed makes the tile Unreadable rather than a smaller number.
 */
export function unmatchedTile(u) {
  const k = 'Unmatched receipts';
  if (!u || u.status === 'loading') return { k, value: 'Reading…', loading: true };
  if (u.status === 'unreadable') return { k, value: 'Unreadable', missing: true, note: 'The Mercury connections could not be read. This is not a claim that there is none.' };
  const rows = ENTITY_ORDER.map((key) => [key, u.byEntity?.[key] || { status: 'unconnected' }]);
  const connected = rows.filter(([, r]) => r.status !== 'unconnected');
  const parts = rows.map(([key, r]) => (r.status === 'unconnected' ? `${ENTITY_SHORT[key]} not connected`
    : r.status === 'ready' ? `${ENTITY_SHORT[key]} ${r.total}` : r.status === 'loading' ? `${ENTITY_SHORT[key]} reading` : `${ENTITY_SHORT[key]} could not be read`));
  const note = `${parts.join(' · ')} · Match in Fund admin › Banking › Reconciliation`;
  if (!connected.length) return { k, ...notRecorded('No entity’s Mercury is connected.') };
  if (connected.some(([, r]) => r.status === 'loading')) return { k, value: 'Reading…', loading: true, note };
  if (connected.some(([, r]) => r.status !== 'ready' || !Number.isSafeInteger(r.total) || r.total < 0)) return { k, value: 'Unreadable', missing: true, note };
  return { k, value: String(connected.reduce((s, [, r]) => s + r.total, 0)), note };
}

/** Every day from `from` to `to`, inclusive. */
export function daysBetween(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
  const out = [];
  for (let t = a; t <= b; t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/**
 * Cash by entity over the range, from `/balances`: end-of-day Current of the
 * registered accounts, stacked by entity. `days[i].total` is null on a gap:
 * a day on which any account in the chart has no snapshot, or no Current.
 * An entity with no snapshot in the range is left out and named in
 * `missing`, never drawn as 0.
 */
export function seriesOf(data) {
  const accounts = registeredOf(data?.items);
  const withPoints = accounts.filter((a) => list(a.points).length);
  const entities = ENTITY_ORDER.filter((k) => withPoints.some((a) => a.entity_key === k));
  const missing = ENTITY_ORDER.filter((k) => !entities.includes(k));
  const at = new Map(withPoints.map((a) => [a.account_uid, new Map(list(a.points).map((p) => [p.date, p.current]))]));
  const days = daysBetween(data?.from, data?.to).map((date) => {
    const byEntity = {};
    let gap = false;
    for (const k of entities) {
      let sum = 0;
      for (const a of withPoints.filter((x) => x.entity_key === k)) {
        const cur = at.get(a.account_uid).get(date);
        if (!known(cur)) { gap = true; break; }
        sum += Number(cur.cents);
      }
      byEntity[k] = gap ? null : sum;
      if (gap) break;
    }
    if (gap) return { date, byEntity: Object.fromEntries(entities.map((k) => [k, null])), total: null };
    return { date, byEntity, total: entities.reduce((s, k) => s + byEntity[k], 0) };
  });
  const gaps = days.filter((d) => d.total == null).length;
  const max = Math.max(0, ...days.map((d) => d.total ?? 0));
  return { days, entities, missing, gaps, max, empty: !entities.length };
}

/** The runs of consecutive days: `[{ gap, start, end }]`, indexes into `days`. */
export function runsOf(days) {
  const runs = [];
  days.forEach((d, i) => {
    const gap = d.total == null;
    const last = runs[runs.length - 1];
    if (last && last.gap === gap) last.end = i; else runs.push({ gap, start: i, end: i });
  });
  return runs;
}

/** The six months `/monthly` covers, oldest first, as `YYYY-MM`. */
export function monthsOf(data) {
  const m = /^(\d{4})-(\d{2})/.exec(String(data?.to || ''));
  if (!m) return [];
  const out = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/**
 * Money in and out by month for `entity` (`all` or a key): one bar pair per
 * month, or `null` for a month with no posted line recorded. For All, a month
 * sums the entities that have it and names the ones that do not.
 */
export function monthlyOf(data, entity = 'all') {
  const items = list(data?.items).filter((it) => entity === 'all' || it.entity_key === entity);
  const months = monthsOf(data).map((month) => {
    const have = items.map((it) => [it.entity_key, list(it.points).find((p) => p.month === month)]).filter(([, p]) => p);
    if (!have.length) return { month, in_cents: null, out_cents: null, to_date: false, without: [] };
    return {
      month,
      in_cents: have.reduce((s, [, p]) => s + Number(p.in_cents || 0), 0),
      out_cents: have.reduce((s, [, p]) => s + Number(p.out_cents || 0), 0),
      to_date: have.some(([, p]) => p.to_date),
      without: entity === 'all' ? items.filter((it) => !have.some(([k]) => k === it.entity_key)).map((it) => it.entity_key) : [],
    };
  });
  const max = Math.max(0, ...months.flatMap((m) => [m.in_cents ?? 0, m.out_cents ?? 0]));
  return { months, max, empty: months.every((m) => m.in_cents == null) };
}

/** "$1.2M", "$350k", "$900" for an axis. */
export function axisMoney(cents) {
  const d = Math.abs(cents) / 100;
  const sign = cents < 0 ? '−' : '';
  if (d >= 1e6) return `${sign}$${(d / 1e6).toFixed(d >= 1e7 ? 0 : 1)}M`;
  if (d >= 1e3) return `${sign}$${Math.round(d / 1e3)}k`;
  return `${sign}$${Math.round(d)}`;
}

/** Four round ticks from 0 to at least `max`. */
export function ticksOf(max) {
  if (!(max > 0)) return [0];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw);
  return [0, 1, 2, 3, 4].map((i) => i * step);
}

/** The words of Cash that are not figures. */
export const CASH_WORDS = {
  seriesFoot: 'End-of-day Current balance of the registered accounts, stacked by entity. A day with no snapshot is not recorded, never a drop to zero.',
  seriesEmpty: 'No stored daily balance for a registered account in this range. The sync keeps one snapshot a day once an entity is connected.',
  monthlyFoot: 'Posted lines only. Moves between Axal’s own accounts are not counted.',
  monthlyEmpty: 'No posted line is recorded in these six months.',
  balancesFoot: 'Cash across entities adds Current over the registry’s accounts that have a balance; an account Mercury reads that is not in the registry is not in it.',
  reconcile: 'Match receipts against capital calls and fees in Fund admin › Banking › Reconciliation. No matching happens here.',
  foot: 'Mercury is read on each sync. Everything here is read-only, and each read is recorded in the admin audit log before it answers.',
};

/** BNK11a: an Admin who is not the Super Admin, on Cash or History. */
export const ADMIN_CARD = {
  eye: 'HQ ONLY',
  title: 'This page belongs to the Super Admin',
  line: 'HQ manages the entities’ bank accounts. You are signed in as an Admin, so Cash and History stay closed rather than opening and refusing each action. Balances and reconciliation are in Fund admin.',
};

/** How a failed read is worded: an audit refusal (503 `audit_unavailable`) read nothing. */
export const AUDIT_REFUSED = 'Nothing was read, because its audit row could not be written.';
export function failedClaim(error, claim) {
  return error?.status === 503 && (error?.data?.code === 'audit_unavailable' || /audit/i.test(String(error?.data?.code || error?.message || ''))) ? AUDIT_REFUSED : claim;
}
