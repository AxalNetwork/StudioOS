/**
 * D4359 (#4359, #2434 Q8 = A) — `GET /api/decks/access`: may this member use
 * the Pitch deck studio.
 *
 *   GET /api/decks/access → { open, required: 'studio', plan: { tier, name, plan_key }, message }
 *
 * The answer is `services/decks/studioAccess.ts` `deckStudioAccess`, the same
 * rule the Worker's own deck gates apply (`DECK_STUDIO_TIER`), so the studio's
 * pages draw it open exactly when the Worker would serve it and locked, with
 * the plan to upgrade to, when it would refuse. It reads only the signed-in
 * member. Mounted before `decks.ts`, whose `GET /:id` would otherwise take
 * `/access`.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import decks from './decks';
import type { RouteMount } from '../util/routeRegistry';
import { deckStudioAccess } from '../services/decks/studioAccess';

const deckAccess = new Hono<{ Bindings: Env }>();

deckAccess.get('/access', async (c) => c.json(deckStudioAccess(await requireAuth(c))));

export default deckAccess;

export const mount: RouteMount = { path: '/api/decks', router: deckAccess, before: [decks] };
