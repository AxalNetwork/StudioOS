/**
 * The working week a roadmap move happened in, and the three windows over it.
 *
 * WHAT THIS IS FOR. `/build/this-week`'s `Last 4`, `All weeks` and `Carried only`
 * chips (#176 FB1). Migration 252 logs every column change; this decides which
 * week a change belongs to and which OKRs each window keeps.
 *
 * IT IS A SERVICE AND NOT INLINE IN THE ROUTE because the week arithmetic is the
 * part that is wrong in a way nobody notices: an off-by-one Monday puts every
 * commitment in the wrong week, `Carried only` then shows this week's new work as
 * carried, and no error is raised anywhere. Exercising it needs a function, not a
 * request.
 */

/**
 * The Monday of the week containing `iso`, as `YYYY-MM-DD`.
 *
 * `Date.UTC(y, m - 1, d)` FROM THE PARTS, never `Date.parse(iso)`. Parsing the
 * string is what makes a bare `YYYY-MM-DD` UTC midnight and then renders it in the
 * reader's zone, landing a day early west of Greenwich; building from integers has
 * no zone in it at all. The whole computation stays in UTC and comes back out as
 * parts, so it is the same answer everywhere.
 *
 * MONDAY, NOT SUNDAY. `getUTCDay()` is 0 for Sunday, so the offset is
 * `(day + 6) % 7` — which is 0 on Monday and 6 on Sunday. Using `day - 1` would
 * send every Sunday FORWARD to the next day instead of back six.
 */
export function weekStartOf(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? '').trim());
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, mo - 1, d);
  if (!Number.isFinite(t)) return null;
  const back = (new Date(t).getUTCDay() + 6) % 7;
  const monday = new Date(t - back * 86400000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}

/** `n` Mondays back from `from`'s week, newest first, `from`'s own week included. */
export function recentWeeks(from: string, n: number): string[] {
  const start = weekStartOf(from);
  if (!start || !Number.isFinite(n) || n < 1) return [];
  const [y, mo, d] = start.split('-').map(Number);
  const base = Date.UTC(y, mo - 1, d);
  const pad = (x: number) => String(x).padStart(2, '0');
  const out: string[] = [];
  for (let i = 0; i < Math.floor(n); i += 1) {
    const day = new Date(base - i * 7 * 86400000);
    out.push(`${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`);
  }
  return out;
}

export type MoveRow = {
  okr_id: number;
  from_status: string | null;
  to_status: string;
  week_start: string;
  moved_at: string;
};

/** Every distinct week on record, newest first. */
export function weeksOnRecord(moves: readonly MoveRow[]): string[] {
  return [...new Set(moves.map((m) => m.week_start))].sort().reverse();
}

/**
 * Which OKRs each window keeps.
 *
 * `nowIds` is the set currently in the Now column — read from `roadmap_okrs`, not
 * inferred from the log, because the log may be younger than the board (migration
 * 252 does not backfill, and it says why).
 *
 * `carried` IS DEFINED AGAINST THE LOG AND NOT AGAINST "OLDER THAN A WEEK". An OKR
 * created eight days ago and committed this morning is NOT carried; one committed
 * three weeks ago and still open IS. The difference is whether a move to `now`
 * exists in an EARLIER week, which is a fact the log has and a timestamp does not.
 */
export function weekWindows(
  moves: readonly MoveRow[], nowIds: readonly number[], today: string,
): { lastFour: number[]; everCommitted: number[]; carried: number[]; weeks: string[] } {
  const thisWeek = weekStartOf(today);
  const four = new Set(recentWeeks(today, 4));
  const toNow = moves.filter((m) => m.to_status === 'now');

  const lastFour = new Set<number>();
  const ever = new Set<number>();
  const earliest = new Map<number, string>();
  for (const m of toNow) {
    ever.add(m.okr_id);
    if (four.has(m.week_start)) lastFour.add(m.okr_id);
    const seen = earliest.get(m.okr_id);
    if (seen == null || m.week_start < seen) earliest.set(m.okr_id, m.week_start);
  }

  // An OKR still in Now whose first commitment was before this week.
  const carried = nowIds.filter((id) => {
    const first = earliest.get(id);
    return first != null && thisWeek != null && first < thisWeek;
  });

  return {
    lastFour: [...lastFour],
    everCommitted: [...ever],
    carried,
    weeks: weeksOnRecord(moves),
  };
}
