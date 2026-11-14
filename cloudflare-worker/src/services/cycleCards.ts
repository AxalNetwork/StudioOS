/**
 * D656 (#1469) — the read every cycle shares, its types and its card states.
 *
 * Validate (D659, #1472) and Grow (D664, #1477) each reached this file before
 * the other had merged. This is the union of the two, and every other cycle
 * (`routes/cycle_<cycle>.ts`) imports it rather than keeping a copy. Contract,
 * from #1469:
 *
 *   GET /api/cycles/:cycle/overview?project=:pid
 *     → { cycle, question, figures: [Figure ×4], cards: [Card ×6 or ×7] }
 *   GET /api/cycles/:cycle/modules/:slug?project=:pid&q=&filter=&sort=&page=
 *     → { module, card: Card, records: { cols, rows, total, page, page_size } }
 *
 * THE FIVE STATES, and what each one promises the screen:
 *
 *   ok            the series is drawn.
 *   empty         nothing is recorded yet. `next` is the one action that
 *                 starts it; no chart.
 *   too_little    fewer than THREE points. No line is drawn through two
 *                 points, because two points always make a trend.
 *   not_recorded  the source does not hold this value. `reason` says why.
 *                 The value is `null`, never 0.
 *   unreadable    the source failed. `reason` names the source. Only this
 *                 card is affected: `safeCard` and `settleCard` catch per card.
 *
 * `next` is the one action a card proposes, computed from its records.
 */

export const CARD_STATES = ['ok', 'empty', 'too_little', 'not_recorded', 'unreadable'] as const;
export type CardState = (typeof CARD_STATES)[number];

/** Fewer points than this is `too_little` (#1469: "fewer than three points"). */
export const MIN_POINTS = 3;
/** The same threshold, under the name Validate's read uses. */
export const MIN_SERIES_POINTS = MIN_POINTS;

export interface CardNext { text: string; href: string }
export type Next = CardNext | null;

export interface Figure {
  coverage?: { scored: number; total: number };
  key: string;
  label: string;
  /** `null` whenever the state is not `ok`. Never 0 for "missing". */
  value: number | string | null;
  unit: string;
  /** Change over the last 30 days; `null` when it cannot be computed. */
  delta_30d: number | null;
  spark: number[];
  state: CardState;
  source: string | null;
  as_of: string | null;
  reason?: string | null;
}

export interface Card {
  slug: string;
  name: string;
  state: CardState;
  range: string;
  caption: string;
  series: unknown;
  next: Next;
  reason: string | null;
  source?: string | null;
  as_of?: string | null;
}

export interface Records {
  cols: string[]; rows: Array<Record<string, unknown>>; total: number; page: number; page_size: number;
}

export type CardMeta = { slug: string; name: string; range: string; caption: string; source: string };

// ---------------------------------------------------------------------------
// One card at a time
// ---------------------------------------------------------------------------

/**
 * Run one card's read, and turn a thrown source into that card's `unreadable`.
 *
 * THE OVERVIEW MUST NOT FAIL AS A WHOLE because one store did. A missing
 * column on the competitor store is the competitor card's problem, not the
 * interview card's. So every card is computed through a wrapper and the route
 * awaits all of them. The error's own text is logged, never returned.
 */
export async function safeCard(meta: CardMeta, read: () => Promise<Omit<Card, 'slug' | 'name' | 'range' | 'caption'>>): Promise<Card> {
  try {
    const body = await read();
    return { slug: meta.slug, name: meta.name, range: meta.range, caption: meta.caption, ...body };
  } catch (e) {
    console.warn('[cycleCards] card unreadable:', meta.slug, (e as Error)?.message);
    return {
      slug: meta.slug,
      name: meta.name,
      range: meta.range,
      caption: meta.caption,
      state: 'unreadable',
      series: null,
      next: null,
      reason: `${meta.source} could not be read`,
    };
  }
}

/**
 * Grow's wrapper: the same rule, and the card may refine its own range and
 * caption. Its reason reads "Unreadable: <source> could not be read".
 */
export async function settleCard(meta: CardMeta,
  compute: () => Promise<Omit<Card, 'slug' | 'name' | 'caption'> & { caption?: string }>): Promise<Card> {
  try {
    const c = await compute();
    return { slug: meta.slug, name: meta.name, caption: c.caption ?? meta.caption, ...c, range: c.range ?? meta.range };
  } catch (e) {
    console.error('[cycleCards] card unreadable:', meta.slug, (e as Error).message);
    return {
      slug: meta.slug, name: meta.name, state: 'unreadable', range: meta.range, caption: meta.caption,
      series: null, next: null, reason: `Unreadable: ${meta.source} could not be read`,
    };
  }
}

/** The same for a figure: a failed source is `unreadable`, with its value null. */
export async function safeFigure(
  meta: { key: string; label: string; unit: string; source: string },
  read: () => Promise<Omit<Figure, 'key' | 'label' | 'unit' | 'source'> & { unit?: string }>,
): Promise<Figure> {
  try {
    const body = await read();
    // `unit` may be refined by the read ("of 7"); the rest of the meta is fixed.
    return { key: meta.key, label: meta.label, unit: meta.unit, source: meta.source, ...body };
  } catch (e) {
    console.warn('[cycleCards] figure unreadable:', meta.key, (e as Error)?.message);
    return {
      key: meta.key, label: meta.label, unit: meta.unit, source: meta.source,
      value: null, delta_30d: null, spark: [], state: 'unreadable', as_of: null,
      reason: `${meta.source} could not be read`,
    };
  }
}

/** A figure nothing records: null, never 0. */
export function notRecordedFigure(key: string, label: string, unit: string, reason: string): Figure {
  return { key, label, value: null, unit, delta_30d: null, spark: [], state: 'not_recorded', source: null, as_of: null, reason };
}

/** A recorded figure: `too_little` when its sparkline has fewer than three points (the figure still shows). */
export function figure(f: Omit<Figure, 'state'>): Figure {
  return { ...f, state: f.spark.length < MIN_POINTS ? 'too_little' : 'ok' };
}

// ---------------------------------------------------------------------------
// States from counts
// ---------------------------------------------------------------------------

/**
 * The state a series earns by its recorded points: `empty` with none,
 * `too_little` under `MIN_POINTS`, else `ok`.
 *
 * Takes either the number of recorded points (Grow) or the series itself
 * (Validate). A series counts only its finite, positive points, because a
 * row of zero-height bars is not a chart of anything.
 */
export function seriesState(points: number | number[]): CardState {
  const n = Array.isArray(points)
    ? points.filter((p) => Number.isFinite(p) && p > 0).length
    : points;
  if (n <= 0) return 'empty';
  return n < MIN_POINTS ? 'too_little' : 'ok';
}

/**
 * The state a count of records earns: `empty` at none, `too_little` under the
 * minimum, else `ok`. For cards whose chart is one bar or one segment per
 * record (themes, segments, hypotheses) rather than a line over time.
 */
export function countState(n: number, min: number = MIN_POINTS): CardState {
  if (n <= 0) return 'empty';
  if (n < min) return 'too_little';
  return 'ok';
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** The house page size. */
export const PAGE_SIZE = 25;

/** A requested page number, clamped to 1 … 10 000. */
export function pageNumber(raw: unknown): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 10_000) : 1;
}

/** Page a list the house way: 25 by default, 100 at most. */
export function pageOf<T>(rows: T[], pageRaw: unknown, sizeRaw: unknown = PAGE_SIZE): { rows: T[]; total: number; page: number; page_size: number } {
  const size = Math.min(100, Math.max(1, Number.parseInt(String(sizeRaw), 10) || PAGE_SIZE));
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(pages, Math.max(1, Number.parseInt(String(pageRaw), 10) || 1));
  return { rows: rows.slice((page - 1) * size, page * size), total, page, page_size: size };
}
