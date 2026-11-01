/**
 * D1499 (#3749, deck v2 A2) — `GET /api/decks/:id/grid`: The Grid of one
 * deck version, read.
 *
 * Answers the geometry every reader places areas from (the slide at the
 * deck's aspect, the safe frame, one cell, the 8 px baseline), the 17
 * structures of the catalogue, and each card's structure and areas: its own
 * when it has sound ones, else derived from its blocks (`derived: true`), so
 * a deck saved before v2 reads unchanged. Every area carries its box in
 * slide pixels from `boxOfAt`, the one geometry the editor, Present and print
 * share.
 *
 * D1554 (#3801, C6): `?aspect=16:9|4:3` adds `reflow`, what a switch to that
 * aspect would move from the saved version into the speaker notes
 * (`services/decks/reflow.ts`: per block, and the count pd3c's notice reads),
 * and `reflow_map`, each structure's areas at both aspects. Any other value
 * is 400 `invalid_aspect`. The aspect itself is written with the version's
 * theme, as #3749 decided; the editor runs the same reflow on its draft.
 *
 * Who: whoever may read the deck (`projectOwned`, the rule `GET /:id` uses).
 * Writes nothing.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { ensureSchema, getDeckRow, rowToDeck } from './decks';
import { GRID_COLS, GRID_ROWS } from '../services/decks/slideModel';
import { ASPECTS, BASELINE, FRAME, SLIDE_SIZES, STRUCTURES, areasOf, aspectOf, boxOfAt, cellAt } from '../services/decks/structures';
import { reflowMap, reflowSlides } from '../services/decks/reflow';
import { refuse } from '../util/refusal';

const deckGrid = new Hono<{ Bindings: Env }>();

deckGrid.get('/:id{[0-9]+}/grid', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  const target = c.req.query('aspect');
  if (target !== undefined && !(ASPECTS as readonly string[]).includes(target)) {
    return refuse(c, 400, { code: 'invalid_aspect', message: 'The slide size is 16:9 or 4:3.' });
  }
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, id); } catch { return c.json({ error: 'not found' }, 404); }
  try { await projectOwned(c, user, Number(row.project_id)); } catch { return c.json({ error: 'forbidden' }, 403); }
  const deck = rowToDeck(row);
  const aspect = aspectOf(deck.theme?.aspect);
  const withBoxes = <T extends { c1: number; c2: number; r1: number; r2: number }>(list: T[]) => list.map((a) => ({ ...a, box: boxOfAt(a, aspect) }));
  return c.json({
    deck_id: deck.id,
    version: deck.version,
    aspect,
    slide: SLIDE_SIZES[aspect],
    frame: FRAME,
    cell: cellAt(aspect),
    baseline: BASELINE,
    grid: { cols: GRID_COLS, rows: GRID_ROWS },
    structures: STRUCTURES.map((s) => ({ ...s, areas: withBoxes(s.areas) })),
    cards: (Array.isArray(deck.slides) ? deck.slides : []).map((card: any, index: number) => {
      const { structure, areas, derived } = areasOf(card);
      return { index, structure, derived, areas: withBoxes(areas) };
    }),
    ...(target !== undefined ? (() => {
      const r = reflowSlides(deck.slides, target, aspect);
      return { reflow: { from: r.from, to: r.to, count: r.count, moved: r.moved }, reflow_map: reflowMap() };
    })() : {}),
  });
});

export default deckGrid;
