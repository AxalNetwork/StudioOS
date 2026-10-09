/**
 * D664 (#1477) — revenue movements: new, expansion and churned recurring
 * revenue by month, computed from the revenue ledger (`revenue_entries`,
 * migration 311, with its proof levels) and stored in `revenue_movements`
 * (migration 443). Rewritten after every ledger write (`routes/revenue.ts`),
 * including the Stripe import.
 *
 * THE RULES
 *   - Only `recurring` rows count. A customer's MRR in a month is the sum of
 *     its recurring rows received that month.
 *   - A movement is computed only between two consecutive months that BOTH
 *     have recurring rows. A month with no rows is not recorded, never 0, so
 *     a gap in a hand-kept ledger never reads as every customer churning.
 *   - Expansion is split from new only when the rows can tell customers apart.
 *     A Stripe charge with no customer (`STRIPE_NO_CUSTOMER`) cannot be told
 *     apart, so that month's growth is stored as `unsplit`, and no churn is
 *     claimed for it.
 *   - Churn needs at least two billing periods; with fewer it is not recorded.
 *   - `source` is the weakest proof level of the rows behind the figure.
 */
import type { Env } from '../types';
import { STRIPE_NO_CUSTOMER, type Verification } from './revenueLedger';

export interface LedgerRecurring {
  customer: string; amount_cents: number; received_on: string; verification: Verification;
}

export interface Movement {
  month: string; kind: 'new' | 'expansion' | 'churned' | 'unsplit';
  amount_cents: number; customers: number; source: Verification; as_of: string;
}

const RANK: Record<Verification, number> = { manual: 0, supported: 1, verified: 2 };
const weakest = (a: Verification, b: Verification) => (RANK[a] <= RANK[b] ? a : b);

export const monthOf = (d: string) => d.slice(0, 7);
export function prevMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
}

/** True when a row names a customer the split can follow from month to month. */
export const identified = (customer: string) => !!customer && customer.trim() !== '' && customer !== STRIPE_NO_CUSTOMER;

interface MonthData { mrr: Map<string, number>; total: number; anonymous: boolean; source: Verification; as_of: string }

/** Group recurring rows by month: MRR per customer, the total, and whether any row is anonymous. */
export function byMonth(rows: LedgerRecurring[]): Map<string, MonthData> {
  const out = new Map<string, MonthData>();
  for (const r of rows) {
    const m = monthOf(r.received_on);
    const d = out.get(m) ?? { mrr: new Map(), total: 0, anonymous: false, source: 'verified' as Verification, as_of: r.received_on };
    const key = identified(r.customer) ? r.customer.trim().toLowerCase() : '';
    if (!key) d.anonymous = true;
    else d.mrr.set(key, (d.mrr.get(key) ?? 0) + r.amount_cents);
    d.total += r.amount_cents;
    d.source = weakest(d.source, r.verification);
    if (r.received_on > d.as_of) d.as_of = r.received_on;
    out.set(m, d);
  }
  return out;
}

/** The movements of every month whose previous month also has rows. */
export function computeMovements(rows: LedgerRecurring[]): Movement[] {
  const months = byMonth(rows);
  const out: Movement[] = [];
  for (const [m, cur] of [...months.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const prev = months.get(prevMonth(m));
    if (!prev) continue; // no previous billing period: nothing can be said about movement
    const source = weakest(cur.source, prev.source);
    const as_of = cur.as_of;
    if (cur.anonymous || prev.anonymous) {
      out.push({ month: m, kind: 'unsplit', amount_cents: Math.max(0, cur.total - prev.total), customers: 0, source, as_of });
      continue;
    }
    let nw = 0; let nwN = 0; let ex = 0; let exN = 0; let ch = 0; let chN = 0;
    for (const [c, v] of cur.mrr) {
      const p = prev.mrr.get(c) ?? 0;
      if (p === 0) { nw += v; nwN += 1; } else if (v > p) { ex += v - p; exN += 1; } else if (v < p) { ch += p - v; chN += 1; }
    }
    for (const [c, p] of prev.mrr) if (!cur.mrr.has(c)) { ch += p; chN += 1; }
    out.push({ month: m, kind: 'new', amount_cents: nw, customers: nwN, source, as_of });
    out.push({ month: m, kind: 'expansion', amount_cents: ex, customers: exN, source, as_of });
    out.push({ month: m, kind: 'churned', amount_cents: ch, customers: chN, source, as_of });
  }
  return out;
}

/** Billing periods recorded: months with at least one recurring row. */
export const billingPeriods = (rows: LedgerRecurring[]) => byMonth(rows).size;

/** Signup-month cohorts of identified customers, and the share still paying each month after. */
export function cohortRetention(rows: LedgerRecurring[]): Array<{ cohort: string; size: number; retention: Array<number | null> }> {
  const months = byMonth(rows);
  const sorted = [...months.keys()].sort();
  const first = new Map<string, string>();
  for (const m of sorted) for (const c of months.get(m)!.mrr.keys()) if (!first.has(c)) first.set(c, m);
  const cohorts = new Map<string, string[]>();
  for (const [c, m] of first) cohorts.set(m, [...(cohorts.get(m) ?? []), c]);
  return [...cohorts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cohort, members]) => {
    // A later month with no rows is not recorded (null), not 0% retained.
    let m = cohort; const retention: Array<number | null> = [];
    const last = sorted[sorted.length - 1];
    while (m <= last) {
      const d = months.get(m);
      retention.push(d ? Math.round((members.filter((c) => (d.mrr.get(c) ?? 0) > 0).length / members.length) * 100) : null);
      const [y, mo] = m.split('-').map(Number);
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    }
    return { cohort, size: members.length, retention };
  });
}

export async function readRecurring(env: Env, projectId: number): Promise<LedgerRecurring[]> {
  const r = await env.DB.prepare(
    `SELECT customer, amount_cents, received_on, verification FROM revenue_entries
      WHERE project_id = ? AND revenue_type = 'recurring' ORDER BY received_on`,
  ).bind(projectId).all<LedgerRecurring>();
  return r.results || [];
}

/** Rewrite the project's movements from its ledger. */
export async function recomputeRevenueMovements(env: Env, projectId: number): Promise<number> {
  const movements = computeMovements(await readRecurring(env, projectId));
  const stmts = [env.DB.prepare('DELETE FROM revenue_movements WHERE project_id = ?').bind(projectId)];
  for (const m of movements) {
    stmts.push(env.DB.prepare(
      `INSERT INTO revenue_movements (project_id, month, kind, amount_cents, customers, source, as_of) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(projectId, m.month, m.kind, m.amount_cents, m.customers, m.source, m.as_of));
  }
  await env.DB.batch(stmts);
  return movements.length;
}
