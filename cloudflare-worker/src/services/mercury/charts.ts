/** D1183 (#3112): stored HQ chart reads only. No bank caller or credentials. */
import type { Env } from '../../types';
import { INTERCOMPANY_DAYS } from '../fundCashSummary';
import { INTERNAL_KINDS, POSTED_STATUSES } from './parse';
import { ENTITY_KEYS, type AccountRow } from './store';

export const BALANCE_RANGES = ['30d', '90d', '12m'] as const;
export type BalanceRange = typeof BALANCE_RANGES[number];
const DAY = 86_400_000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const shift = (day: string, n: number) => iso(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY));

export function balanceWindow(range: BalanceRange, now: Date) {
  const to = iso(now);
  if (range !== '12m') return { from: shift(to, range === '30d' ? -29 : -89), to };
  // The trailing calendar year, inclusive of today; clamp 29 February.
  const year = now.getUTCFullYear() - 1, month = now.getUTCMonth();
  const day = Math.min(now.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return { from: shift(iso(new Date(Date.UTC(year, month, day))), 1), to };
}

function cents(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value)) throw new Error('Stored chart amount unreadable');
  return value;
}
const money = (value: number | null) => ({ cents: cents(value), reason: value === null ? 'not_recorded' : null });

type Snapshot = { account_uid: string; as_of_date: string; current_cents: number | null; available_cents: number | null; read_at: string };
type ChartAccount = Pick<AccountRow, 'uid' | 'entity_key' | 'kind' | 'last_four' | 'registered'>;

export async function balanceSeries(env: Env, account: string | null, range: BalanceRange, now: Date) {
  const period = balanceWindow(range, now);
  const accounts = await env.DB.prepare(`SELECT uid, entity_key, kind, last_four, registered FROM mercury_accounts
    WHERE (? IS NULL OR uid = ?) ORDER BY entity_key, uid`).bind(account, account).all<ChartAccount>();
  if (!Array.isArray(accounts?.results)) throw new Error('Stored chart accounts unreadable');
  if (account && !accounts.results.length) return null;
  const snapshots = await env.DB.prepare(`SELECT a.uid AS account_uid, s.as_of_date, s.current_cents, s.available_cents, s.read_at
    FROM mercury_balance_snapshots s JOIN mercury_accounts a ON a.id = s.account_id
    WHERE (? IS NULL OR a.uid = ?) AND s.as_of_date >= ? AND s.as_of_date <= ?
    ORDER BY s.as_of_date, a.uid`).bind(account, account, period.from, period.to).all<Snapshot>();
  if (!Array.isArray(snapshots?.results)) throw new Error('Stored chart snapshots unreadable');
  const byAccount = new Map<string, Snapshot[]>();
  for (const row of snapshots.results) {
    const rows = byAccount.get(row.account_uid) ?? [];
    rows.push(row); byAccount.set(row.account_uid, rows);
  }
  return { currency: 'USD', range, ...period, items: accounts.results.map(a => {
    const rows = byAccount.get(a.uid) ?? [];
    return { account_uid: a.uid, entity_key: a.entity_key, kind: a.kind, account_masked: `••••${a.last_four}`,
      registered: a.registered === 1, reason: rows.length ? null : 'not_recorded',
      points: rows.map(s => ({ date: s.as_of_date, current: money(s.current_cents), available: money(s.available_cents), as_of: s.read_at })) };
  }) };
}

type Posted = { id: number; entity_key: string; registered: number; amount_cents: number; posted_on: string; kind: string | null };

/** D712's earliest-first, one-use pairing: registered accounts of different
 * entities, equal opposite cents, posted no more than five days apart. */
function intercompanyIds(rows: Posted[]) {
  // A native move stays inside one Mercury organization. It cannot be the
  // other half of an external flow at another entity, even at equal cents.
  const candidates = rows.filter(row => !(INTERNAL_KINDS as readonly string[]).includes(row.kind ?? ''));
  const credits = new Map<number, Posted[]>();
  for (const row of candidates) if (row.registered === 1 && row.amount_cents > 0) {
    const group = credits.get(row.amount_cents) ?? [];
    group.push(row); credits.set(row.amount_cents, group);
  }
  const paired = new Set<number>();
  for (const debit of candidates) {
    if (debit.registered !== 1 || debit.amount_cents >= 0) continue;
    const group = credits.get(-debit.amount_cents);
    if (!group) continue;
    const since = shift(debit.posted_on, -INTERCOMPANY_DAYS), until = shift(debit.posted_on, INTERCOMPANY_DAYS);
    // Skip old credits by date instead of rescanning every earlier year for
    // each debit. Credits retain their posting-date/id order.
    let lo = 0, hi = group.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (group[mid].posted_on < since) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < group.length && group[i].posted_on <= until; i++) {
      const credit = group[i];
      if (paired.has(credit.id) || credit.entity_key === debit.entity_key) continue;
      paired.add(debit.id); paired.add(credit.id); break;
    }
  }
  return paired;
}

export async function monthlyFlows(env: Env, entity: string | null, now: Date) {
  const from = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1))), to = iso(now);
  // Read all entities before applying the display filter.
  const result = await env.DB.prepare(`SELECT t.id, a.entity_key, a.registered, t.amount_cents, t.posted_on, t.kind
    FROM mercury_transactions t JOIN mercury_accounts a ON a.id = t.account_id
    WHERE t.posted_on IS NOT NULL AND t.posted_on >= ? AND t.posted_on <= ?
      AND lower(COALESCE(t.status, '')) IN (SELECT value FROM json_each(?)) AND lower(t.currency) = 'usd'
    ORDER BY t.posted_on, t.id`).bind(from, to, JSON.stringify(POSTED_STATUSES)).all<Posted>();
  if (!Array.isArray(result?.results)) throw new Error('Stored chart transactions unreadable');
  for (const row of result.results) cents(row.amount_cents);
  // Pairing decisions can depend on chains of earlier pairs. A fixed five-
  // day lookback can free an already-used counterpart at the display edge.
  // Read earlier candidates for the displayed amounts only; other amounts
  // cannot affect these pairs. No historical figures leave this service.
  const amounts = [...new Set(result.results.filter(row => row.registered === 1 && row.amount_cents !== 0
    && !(INTERNAL_KINDS as readonly string[]).includes(row.kind ?? '')).flatMap(row => [row.amount_cents, -row.amount_cents]))];
  let history: Posted[] = [];
  if (amounts.length) {
    const earlier = await env.DB.prepare(`SELECT t.id, a.entity_key, a.registered, t.amount_cents, t.posted_on, t.kind
      FROM mercury_transactions t JOIN mercury_accounts a ON a.id = t.account_id
      WHERE a.registered = 1 AND t.posted_on IS NOT NULL AND t.posted_on < ?
        AND t.amount_cents IN (SELECT value FROM json_each(?))
        AND lower(COALESCE(t.status, '')) IN (SELECT value FROM json_each(?)) AND lower(t.currency) = 'usd'
        AND (t.kind IS NULL OR t.kind NOT IN (SELECT value FROM json_each(?)))
      ORDER BY t.posted_on, t.id`).bind(from, JSON.stringify(amounts), JSON.stringify(POSTED_STATUSES), JSON.stringify(INTERNAL_KINDS)).all<Posted>();
    if (!Array.isArray(earlier?.results)) throw new Error('Stored chart transfer history unreadable');
    history = earlier.results;
    for (const row of history) cents(row.amount_cents);
  }
  const paired = intercompanyIds([...history, ...result.results]);
  return { currency: 'USD', from, to, months: 6, items: ENTITY_KEYS.filter(key => !entity || key === entity).map(key => {
    const points = new Map<string, { month: string; in_cents: number; out_cents: number; to_date: boolean }>();
    for (const row of result.results) {
      if (row.entity_key !== key || row.posted_on < from) continue;
      const month = row.posted_on.slice(0, 7);
      const point = points.get(month) ?? { month, in_cents: 0, out_cents: 0, to_date: month === to.slice(0, 7) };
      if (!paired.has(row.id) && !(INTERNAL_KINDS as readonly string[]).includes(row.kind ?? '')) {
        if (row.amount_cents > 0) point.in_cents += row.amount_cents;
        else point.out_cents -= row.amount_cents;
        cents(point.in_cents); cents(point.out_cents);
      }
      points.set(month, point);
    }
    return { entity_key: key, reason: points.size ? null : 'not_recorded', points: [...points.values()] };
  }) };
}
