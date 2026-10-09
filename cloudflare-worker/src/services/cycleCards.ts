/**
 * D656 / D659 — the shape every cycle's overview and module read returns, and
 * the five states a card or a figure may be in.
 *
 * ONE FILE FOR THE FOUR CYCLES. Validate (#1472) created it; Build, Raise and
 * Grow (#1475–#1477) import it. A second copy of `CardState` in a sibling
 * route would be a second answer to "what does `too_little` mean", and the SPA
 * (#1474) draws one card component over all four.
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
 *                 card is affected: `safeCard` catches per card.
 */

export const CARD_STATES = ['ok', 'empty', 'too_little', 'not_recorded', 'unreadable'] as const;
export type CardState = (typeof CARD_STATES)[number];

/** Fewer points than this draws no line (#1469: "fewer than three points"). */
export const MIN_SERIES_POINTS = 3;

export type Next = { text: string; href: string } | null;

export type Figure = {
  key: string;
  label: string;
  /** `null` whenever the state is not `ok`. Never 0 for "missing". */
  value: number | string | null;
  unit: string;
  /** Change over the last 30 days; `null` when it cannot be computed. */
  delta_30d: number | null;
  spark: number[];
  state: CardState;
  source: string;
  as_of: string | null;
  reason?: string | null;
};

export type Card = {
  slug: string;
  name: string;
  state: CardState;
  range: string;
  caption: string;
  series: unknown;
  next: Next;
  reason: string | null;
};

export type CardMeta = { slug: string; name: string; range: string; caption: string; source: string };

/**
 * Run one card's read, and turn a thrown source into that card's `unreadable`.
 *
 * THE OVERVIEW MUST NOT FAIL AS A WHOLE because one store did. Six modules
 * read six different stores; a missing column on one of them is the
 * competitor card's problem, not the interview card's. So every card is
 * computed through this wrapper and the route awaits all of them.
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

/** The same for a figure: a failed source is `unreadable` with its value null. */
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

/**
 * The state a series earns by its length alone: `empty` with nothing in it,
 * `too_little` under `MIN_SERIES_POINTS`, else `ok`. A series of buckets that
 * are all zero is `empty` — a row of zero-height bars is not a chart of
 * anything.
 */
export function seriesState(points: number[]): CardState {
  const recorded = points.filter((p) => Number.isFinite(p) && p > 0).length;
  if (recorded === 0) return 'empty';
  if (recorded < MIN_SERIES_POINTS) return 'too_little';
  return 'ok';
}

/**
 * The state a count of records earns: `empty` at none, `too_little` under the
 * minimum, else `ok`. For cards whose chart is one bar or one segment per
 * record (themes, segments, hypotheses) rather than a line over time.
 */
export function countState(n: number, min: number = MIN_SERIES_POINTS): CardState {
  if (n <= 0) return 'empty';
  if (n < min) return 'too_little';
  return 'ok';
}

/** Pagination a module read accepts, clamped. */
export const PAGE_SIZE = 25;
export function pageOf(raw: unknown): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 10_000) : 1;
}
