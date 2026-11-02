/**
 * D1524 (#3776, deck v2 A25) — the plain usage meter for one deck.
 *
 *   GET /api/decks/:id/usage
 *       → { deck_id, project_id,
 *           estimated: { available: true, value_microusd, lines } | { available: false, reason },
 *           spent:     { available: true, value_microusd, runs } | { available: false, reason },
 *           units:     { text_area_microusd, image_microusd } }   (each null when it cannot be priced)
 *
 * `estimated` is #3754's `estimateDeck` over the deck's cards
 * (`services/decks/usage.ts`), on the models `elementModelFor` resolves for
 * this deck and member: the same quote lines `GET …/element-models` prices,
 * never a second pricing path. `spent` is the ledger's charges on this
 * venture's deck. A figure that cannot be read is `{ available: false,
 * reason: 'Could not be read' }`, never $0.00. `units` are the per-run prices
 * the rail's "about [40] text areas or [12] images" line divides the balance
 * (`/api/ai-budget/me`) by.
 *
 * Read only, and it runs no model. Who: the deck routes' `projectOwned`, read.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { getDeckRow, rowToDeck } from './decks';
import { elementModelFor } from './deck_element_models';
import { aiLicenceKey } from '../services/aiBudget';
import { multiplierFor } from '../services/ai/pricing';
import { estimateDeck } from '../services/decks/elementModels';
import { IMAGE_UNIT, TEXT_UNIT, deckEstimate, deckSpend, elementsToResolve } from '../services/decks/usage';

const deckUsage = new Hono<{ Bindings: Env }>();
const UNREAD = 'Could not be read';

deckUsage.get('/:id{[0-9]+}/usage', async (c) => {
  const user = (await requireAuth(c)) as User;
  const deckId = Number(c.req.param('id'));
  let row: any;
  try { row = await getDeckRow(c.env, deckId); } catch { return c.json({ error: 'not found' }, 404); }
  const projectId = Number(row.project_id);
  try { await projectOwned(c, user, projectId, { write: false }); } catch (e: any) {
    return e?.message === 'NotFound' ? c.json({ error: 'not found' }, 404) : c.json({ error: 'forbidden' }, 403);
  }
  const slides = rowToDeck(row).slides ?? [];
  const multiplier = multiplierFor(aiLicenceKey(user));
  let models: Record<string, string | null> | null = {};
  try {
    for (const el of elementsToResolve(slides)) models[el] = (await elementModelFor(c.env, user, projectId, el)).model;
  } catch { models = null; }
  const est = models ? deckEstimate(slides, models, multiplier) : null;
  const per = (el: string) => {
    if (!models?.[el]) return null;
    return estimateDeck({ [el]: 1 }, { [el]: models[el] }, multiplier).lines[0]?.per_microusd ?? null;
  };
  return c.json({
    deck_id: deckId, project_id: projectId,
    estimated: est && est.total_microusd != null ? { available: true, value_microusd: est.total_microusd, lines: est.lines } : { available: false, reason: UNREAD },
    spent: await deckSpend(c.env, projectId),
    units: { text_area_microusd: per(TEXT_UNIT), image_microusd: per(IMAGE_UNIT) },
  });
});

export default deckUsage;
