/**
 * Deal Flow analytics — pure aggregation over rows the caller has already
 * read. No DB, no Env, so every claim below is unit-testable against a fixed
 * input.
 *
 * The honesty rules this module enforces, in order of how easily each one gets
 * violated by accident:
 *
 *   1. A pass with no recorded reason is its own bucket, never redistributed
 *      into the five real ones and never dropped from the denominator. Both
 *      failures make the recorded reasons look more certain than they are.
 *   2. Conversion is measured on deals that ENTERED a stage inside the window,
 *      not on who is standing in it now. A board snapshot answers a different
 *      question and answers it with survivor bias.
 *   3. Nothing derived from stage history is returned without the date that
 *      history began. A three-week-old table can produce a confident-looking
 *      quarterly conversion rate, and the number would be a lie of omission.
 */
import {
  PASS_TAXONOMY,
  PASS_REASON_UNRECORDED,
  PASS_REASON_UNRECORDED_LABEL,
  passReasonLabel,
} from './dealPassTaxonomy';

/** Why a figure is absent, in the operator's words. Mirrors fundRollup.ts. */
export const DEAL_METRIC_UNAVAILABLE = {
  stage_history:
    'Stage transitions were not recorded before this release. Conversion and time-in-stage begin from the first recorded move.',
  source_quality:
    'Deals do not record where they came from. There is no source field, no IC decision record and no term-sheet object, so a source table would be three invented columns.',
} as const;

export interface PassBucket {
  reason: string;
  label: string;
  count: number;
  /** Share of all passes, 0–100, one decimal. Null when there are no passes. */
  pct: number | null;
}

/**
 * Percentage of a whole, or null when the whole is zero.
 *
 * `0/0` is not 0% — it is a question with no answer, and rendering it as 0%
 * puts a confident number where there is no data.
 */
export function pctOrNull(part: number, whole: number): number | null {
  if (!(whole > 0)) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Bucket passes by reason.
 *
 * Every taxonomy reason appears even at zero — an empty bucket is a finding
 * ("we have never once passed on valuation"), and a list that silently omits
 * it reads as though the option does not exist. The unrecorded bucket appears
 * ONLY when it is non-empty, because it describes a gap in the data rather
 * than a decision the fund made.
 */
export function buildPassBreakdown(
  rows: Array<{ pass_reason?: string | null; count?: any; n?: any }>,
): { total: number; buckets: PassBucket[]; unrecorded: number } {
  const byReason = new Map<string, number>();
  let unrecorded = 0;
  let total = 0;
  for (const r of rows || []) {
    const n = Number(r.count ?? r.n ?? 0) || 0;
    total += n;
    const key = r.pass_reason;
    if (key && PASS_TAXONOMY.some((t) => t.key === key)) {
      byReason.set(key, (byReason.get(key) || 0) + n);
    } else {
      unrecorded += n;
    }
  }
  const buckets: PassBucket[] = PASS_TAXONOMY.map((t) => ({
    reason: t.key,
    label: t.label,
    count: byReason.get(t.key) || 0,
    pct: pctOrNull(byReason.get(t.key) || 0, total),
  }));
  if (unrecorded > 0) {
    buckets.push({
      reason: PASS_REASON_UNRECORDED,
      label: PASS_REASON_UNRECORDED_LABEL,
      count: unrecorded,
      pct: pctOrNull(unrecorded, total),
    });
  }
  // Largest first — the reason a fund passes most is the one worth arguing
  // about. Ties keep taxonomy order so the list does not reshuffle on reload.
  buckets.sort((a, b) => b.count - a.count);
  return { total, buckets, unrecorded };
}

export interface StageEventRow {
  deal_id: number;
  from_stage: string | null;
  to_stage: string;
  kind: string;
  days_in_from: number | null;
  created_at: string;
}

export interface StageFunnelRow {
  stage: string;
  /** Deals whose ENTRY into this stage was recorded inside the window. */
  entered: number;
  /** Of those, how many were later recorded advancing out of it. */
  advanced: number;
  /** advanced/entered as 0–100, or null when nothing entered. */
  conversion: number | null;
  /** Mean recorded days spent in this stage. Null when never measured. */
  avg_days: number | null;
}

/**
 * Cohort funnel from recorded transitions.
 *
 * `entered` counts distinct deals, not events: a deal moved back and forth
 * between two stages is one deal in the cohort, and counting it twice would
 * inflate both the numerator's base and the fund's apparent volume.
 *
 * `advanced` asks whether the SAME deal was later recorded leaving the stage
 * forward. It deliberately does not credit a deal that left by being passed —
 * a pass is the opposite of conversion.
 */
export function buildStageFunnel(
  stages: readonly string[],
  events: StageEventRow[],
): StageFunnelRow[] {
  const rows = events || [];
  return stages.map((stage) => {
    const enteredDeals = new Set<number>();
    for (const e of rows) if (e.to_stage === stage) enteredDeals.add(e.deal_id);

    const advancedDeals = new Set<number>();
    const durations: number[] = [];
    for (const e of rows) {
      if (e.from_stage !== stage) continue;
      if (typeof e.days_in_from === 'number' && Number.isFinite(e.days_in_from)) {
        durations.push(e.days_in_from);
      }
      // Only a forward move counts as conversion. `kind==='set'` is a direct
      // status write, which may be a correction rather than progress, so it is
      // credited only when it actually moves the deal further down the list.
      if (e.kind === 'advance') { advancedDeals.add(e.deal_id); continue; }
      if (e.kind === 'set') {
        const from = stages.indexOf(stage);
        const to = stages.indexOf(e.to_stage);
        if (from >= 0 && to > from) advancedDeals.add(e.deal_id);
      }
    }
    // Restrict to the cohort: a deal that advanced out of a stage it was
    // already sitting in when recording began never "entered" within the
    // window, so crediting it would make conversion exceed 100%.
    let advanced = 0;
    for (const id of advancedDeals) if (enteredDeals.has(id)) advanced += 1;

    const avg = durations.length
      ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
      : null;

    return {
      stage,
      entered: enteredDeals.size,
      advanced,
      conversion: pctOrNull(advanced, enteredDeals.size),
      avg_days: avg,
    };
  });
}

/** Label helper re-exported so route handlers have one import for the vocabulary. */
export { passReasonLabel };
