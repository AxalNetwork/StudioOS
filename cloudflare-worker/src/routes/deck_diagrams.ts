/**
 * D1542 (#3780, deck v2 B4) — a diagram on a card, checked in code: the route
 * the editor's canvas reads when a founder edits a diagram's nodes, mounted at
 * `/api/decks` beside the other deck routes.
 *
 *   POST /api/decks/:id/diagrams/check   { diagram, grid, card? }
 *        → { diagram, type, fits, problems: [{ kind, message }], figures, steps: { min, max } }
 *
 * Free: no model runs and nothing is saved. `diagram` is the stored diagram as
 * it would be saved (`diagramModel.sanitizeDiagram`), or null with a problem
 * when it is not one; `problems` are `fitProblems` and every node's own box
 * (`gridDiagram.diagramFit`) at the deck's aspect, so an edit that would
 * overflow says so before Save; `figures` are the numbers the founder's own
 * labels name (a diagram's labels are words, D898 §8.4), shown, never removed
 * from their words.
 *
 * GENERATING a diagram is not here: the `grid_diagram` job runs through
 * Generate into areas (`deck_areas.ts`, D1512), one quote and one hold, and
 * arrives as a proposal nothing places until Accept.
 *
 * Who: whoever may read the deck (`deckOf`, read). A deck the member may not
 * read is 404. All SQL is bound.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import type { RouteMount } from '../util/routeRegistry';
import decks, { getDeckRow, themeOfRow } from './decks';
import { deckOf } from './deck_element_models';
import { diagramProblem, sanitizeDiagram } from '../services/decks/diagramModel';
import { diagramFit, stepsFor } from '../services/decks/gridDiagram';
import { numberIn } from '../services/decks/newDeck';
import { GRID_COLS, GRID_ROWS, type Grid } from '../services/decks/slideModel';
import { aspectOf } from '../services/decks/structures';

const deckDiagrams = new Hono<{ Bindings: Env }>();

function gridOf(v: any): Grid | null {
  const g = { c1: Number(v?.c1), c2: Number(v?.c2), r1: Number(v?.r1), r2: Number(v?.r2) };
  if (![g.c1, g.c2, g.r1, g.r2].every(Number.isInteger)) return null;
  return g.c1 >= 1 && g.c1 <= g.c2 && g.c2 <= GRID_COLS && g.r1 >= 1 && g.r1 <= g.r2 && g.r2 <= GRID_ROWS ? g : null;
}

deckDiagrams.post('/:id{[0-9]+}/diagrams/check', async (c) => {
  const user = await requireAuth(c);
  const deck = await deckOf(c, user, false);
  if (deck instanceof Response) return deck;
  const body = await c.req.json().catch(() => null) as any;
  const grid = gridOf(body?.grid);
  if (!grid) return refuse(c, 400, { code: 'invalid_grid', message: 'Name the area the diagram sits in: its columns and rows on the Grid.' });
  const card = Number.isSafeInteger(body?.card) && body.card >= 0 ? Number(body.card) : 0;
  let aspect = aspectOf('16:9');
  try { aspect = aspectOf(themeOfRow(await getDeckRow(c.env, deck.deckId))?.aspect); } catch { aspect = aspectOf('16:9'); }
  const diagram = sanitizeDiagram(body?.diagram);
  if (!diagram) {
    const why = diagramProblem(body?.diagram) ?? 'this is not a diagram.';
    return c.json({ diagram: null, type: null, fits: false, problems: [{ kind: 'not_a_diagram', message: `The diagram cannot be drawn: ${why}` }], figures: [], steps: null });
  }
  const problems = diagramFit(diagram, grid, aspect, card).map((p) => ({ kind: p.kind, message: p.message }));
  const words = [...diagram.items.flatMap((it) => [it.label, it.detail ?? '']), diagram.axes?.x ?? '', diagram.axes?.y ?? ''];
  const figures = [...new Set(words.map((t) => numberIn(t)).filter((x): x is string => Boolean(x)))];
  return c.json({ diagram, type: diagram.type, fits: problems.length === 0, problems, figures, steps: stepsFor(diagram.type, grid) });
});

export default deckDiagrams;

export const mount: RouteMount = { path: '/api/decks', router: deckDiagrams, before: [decks] };
