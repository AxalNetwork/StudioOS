/**
 * D4295 (#4295, D4289 P6) — the influencer's analytics: one read for the
 * Overview, Links, Earnings and Audience tabs (IN1, IN2, IN4, IN5), and HQ's
 * per-influencer totals.
 *
 * TOTALS ONLY. Nothing here selects a referred member's name, email or id
 * into a reply: every statement aggregates, and a group of 1 to 4 members
 * comes back as `{ fewer_than: 5 }` (D-h). A counted 0 is a 0, because the
 * stores it is counted from are written on every sign-up and commission.
 *
 * HONEST VALUES. A figure nothing stores yet comes back as
 * `{ available: false, reason: 'not_recorded', source }`, naming the part that
 * adds its store; a read that fails comes back as `reason: 'unreadable'`.
 * Never 0 for either.
 *
 *   figure                   source (on main)                          until then
 *   sign-ups                 `referrals` the influencer referred        —
 *   commission               `commissions` by status and currency;     —
 *                            paid = claimed by a completed payout
 *   audience: plan family    referred members' current subscriptions   —
 *                            (`member_subscription_amounts`)
 *   audience: region         referred members' `users.country`         —
 *   audience: month joined   `referrals.created_at`                    —
 *   visits, channels         `handle_visits` (P2, #4291)               not_recorded
 *   paid members, revenue,   the paid invoices behind commissions       not_recorded
 *   bonuses, retention,      (P3, #4292)
 *   visit → paid
 *
 * Money is per currency and never summed across currencies. Pure apart from
 * its bound reads; it never calls a model. `summaryLine` is IN1's Eadwyn line,
 * built from these figures with their date, so it can only restate them.
 */
import type { Env } from '../../types';

export const SMALL_GROUP = 5;
export const WEEKS = 12;
const DAY = 86_400_000;

export type Unavailable = { available: false; reason: 'not_recorded' | 'unreadable' | 'hq_reads'; source?: string };
export type Count = number | { fewer_than: number };
export const notRecorded = (source: string): Unavailable => ({ available: false, reason: 'not_recorded', source });
export const unreadable = (): Unavailable => ({ available: false, reason: 'unreadable' });
export const hqReads = (): Unavailable => ({ available: false, reason: 'hq_reads' });

/** A count of members: 1 to 4 reads "Fewer than 5". */
export function masked(n: number): Count {
  return n > 0 && n < SMALL_GROUP ? { fewer_than: SMALL_GROUP } : n;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Monday of `d`'s week, UTC, as YYYY-MM-DD. */
export function weekOf(d: Date): string {
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back)).toISOString().slice(0, 10);
}

export interface Range { from: string; to: string; weeks: string[] }
/** The range a request asks for, or the last 12 weeks to today. Null when it is malformed. */
export function rangeOf(from: string | undefined, to: string | undefined, now: Date): Range | null {
  if ((from && !ISO_DAY.test(from)) || (to && !ISO_DAY.test(to))) return null;
  const end = to || now.toISOString().slice(0, 10);
  const start = from || weekOf(new Date(Date.parse(`${end}T00:00:00Z`) - (WEEKS - 1) * 7 * DAY));
  if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)) || start > end) return null;
  if ((Date.parse(end) - Date.parse(start)) / DAY > 366) return null;
  const weeks: string[] = [];
  for (let t = Date.parse(`${weekOf(new Date(`${start}T00:00:00Z`))}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 7 * DAY) {
    weeks.push(new Date(t).toISOString().slice(0, 10));
  }
  return { from: start, to: end, weeks };
}

async function guarded<T>(read: () => Promise<T>): Promise<T | Unavailable> {
  try { return await read(); } catch { console.warn('[influencer-analytics] a figure could not be read'); return unreadable(); }
}

type CurrencyMoney = { currency: string; pending_cents: number; payable_cents: number; in_payout_cents: number; paid_cents: number; reversed_cents: number };

export interface Analytics {
  as_of: string;
  range: { from: string; to: string; grain: 'week'; channel: string | null };
  visits: Unavailable;
  signups: { total: Count; series: { week: string; value: Count }[] } | Unavailable;
  paid_members: Unavailable;
  revenue: Unavailable;
  commission: { by_currency: CurrencyMoney[]; series: { week: string; currency: string; earned_cents: number }[] } | Unavailable;
  bonuses: Unavailable;
  funnel: { visits: Unavailable; signups: Count | Unavailable; paid: Unavailable };
  channels: Unavailable;
  audience: {
    by_plan_family: { plan_family: string; members: Count }[] | Unavailable;
    by_region: { country: string | null; members: Count }[] | Unavailable;
    by_month_joined: { month: string; members: Count }[] | Unavailable;
    retention: Unavailable;
    visit_to_paid_median_days: Unavailable;
  };
}

export interface AnalyticsOptions { from?: string; to?: string; channel?: string | null; money: boolean; now?: Date }

/** Every figure for one influencer. `money: false` answers each money figure with `hq_reads` (O-MONEY A). */
export async function influencerAnalytics(env: Env, userId: number, range: Range, opts: AnalyticsOptions): Promise<Analytics> {
  const now = opts.now ?? new Date();
  const channel = opts.channel || null;
  // Nothing is split by channel until P2 records the channel of a visit and a sign-up.
  const byChannel = (v: () => Promise<any>) => (channel ? Promise.resolve(notRecorded('handle_visits')) : guarded(v));
  const end = `${range.to} 23:59:59`;
  const start = `${range.from} 00:00:00`;

  const signups = await byChannel(async () => {
    const rows = await env.DB.prepare(
      `SELECT date(created_at) AS day FROM referrals WHERE referrer_id = ? AND created_at BETWEEN ? AND ?`,
    ).bind(userId, start, end).all<{ day: string }>();
    const perWeek = new Map<string, number>();
    for (const r of rows.results || []) {
      const w = weekOf(new Date(`${r.day}T00:00:00Z`));
      perWeek.set(w, (perWeek.get(w) || 0) + 1);
    }
    const total = (rows.results || []).length;
    return { total: masked(total), series: range.weeks.map((week) => ({ week, value: masked(perWeek.get(week) || 0) })) };
  });

  const commission = !opts.money ? hqReads() : await byChannel(async () => {
    const money = await env.DB.prepare(
      // A commission a failed payout gave back can be claimed again, so only its latest payout's status counts.
      `SELECT currency,
              SUM(CASE WHEN status = 'pending' THEN amount_cents ELSE 0 END) AS pending_cents,
              SUM(CASE WHEN status = 'accrued' THEN amount_cents ELSE 0 END) AS payable_cents,
              SUM(CASE WHEN status = 'paid' AND COALESCE(payout_status, '') <> 'completed' THEN amount_cents ELSE 0 END) AS in_payout_cents,
              SUM(CASE WHEN status = 'paid' AND payout_status = 'completed' THEN amount_cents ELSE 0 END) AS paid_cents,
              SUM(CASE WHEN reversed_amount_cents > 0 THEN reversed_amount_cents
                       WHEN status = 'reversed' THEN amount_cents ELSE 0 END) AS reversed_cents
         FROM (SELECT COALESCE(c.currency, 'USD') AS currency, c.status, c.amount_cents,
                      COALESCE(c.reversed_amount_cents, 0) AS reversed_amount_cents,
                      (SELECT p.status FROM payout_commissions pc JOIN payouts p ON p.id = pc.payout_id
                        WHERE pc.commission_id = c.id ORDER BY p.id DESC LIMIT 1) AS payout_status
                 FROM commissions c WHERE c.user_id = ? AND c.created_at BETWEEN ? AND ?)
        GROUP BY currency ORDER BY currency`,
    ).bind(userId, start, end).all<CurrencyMoney>();
    const weekly = await env.DB.prepare(
      `SELECT date(created_at) AS day, COALESCE(currency, 'USD') AS currency, amount_cents
         FROM commissions WHERE user_id = ? AND created_at BETWEEN ? AND ? AND status <> 'reversed'`,
    ).bind(userId, start, end).all<{ day: string; currency: string; amount_cents: number }>();
    const series = new Map<string, number>();
    for (const r of weekly.results || []) {
      const k = `${weekOf(new Date(`${r.day}T00:00:00Z`))}|${r.currency}`;
      series.set(k, (series.get(k) || 0) + (Number(r.amount_cents) || 0));
    }
    const currencies = [...new Set((weekly.results || []).map((r) => r.currency))].sort();
    return {
      by_currency: (money.results || []).map((m) => ({
        currency: m.currency, pending_cents: Number(m.pending_cents) || 0, payable_cents: Number(m.payable_cents) || 0,
        in_payout_cents: Number(m.in_payout_cents) || 0, paid_cents: Number(m.paid_cents) || 0, reversed_cents: Number(m.reversed_cents) || 0,
      })),
      series: currencies.flatMap((currency) => range.weeks.map((week) => ({ week, currency, earned_cents: series.get(`${week}|${currency}`) || 0 }))),
    };
  });

  const group = async <K extends string>(sql: string, key: K) => {
    const rows = await env.DB.prepare(sql).bind(userId, start, end).all<Record<string, unknown>>();
    return (rows.results || []).map((r) => ({ [key]: r.k ?? null, members: masked(Number(r.n) || 0) })) as any[];
  };
  const byPlanFamily = await byChannel(() => group(
    `SELECT m.plan_family AS k, COUNT(DISTINCT r.referred_id) AS n
       FROM referrals r JOIN member_subscription_amounts m ON m.user_id = r.referred_id
      WHERE r.referrer_id = ? AND r.created_at BETWEEN ? AND ? AND m.status IN ('active', 'trialing', 'past_due')
      GROUP BY m.plan_family ORDER BY n DESC, k`, 'plan_family'));
  const byRegion = await byChannel(() => group(
    `SELECT u.country AS k, COUNT(*) AS n
       FROM referrals r JOIN users u ON u.id = r.referred_id
      WHERE r.referrer_id = ? AND r.created_at BETWEEN ? AND ?
      GROUP BY u.country ORDER BY n DESC, k`, 'country'));
  const byMonth = await byChannel(() => group(
    `SELECT substr(r.created_at, 1, 7) AS k, COUNT(*) AS n
       FROM referrals r WHERE r.referrer_id = ? AND r.created_at BETWEEN ? AND ?
      GROUP BY substr(r.created_at, 1, 7) ORDER BY k`, 'month'));

  const signupCount = 'total' in (signups as any) ? (signups as any).total as Count : signups as Unavailable;
  const paid = notRecorded('subscription_commissions');
  return {
    as_of: now.toISOString(),
    range: { from: range.from, to: range.to, grain: 'week', channel },
    visits: notRecorded('handle_visits'),
    signups: signups as Analytics['signups'],
    paid_members: paid,
    revenue: opts.money ? notRecorded('subscription_commissions') : hqReads(),
    commission: commission as Analytics['commission'],
    bonuses: opts.money ? notRecorded('subscription_commissions') : hqReads(),
    funnel: { visits: notRecorded('handle_visits'), signups: signupCount, paid },
    channels: notRecorded('handle_visits'),
    audience: {
      by_plan_family: byPlanFamily, by_region: byRegion, by_month_joined: byMonth,
      retention: notRecorded('subscription_commissions'),
      visit_to_paid_median_days: notRecorded('handle_visits'),
    },
  };
}

const money = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency}`;

/**
 * IN1's Eadwyn line: the week restated from the figures, with their date.
 * It names only what the read returned; a figure it does not have is left
 * out, and a small group reads "fewer than 5". It never promises anything.
 */
export function summaryLine(a: Analytics): string {
  const date = a.as_of.slice(0, 10);
  const parts: string[] = [];
  if (!('available' in (a.signups as any))) {
    const t = (a.signups as any).total as Count;
    parts.push(typeof t === 'number' ? `${t} sign-up${t === 1 ? '' : 's'} came through you` : 'fewer than 5 sign-ups came through you');
  }
  if (!('available' in (a.commission as any))) {
    for (const m of (a.commission as any).by_currency as CurrencyMoney[]) {
      if (m.payable_cents) parts.push(`${money(m.payable_cents, m.currency)} is payable`);
    }
  }
  if (!parts.length) return `From your link records, as of ${date}: nothing to report yet for ${a.range.from} to ${a.range.to}.`;
  return `From your link records, as of ${date}: from ${a.range.from} to ${a.range.to}, ${parts.join(', and ')}.`;
}
