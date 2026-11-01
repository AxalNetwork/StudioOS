/**
 * D1522 (#3774, deck v2 A23) — `GET /api/decks/:id/stage-plan`: the order an
 * investor at the deck's stage reads it in, a "why this order" line per card,
 * and the missing-proof warnings ("Seed deck with no traction slide").
 *
 * Query: `stage` (pre_seed, seed, series_a, series_b_plus) and
 * `investor_type` (an audience), both optional. With no stage the deck's
 * audience, then the venture's stage, decides; `stage_source` says which.
 *
 * Pure records, no model and no charge: the plan is `services/decks/stagePlan.ts`'s
 * `stagePlan`, which the one-click run calls too. Bank-derived sources are read
 * only for the venture's founder (`mercuryFor`); for anyone else they are
 * withheld and the proof they would give reads "unchecked", never missing.
 *
 * Who: whoever may read the deck (`projectOwned`, the rule `GET /:id` uses).
 * Writes nothing.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { ensureSchema, getDeckRow, rowToDeck } from './decks';
import { mercuryFor } from './deck_sources';
import { stagePlan } from '../services/decks/stagePlan';
import { stageFrom } from '../services/narrative/arcs';
import { AUDIENCES } from '../services/decks/slideModel';

const deckStage = new Hono<{ Bindings: Env }>();
const today = () => new Date().toISOString().slice(0, 10);

deckStage.get('/:id{[0-9]+}/stage-plan', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  const askedStage = c.req.query('stage');
  if (askedStage != null && askedStage !== '' && !stageFrom(askedStage)) return c.json({ error: 'stage must be one of pre_seed, seed, series_a, series_b_plus' }, 400);
  const investor = c.req.query('investor_type');
  if (investor != null && investor !== '' && !(AUDIENCES as readonly string[]).includes(investor)) return c.json({ error: `investor_type must be one of ${AUDIENCES.join(', ')}` }, 400);
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, id); } catch { return c.json({ error: 'not found' }, 404); }
  let project: any;
  try { project = await projectOwned(c, user, Number(row.project_id)); } catch { return c.json({ error: 'forbidden' }, 403); }
  const deck = rowToDeck(row);
  const plan = await stagePlan(c.env, {
    projectId: Number(row.project_id), slides: deck.slides, audience: deck.audience,
    stage: askedStage || null, investorType: investor || null,
    mercury: await mercuryFor(c, user, project ?? { founder_id: null, company_id: null }), today: today(),
  });
  return c.json({ deck_id: deck.id, version: deck.version, ...plan });
});

export default deckStage;
