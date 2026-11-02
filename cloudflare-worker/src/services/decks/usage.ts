/**
 * D1524 (#3776, deck v2 A25) — the AIRail's plain usage meter for one deck:
 * what the deck is estimated to cost, what has been spent on it, and the
 * per-run prices the "about [40] text areas or [12] images" line divides the
 * balance by.
 *
 * ESTIMATED is #3754's `estimateDeck`, never a second pricing path. Its counts
 * are the areas the deck's cards hold, each mapped to the grid element that
 * fills it (`deckCounts`):
 *   a title band or the card's title   → title
 *   a text block, or an area left empty → body
 *   chart / table / graphic             → chart / table / flow
 *   an image block                      → photo
 *   the card's speaker notes            → speaker_notes
 * A metric, video, audio or link block runs no model and is not counted. Each
 * element runs on the model `elementModelFor` resolves for this deck and
 * member, at the member's multiplier. A line that cannot be priced makes the
 * total null, never 0.
 *
 * SPENT is the ledger: the sum of `ai_usage_logs.charged_microusd` over the
 * runs recorded against this venture's deck (`record_ref` `deck:<id>` for any
 * of its versions, or `project:<id>` on the Pitch deck rail page), with their
 * guard rows. A row whose charge is not recorded makes the sum unknown, not
 * smaller.
 *
 * Read only: nothing here runs a model or writes a row.
 */
import type { Env } from '../../types';
import { areasOf } from './structures';
import { estimateDeck, isRouted, type Estimate } from './elementModels';

export const PITCH_PAGE = 'Founder · Raise · Pitch deck';
/** The element a text area and a picture are priced at, for the plain-units line. */
export const TEXT_UNIT = 'body';
export const IMAGE_UNIT = 'photo';

export type Money = { available: true; value_microusd: number } | { available: false; reason: string };

const BLOCK_ELEMENT: Record<string, string | null> = {
  text: 'body', chart: 'chart', table: 'table', graphic: 'flow', image: 'photo',
  metric: null, video: null, audio: null, link: null,
};

const inside = (g: any, a: any) => g && a && g.c1 >= a.c1 && g.c2 <= a.c2 && g.r1 >= a.r1 && g.r2 <= a.r2;

/** How many of each grid element the deck's cards place. */
export function deckCounts(slides: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  const add = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
  for (const card of Array.isArray(slides) ? slides : []) {
    const { areas } = areasOf(card);
    const blocks: any[] = Array.isArray((card as any)?.blocks) ? (card as any).blocks : [];
    let titled = false;
    for (const area of areas) {
      if (area.role === 'title') { add('title'); titled = true; continue; }
      const held = blocks.filter((b) => inside(b?.grid, area));
      if (!held.length) { add('body'); continue; }
      for (const b of held) {
        const el = BLOCK_ELEMENT[String(b?.kind)] ?? null;
        if (el) add(el);
      }
    }
    if (!titled && typeof (card as any)?.title === 'string' && (card as any).title.trim()) add('title');
    if (typeof (card as any)?.notes === 'string' && (card as any).notes.trim()) add('speaker_notes');
  }
  return counts;
}

/** The deck's estimate: `estimateDeck` over `deckCounts`, each element on the model given. */
export function deckEstimate(slides: unknown, models: Readonly<Record<string, string | null>>, multiplier: number): Estimate {
  return estimateDeck(deckCounts(slides), models, multiplier);
}

/** The routed elements a deck's estimate needs a model for, plus the two the units line prices. */
export function elementsToResolve(slides: unknown): string[] {
  return [...new Set([...Object.keys(deckCounts(slides)), TEXT_UNIT, IMAGE_UNIT])].filter(isRouted);
}

/** What has been charged on this venture's deck, from the ledger; unknown when any run's charge is not recorded. */
export async function deckSpend(env: Env, projectId: number): Promise<Money & { runs?: number }> {
  try {
    const row = await env.DB.prepare(
      `WITH runs AS (
         SELECT id FROM ai_usage_logs
          WHERE (record_ref IN (SELECT 'deck:' || id FROM pitch_decks WHERE project_id = ?1))
             OR (record_ref = ?3 AND rail_page = ?2)
       )
       SELECT COUNT(*) AS n,
              SUM(charged_microusd) AS charged,
              SUM(CASE WHEN charged_microusd IS NULL THEN 1 ELSE 0 END) AS unrecorded
         FROM ai_usage_logs
        WHERE id IN (SELECT id FROM runs) OR guard_for IN (SELECT id FROM runs)`,
    ).bind(projectId, PITCH_PAGE, `project:${projectId}`).first<{ n: number; charged: number | null; unrecorded: number | null }>();
    if (!row) return { available: false, reason: 'Could not be read' };
    if (Number(row.unrecorded) > 0) return { available: false, reason: 'Could not be read' };
    return { available: true, value_microusd: Number(row.n) ? Number(row.charged ?? 0) : 0, runs: Number(row.n) };
  } catch {
    return { available: false, reason: 'Could not be read' };
  }
}
