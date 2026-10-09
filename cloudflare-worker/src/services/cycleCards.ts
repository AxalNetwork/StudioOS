/**
 * D656 (#1469) — the read every cycle shares, its types and its card states.
 *
 * Created by D664 (#1477, Grow), the first cycle task to reach it; the other
 * cycles (`routes/cycle_<cycle>.ts`) import it. Contract, from #1469:
 *
 *   GET /api/cycles/:cycle/overview?project=:pid
 *     → { cycle, question, figures: [Figure ×4], cards: [Card ×6 or ×7] }
 *   GET /api/cycles/:cycle/modules/:slug?project=:pid&q=&filter=&sort=&page=
 *     → { module, card: Card, records: { cols, rows, total, page, page_size } }
 *
 * THE RULES THIS FILE HOLDS
 *   - Each card is computed on its own (`settleCard`): a failing source makes
 *     that card `unreadable`, naming the source, and leaves the others alone.
 *   - A value the store does not hold is null, `not_recorded`, with a reason —
 *     never 0.
 *   - `too_little` is fewer than three points: no line is drawn through two.
 *   - `next` is the one action a card proposes, computed from its records.
 */

export const CARD_STATES = ['ok', 'empty', 'too_little', 'not_recorded', 'unreadable'] as const;
export type CardState = typeof CARD_STATES[number];

/** Fewer points than this is `too_little`. */
export const MIN_POINTS = 3;

export interface Figure {
  key: string; label: string; value: number | null; unit: string;
  delta_30d: number | null; spark: number[]; state: CardState;
  source: string | null; as_of: string | null; reason?: string | null;
}

export interface CardNext { text: string; href: string }

export interface Card {
  slug: string; name: string; state: CardState; range: string; caption: string;
  series: unknown; next: CardNext | null; reason: string | null;
  source?: string | null; as_of?: string | null;
}

export interface Records {
  cols: string[]; rows: Array<Record<string, unknown>>; total: number; page: number; page_size: number;
}

/** A figure nothing records: null, never 0. */
export function notRecordedFigure(key: string, label: string, unit: string, reason: string): Figure {
  return { key, label, value: null, unit, delta_30d: null, spark: [], state: 'not_recorded', source: null, as_of: null, reason };
}

/** A recorded figure: `too_little` when its sparkline has fewer than three points (the figure still shows). */
export function figure(f: Omit<Figure, 'state'>): Figure {
  return { ...f, state: f.spark.length < MIN_POINTS ? 'too_little' : 'ok' };
}

/** The state a series of points earns: empty, too little, or ok. */
export function seriesState(points: number): CardState {
  if (points === 0) return 'empty';
  return points < MIN_POINTS ? 'too_little' : 'ok';
}

/**
 * Compute one card on its own. A thrown read becomes `unreadable`, naming the
 * source; it never empties the card or touches another one. The error's own
 * text is logged, never returned.
 */
export async function settleCard(meta: { slug: string; name: string; range: string; caption: string; source: string },
  compute: () => Promise<Omit<Card, 'slug' | 'name' | 'caption'> & { caption?: string }>): Promise<Card> {
  try {
    const c = await compute();
    return { slug: meta.slug, name: meta.name, caption: c.caption ?? meta.caption, ...c, range: c.range ?? meta.range };
  } catch (e) {
    console.error(`[cycleCards] ${meta.slug} unreadable:`, (e as Error).message);
    return {
      slug: meta.slug, name: meta.name, state: 'unreadable', range: meta.range, caption: meta.caption,
      series: null, next: null, reason: `Unreadable: ${meta.source} could not be read`,
    };
  }
}

/** Page a list the house way: 25 by default, 100 at most. */
export function pageOf<T>(rows: T[], pageRaw: unknown, sizeRaw: unknown = 25): { rows: T[]; total: number; page: number; page_size: number } {
  const size = Math.min(100, Math.max(1, Number.parseInt(String(sizeRaw), 10) || 25));
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(pages, Math.max(1, Number.parseInt(String(pageRaw), 10) || 1));
  return { rows: rows.slice((page - 1) * size, page * size), total, page, page_size: size };
}
