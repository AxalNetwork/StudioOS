/**
 * The branch's operating digest — canvas S1 (D131).
 *
 * S1 IS DRAWN AS SIX BLOCKS AND THREE OF THEM HAVE NO SOURCE. Rather than a
 * notice standing in for the whole screen, this returns the three that are
 * real and names the three that are not, each with its own reason, so a reader
 * meets the gap where the block would have been. #598 recorded the split in
 * advance; this is it verified against the code rather than carried over:
 *
 *   · **Queue pressure** — REAL. `laneCounts` (D130/D131), which is the same
 *     `countSql` read `backlogOf` sums. Ordered by the OLDEST ITEM, not by
 *     count, because that is what the canvas asks for and they are different
 *     orders: a lane of forty things opened this morning is not more urgent
 *     than one thing nobody has touched in a week.
 *   · **The programme clock** — REAL. `runCohortTimingTick` is NOT gated on
 *     `hqCadences` (`index.ts`), so a branch materialises its own cycles and
 *     `company_week_status` fills with this branch's accounts.
 *   · **Revenue share** — the RATE is real and dated (HQ pushed it into
 *     `branch_licence`); the AMOUNT it applies to is not derivable here, and
 *     `branchRevenueSummary` already spells out why for all three streams.
 *   · **The AI digest, the rail's flags, and a local territory clock** — each
 *     absent for its own reason, listed in `unavailable`. See below for the
 *     clock, which is the one that looks like an oversight and is not.
 *
 * THE TERRITORY'S OWN CLOCK IS DELIBERATELY NOT DRAWN, and the reason is a
 * measurement rather than a preference. `branch_licence.territory` is
 * comma-separated ISO alpha-2 codes; `frontend/src/lib/countries.js` is the
 * platform's only country list and its own header says **"NOT ISO CODES —
 * these are display names"**. So nothing on the platform maps `FR` to a zone,
 * and inventing one would be a store built to decorate a greeting.
 *
 * WHAT IS DRAWN INSTEAD IS THE CLOCK THAT ACTUALLY GOVERNS. The programme runs
 * on `COHORT_TZ` — America/New_York — platform-wide, and a week deadline is a
 * true wall-clock boundary there (`cycleWeekWindows`: *"a DST week is 167 or
 * 169 real hours"*). A deadline rendered without its zone is the failure this
 * block exists to avoid: an admin in Paris reading "closes 23 Sep 00:00" would
 * be six hours wrong about their own founders' last night to submit. So the
 * zone travels with the deadline, every time.
 */
import type { Env } from '../types';
import { laneCounts, slaFor, ageHours, SLA_DUE_SOON_HOURS, SLA_PAST_HOURS } from './approvalSources';
import type { ApprovalLaneKey } from './approvalSources';
import { COHORT_TZ, cycleWeekWindows, delawareYearMonth } from './cohortTiming';

export type QueuePressureLane = {
  key: ApprovalLaneKey;
  label: string;
  /** `null` = unreadable. A measured empty lane is `0`. */
  count: number | null;
  oldest_age_hours: number | null;
  sla: 'ok' | 'due_soon' | 'past' | 'unknown';
};

export type ProgrammeClock = {
  /** The IANA zone every window below is expressed in. Never omitted. */
  zone: string;
  cycle: { year: number; month: number };
  /** null when `now` sits outside the four week windows of its own cycle. */
  open_week: number | null;
  /** ISO instants, so the page formats them in the zone named above. */
  week_opened_at: string | null;
  week_closes_at: string | null;
  hours_to_close: number | null;
  /** Accounts on this branch still pending the open week; null = unreadable. */
  pending_accounts: number | null;
  reason?: string;
};

export type BranchHome = {
  queue_pressure: QueuePressureLane[];
  /** The lanes that could not be read, named. Empty when all four answered. */
  unreadable: string[];
  programme: ProgrammeClock;
  revenue: {
    share_bps: number | null;
    as_of: string | null;
    /** Always null, and the reason says why rather than the page guessing. */
    amount_cents: null;
    reason: string;
  };
  sla_bands: { due_soon_hours: number; past_hours: number };
};

/**
 * WORST FIRST, WHERE WORST MEANS OLDEST. An unreadable lane sorts to the top,
 * above every measured one, because "I could not look" is the thing an admin
 * most needs to act on — and a lane with no oldest item (measured empty) sorts
 * last, below every lane that has something waiting.
 */
function byPressure(a: QueuePressureLane, b: QueuePressureLane): number {
  if ((a.count === null) !== (b.count === null)) return a.count === null ? -1 : 1;
  if (a.oldest_age_hours === null) return b.oldest_age_hours === null ? 0 : 1;
  if (b.oldest_age_hours === null) return -1;
  return b.oldest_age_hours - a.oldest_age_hours;
}

/** Which of the cycle's four windows contains `nowMs`, with its bounds. */
export function openWeekAt(nowMs: number): {
  cycle: { year: number; month: number };
  week: number | null;
  unlockMs: number | null;
  deadlineMs: number | null;
} {
  const cycle = delawareYearMonth(nowMs);
  for (const w of cycleWeekWindows(cycle.year, cycle.month)) {
    // HALF-OPEN, matching `cycleWeekWindows`: week N's deadline IS week N+1's
    // unlock, so a closed-interval test would report two weeks open for one
    // instant a month and the page would name whichever it found first.
    if (nowMs >= w.unlockMs && nowMs < w.deadlineMs) {
      return { cycle, week: w.week, unlockMs: w.unlockMs, deadlineMs: w.deadlineMs };
    }
  }
  return { cycle, week: null, unlockMs: null, deadlineMs: null };
}

async function programmeClock(env: Env, nowMs: number): Promise<ProgrammeClock> {
  const { cycle, week, unlockMs, deadlineMs } = openWeekAt(nowMs);
  const base: ProgrammeClock = {
    zone: COHORT_TZ,
    cycle,
    open_week: week,
    week_opened_at: unlockMs === null ? null : new Date(unlockMs).toISOString(),
    week_closes_at: deadlineMs === null ? null : new Date(deadlineMs).toISOString(),
    hours_to_close: deadlineMs === null ? null : Math.round(((deadlineMs - nowMs) / 3_600_000) * 10) / 10,
    pending_accounts: null,
  };
  if (week === null) {
    return {
      ...base,
      reason:
        'No cohort week is open right now. The four windows run from the 1st of the month in '
        + `${COHORT_TZ}, so the days after the fourth deadline belong to no week.`,
    };
  }
  try {
    // THE JOIN HERE IS THE PREDICATE, NOT A PROJECTION, which is the
    // distinction D130 was written about. `cohort_cycles` is how a (year,
    // month) becomes the id `company_week_status` stores; dropping it would
    // count every cycle's pending rows, not this one's. A row cannot exist
    // without its cycle, so the join removes nothing.
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n
         FROM company_week_status s
         JOIN cohort_cycles c ON c.id = s.cohort_cycle_id
        WHERE c.year = ? AND c.month = ? AND s.week_number = ? AND s.status = 'pending'`,
    ).bind(cycle.year, cycle.month, week).first<{ n: number }>();
    return { ...base, pending_accounts: Number(row?.n) || 0 };
  } catch {
    return {
      ...base,
      reason:
        'The cohort week status could not be read on this branch, so the number of accounts still '
        + 'pending this week is unknown rather than zero.',
    };
  }
}

/**
 * The rate is a licence TERM HQ pushed, so it is real and it is dated. The
 * amount it applies to is not, and `branchRevenueSummary` already establishes
 * why for every stream a branch has: subscriptions carry no amount in this
 * database, a subsidiary charges no onward licence fee, and the token figure
 * is a COST rather than revenue. Multiplying a real rate by a missing base is
 * how a page invents a number that looks audited.
 */
async function revenueShare(env: Env): Promise<BranchHome['revenue']> {
  const reason =
    'Your share is a licence term and it is shown. The amount it applies to is not totalled on a '
    + 'branch: subscription charges live in Stripe with no amount in this database, a subsidiary '
    + 'charges no onward licence fee, and the AI figure is a cost rather than revenue. HQ enters '
    + 'the gross on the statement, so the statement is where a euro figure exists.';
  try {
    const row = await env.DB.prepare(
      'SELECT revenue_share_bps, pushed_at FROM branch_licence WHERE id = 1',
    ).first<{ revenue_share_bps: number | null; pushed_at: string | null }>();
    const bps = row?.revenue_share_bps;
    return {
      share_bps: bps === null || bps === undefined ? null : Number(bps),
      as_of: row?.pushed_at ?? null,
      amount_cents: null,
      reason,
    };
  } catch {
    return { share_bps: null, as_of: null, amount_cents: null, reason };
  }
}

export async function branchHome(env: Env, now = Date.now()): Promise<BranchHome> {
  const lanes = await laneCounts(env);
  const queue_pressure: QueuePressureLane[] = lanes.map((l) => {
    const age = l.count === null ? null : ageHours(l.oldest_at, now);
    return {
      key: l.key,
      label: l.label,
      count: l.count,
      oldest_age_hours: age === null ? null : Math.round(age * 10) / 10,
      // An unreadable lane has no band. Calling it `ok` would be the one
      // reading that turns a gap into reassurance.
      sla: l.count === null ? 'unknown' : slaFor(age),
    };
  });
  queue_pressure.sort(byPressure);

  const [programme, revenue] = await Promise.all([programmeClock(env, now), revenueShare(env)]);

  return {
    queue_pressure,
    unreadable: lanes.filter((l) => l.count === null).map((l) => l.label),
    programme,
    revenue,
    sla_bands: { due_soon_hours: SLA_DUE_SOON_HOURS, past_hours: SLA_PAST_HOURS },
  };
}
