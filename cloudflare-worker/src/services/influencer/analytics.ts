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
 * HONEST VALUES. A read that fails comes back as `{ available: false,
 * reason: 'unreadable' }` and the other figures still read; never 0. Every
 * store is on main (P1–P3), so nothing here reads Not recorded any more;
 * `notRecorded` stays for the frontend's shape.
 *
 *   figure                   source
 *   sign-ups                 `referrals` the influencer referred
 *   visits                   `handle_visits` (P2), by the influencer's `influencers.id`
 *   channels, the filter     a visit's `handle_visits.channel`; a sign-up's handle
 *                            attribution (`referral_attributions`, source 'handle');
 *                            an invoice's `influencer_commission_invoices.channel`.
 *                            '' / NULL with a handle is the handle itself (channel null
 *                            in the reply); by code is on no channel.
 *   paid members             the member's first paid invoice (invoice_number 1, not cancelled)
 *   revenue influenced       those invoices' `net_cents`, per currency
 *   commission               `commissions` by status and currency; paid = claimed by
 *                            a completed payout
 *   bonuses                  `influencer_milestones` with their bonus commission; the
 *                            next milestone from the D4292 count (`paidCustomers`)
 *   audience: plan family    referred members' current subscriptions
 *   audience: region         referred members' `users.country`
 *   audience: month joined   `referrals.created_at`
 *   retention                cohorts by the month of the first paid invoice; still with
 *                            us while the subscription had not ended by a month's end
 *   visit → paid             median days from the handle's first touch to the first
 *                            paid invoice, over five members or more
 *
 * Money is per currency and never summed across currencies. Pure apart from
 * its bound reads; it never calls a model. `summaryLine` is IN1's Eadwyn line,
 * built from these figures with their date, so it can only restate them.
 */
import type { Env } from '../../types';
import { BONUS_MILESTONES, CUSTOM_MILESTONE, paidCustomers } from '../influencerCommission';

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
type Series = { week: string; value: Count }[];

/** The next bonus milestone, or the custom-partnership count once every bonus is reached; null past both. */
export function nextMilestone(paidCustomers: number): { milestone: number; kind: 'bonus' | 'custom'; needs: number | { more_than: number } } | null {
  const ladder: [number, 'bonus' | 'custom'][] = [...BONUS_MILESTONES.map((m) => [m, 'bonus'] as [number, 'bonus']), [CUSTOM_MILESTONE, 'custom']];
  const next = ladder.find(([m]) => m > paidCustomers);
  if (!next) return null;
  const [milestone, kind] = next;
  // An exact distance would give away a count of 1 to 4: say only that more than (milestone − 5) are needed.
  const needs = paidCustomers > 0 && paidCustomers < SMALL_GROUP ? { more_than: milestone - SMALL_GROUP } : milestone - paidCustomers;
  return { milestone, kind, needs };
}

/** The middle of a list of numbers, or null for none. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const monthAdd = (month: string, k: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + k, 1));
  return d.toISOString().slice(0, 7);
};
/** The first instant after `month` ends, as an SQL time. */
const monthEnd = (month: string) => `${monthAdd(month, 1)}-01 00:00:00`;

export interface Analytics {
  as_of: string;
  range: { from: string; to: string; grain: 'week'; channel: string | null };
  visits: { total: Count; series: Series } | Unavailable;
  signups: { total: Count; series: Series } | Unavailable;
  paid_members: { total: Count; series: Series } | Unavailable;
  revenue: { by_currency: { currency: string; net_cents: number }[] } | Unavailable;
  commission: { by_currency: CurrencyMoney[]; series: { week: string; currency: string; earned_cents: number }[] } | Unavailable;
  bonuses: { earned: { milestone: number; currency: string; amount_cents: number; achieved_at: string }[]; next: ReturnType<typeof nextMilestone> } | Unavailable;
  funnel: { visits: Count | Unavailable; signups: Count | Unavailable; paid: Count | Unavailable };
  channels: { channel: string | null; visits: Count; signups: Count; paid: Count }[] | Unavailable;
  audience: {
    by_plan_family: { plan_family: string; members: Count }[] | Unavailable;
    by_region: { country: string | null; members: Count }[] | Unavailable;
    by_month_joined: { month: string; members: Count }[] | Unavailable;
    retention: { cohort: string; members: Count; months: Count[] }[] | Unavailable;
    visit_to_paid_median_days: { days: number | null; members: Count } | Unavailable;
  };
}

export interface AnalyticsOptions { from?: string; to?: string; channel?: string | null; money: boolean; now?: Date }

const totalOf = (x: unknown): Count | Unavailable => (x && typeof x === 'object' && 'total' in (x as any) ? (x as any).total : x as Unavailable);

/**
 * Every figure for one influencer. `money: false` answers each money figure
 * with `hq_reads` (O-MONEY A). A `channel` narrows every figure to the
 * sub-link it names: visits by `handle_visits.channel`, sign-ups and the
 * audience by the member's handle attribution, paid members, revenue,
 * commission and retention by the channel on the invoice behind the commission.
 * Bonuses are the influencer's whole count, so a channel leaves them as they are.
 */
export async function influencerAnalytics(env: Env, userId: number, range: Range, opts: AnalyticsOptions): Promise<Analytics> {
  const now = opts.now ?? new Date();
  const channel = opts.channel || null;
  const end = `${range.to} 23:59:59`;
  const start = `${range.from} 00:00:00`;
  const weekly = (days: string[]) => {
    const perWeek = new Map<string, number>();
    for (const d of days) {
      const w = weekOf(new Date(`${d}T00:00:00Z`));
      perWeek.set(w, (perWeek.get(w) || 0) + 1);
    }
    return { total: masked(days.length), series: range.weeks.map((week) => ({ week, value: masked(perWeek.get(week) || 0) })) };
  };

  const influencer = await guarded(async () =>
    (await env.DB.prepare(`SELECT id FROM influencers WHERE user_id = ?`).bind(userId).first<{ id: number }>())?.id ?? null);

  const visitRows = await guarded(async () => {
    if (influencer === null) return [] as { channel: string; day: string }[];
    if (typeof influencer !== 'number') throw new Error('influencer unreadable');
    const rows = await env.DB.prepare(
      `SELECT channel, day FROM handle_visits WHERE influencer_id = ? AND day BETWEEN ? AND ? AND (? IS NULL OR channel = ?)`,
    ).bind(influencer, range.from, range.to, channel, channel).all<{ channel: string; day: string }>();
    return rows.results || [];
  });
  const visits = 'available' in (visitRows as any) ? visitRows as Unavailable : weekly((visitRows as any[]).map((r) => r.day));

  const signupRows = await guarded(async () => {
    const rows = await env.DB.prepare(
      `SELECT date(r.created_at) AS day,
              -- '' through the handle itself, the sub-link's name through one, NULL when it did not come through the handle.
              (SELECT COALESCE(a.channel, '') FROM referral_attributions a
                WHERE a.user_id = r.referred_id AND a.referrer_user_id = r.referrer_id AND a.source = 'handle') AS channel
         FROM referrals r WHERE r.referrer_id = ? AND r.created_at BETWEEN ? AND ? AND (? IS NULL OR EXISTS (SELECT 1 FROM referral_attributions a WHERE a.user_id = r.referred_id AND a.referrer_user_id = r.referrer_id AND a.source = 'handle' AND a.channel = ?))`,
    ).bind(userId, start, end, channel, channel).all<{ day: string; channel: string | null }>();
    return rows.results || [];
  });
  const signups = 'available' in (signupRows as any) ? signupRows as Unavailable : weekly((signupRows as any[]).map((r) => r.day));

  // The paid invoices behind commissions (P3). A member is paid from their first paid invoice; a cancelled one never counts.
  const invoiceRows = await guarded(async () => {
    const rows = await env.DB.prepare(
      `SELECT i.member_user_id AS member, i.invoice_number, i.net_cents, i.currency, date(i.paid_at) AS day,
              substr(i.paid_at, 1, 7) AS month,
              CASE WHEN i.channel IS NOT NULL THEN i.channel WHEN i.handle IS NOT NULL THEN '' END AS channel,
              i.subscription_ended_at AS ended_at
         FROM influencer_commission_invoices i
        WHERE i.referrer_user_id = ? AND i.cancelled_at IS NULL AND (? IS NULL OR i.channel = ?)`,
    ).bind(userId, channel, channel).all<{ member: number; invoice_number: number; net_cents: number; currency: string; day: string; month: string; channel: string | null; ended_at: string | null }>();
    return rows.results || [];
  });
  const invoices = 'available' in (invoiceRows as any) ? null : invoiceRows as any[];
  const inRange = (day: string) => day >= range.from && day <= range.to;
  const firstPaid = invoices ? invoices.filter((i) => Number(i.invoice_number) === 1) : null;
  const paid_members = firstPaid ? weekly(firstPaid.filter((i) => inRange(i.day)).map((i) => i.day)) : invoiceRows as Unavailable;

  const revenue = !opts.money ? hqReads() : !invoices ? invoiceRows as Unavailable : (() => {
    const by = new Map<string, number>();
    for (const i of invoices) if (inRange(i.day)) by.set(i.currency, (by.get(i.currency) || 0) + (Number(i.net_cents) || 0));
    return { by_currency: [...by.keys()].sort().map((currency) => ({ currency, net_cents: by.get(currency)! })) };
  })();

  const commission = !opts.money ? hqReads() : await guarded(async () => {
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
                 FROM commissions c WHERE c.user_id = ? AND c.created_at BETWEEN ? AND ?
                  AND (? IS NULL OR c.id IN (SELECT commission_id FROM influencer_commission_invoices WHERE channel = ?)))
        GROUP BY currency ORDER BY currency`,
    ).bind(userId, start, end, channel, channel).all<CurrencyMoney>();
    const earned = await env.DB.prepare(
      `SELECT date(created_at) AS day, COALESCE(currency, 'USD') AS currency, amount_cents
         FROM commissions WHERE user_id = ? AND created_at BETWEEN ? AND ? AND status <> 'reversed'
          AND (? IS NULL OR id IN (SELECT commission_id FROM influencer_commission_invoices WHERE channel = ?))`,
    ).bind(userId, start, end, channel, channel).all<{ day: string; currency: string; amount_cents: number }>();
    const series = new Map<string, number>();
    for (const r of earned.results || []) {
      const k = `${weekOf(new Date(`${r.day}T00:00:00Z`))}|${r.currency}`;
      series.set(k, (series.get(k) || 0) + (Number(r.amount_cents) || 0));
    }
    const currencies = [...new Set((earned.results || []).map((r) => r.currency))].sort();
    return {
      by_currency: (money.results || []).map((m) => ({
        currency: m.currency, pending_cents: Number(m.pending_cents) || 0, payable_cents: Number(m.payable_cents) || 0,
        in_payout_cents: Number(m.in_payout_cents) || 0, paid_cents: Number(m.paid_cents) || 0, reversed_cents: Number(m.reversed_cents) || 0,
      })),
      series: currencies.flatMap((currency) => range.weeks.map((week) => ({ week, currency, earned_cents: series.get(`${week}|${currency}`) || 0 }))),
    };
  });

  // Bonuses are paid on the influencer's whole count (D4292), so they read the same over any range or channel.
  const bonuses = !opts.money ? hqReads() : await guarded(async () => {
    const earned = await env.DB.prepare(
      `SELECT m.milestone, COALESCE(c.currency, 'USD') AS currency, c.amount_cents, m.achieved_at
         FROM influencer_milestones m JOIN commissions c ON c.id = m.commission_id
        WHERE m.referrer_user_id = ? AND m.kind = 'bonus' AND c.status <> 'reversed'
        ORDER BY m.milestone`,
    ).bind(userId).all<{ milestone: number; currency: string; amount_cents: number; achieved_at: string }>();
    return {
      earned: (earned.results || []).map((e) => ({ milestone: Number(e.milestone), currency: e.currency, amount_cents: Number(e.amount_cents) || 0, achieved_at: e.achieved_at })),
      next: nextMilestone(await paidCustomers(env, userId)),
    };
  });

  const channels = 'available' in (visitRows as any) ? visitRows as Unavailable
    : 'available' in (signupRows as any) ? signupRows as Unavailable
    : !invoices ? invoiceRows as Unavailable
    : (() => {
      // '' is the handle itself; NULL (a sign-up or invoice by code) came through no channel and is left out.
      const tally = new Map<string, { visits: number; signups: number; paid: number }>();
      const at = (c: string) => { if (!tally.has(c)) tally.set(c, { visits: 0, signups: 0, paid: 0 }); return tally.get(c)!; };
      for (const v of visitRows as any[]) at(v.channel ?? '').visits++;
      for (const s of signupRows as any[]) if (s.channel !== null) at(s.channel).signups++;
      for (const p of firstPaid!) if (inRange(p.day) && p.channel !== null) at(p.channel).paid++;
      return [...tally.entries()]
        .sort((a, b) => b[1].visits - a[1].visits || b[1].signups - a[1].signups || a[0].localeCompare(b[0]))
        .map(([c, t]) => ({ channel: c || null, visits: masked(t.visits), signups: masked(t.signups), paid: masked(t.paid) }));
    })();

  const group = async <K extends string>(sql: string, key: K) => {
    const rows = await env.DB.prepare(sql).bind(userId, start, end, channel, channel).all<Record<string, unknown>>();
    return (rows.results || []).map((r) => ({ [key]: r.k ?? null, members: masked(Number(r.n) || 0) })) as any[];
  };
  const byPlanFamily = await guarded(() => group(
    `SELECT m.plan_family AS k, COUNT(DISTINCT r.referred_id) AS n
       FROM referrals r JOIN member_subscription_amounts m ON m.user_id = r.referred_id
      WHERE r.referrer_id = ? AND r.created_at BETWEEN ? AND ? AND (? IS NULL OR EXISTS (SELECT 1 FROM referral_attributions a WHERE a.user_id = r.referred_id AND a.referrer_user_id = r.referrer_id AND a.source = 'handle' AND a.channel = ?)) AND m.status IN ('active', 'trialing', 'past_due')
      GROUP BY m.plan_family ORDER BY n DESC, k`, 'plan_family'));
  const byRegion = await guarded(() => group(
    `SELECT u.country AS k, COUNT(*) AS n
       FROM referrals r JOIN users u ON u.id = r.referred_id
      WHERE r.referrer_id = ? AND r.created_at BETWEEN ? AND ? AND (? IS NULL OR EXISTS (SELECT 1 FROM referral_attributions a WHERE a.user_id = r.referred_id AND a.referrer_user_id = r.referrer_id AND a.source = 'handle' AND a.channel = ?))
      GROUP BY u.country ORDER BY n DESC, k`, 'country'));
  const byMonth = await guarded(() => group(
    `SELECT substr(r.created_at, 1, 7) AS k, COUNT(*) AS n
       FROM referrals r WHERE r.referrer_id = ? AND r.created_at BETWEEN ? AND ? AND (? IS NULL OR EXISTS (SELECT 1 FROM referral_attributions a WHERE a.user_id = r.referred_id AND a.referrer_user_id = r.referrer_id AND a.source = 'handle' AND a.channel = ?))
      GROUP BY substr(r.created_at, 1, 7) ORDER BY k`, 'month'));

  // Retention: a cohort is the members whose first paid invoice fell in a month of the range; a member is
  // still with us in a later month when their subscription had not ended by that month's end. Months
  // that have not ended yet are left off.
  const retention = !invoices ? invoiceRows as Unavailable : (() => {
    const nowMonth = now.toISOString().slice(0, 7);
    const ended = new Map<number, string | null>();
    for (const i of invoices) {
      const prev = ended.get(i.member);
      if (prev === undefined || (prev !== null && (i.ended_at === null || i.ended_at > prev))) ended.set(i.member, i.ended_at);
    }
    const cohorts = new Map<string, number[]>();
    for (const f of firstPaid!) if (inRange(f.day)) { if (!cohorts.has(f.month)) cohorts.set(f.month, []); cohorts.get(f.month)!.push(f.member); }
    return [...cohorts.keys()].sort().map((cohort) => {
      const members = cohorts.get(cohort)!;
      const months: Count[] = [];
      for (let k = 0; k < WEEKS && monthAdd(cohort, k) < nowMonth; k++) {
        const until = monthEnd(monthAdd(cohort, k));
        months.push(masked(members.filter((m) => { const e = ended.get(m); return e === null || e === undefined || e >= until; }).length));
      }
      return { cohort, members: masked(members.length), months };
    });
  })();

  // Visit to paid: from the member's first touch through the handle to their first paid invoice.
  const visitToPaid = await guarded(async () => {
    const rows = await env.DB.prepare(
      `SELECT julianday(i.paid_at) - julianday(a.first_touch_at) AS days
         FROM influencer_commission_invoices i
         JOIN referral_attributions a ON a.user_id = i.member_user_id AND a.referrer_user_id = i.referrer_user_id AND a.source = 'handle'
        WHERE i.referrer_user_id = ? AND i.invoice_number = 1 AND i.cancelled_at IS NULL
          AND i.paid_at BETWEEN ? AND ? AND (? IS NULL OR i.channel = ?)`,
    ).bind(userId, start, end, channel, channel).all<{ days: number }>();
    const days = (rows.results || []).map((r) => Math.max(0, Number(r.days) || 0));
    const members = masked(days.length);
    // A median of 1 to 4 members would describe them; it reads only once there are five.
    const m = typeof members === 'number' ? median(days) : null;
    return { days: m === null ? null : Math.round(m * 10) / 10, members };
  });

  return {
    as_of: now.toISOString(),
    range: { from: range.from, to: range.to, grain: 'week', channel },
    visits,
    signups: signups as Analytics['signups'],
    paid_members: paid_members as Analytics['paid_members'],
    revenue: revenue as Analytics['revenue'],
    commission: commission as Analytics['commission'],
    bonuses: bonuses as Analytics['bonuses'],
    funnel: { visits: totalOf(visits), signups: totalOf(signups), paid: totalOf(paid_members) },
    channels,
    audience: {
      by_plan_family: byPlanFamily, by_region: byRegion, by_month_joined: byMonth,
      retention,
      visit_to_paid_median_days: visitToPaid as Analytics['audience']['visit_to_paid_median_days'],
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
