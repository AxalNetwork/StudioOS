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
 * Who: whoever may read the deck (`projectOwned`, the rule `GET /:id` uses).
 * Writes nothing.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { ensureSchema, getDeckRow, rowToDeck } from './decks';
import { GRID_COLS, GRID_ROWS } from '../services/decks/slideModel';
import { BASELINE, FRAME, SLIDE_SIZES, STRUCTURES, areasOf, aspectOf, boxOfAt, cellAt } from '../services/decks/structures';

const deckGrid = new Hono<{ Bindings: Env }>();

deckGrid.get('/:id{[0-9]+}/grid', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
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
  });
});

export default deckGrid;
