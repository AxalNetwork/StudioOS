/**
 * The derived halves of Cohorts · Guidance and · Calendar.
 *
 * Pure, and separate from the route, for the reason `_founder_validate_helpers`
 * gives: these are the parts that produce a NUMBER, and a wrong number does not
 * throw. It renders, in the right font, beside numbers that are correct.
 *
 * Both functions here refuse rather than guess when the rows cannot answer.
 */

/** Guidance as stored. `answer === null` is open; there is no status column. */
export type GuidanceRow = {
  id: number;
  asked_by_user_id: number | null;
  answer: string | null;
  posted_at: string;
  answered_at: string | null;
  retired_at: string | null;
};

export type GuidanceCounts = {
  /** Founder questions with no answer yet. */
  open: number;
  /** Answered questions. */
  answered: number;
  /** Advisor-posted guidance — no question, so never open or answered. */
  broadcast: number;
  /**
   * Median hours from question to answer, or `null`.
   *
   * NULL WHEN NOTHING HAS BEEN ANSWERED, which is not the same as zero. A
   * median over an empty set is undefined, and rendering "0h" would claim an
   * instant reply to questions nobody has answered. The canvas draws this as
   * "Median response · last 30 days"; with no answered question the tile shows
   * "Not recorded" rather than a flattering number.
   */
  medianResponseHours: number | null;
};

const hoursBetween = (from: string, to: string): number | null => {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (b - a) / 3_600_000;
};

export function guidanceCounts(rows: GuidanceRow[]): GuidanceCounts {
  const live = rows.filter((r) => !r.retired_at);
  const questions = live.filter((r) => r.asked_by_user_id != null);
  const answered = questions.filter((r) => r.answer != null && r.answered_at);
  const spans = answered
    .map((r) => hoursBetween(r.posted_at, r.answered_at as string))
    .filter((h): h is number => h != null && h >= 0)
    .sort((x, y) => x - y);
  let median: number | null = null;
  if (spans.length) {
    const mid = Math.floor(spans.length / 2);
    median = spans.length % 2 ? spans[mid] : (spans[mid - 1] + spans[mid]) / 2;
    median = Math.round(median * 10) / 10;
  }
  return {
    open: questions.length - answered.length,
    answered: answered.length,
    broadcast: live.length - questions.length,
    medianResponseHours: median,
  };
}

/**
 * OVERDUE IS NOT COMPUTED HERE, and its absence is the point.
 *
 * The canvas draws "Overdue · past your 24h commitment". Nothing in the product
 * stores a commitment: no advisor has ever been asked for one, and there is no
 * settings row to hold it. Picking 24 hours because the canvas printed it would
 * turn a designer's example into a promise the advisor never made, and then
 * report them as having broken it.
 *
 * So the zone shows how long the oldest open question has waited — a fact — and
 * says the commitment is not recorded. If a commitment ever becomes a stored
 * setting, `overdue` becomes one comparison against this same number.
 */
export function oldestOpenHours(rows: GuidanceRow[], nowIso: string): number | null {
  const open = rows.filter((r) => !r.retired_at && r.asked_by_user_id != null && r.answer == null);
  const ages = open
    .map((r) => hoursBetween(r.posted_at, nowIso))
    .filter((h): h is number => h != null && h >= 0);
  if (!ages.length) return null;
  return Math.round(Math.max(...ages) * 10) / 10;
}

// ---------------------------------------------------------------------------

export type CalendarItem = {
  kind: 'cohort' | 'client' | 'demo_day';
  title: string;
  starts_at: string;
  /** NULL for an instant — a deadline or Demo Day has no duration recorded. */
  ends_at: string | null;
  ref: string;
};

/**
 * Items whose times overlap, as index pairs.
 *
 * WHAT COUNTS AS A COLLISION, stated because the honest answer is narrower than
 * it looks. A Lab week window spans seven days; every client slot in that month
 * falls inside one, so overlapping a WINDOW is not a clash and treating it as
 * one would report four collisions a week, every week, forever. What clashes is
 * an obligation at a moment: a deadline or Demo Day landing inside a booked
 * slot, or two booked slots overlapping each other.
 *
 * So an instant (`ends_at === null`) collides when it falls strictly inside a
 * ranged item, and two ranged items collide when their spans intersect.
 *
 * TWO INSTANTS NEVER COLLIDE, AND NO SPECIAL CASE ENFORCES THAT. The strict
 * `<` on both sides already does it: an instant is `[s, s]`, so `x[0] < y[1] &&
 * y[0] < x[1]` is false for any pair of them, identical times included. An
 * earlier draft carried an explicit `if (xInstant && yInstant) continue` — it
 * could never change an outcome, and the test for the behaviour passed with it
 * removed, which is how it was found. Being due at the same minute is not a
 * scheduling conflict, and the comparison says so without help.
 *
 * The same strictness is what makes back-to-back sessions legal: a slot ending
 * at 11:00 and one starting at 11:00 do not overlap.
 */
export function collisions(items: CalendarItem[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const span = (i: CalendarItem): [number, number] | null => {
    const s = Date.parse(i.starts_at);
    if (!Number.isFinite(s)) return null;
    if (i.ends_at == null) return [s, s];
    const e = Date.parse(i.ends_at);
    return [s, Number.isFinite(e) ? e : s];
  };
  for (let a = 0; a < items.length; a += 1) {
    for (let b = a + 1; b < items.length; b += 1) {
      const x = span(items[a]);
      const y = span(items[b]);
      if (!x || !y) continue;
      if (x[0] < y[1] && y[0] < x[1]) out.push([a, b]);
    }
  }
  return out;
}

/** Items starting within `days` of `nowIso`, in time order. */
export function withinDays(items: CalendarItem[], nowIso: string, days: number): CalendarItem[] {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return [];
  const until = now + days * 86_400_000;
  return items
    .filter((i) => {
      const s = Date.parse(i.starts_at);
      return Number.isFinite(s) && s >= now && s <= until;
    })
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
}
