/**
 * Spin-Out Fund metrics — pure aggregation logic for GET /api/spinout-lab/fund-metrics.
 *
 * Kept as a standalone pure module (no Hono / db / auth imports) so the test
 * harness can drive it directly, and so `routes/spinout_lab.ts` — whose smoke
 * test slices exact source strings out of the file — only gains a thin wire
 * handler, never new logic inside the existing pure functions.
 *
 * Money convention: everything here is DOLLARS (matching
 * `limited_partners.commitment_amount` and `projects.total_funding`). The SPA
 * converts to $K / $M for display.
 */

export type GraduateTimingRow = {
  user_id: number;
  completed_at: string | null;
  started_at: string | null;
  total_funding: number | null;
  /**
   * Per-graduate evidence columns for the studio-throughput tiles. All
   * OPTIONAL: an older query that does not select them leaves every derived
   * percentage null (a data gap), never 0 (a program failure). See
   * summarizeGraduates for how each is read.
   */
  interview_count?: number | null;
  revenue?: number | null;
  mrr?: number | null;
  paying_customers?: number | null;
  paid_pilot_status?: string | null;
  /** 1 when the fund holds a portfolio position in this graduate's company. */
  backed?: number | null;
};

export type LpCommitmentRow = {
  commitment_amount: number | null;
  lpa_signed: number | null;
};

export type ProgramSummary = {
  /**
   * True whenever the underlying query SUCCEEDED — including a genuine
   * zero-graduate state. Only the wire handler's catch (tables absent /
   * query failed) answers false: a live zero is a fact, not an outage, and
   * must not be papered over by the SPA's operator-maintained fallback.
   */
  available: boolean;
  graduates: number;
  /** 0–100 integer, or null when no graduate has a measurable start date. */
  on_time_pct: number | null;
  /** Total dollars raised by graduates' companies; null when none recorded. */
  alumni_raised: number | null;

  /* ---- studio-throughput tiles (the LP sales page's proof strip) --------
   *
   * EVERY percentage below is null when its denominator or its evidence
   * column is unavailable, and the SPA renders null as its operator-
   * maintained figure with a provenance caption. That asymmetry is
   * deliberate and load-bearing: these numbers sit on a page that asks an LP
   * for capital, so "we cannot measure this" must never render as a number,
   * and a missing column must never render as 0%.
   */

  /** Founders who ever started the Lab (the incorporation-rate denominator). */
  entrants: number | null;
  /** Graduates ÷ entrants, 0–100. Null when the entrant count is unknown. */
  incorporation_pct: number | null;
  /** Graduates with >= VERIFIED_DISCOVERY_MIN logged interviews, 0–100. */
  verified_discovery_pct: number | null;
  /** Graduates with recorded revenue, paying customers or a paid pilot, 0–100. */
  revenue_proof_pct: number | null;
  /** Median days from Lab start to incorporation across measurable graduates. */
  formation_velocity_days: number | null;
  /** Graduates the fund holds a portfolio position in, 0–100. */
  graduation_to_investment_pct: number | null;
};

/**
 * The week-1 discovery bar: five structured interviews. Same threshold the
 * program itself gates on (`interview_5_logged` in the milestone catalog), so
 * "verified discovery" on the LP page means exactly what it means to a founder.
 */
export const VERIFIED_DISCOVERY_MIN = 5;

export type FundRaiseSummary = {
  committed: number;
  soft_circled: number;
  lp_count: number;
  /** Median of positive commitments, in dollars; null when there are none. */
  median_commitment: number | null;
};

const parseTs = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const ms = Date.parse(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z'));
  return Number.isFinite(ms) ? ms : null;
};

/** Median of a list of numbers. Null for an empty list. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Program track record from graduate rows (one row per user with the week-4
 * `incorporation_completed` milestone; callers pre-dedupe to the first
 * project per user, mirroring GET /stats).
 *
 * On-time = the incorporation milestone landed within `sprintDays` of the
 * founder's `spinout_lab_started_at`. Graduates whose start date is missing
 * or unparseable are excluded from the percentage (not counted late) — a
 * data gap must not read as a program failure.
 */
export function summarizeGraduates(
  rows: GraduateTimingRow[],
  sprintDays = 28,
  entrants: number | null = null,
): ProgramSummary {
  const seen = new Set<number>();
  let graduates = 0;
  let measurable = 0;
  let onTime = 0;
  let raised = 0;
  const durations: number[] = [];

  // Evidence counters carry their own denominators. A column the query did
  // not select leaves `x.seen` at 0, so the percentage stays null instead of
  // reading as 0% — an unselected column is a data gap, not a failing program.
  const discovery = { seen: 0, hit: 0 };
  const revenue = { seen: 0, hit: 0 };
  const backed = { seen: 0, hit: 0 };

  for (const r of rows) {
    if (seen.has(r.user_id)) continue;
    seen.add(r.user_id);
    graduates += 1;
    const funding = Number(r.total_funding ?? 0);
    if (Number.isFinite(funding) && funding > 0) raised += funding;
    const start = parseTs(r.started_at);
    const done = parseTs(r.completed_at);
    if (start !== null && done !== null && done >= start) {
      measurable += 1;
      const elapsed = done - start;
      durations.push(elapsed / 86_400_000);
      if (elapsed <= sprintDays * 86_400_000) onTime += 1;
    }

    if (r.interview_count != null) {
      discovery.seen += 1;
      if (Number(r.interview_count) >= VERIFIED_DISCOVERY_MIN) discovery.hit += 1;
    }
    // Revenue proof is a disjunction because the product records it four ways
    // (Stripe-synced total, MRR, paying customers, or an explicitly set pilot
    // status). `paid_pilot_status` alone is enough to say "seen": a founder who
    // set it to 'pre_revenue' has answered the question, and answering "no"
    // must count in the denominator or the percentage only ever surveys
    // companies that already have revenue.
    const status = String(r.paid_pilot_status ?? '').trim().toLowerCase();
    const hasRevenueSignal = r.revenue != null || r.mrr != null
      || r.paying_customers != null || status !== '';
    if (hasRevenueSignal) {
      revenue.seen += 1;
      const proven = Number(r.revenue ?? 0) > 0
        || Number(r.mrr ?? 0) > 0
        || Number(r.paying_customers ?? 0) > 0
        || status === 'paid' || status === 'pilot_paid';
      if (proven) revenue.hit += 1;
    }
    if (r.backed != null) {
      backed.seen += 1;
      if (Number(r.backed) > 0) backed.hit += 1;
    }
  }

  const pct = (hit: number, of: number): number | null =>
    of > 0 ? Math.round((hit / of) * 100) : null;

  // Incorporation rate is graduates ÷ ENTRANTS, never graduates ÷ graduates:
  // a graduate is *defined* by the incorporation milestone, so the latter is
  // 100% by construction and would be a meaningless number on an LP page.
  // A cohort cannot produce more graduates than entrants; if the counts say
  // otherwise the entrant query is wrong, and reporting >100% would be worse
  // than reporting nothing.
  const incorporation_pct = entrants != null && entrants > 0 && graduates <= entrants
    ? Math.round((graduates / entrants) * 100)
    : null;

  const medianDays = median(durations);

  return {
    available: true,
    graduates,
    on_time_pct: pct(onTime, measurable),
    alumni_raised: raised > 0 ? raised : null,
    entrants,
    incorporation_pct,
    verified_discovery_pct: pct(discovery.hit, discovery.seen),
    revenue_proof_pct: pct(revenue.hit, revenue.seen),
    formation_velocity_days: medianDays != null ? Math.round(medianDays) : null,
    graduation_to_investment_pct: pct(backed.hit, backed.seen),
  };
}

/**
 * Raise progress from the fund's limited-partner rows.
 *
 * Committed = countersigned subscription (`lpa_signed = 1`); anything an LP
 * has indicated but not countersigned is soft-circled — the same distinction
 * the workspace's own footnote states. Median is over positive commitments
 * regardless of signature (it describes ticket size, not raised capital).
 */
export function summarizeLpRows(rows: LpCommitmentRow[]): FundRaiseSummary {
  let committed = 0;
  let soft = 0;
  const tickets: number[] = [];
  for (const r of rows) {
    const amount = Number(r.commitment_amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (Number(r.lpa_signed ?? 0) === 1) committed += amount;
    else soft += amount;
    tickets.push(amount);
  }
  return {
    committed,
    soft_circled: soft,
    lp_count: rows.length,
    median_commitment: median(tickets),
  };
}
