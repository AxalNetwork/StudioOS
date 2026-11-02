/**
 * D1553 (#3800, deck v2 C5) — `POST /api/decks/:id/remix`: four layouts for
 * one card, and pd5's remove-a-block reflow.
 *
 * Body: `{ card, remove? }`. `card` is the card as the editor holds it (its
 * unsaved edits included), sanitised as a save would be. With `remove` (a
 * block id) the block is removed first and the rest reflows inside the grid.
 * Answers `{ deck_id, current, card, options: [{ structure, label, line, card }] }`.
 *
 * Deterministic and free: no model, no hold, no charge and no AI switch, so it
 * answers with AI paused (pd9e). It writes nothing: "Use this layout" applies
 * the option in the editor, held until the founder saves a version.
 *
 * Who: whoever may read the deck (`projectOwned`, as `GET /:id`); the editor
 * offers it only to someone who may write.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { ensureSchema, getDeckRow, sanitizeImageUrl } from './decks';
import { sanitizeModel } from '../services/decks/slideModel';
import { areasOf } from '../services/decks/structures';
import { remixOptions, removeBlock } from '../services/decks/remix';

const deckRemix = new Hono<{ Bindings: Env }>();

deckRemix.post('/:id{[0-9]+}/remix', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => null) as { card?: unknown; remove?: unknown } | null;
  if (!body || !body.card || typeof body.card !== 'object' || Array.isArray(body.card)) return c.json({ error: 'card must be the card to remix' }, 400);
  if (body.remove != null && (typeof body.remove !== 'string' || !body.remove)) return c.json({ error: 'remove must be a block id' }, 400);
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, id); } catch { return c.json({ error: 'not found' }, 404); }
  try { await projectOwned(c, user, Number(row.project_id)); } catch { return c.json({ error: 'forbidden' }, 403); }
  const raw = body.card as Record<string, unknown>;
  let card: any = { ...raw, ...sanitizeModel(raw, sanitizeImageUrl) };
  if (!Array.isArray(card.blocks) || !card.blocks.length) return c.json({ error: 'This card has no blocks to lay out.' }, 400);
  if (typeof body.remove === 'string') {
    const next = removeBlock(card, body.remove);
    if (!next) return c.json({ error: 'That block is not on this card.' }, 400);
    card = next;
  }
  return c.json({ deck_id: Number(row.id), current: areasOf(card).structure, card, options: remixOptions(card) });
});

export default deckRemix;
