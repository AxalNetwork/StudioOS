/**
 * D712 (#1777) PR 2 — what the reporting queue reads from #1775's stored
 * Mercury rows: the monthly cash and reconciliation summary (decision 10), the
 * Fund's cash (decision 9) and a quarterly report's unmatched count
 * (decision 3).
 *
 * SQL over migration 474's tables only. It never calls Mercury, never reads a
 * token or a credential column, and never reads a personal connection: every
 * account comes from `mercury_accounts`, which only an entity connection
 * fills. Bank text (counterparty names, memos) is data, copied from an
 * allowlist of fields, never instructions; a full account or routing number
 * is never stored by D710, and none is copied here.
 */
import type { Env } from '../types';
import { POSTED_STATUSES } from './mercury/match';
import { fundPayeeOf } from './payInstructions';
import type { Line, Period } from './fundReportBuild';

/**
 * `services/mercury/store.ts`'s voided statuses. Only D710's files may import
 * the store (`mercury_read_only_d710.test.mjs`), so this is a copy, and
 * `fund_cash_summary_d712.test.ts` pins it to the store's list.
 */
export const VOIDED_STATUSES = ['cancelled', 'failed'];
export const UNMATCHED_CAP = 500;
export const MEMO_CAP = 140;
export const INTERCOMPANY_DAYS = 5;
export const NO_FUND_ACCOUNT = 'Not recorded: the Fund has no bank account on record';

const known = (cents: number): Line => ({ cents });
const missing = (reason: string): Line => ({ cents: null, reason });
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const dayBefore = (iso: string) => shift(iso, -1);
const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
const POSTED = JSON.stringify(POSTED_STATUSES);
const VOIDED = JSON.stringify(VOIDED_STATUSES);

/** The entities with a Mercury entity connection, in any state: their stored rows stay readable. */
export async function connectedEntities(env: Env): Promise<string[]> {
  const res = await env.DB.prepare('SELECT DISTINCT entity_key FROM mercury_entity_connections ORDER BY entity_key').all<{ entity_key: string }>();
  return (res.results || []).map((r) => r.entity_key);
}

type Account = { id: number; entity_key: string; kind: string; last_four: string; nickname: string | null; registered: number };

async function snapshot(env: Env, accountId: number, date: string): Promise<number | null> {
  const row = await env.DB.prepare('SELECT current_cents FROM mercury_balance_snapshots WHERE account_id = ? AND as_of_date = ?')
    .bind(accountId, date).first<{ current_cents: number | null }>();
  return row && row.current_cents != null ? Number(row.current_cents) : null;
}

type Txn = {
  id: number; uid: string; account_id: number; last_four: string; entity_key: string; registered: number;
  amount_cents: number; posted_on: string; counterparty_name: string | null; memo: string | null; kind: string | null; status: string | null;
  match_kind: string | null;
  /** D749: the reason of the line's `active` Not ours mark, or null. A `needs_review` mark leaves it null. */
  not_ours: string | null;
};

type Scope = { account?: number; entity?: string; registered?: boolean };

/** Posted means `posted_on` is set and the status is a posted one. Every filter is bound. */
async function postedBetween(env: Env, scope: Scope, start: string, end: string): Promise<Txn[]> {
  const res = await env.DB.prepare(
    `SELECT t.id, t.uid, t.account_id, a.last_four, a.entity_key, a.registered, t.amount_cents, t.posted_on,
            t.counterparty_name, t.memo, t.kind, t.status,
            (SELECT m.target_kind FROM mercury_matches m WHERE m.transaction_id = t.id AND m.state = 'confirmed' LIMIT 1) AS match_kind,
            (SELECT n.reason FROM mercury_not_ours n WHERE n.transaction_id = t.id AND n.state = 'active') AS not_ours
       FROM mercury_transactions t JOIN mercury_accounts a ON a.id = t.account_id
      WHERE (? IS NULL OR t.account_id = ?) AND (? IS NULL OR a.entity_key = ?) AND (? = 0 OR a.registered = 1)
        AND t.posted_on IS NOT NULL AND t.posted_on BETWEEN ? AND ?
        AND lower(COALESCE(t.status, '')) IN (SELECT value FROM json_each(?))
      ORDER BY t.posted_on, t.id`,
  ).bind(scope.account ?? null, scope.account ?? null, scope.entity ?? null, scope.entity ?? null, scope.registered ? 1 : 0,
    start, end, POSTED).all<Txn>();
  return res.results || [];
}

/**
 * Decision 10's intercompany pairs touching `entity` in the month: a posted
 * debit on one entity's registered account and a posted credit of the same
 * absolute cents on another entity's registered account, within five days.
 * Each transaction pairs once, earliest first.
 */
async function intercompany(env: Env, entity: string, p: Period) {
  // A pair may straddle the month, so read five days either side of it.
  const lo = shift(p.start, -INTERCOMPANY_DAYS);
  const hi = shift(p.end, INTERCOMPANY_DAYS);
  const all = await postedBetween(env, { registered: true }, lo, hi);
  const debits = all.filter((t) => t.amount_cents < 0);
  const credits = all.filter((t) => t.amount_cents > 0);
  const used = new Set<number>();
  const pairs: Array<Record<string, unknown>> = [];
  for (const d of debits) {
    const c = credits.find((x) => !used.has(x.id) && x.entity_key !== d.entity_key && x.amount_cents === -d.amount_cents
      && daysApart(x.posted_on, d.posted_on) <= INTERCOMPANY_DAYS);
    if (!c) continue;
    used.add(c.id);
    const mine = d.entity_key === entity ? d : c.entity_key === entity ? c : null;
    if (!mine || mine.posted_on < p.start || mine.posted_on > p.end) continue;
    pairs.push({
      direction: mine === d ? 'out' : 'in',
      counterpart_entity: mine === d ? c.entity_key : d.entity_key,
      amount_cents: c.amount_cents,
      debit: { transaction: d.uid, entity: d.entity_key, account_last_four: d.last_four, date: d.posted_on },
      credit: { transaction: c.uid, entity: c.entity_key, account_last_four: c.last_four, date: c.posted_on },
    });
  }
  return pairs;
}

/** The fields an unmatched line may carry, and nothing else. */
const unmatchedLine = (t: Txn) => ({
  transaction: t.uid, account_last_four: t.last_four, date: t.posted_on, amount_cents: t.amount_cents,
  counterparty_name: t.counterparty_name ?? null,
  memo: t.memo == null ? null : t.memo.length > MEMO_CAP ? `${t.memo.slice(0, MEMO_CAP - 1)}…` : t.memo,
  kind: t.kind ?? null, status: t.status ?? null,
});

/** One entity's `entity_cash_monthly` figures for a closed month (decision 10). */
export async function cashSummaryFigures(env: Env, entity: string, p: Period) {
  const accounts = (await env.DB.prepare(
    'SELECT id, entity_key, kind, last_four, nickname, registered FROM mercury_accounts WHERE entity_key = ? ORDER BY id',
  ).bind(entity).all<Account>()).results || [];
  const openDate = dayBefore(p.start);
  const perAccount = [];
  for (const a of accounts) {
    const posted = await postedBetween(env, { account: a.id }, p.start, p.end);
    const inflows = posted.filter((t) => t.amount_cents > 0).reduce((s, t) => s + t.amount_cents, 0);
    const outflows = posted.filter((t) => t.amount_cents < 0).reduce((s, t) => s - t.amount_cents, 0);
    const o = await snapshot(env, a.id, openDate);
    const c = await snapshot(env, a.id, p.end);
    const opening = o == null ? missing(`Not recorded: no balance on record for ${openDate}`) : known(o);
    const closing = c == null ? missing(`Not recorded: no balance on record for ${p.end}`) : known(c);
    const difference = o == null || c == null ? null : o + inflows - outflows - c;
    perAccount.push({
      label: a.nickname || `${a.kind} ${a.last_four}`, kind: a.kind, last_four: a.last_four, registered: Number(a.registered) === 1,
      opening, closing, inflows_cents: inflows, outflows_cents: outflows,
      tie: difference == null
        ? { difference_cents: null, reason: 'Not recorded: an opening or closing balance is missing' }
        : { difference_cents: difference, ties: difference === 0, ...(difference === 0 ? {} : { label: 'Does not tie' }) },
    });
  }
  const pending = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(t.amount_cents), 0) AS cents
       FROM mercury_transactions t JOIN mercury_accounts a ON a.id = t.account_id
      WHERE a.entity_key = ? AND t.created_on IS NOT NULL AND t.created_on <= ?
        AND (t.posted_on IS NULL OR t.posted_on > ?)
        AND lower(COALESCE(t.status, '')) NOT IN (SELECT value FROM json_each(?))`,
  ).bind(entity, p.end, p.end, VOIDED).first<{ n: number; cents: number }>();
  const posted = await postedBetween(env, { entity }, p.start, p.end);
  const matched: Record<string, number> = {};
  for (const t of posted) if (t.match_kind) matched[t.match_kind] = (matched[t.match_kind] ?? 0) + 1;
  // D710 matches credits only, so every other posted line is unmatched,
  // debits and internal transfers included, except a credit an Admin marked
  // Not ours (D749): it is counted by reason instead.
  const unmatched = posted.filter((t) => !t.match_kind && !t.not_ours);
  const notOurs: Record<string, number> = {};
  for (const t of posted) if (!t.match_kind && t.not_ours) notOurs[t.not_ours] = (notOurs[t.not_ours] ?? 0) + 1;
  return {
    schema: 'entity_cash_monthly/1',
    entity: entity,
    period: p,
    currency: 'USD',
    accounts: perAccount,
    pending: { count: Number(pending?.n ?? 0), sum_cents: Number(pending?.cents ?? 0), as_of: p.end },
    reconciliation: {
      posted_count: posted.length,
      matched_by_kind: matched,
      unmatched: unmatched.slice(0, UNMATCHED_CAP).map(unmatchedLine),
      unmatched_more: Math.max(0, unmatched.length - UNMATCHED_CAP),
      not_ours_count: Object.values(notOurs).reduce((a, b) => a + b, 0),
      not_ours_by_reason: notOurs,
    },
    intercompany: await intercompany(env, entity, p),
    // Those past the 500-row cap included (decision 3).
    unmatched_count: unmatched.length,
  };
}

/** The Fund's registered accounts, only for the fund #1773 names as Fund I (decision 9). */
async function fundAccounts(env: Env, fundId: number): Promise<Account[] | null> {
  if (await fundPayeeOf(env, fundId) !== 'fund') return null;
  const rows = (await env.DB.prepare(
    "SELECT id, entity_key, kind, last_four, nickname, registered FROM mercury_accounts WHERE entity_key = 'fund' AND registered = 1 ORDER BY id",
  ).all<Account>()).results || [];
  return rows.some((a) => a.kind === 'checking') ? rows : null;
}

/** The Fund's cash at `date`: the closing balances of its registered accounts, else Not recorded. */
export async function fundCash(env: Env, fundId: number, date: string): Promise<Line> {
  const accounts = await fundAccounts(env, fundId);
  if (!accounts) return missing(NO_FUND_ACCOUNT);
  let total = 0;
  for (const a of accounts) {
    const c = await snapshot(env, a.id, date);
    if (c == null) return missing(`Not recorded: no balance on record for ${date}`);
    total += c;
  }
  return known(total);
}

/** A quarterly report's `unmatched_count`: the Fund's posted lines in the quarter that no confirmed match covers and no active Not ours mark takes out. */
export async function fundUnmatchedCount(env: Env, fundId: number, p: Period): Promise<number> {
  const accounts = await fundAccounts(env, fundId);
  if (!accounts) return 0;
  const posted = await postedBetween(env, { entity: 'fund', registered: true }, p.start, p.end);
  // D749: a line with an active Not ours mark is not unmatched.
  return posted.filter((t) => !t.match_kind && !t.not_ours).length;
}
