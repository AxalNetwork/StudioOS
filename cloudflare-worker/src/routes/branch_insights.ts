/**
 * What this territory measures about itself, and the one tick against the
 * platform median (S6, D148).
 *
 *   GET /api/branch/insights
 *
 * TWO KINDS OF NUMBER ON ONE PAYLOAD, AND THEY ARE NOT INTERCHANGEABLE. The
 * stats are read from this branch's own database and are facts about it. The
 * benchmark is a COPY HQ pushed, computed across branches, and carries HQ's
 * `pushed_at` and its own `n_branches` — because a median with no denominator
 * implies a population the screen does not know.
 *
 * S6 DRAWS FOUR STATS AND THIS SHIPS TWO, which is the measurement rather than
 * a choice. Accounts and seats used are counted here the way `branchOverview`
 * counts them (D127's definition, stated with the figure). Activation and
 * programme throughput have no branch-side read anywhere in the worker, so they
 * arrive as `unavailable` with their reasons instead of a derived-looking zero —
 * the shape `branch_home.ts` already uses for S1's three sourceless blocks.
 *
 * REVENUE SHARE IS THE FOURTH AND IT IS THE INTERESTING ABSENCE.
 * `branchOverview` returns `revenue_mtd_cents: null` BY CONSTRUCTION and
 * `branchRevenueSummary` returns every stream `available: false`: a branch's
 * subscription charges live in the Stripe API and its licence fee flows to HQ.
 * So the rate is knowable — it is on the pushed licence — and the amount is
 * not, and the payload says exactly that rather than multiplying a rate by a
 * number nobody has.
 *
 * SUSPENSION DOES NOT GATE IT, for D130's and D131's reason: the freeze guards
 * approval WRITES, and a frozen branch still needs to read where it stands.
 *
 * AN UNREADABLE TABLE IS NOT AN ABSENT BENCHMARK. A database missing
 * `branch_benchmarks` answers `benchmarks_available: false` with its reason
 * rather than the same empty list a branch HQ has never pushed to would get —
 * the #204 rule, and the distinction D147 drew one table over.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { requireBranchTier } from '../util/branch';
import { mapError } from './_t13t14t15_helpers';
import { SEAT_ROLES, branchRevenueSummary } from '../rpc/branchOps';
import {
  ACTIVE_ACCOUNT_BASIS, parseAnalyticsRange, ANALYTICS_RANGES, weekAxis,
  loadBranchWeeklyActives, weeklyKpi, GAP_SENTENCES,
} from '../services/activeAccounts';
import { verdictSpans, type VerdictEventRow } from '../services/referralSubmissions';
import { median, currentPeriod } from '../services/branchBenchmarks';
import { branchLicencePayload } from './licence';

const r = new Hono<{ Bindings: Env }>();

type BenchmarkRow = {
  metric_key: string; label: string; median_value: number;
  unit: string; n_branches: number; period: string; pushed_at: string;
};

/**
 * Why activation is not a figure here. One sentence, read by both `/insights`
 * and `/analytics`, so the two pages cannot give two reasons for one absence.
 */
const ACTIVATION_REASON =
  'Activation would be the share of accounts that reached a first meaningful action — S15 draws '
  + 'it as invited, signed in, agreement signed, active in week 2 — and no step of that funnel is '
  + 'recorded as an event this branch can count, with a definition of whose funnel it is. Deriving '
  + 'it here would be inventing the definition on the screen.';

/**
 * Programme throughput, corrected in D210. It used to say the worker had no read
 * for it at all; the cohort timeline (`GET /api/admin/cohort/timeline`) returns
 * every week's outcomes per cycle and a branch admin can read it. What is still
 * missing is the other half — assessment runs have no list route — so this page
 * does not print one figure for it, and the Analytics page draws the half that
 * exists, by week, from the timeline.
 */
const THROUGHPUT_REASON =
  'Throughput needs two things and this branch can read one of them. Cohort week outcomes are '
  + 'readable — the Analytics page draws them from the cohort timeline, week by week — but '
  + 'assessment runs are not: the worker has no route that lists sessions or results, the gap '
  + 'D140 named on Programs. One figure counting half a programme would not say which half.';

/** The window a decision age is measured over, in days. */
const DECISION_WINDOW_DAYS = 30;

/** `YYYY-MM-DD HH:MM:SS`, UTC — the form `CURRENT_TIMESTAMP` columns hold (D162). */
function sqlStamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * A stamp in either form this table set holds: ISO with its zone (what a route
 * writes with `nowIso()`) or SQLite's `YYYY-MM-DD HH:MM:SS` (a column default),
 * which carries no zone and is UTC.
 */
function utcMs(raw: unknown): number {
  const s = String(raw ?? '').trim();
  if (!s) return NaN;
  return s.includes('T') ? Date.parse(s) : Date.parse(`${s.replace(' ', 'T')}Z`);
}

// GET /api/branch/insights
r.get('/insights', async (c) => {
  try {
    await requireAdmin(c);
    const branch = requireBranchTier(c.env);

    // The branch's own figures. Same query and same definition `branchOverview`
    // uses, so the number HQ reads over RPC and the number this screen prints
    // cannot disagree.
    let accounts = 0;
    let seatsUsed = 0;
    // D155 — THE BREAKDOWN WAS COMPUTED AND DROPPED. `GROUP BY role` already
    // returns it and the loop below already walks it; only the totals left the
    // function. S11's "Staff & roles" row is a sentence about that breakdown
    // ("6 admins, 2 reviewers"), so without it the row had nothing to say
    // about a figure this query had in hand. Ninth instance of a producer with
    // no reader in this programme (#252, D142, D149, D150, D151, D152, D153).
    const byRole: Record<string, number> = {};
    let statsAvailable = true;
    let statsReason: string | null = null;
    try {
      const q = await c.env.DB.prepare(
        'SELECT role, COUNT(*) AS n FROM users WHERE is_active = 1 GROUP BY role',
      ).all<{ role: string; n: number }>();
      for (const row of q.results || []) {
        const n = Number(row.n) || 0;
        accounts += n;
        byRole[String(row.role)] = n;
        if ((SEAT_ROLES as readonly string[]).includes(String(row.role))) seatsUsed += n;
      }
    } catch (e) {
      statsAvailable = false;
      statsReason = `The account table could not be read on this branch: ${(e as Error)?.message || 'unknown'}.`;
    }

    let benchmarks: BenchmarkRow[] = [];
    let benchmarksAvailable = true;
    let benchmarksReason: string | null = null;
    try {
      const q = await c.env.DB.prepare(
        `SELECT metric_key, label, median_value, unit, n_branches, period, pushed_at
           FROM branch_benchmarks ORDER BY metric_key`,
      ).all<BenchmarkRow>();
      benchmarks = q.results || [];
    } catch (e) {
      benchmarksAvailable = false;
      benchmarksReason =
        'The benchmark copy could not be read on this database (migration 256). That is not the '
        + `same as HQ having published nothing: ${(e as Error)?.message || 'the table is missing'}.`;
    }

    return c.json({
      branch,
      stats: {
        accounts: statsAvailable ? accounts : null,
        seats_used: statsAvailable ? seatsUsed : null,
        // ACTIVE ONLY, and the flag says so rather than leaving a reader to
        // infer it from a total that does not match the directory.
        by_role: statsAvailable ? byRole : null,
        by_role_active_only: true,
        // THE FIGURE CARRIES WHAT IT MEANS, or it reads as a seat ledger. Same
        // sentence `branchOverview` sends over RPC (D127), because two
        // different explanations of one number is how two surfaces come to
        // disagree about what it counts.
        seats_used_basis:
          'Seats used is the count of active accounts whose role is one a licence sells a seat for '
          + `(${SEAT_ROLES.join(', ')}). Role is not the same thing as a licensed seat: there is no `
          + 'seat ledger, so no seat has an id and a vacant seat cannot be shown.',
      },
      stats_available: statsAvailable,
      ...(statsReason ? { stats_reason: statsReason } : {}),
      benchmarks,
      benchmarks_available: benchmarksAvailable,
      ...(benchmarksReason ? { benchmarks_reason: benchmarksReason } : {}),
      ...(benchmarksAvailable && !benchmarks.length ? {
        benchmarks_empty_reason:
          'HQ has published no benchmark yet. A median is only anonymous once enough branches '
          + 'answer — at one branch it IS that branch\'s figure, and at two a branch subtracts its '
          + 'own and reads the other\'s exactly — so HQ withholds the row rather than naming a '
          + 'territory. With the platform this size there is nothing to compare against yet.',
      } : {}),
      // THE TWO STATS S6 DRAWS AND THIS CANNOT COMPUTE, named on the payload
      // rather than written into the page: a page holding its own copy of a
      // reason is a second place to update, and the one that is not updated is
      // the one that lies (D131's rule, D140's and D147's too).
      unavailable: [
        { stat: 'Activation', reason: ACTIVATION_REASON },
        { stat: 'Programme throughput', reason: THROUGHPUT_REASON },
        {
          stat: 'Revenue share for the quarter',
          reason:
            'The RATE is on the licence HQ pushed and the AMOUNT is not knowable here: subscription '
            + 'charges live in the Stripe API and a subsidiary charges no onward licence fee, which '
            + 'is why the revenue figure on the HQ overview is null by construction. A rate times a '
            + 'number nobody has is not a figure.',
        },
      ],
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * The canvas's two approval queues this branch cannot time, and why. Each is a
 * measurement of the store, not a gap in the page: the timestamp a decision age
 * would need is either rewritten on every move or overwritten by the next one.
 */
const APPROVAL_AGE_NOT_RECORDED = [
  {
    key: 'lp_applications',
    label: 'LP applications',
    reason:
      '`reviewed_at` is rewritten on every status change — in review, needs follow-up, and a note '
      + 'saved without a change of status — and a decision can be reversed, so the column holds the '
      + 'last move, not the decision.',
  },
  {
    key: 'cohort_applications',
    label: 'Cohort applications',
    reason:
      '`decided_at` is overwritten when an application is decided again or rolled to the next '
      + 'cohort, and a rolled application starts a new row with a new `created_at`, so neither end '
      + 'of the interval survives a roll.',
  },
] as const;

/**
 * Median hours from a start to an end, over the spans given, or `null` for none.
 * A median and not a mean: one referral left for a month would move a mean by
 * days and move a median by nothing, and the canvas labels this a median.
 */
function medianHours(spans: Array<{ from: number; to: number }>): number | null {
  const hs = spans.map((s) => (s.to - s.from) / 3_600_000).filter((h) => Number.isFinite(h) && h >= 0);
  return hs.length ? Math.round(median(hs) * 10) / 10 : null;
}

// GET /api/branch/analytics?range=8w|quarter|year
//
// S15. Everything this branch can measure about itself over time, and each
// thing it cannot, with the reason — on the same rules as `/insights`, whose
// sentences it reuses rather than restates. Not suspension-gated (reads never
// are, D130).
r.get('/analytics', async (c) => {
  try {
    await requireAdmin(c);
    const branch = requireBranchTier(c.env);
    const range = parseAnalyticsRange(c.req.query('range'));
    if (!range) {
      return c.json({
        error: 'bad_range',
        message: `range must be one of ${Object.keys(ANALYTICS_RANGES).join(', ')}.`,
      }, 400);
    }
    const nowMs = Date.now();
    const axis = weekAxis(new Date(nowMs).toISOString(), ANALYTICS_RANGES[range]);

    // ACTIVE ACCOUNTS — this branch's own request log, one definition with HQ.
    const actives = await loadBranchWeeklyActives(c.env, axis);
    const active_accounts = actives.available
      ? {
        available: true as const,
        values: actives.values,
        gap: actives.gap,
        ...(actives.gap ? { gap_reason: GAP_SENTENCES[actives.gap] } : {}),
        first_day: actives.first_day,
        kpi: weeklyKpi(axis, [{ values: actives.values }]),
      }
      : { available: false as const, reason: actives.reason };

    // SEAT UTILISATION — the licence copy's own figures, read the way
    // `/api/licence/mine` reads them, so the two pages cannot disagree.
    const lic = await branchLicencePayload(c.env, branch);
    const seats = 'error' in lic
      ? { available: false as const, used: null, licensed: null, reason: lic.message, basis: null }
      : {
        available: lic.licence.seats_used !== null,
        used: lic.licence.seats_used,
        licensed: lic.licence.seats_licensed,
        basis: lic.licence.seats_used_basis,
        ...(lic.licence.seats_used === null
          ? { reason: 'The account table could not be read, so seats used is not known.' }
          : {}),
      };

    // MEDIAN DECISION AGE — referrals, the one queue whose decision is an
    // event that is written once and never rewritten.
    const windowStartMs = nowMs - DECISION_WINDOW_DAYS * 86_400_000;
    let referralAge: { available: boolean; median_hours: number | null; n: number; reason?: string };
    try {
      const q = await c.env.DB.prepare(
        `SELECT s.id AS submission_id, s.created_at AS submitted_at,
                e.status AS event_status, e.created_at AS event_at
           FROM referral_submissions s
           JOIN referral_submission_events e ON e.submission_id = s.id
          WHERE s.id IN (SELECT submission_id FROM referral_submission_events WHERE created_at >= ?)`,
      ).bind(sqlStamp(windowStartMs)).all<VerdictEventRow>();
      // The earliest verdict per referral, then only those decided inside the
      // window: a referral decided last year and converted this week has an
      // event in the window and no decision in it.
      const spans = [...verdictSpans(q.results || []).values()].filter((s) => s.to >= windowStartMs);
      referralAge = { available: true, median_hours: medianHours(spans), n: spans.length };
      if (!spans.length) {
        referralAge.reason = `No referral was decided in the last ${DECISION_WINDOW_DAYS} days.`;
      }
    } catch (e) {
      referralAge = {
        available: false, median_hours: null, n: 0,
        reason: `The referral log could not be read: ${(e as Error)?.message || 'unknown'}.`,
      };
    }

    // CONTENT TO HQ — what this branch asked HQ and how long HQ took. The
    // clock that ends it is HQ's (`answered_at` is HQ's stamp, pushed here).
    let contentAge: { available: boolean; median_hours: number | null; n: number; reason?: string };
    try {
      const q = await c.env.DB.prepare(
        `SELECT created_at, answered_at FROM branch_escalations
          WHERE kind = 'content' AND answered_at IS NOT NULL AND answered_at >= ?`,
      ).bind(new Date(windowStartMs).toISOString()).all<{ created_at: string; answered_at: string }>();
      const spans = (q.results || [])
        .map((row) => ({ from: utcMs(row.created_at), to: utcMs(row.answered_at) }))
        .filter((s) => Number.isFinite(s.from) && Number.isFinite(s.to) && s.to >= s.from && s.to >= windowStartMs);
      contentAge = { available: true, median_hours: medianHours(spans), n: spans.length };
      if (!spans.length) {
        contentAge.reason = `HQ answered no content escalation from this branch in the last ${DECISION_WINDOW_DAYS} days.`;
      }
    } catch (e) {
      contentAge = {
        available: false, median_hours: null, n: 0,
        reason: `The escalation log could not be read (migration 261): ${(e as Error)?.message || 'unknown'}.`,
      };
    }

    // THE BENCHMARK — HQ's median of the same metric for the same week, and
    // this branch's own figure beside it. Unreadable and withheld stay apart.
    let benchmark: Record<string, unknown>;
    try {
      const row = await c.env.DB.prepare(
        `SELECT metric_key, median_value, n_branches, period, pushed_at
           FROM branch_benchmarks WHERE metric_key = 'active_accounts_week'`,
      ).first<{ metric_key: string; median_value: number; n_branches: number; period: string; pushed_at: string }>();
      if (!row) {
        benchmark = {
          available: false,
          reason:
            'HQ has published no median of active accounts yet. A median is only anonymous once enough '
            + 'branches answer, so HQ withholds it rather than naming a territory.',
        };
      } else {
        const i = axis.weeks.indexOf(row.period);
        const own = i >= 0 && actives.available ? actives.values[i] : null;
        benchmark = {
          available: true,
          metric: row.metric_key,
          week: row.period,
          median_value: row.median_value,
          n_branches: row.n_branches,
          pushed_at: row.pushed_at,
          own_value: own,
          ...(own === null
            ? { own_reason: `This branch has no recorded value for the week of ${row.period} on this chart.` }
            : {}),
        };
      }
    } catch (e) {
      benchmark = {
        available: false,
        reason:
          'The benchmark copy could not be read on this database (migration 256), which is not the same '
          + `as HQ having published nothing: ${(e as Error)?.message || 'the table is missing'}.`,
      };
    }

    // REVENUE — the rate is on the licence; every stream says why it has no amount.
    let revenue: Record<string, unknown>;
    try {
      const summary = await branchRevenueSummary(c.env, currentPeriod(new Date(nowMs)));
      const shareBps = 'error' in lic ? null : lic.licence.revenue_share_bps;
      revenue = {
        available: true,
        period: summary.period,
        share_bps: shareBps,
        keeps_bps: shareBps === null || shareBps === undefined ? null : 10_000 - Number(shareBps),
        streams: summary.streams,
        note:
          'The canvas draws programme fees and perks as revenue streams. Neither is a stream this '
          + 'platform records: a programme fee is not charged in the product, and a perk is a discount '
          + 'a partner gives, not income.',
      };
    } catch (e) {
      revenue = { available: false, reason: `The revenue summary could not be built: ${(e as Error)?.message || 'unknown'}.` };
    }

    return c.json({
      branch,
      range,
      weeks: axis.weeks,
      current_week: axis.current,
      last_complete_week: axis.last_complete,
      as_of: new Date(nowMs).toISOString(),
      basis: ACTIVE_ACCOUNT_BASIS,
      source: 'This branch\'s own request log (activity_logs).',
      active_accounts,
      seats,
      activation: { available: false, reason: ACTIVATION_REASON },
      decision_age: {
        queue: 'referrals',
        window_days: DECISION_WINDOW_DAYS,
        ...referralAge,
        hq: { available: false, reason: 'HQ publishes no median of this, so there is nothing to set it against.' },
      },
      approval_age: [
        ...APPROVAL_AGE_NOT_RECORDED.map((q) => ({ ...q, available: false })),
        { key: 'referrals', label: 'Referrals', window_days: DECISION_WINDOW_DAYS, ...referralAge },
        {
          key: 'content_to_hq', label: 'Content to HQ', window_days: DECISION_WINDOW_DAYS, ...contentAge,
          clock: 'HQ\'s: the answer is stamped where it is decided.',
        },
      ],
      revenue,
      benchmark,
      footer:
        'Everything here is read from this branch\'s own database, plus the one median HQ pushed. '
        + 'This page does not read the platform\'s metrics dataset.',
    });
  } catch (e) { return mapError(c, e); }
});

export default r;
