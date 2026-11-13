/**
 * Geometry for a weekly line chart — H15's per-branch lines and S15's one line
 * against a median (D210). Pure: the component that draws it
 * (`components/WeeklyLineChart.jsx`) holds no arithmetic, and the test reads
 * this function rather than restating it. `trajectoryGeometry` in
 * `lib/scoringViewModel.js` is the precedent.
 *
 * A MISSING WEEK IS NEVER DRAWN AS A ZERO, AND NEVER BRIDGED. Every value the
 * server sends is a number or `null`, and `null` has four meanings the route
 * already separates (a capped read, a week older than the store, a series with
 * no rows, a week before the series began). None of them is "nobody was
 * active". So a line breaks at every `null` into separate runs, a run of one
 * week is drawn as a dot, and no segment ever joins the two sides of a gap —
 * joining them would draw a trend through weeks nothing measured.
 *
 * THE MEDIAN SITS AT ITS TRUE VALUE. The canvas draws S15's dashed median rule
 * as a fixed-height decoration; here it is placed on the same y-scale as the
 * line, and the scale is widened to hold it, so "above the median" on screen is
 * above the median in fact.
 *
 * THE Y AXIS STARTS AT ZERO, ALWAYS. A count of accounts with a baseline above
 * zero turns a move from 40 to 44 into a line that doubles.
 */

/** The canvas's plot box, in viewBox units (H15 and S15 both draw 534 × 150). */
export const VIEW_W = 534;
export const VIEW_H = 150;
const LEFT = 4;
const RIGHT = 8;
const TOP = 8;
const BOTTOM = 4;

/**
 * The smallest "nice" step — 1, 2 or 5 times a power of ten — at least `raw`.
 * Never below 1: these are counts of accounts, and a gridline at 0.5 accounts
 * would label a fraction of a person.
 */
export function niceStep(raw) {
  const r = Number(raw);
  if (!Number.isFinite(r) || r <= 1) return 1;
  const pow = 10 ** Math.floor(Math.log10(r));
  for (const m of [1, 2, 5, 10]) {
    if (m * pow >= r) return m * pow;
  }
  return 10 * pow;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A Monday as the axis prints it: `2026-09-14` → `14 Sep`. `null` for anything
 * that is not a calendar date, rather than a label reading "undefined NaN".
 */
export function weekLabel(monday) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(monday ?? ''));
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  const day = Number(m[3]);
  if (!month || day < 1 || day > 31) return null;
  return `${day} ${month}`;
}

const isValue = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * @param {{ weeks: string[], series?: Array<{ key: string, values: Array<number|null>, dashed?: boolean }>,
 *           median?: number|null }} input
 */
export function weeklyChartGeometry({ weeks, series = [], median = null }) {
  const list = Array.isArray(weeks) ? weeks : [];
  const n = list.length;
  const plotW = VIEW_W - LEFT - RIGHT;
  const plotH = VIEW_H - TOP - BOTTOM;

  const all = [];
  for (const s of series) for (const v of s.values || []) if (isValue(v)) all.push(v);
  const medianValue = isValue(median) ? median : null;
  // A missing median contributes nothing to the scale, rather than a zero.
  const peak = Math.max(0, ...all, ...(medianValue === null ? [] : [medianValue]));
  const step = niceStep(peak / 4);
  const yMax = step * 4;

  const xAt = (i) => (n <= 1 ? LEFT + plotW / 2 : LEFT + (i / (n - 1)) * plotW);
  const yAt = (v) => TOP + plotH - (Math.max(0, v) / yMax) * plotH;
  const pct = (y) => Number(((y / VIEW_H) * 100).toFixed(2));
  const fmt = (x) => Number(x.toFixed(1));

  const ticks = [0, 1, 2, 3, 4].map((k) => {
    const value = step * k;
    const y = yAt(value);
    return { value, y: fmt(y), pct: pct(y) };
  });

  const drawn = series.map((s) => {
    const values = (s.values || []).slice(0, n);
    const runs = [];
    let run = [];
    values.forEach((v, i) => {
      if (isValue(v)) {
        run.push({ i, x: fmt(xAt(i)), y: fmt(yAt(v)), value: v });
      } else if (run.length) {
        runs.push(run);
        run = [];
      }
    });
    if (run.length) runs.push(run);

    const lines = runs.filter((r) => r.length > 1).map((r) => r.map((p) => `${p.x},${p.y}`).join(' '));
    const lastRun = runs[runs.length - 1];
    const lastPoint = lastRun ? lastRun[lastRun.length - 1] : null;
    // A lone measured week is a dot. The newest point is drawn once, as `last`
    // (hollow when its week has not ended), so it is not also a dot beneath it.
    const dots = runs.filter((r) => r.length === 1).map((r) => r[0]).filter((p) => p !== lastPoint);
    return {
      key: s.key,
      dashed: Boolean(s.dashed),
      lines,
      dots,
      last: lastPoint
        ? {
          x: lastPoint.x,
          y: lastPoint.y,
          value: lastPoint.value,
          week: list[lastPoint.i],
          // The current week has not ended, so its point is a count so far.
          partial: lastPoint.i === n - 1,
        }
        : null,
    };
  });

  // At most eight labels on the x axis, always including the newest week, so a
  // year's chart stays readable and its right edge is always named.
  const every = Math.max(1, Math.ceil(n / 8));
  const labels = [];
  for (let i = n - 1; i >= 0; i -= every) {
    const label = weekLabel(list[i]);
    if (label) labels.unshift({ week: list[i], label, pct: Number(((xAt(i) / VIEW_W) * 100).toFixed(2)) });
  }

  return {
    viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
    W: VIEW_W,
    H: VIEW_H,
    plot: { left: LEFT, right: VIEW_W - RIGHT, top: TOP, bottom: VIEW_H - BOTTOM },
    yMax,
    step,
    ticks,
    series: drawn,
    median: medianValue === null ? null : { value: medianValue, y: fmt(yAt(medianValue)), pct: pct(yAt(medianValue)) },
    labels,
    empty: all.length === 0,
  };
}
