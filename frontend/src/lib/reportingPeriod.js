// D4647 (#4647) — which reporting period a Portfolio default means.
//
// WHAT WAS WRONG. The quarter-end export's default was
//
//   const quarterEndMonth = Math.floor((now.getMonth() - 1) / 3) * 3;
//   const end = new Date(now.getFullYear(), quarterEndMonth, 0);
//   return end.toISOString().slice(0, 10);
//
// which is wrong twice. `getMonth()` is zero-based, so in the first month of
// any quarter — January, April, July, October — `(0 - 1) / 3` floors to -1 and
// the default lands a WHOLE QUARTER early: in April it exported 31 December,
// not 31 March. And `new Date(y, m, 0)` is local midnight, which
// `toISOString()` then converts to UTC, so in any zone east of UTC the
// exported date was the day BEFORE the quarter end.
//
// A quarter-end export with the wrong date is not a small error: the figures
// it carries are a different quarter's, and nothing on the sheet says so.
//
// THE RULE. The default is the LAST COMPLETED quarter — the one before the
// quarter containing today — because a quarter still running has no end to
// report. The Worker applies the same rule in two places, and this module is
// pinned to both, for every month of several years, by
// `cloudflare-worker/test/portfolio_reporting_period_d4647.test.ts`:
//
//   - `services/portfolioMetrics.ts`'s `completedPeriod` — the Portfolio
//     Worker's own completed-period default (D4647, #5323) — for WHICH quarter;
//   - `services/fundReportBuild.ts`'s `lastClosedQuarter` — a fund's
//     quarterly pack — for that quarter's LAST DAY.
//
// So the page's default and the Worker's cannot drift. All three work on a
// civil date, never on a timestamp.
//
// WHAT THIS IS NOT. It chooses a default date and passes it on as `as_of`. It
// defines no as-of rule of its own: how the Worker cuts cash flows and
// valuation marks at that date is #4644's, in `routes/positions.ts`.

const pad = (n) => String(n).padStart(2, '0');
/** Days in a month, by the calendar: 0 as the next month's day rolls back. */
const lastDay = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Today's civil date in a named IANA time zone, as `YYYY-MM-DD`. The zone is
 * the viewer's own unless one is given; an unknown zone falls back to UTC
 * rather than throwing, because a date is wanted either way.
 *
 * This is the step the old default skipped. A quarter ends on a calendar day
 * in somebody's calendar, and converting a local midnight to UTC is not that
 * day — it is the instant before it.
 */
export function civilToday(timeZone = undefined, instant = new Date()) {
  const zone = timeZone || (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } })();
  for (const tz of [zone, 'UTC']) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(instant).reduce((all, p) => ({ ...all, [p.type]: p.value }), {});
      if (parts.year && parts.month && parts.day) return `${parts.year}-${parts.month}-${parts.day}`;
    } catch { /* an unknown zone: try UTC, then the instant itself */ }
  }
  return instant.toISOString().slice(0, 10);
}

/** The quarter a civil date falls in: 1 to 4. */
export function quarterNumber(day) {
  const month = Number(String(day).slice(5, 7));
  return Math.floor((month - 1) / 3) + 1;
}

/**
 * A quarter as its label and its two inclusive civil bounds, from the quarter
 * number and year. The end is the real last day of the quarter's last month.
 */
export function quarterPeriod(quarter, year) {
  const q = Number(quarter);
  const y = Number(year);
  if (!Number.isInteger(q) || q < 1 || q > 4 || !Number.isInteger(y)) return null;
  const firstMonth = (q - 1) * 3 + 1;
  const lastMonth = q * 3;
  return { label: `Q${q} ${y}`, quarter: q, year: y, start: `${y}-${pad(firstMonth)}-01`, end: `${y}-${pad(lastMonth)}-${pad(lastDay(y, lastMonth))}` };
}

/**
 * The last completed quarter as of a civil date: the quarter before the one
 * containing it. In Q1 that is Q4 of the year before, which is where the old
 * arithmetic also lost the year.
 */
export function lastCompletedQuarter(today = civilToday()) {
  const year = Number(String(today).slice(0, 4));
  const q = quarterNumber(today);
  return q === 1 ? quarterPeriod(4, year - 1) : quarterPeriod(q - 1, year);
}

/** The default `as_of` for a quarter-end export: that quarter's last day. */
export function lastCompletedQuarterEnd(today = civilToday()) {
  return lastCompletedQuarter(today).end;
}

/** True while every day of the period is in the past on `today`. */
export const isCompleted = (period, today) => !!period && period.end < String(today);
