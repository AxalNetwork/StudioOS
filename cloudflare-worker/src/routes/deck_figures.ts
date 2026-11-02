/**
 * D1523 (#3775, deck v2 A24) — the provenance of every figure on a deck version.
 *
 *   GET /api/decks/:id/figures
 *       → { deck_id, figures: [Figure], counts: { linked, stated, uncited, not_recorded } }
 *
 * `Figure` is `services/decks/figures.ts`'s: the card, the block, the state
 * (linked, stated, uncited or not_recorded) and, for a linked figure, its
 * slot, record, as of and grade. A missing figure is `not_recorded`, never 0.
 *
 * Who: whoever may read the deck (`projectOwned`, as `/:id/typed-values`).
 * The editor draws these badges; Present, share links and exports never call
 * this route, so a deck an investor sees carries no editor mark. Reads only.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { ensureSchema, getDeckRow } from './decks';
import { figuresOf } from '../services/decks/figures';

const r = new Hono<{ Bindings: Env }>();

r.get('/:id{[0-9]+}/figures', async (c) => {
  const user = await requireAuth(c);
  const deckId = Number(c.req.param('id'));
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, deckId); } catch { return c.json({ error: 'not found' }, 404); }
  try { await projectOwned(c, user, Number(row.project_id), {}); } catch { return c.json({ error: 'forbidden' }, 403); }
  let slides: unknown = [];
  try { slides = typeof row.slides === 'string' ? JSON.parse(row.slides || '[]') : row.slides; } catch { slides = []; }
  const { figures, counts } = figuresOf(slides, Number(row.project_id));
  return c.json({ deck_id: deckId, figures, counts });
});

export default r;
