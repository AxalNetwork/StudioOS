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
};

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
): ProgramSummary {
  const seen = new Set<number>();
  let graduates = 0;
  let measurable = 0;
  let onTime = 0;
  let raised = 0;
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
      if (done - start <= sprintDays * 86_400_000) onTime += 1;
    }
  }
  return {
    available: true,
    graduates,
    on_time_pct: measurable > 0 ? Math.round((onTime / measurable) * 100) : null,
    alumni_raised: raised > 0 ? raised : null,
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
