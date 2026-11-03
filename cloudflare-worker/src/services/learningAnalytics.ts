/**
 * D4181 (#4181, #3726 L6) — one video's analytics, from the positions the
 * player writes (`learning_progress`, `subject_kind = 'item'`). Pure: the
 * route reads the rows; nothing here reads or writes the store.
 *
 * WHAT A ROW IS. One member's progress on the video: `status` (started or
 * completed), `percent` (never goes backwards) and `position_seconds` (the
 * last second the player saved). How far a viewer got is the furthest of the
 * two, and a completed view reached the end. A row with none of them says
 * nothing about where the viewer stopped: it counts as a view and is left out
 * of the curve, and the reply says how many were.
 *
 * NO SMALL COHORTS. With fewer than `MIN_VIEWERS` viewers the reply carries no
 * figure at all, only "Not enough views to show": a count, a rate or a curve
 * over two or three people says what each of them did. The curve has the
 * same floor over the viewers whose position is known.
 *
 * NO MEMBER IS NAMED. The rows carry no user id, and nothing per viewer is
 * returned: counts, a rate, a median and a curve of shares.
 *
 * A NULL DURATION reads "Not recorded" for the curve and the median of a
 * percent-only view: without the length there is no second to put it at.
 */

export const MIN_VIEWERS = 5;
export const BUCKETS = 20;
export const NOT_ENOUGH = 'Not enough views to show';
export const NOT_RECORDED = 'Not recorded';

export type ProgressRow = { status: string | null; percent: number | null; position_seconds: number | null };
export type Chapter = { start_seconds: number; title: string };
type Absent = { available: false; reason: string };
type Present<T> = { available: true; value: T };

export type DropOff = {
  buckets: { start_seconds: number; end_seconds: number; still_watching_pct: number }[];
  biggest_drop: { at_seconds: number; points: number; chapter: string | null } | null;
  viewers: number;
  unrecorded: number;
};

export type VideoAnalytics =
  | { enough: false; reason: string; min_viewers: number }
  | {
    enough: true;
    views: number;
    completion_pct: number;
    median_watch_seconds: Present<number> | Absent;
    drop_off: Present<DropOff> | Absent;
    chapters: Chapter[];
  };

const whole = (v: unknown): number | null => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

/**
 * How far one viewer got, in seconds, or null when the row does not say.
 * Never past the end, and never negative.
 */
export function reachedSeconds(row: ProgressRow, duration: number | null): number | null {
  const done = row.status === 'completed';
  const pos = whole(row.position_seconds);
  const pct = whole(row.percent);
  const fromPct = duration !== null && pct !== null ? (pct / 100) * duration : null;
  const candidates = [done && duration !== null ? duration : null, pos, fromPct].filter((x): x is number => x !== null && x >= 0);
  if (!candidates.length) return null;
  const best = Math.max(...candidates);
  return duration !== null ? Math.min(best, duration) : best;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The chapter a second falls in: the last one starting at or before it. */
export function chapterAt(chapters: Chapter[], seconds: number): string | null {
  let hit: string | null = null;
  for (const c of chapters) if (c.start_seconds <= seconds) hit = c.title;
  return hit;
}

/** The share of viewers still watching at the start of each of `BUCKETS` equal spans of the video. */
export function dropOff(reached: number[], duration: number, chapters: Chapter[] = []): DropOff {
  const n = reached.length;
  const span = duration / BUCKETS;
  const buckets = Array.from({ length: BUCKETS }, (_, b) => {
    const start = b * span;
    // Strictly past the span's start, except the first: everyone who pressed play is watching at 0.
    const still = b === 0 ? n : reached.filter((r) => r > start).length;
    return { start_seconds: Math.round(start), end_seconds: Math.round((b + 1) * span), still_watching_pct: Math.round((still / n) * 100) };
  });
  let biggest: DropOff['biggest_drop'] = null;
  for (let b = 1; b < BUCKETS; b += 1) {
    const points = buckets[b - 1].still_watching_pct - buckets[b].still_watching_pct;
    if (points > 0 && (!biggest || points > biggest.points)) {
      biggest = { at_seconds: buckets[b].start_seconds, points, chapter: chapterAt(chapters, buckets[b].start_seconds) };
    }
  }
  return { buckets, biggest_drop: biggest, viewers: n, unrecorded: 0 };
}

/** The whole reply for one video. `duration` is the item's `duration_seconds`, or null. */
export function videoAnalytics(rows: ProgressRow[], duration: number | null, chapters: Chapter[] = []): VideoAnalytics {
  const viewers = rows.filter((r) => r.status === 'started' || r.status === 'completed');
  if (viewers.length < MIN_VIEWERS) return { enough: false, reason: NOT_ENOUGH, min_viewers: MIN_VIEWERS };
  const len = duration !== null && Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null;
  const completed = viewers.filter((r) => r.status === 'completed').length;
  const reached = viewers.map((r) => reachedSeconds(r, len));
  const known = reached.filter((x): x is number => x !== null);
  const unrecorded = viewers.length - known.length;

  const medianWatch: Present<number> | Absent = known.length >= MIN_VIEWERS
    ? { available: true, value: Math.round(median(known)) }
    : { available: false, reason: known.length ? NOT_ENOUGH : NOT_RECORDED };

  let curve: Present<DropOff> | Absent;
  if (len === null) curve = { available: false, reason: NOT_RECORDED };
  else if (known.length < MIN_VIEWERS) curve = { available: false, reason: NOT_ENOUGH };
  else curve = { available: true, value: { ...dropOff(known, len, chapters), unrecorded } };

  return {
    enough: true,
    views: viewers.length,
    completion_pct: Math.round((completed / viewers.length) * 100),
    median_watch_seconds: medianWatch,
    drop_off: curve,
    chapters,
  };
}
