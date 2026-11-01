/**
 * D1538 (#3787, deck v2 B11) — what the editor, Present and the print page
 * draw for a typed table and for the market_circles and projection charts.
 * Pure, so a test can hold every shape; `BlockGrid.jsx` draws them.
 *
 *   marketCircles  TAM, SAM and SOM, nested and touching at the bottom, each
 *                  circle's area in proportion to its figure. Null when the
 *                  three are not exactly TAM, SAM and SOM with SOM ≤ SAM ≤ TAM
 *                  (the Worker's `visuals.marketShape`): a market that does
 *                  not nest is not drawn as circles.
 *   projectionLines the series as two polylines in a 100 × 60 box: solid up
 *                  to today's month, dashed after it. The "Projection" label
 *                  and its footnote are S1's `projectionOf` (figuresModel),
 *                  drawn beside the chart, never a second label here.
 *   tableView      a table block's rows as text: a check is ✓ or ✗, a bound
 *                  cell names its source, an empty cell is blank (never 0).
 */

export const TYPED_CHART_TYPES = ['market_circles', 'projection'];
export const isTypedChart = (b) => Boolean(b && b.kind === 'chart' && TYPED_CHART_TYPES.includes(b.chart_type));

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const monthOf = (x) => (typeof x === 'string' && /^\d{4}-\d{2}/.test(x) ? x.slice(0, 7) : null);
const pointsOf = (block) => (Array.isArray(block?.series?.[0]?.points) ? block.series[0].points : []);

/** TAM, SAM and SOM from a series' three points, or null when they do not nest. */
export function marketShape(points) {
  if (!Array.isArray(points) || points.length !== 3) return null;
  const by = new Map();
  for (const p of points) {
    const k = typeof p?.x === 'string' ? p.x.trim().toUpperCase() : '';
    const y = num(p?.y);
    if (!['TAM', 'SAM', 'SOM'].includes(k) || by.has(k) || y == null || y <= 0) return null;
    by.set(k, y);
  }
  const tam = by.get('TAM'), sam = by.get('SAM'), som = by.get('SOM');
  return som <= sam && sam <= tam ? { tam, sam, som } : null;
}

/** "$40B": a market figure, short. */
export function compactUsd(v) {
  const n = num(v);
  if (n == null) return '';
  const steps = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [at, unit] of steps) if (Math.abs(n) >= at) return `$${+(n / at).toFixed(n / at >= 10 ? 0 : 1)}${unit}`;
  return `$${n}`;
}

/**
 * The three circles in a 100 × 100 box, outermost first: `r` scaled so each
 * circle's AREA is its figure's share of TAM, all resting on the same bottom.
 */
export function marketCircles(block) {
  const m = marketShape(pointsOf(block));
  if (!m) return null;
  const R = 48;
  const bottom = 98;
  const circle = (key, label, value) => {
    const r = R * Math.sqrt(value / m.tam);
    return { key, label, value, text: `${label} ${compactUsd(value)}`, cx: 50, cy: +(bottom - r).toFixed(2), r: +r.toFixed(2) };
  };
  return [circle('tam', 'TAM', m.tam), circle('sam', 'SAM', m.sam), circle('som', 'SOM', m.som)];
}

/**
 * The series as `{ solid, dashed }` point strings in a 100 × 60 box, split at
 * the last month not after today's: the dashed part starts at that point, so
 * the two lines meet. `dashed` is '' when nothing is past today.
 */
export function projectionLines(block, today = new Date().toISOString().slice(0, 10)) {
  const pts = pointsOf(block).filter((p) => num(p?.y) != null);
  if (pts.length < 2) return null;
  const ys = pts.map((p) => p.y);
  const lo = Math.min(0, ...ys), hi = Math.max(...ys);
  const span = hi - lo || 1;
  const xy = pts.map((p, i) => [+(i * (100 / (pts.length - 1))).toFixed(2), +(60 - ((p.y - lo) / span) * 56 - 2).toFixed(2)]);
  const now = monthOf(today);
  const firstFuture = now ? pts.findIndex((p) => { const m = monthOf(p?.x); return m != null && m > now; }) : -1;
  const join = (list) => list.map(([x, y]) => `${x},${y}`).join(' ');
  if (firstFuture < 0) return { solid: join(xy), dashed: '', from: null };
  const cut = Math.max(0, firstFuture - 1);
  return { solid: firstFuture === 0 ? '' : join(xy.slice(0, cut + 1)), dashed: join(xy.slice(cut)), from: monthOf(pts[firstFuture].x) };
}

/** One cell as text: its words, ✓ or ✗, or its binding's source key; an empty cell is ''. */
export function cellText(cell) {
  if (cell?.binding?.source_key) return String(cell.binding.source_key);
  if (typeof cell?.check === 'boolean') return cell.check ? '✓' : '✗';
  return typeof cell?.text === 'string' ? cell.text : '';
}

/** A table block as `{ head, body }`, rows of cell text; the first row is the head unless `header` is false. */
export function tableView(block) {
  const rows = (Array.isArray(block?.rows) ? block.rows : []).map((row) => (Array.isArray(row) ? row : []).map(cellText));
  if (!rows.length) return { head: null, body: [] };
  return block.header === false ? { head: null, body: rows } : { head: rows[0], body: rows.slice(1) };
}
