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
  /** The lanes that could not be read, named. Empty when every approval lane answered. */
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
  /** The Studio card's expiring agreements (#308, D199). */
  agreements: AgreementsExpiring;
};

/**
 * Agreements that end inside the window, from THIS database's own contract
 * stores. `expiring` is null whenever a dated source could not be read.
 */
export type AgreementsExpiring = {
  window_days: number;
  /** null = at least one dated source is unreadable, so any total would be smaller than the truth. */
  expiring: number | null;
  by_source: { pairwise_ndas: number | null; partner_deals: number | null };
  /** Present when `expiring` is null, naming what could not be read. */
  reason?: string;
  /** What is NOT counted and why — a zero must never be read as "checked everything". */
  undated: { sources: string[]; reason: string };
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
    'The share is a licence term and it is shown: the part of this territory\'s revenue owed to '
    + 'HQ, with the rest kept here. The amount it applies to is not totalled on a '
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

/**
 * AGREEMENTS THAT END INSIDE THE WINDOW (#308, D199).
 *
 * THE TASK NAMED THE WRONG CAUSE, and the correction decides the whole shape.
 * The Studio card said these were "not recorded on a branch" because "the
 * contract ledger is HQ's table". That ledger is `licence_contracts`
 * (migration 259): the licence agreement between HQ and this licensee, one per
 * licence, recording drafting and signature and NEVER an end date. Pushing it
 * here would carry nothing that can expire.
 *
 * The agreements the canvas draws on this card (S5, `conExpiring` — a Partner
 * MSA, an Advisory agreement, a Service agreement, each with a counterparty
 * and a renewal) are the platform's own contract union: the four sources
 * `admin_contracts.ts`'s `loadAllContracts` joins, `documents`,
 * `esign_envelopes`, `pairwise_ndas` and `partner_deals`. Every one is a table
 * in THIS database, so on a branch they are the branch's by construction
 * (D.2). Nothing needs pushing and no new store is needed.
 *
 * WHAT IS MISSING IS A FIELD, NOT A TRANSPORT. Two of the four record when an
 * agreement ends, and each has a live sweep acting on it —
 * `pairwise_ndas.valid_until` (`expireDueArtifacts`) and
 * `partner_deals.expires_at` (`expirePartnerDeals`). The other two record
 * when a document was SIGNED and nothing about when it stops binding, so an
 * MSA sent through e-sign cannot be counted here, and `undated` says so rather
 * than letting "0 expiring" read as though they were checked.
 *
 * THE WINDOW IS (now, now + 60 days], `renewalSweep`'s own shape: a row still
 * `active` after its end has ended — that is the sweep's business, not
 * something "expiring". BOTH SIDES GO THROUGH `datetime()`. These columns are
 * written from JavaScript as ISO strings, and comparing one bare against a
 * SQLite stamp decides at position 10, where 'T' sorts above ' ': an agreement
 * that ended this morning reads as still running (the D124/D125 class). The
 * handler's own `now` is bound rather than SQLite's clock, as the rest of this
 * digest does, so the answer cannot drift from the page it is printed on.
 *
 * AN UNREADABLE SOURCE MAKES THE TOTAL UNKNOWN, NEVER SMALLER — `backlogOf`'s
 * rule for the queues. Two sources with one unreadable is a count that is
 * wrong by an amount nobody knows.
 */
export const AGREEMENT_WINDOW_DAYS = 60;

const UNDATED_REASON =
  'Counted: mutual NDAs and partner deals, the two agreement stores that record an end date. '
  + 'E-sign envelopes and signed documents record when an agreement was signed, not when it '
  + 'ends, so an MSA or a service agreement cannot be counted here.';

async function countEnding(env: Env, sql: string, nowIso: string): Promise<number | null> {
  try {
    const row = await env.DB.prepare(sql)
      .bind(nowIso, nowIso, `+${AGREEMENT_WINDOW_DAYS} days`)
      .first<{ n: number }>();
    return Number(row?.n ?? 0);
  } catch {
    return null;
  }
}

async function agreementsExpiring(env: Env, now: number): Promise<AgreementsExpiring> {
  const nowIso = new Date(now).toISOString();
  const [ndas, deals] = await Promise.all([
    countEnding(env,
      `SELECT COUNT(*) AS n FROM pairwise_ndas
        WHERE status = 'active'
          AND valid_until IS NOT NULL
          AND datetime(valid_until) >  datetime(?)
          AND datetime(valid_until) <= datetime(?, ?)`,
      nowIso),
    countEnding(env,
      `SELECT COUNT(*) AS n FROM partner_deals
        WHERE status = 'active'
          AND expires_at IS NOT NULL
          AND datetime(expires_at) >  datetime(?)
          AND datetime(expires_at) <= datetime(?, ?)`,
      nowIso),
  ]);
  const unreadable = [
    ndas === null ? 'mutual NDAs' : null,
    deals === null ? 'partner deals' : null,
  ].filter(Boolean) as string[];
  const undated = { sources: ['esign_envelopes', 'documents'], reason: UNDATED_REASON };
  if (unreadable.length) {
    return {
      window_days: AGREEMENT_WINDOW_DAYS,
      expiring: null,
      by_source: { pairwise_ndas: ndas, partner_deals: deals },
      reason: `The ${unreadable.join(' and ')} could not be read, so no total is given: one that `
        + 'left them out would be smaller than the truth by an amount nobody knows.',
      undated,
    };
  }
  return {
    window_days: AGREEMENT_WINDOW_DAYS,
    expiring: (ndas as number) + (deals as number),
    by_source: { pairwise_ndas: ndas, partner_deals: deals },
    undated,
  };
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

  const [programme, revenue, agreements] = await Promise.all([
    programmeClock(env, now), revenueShare(env), agreementsExpiring(env, now),
  ]);

  return {
    queue_pressure,
    unreadable: lanes.filter((l) => l.count === null).map((l) => l.label),
    programme,
    revenue,
    sla_bands: { due_soon_hours: SLA_DUE_SOON_HOURS, past_hours: SLA_PAST_HOURS },
    agreements,
  };
}
