/**
 * #4715 (D4715) — Engagements: the contract behind the sessions, its lanes, renewals and corrections (migration 238).
 *
 * Split out of routes/advisors.ts, which mounts it at the place these routes
 * held there (`advisors.route('/', …)`), so the paths and their order under
 * /api/advisors and /api/mentors are unchanged. Shared rows, checks and money
 * helpers come from services/advisorPractice.ts.
 */
import { Hono } from 'hono';
import { PracticeRefusal } from '../services/practiceRefusal';
import { createEngagement, correctEngagement, advanceEngagement, renewEngagement, engagementPage, engagementHistory } from '../services/advisorEngagements';
export { ENGAGEMENT_LANES, ENGAGEMENT_SHAPES, ENGAGEMENT_END_REASONS, ENGAGEMENT_GRAPH, ENGAGEMENT_TERMS, termChanges } from '../services/advisorEngagements';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { pageWindow } from '../services/listPage';
import {
  PRACTICE_PAGE, requireMyAdvisor, requireOwnEngagement,
} from '../services/advisorPractice';

const advisors = new Hono<{ Bindings: Env }>();


advisors.get('/me/engagements', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    return c.json(await engagementPage(c.env, m.id, pageWindow(c.req.query(), PRACTICE_PAGE)));
  } catch (e) {
    if (e instanceof PracticeRefusal) return c.json(e.body, e.status);
    return mapError(c, e);
  }
});

advisors.post('/me/engagements', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const body = await c.req.json().catch(() => ({} as any));
    return c.json(await createEngagement(c.env, user, m, body), 201);
  } catch (e) {
    if (e instanceof PracticeRefusal) return c.json(e.body, e.status);
    return mapError(c, e);
  }
});

// PATCH — the descriptive columns only. `lane`, `cycles` and `outcome` are
// absent by design; see the block comment above.
advisors.patch('/me/engagements/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await requireOwnEngagement(c, m.id, Number(c.req.param('id')));
    const body = await c.req.json().catch(() => ({} as any));
    return c.json(await correctEngagement(c.env, user, m, row, body));
  } catch (e) {
    if (e instanceof PracticeRefusal) return c.json(e.body, e.status);
    return mapError(c, e);
  }
});

/**
 * POST /me/engagements/:id/advance — move a card between lanes.
 *
 * A CONTROL RATHER THAN A DRAG, and the divergence is deliberate. The canvas
 * labels the board "By contract state · drag to advance"; a per-card control
 * is keyboard-reachable without a drag-and-drop implementation to make
 * accessible, and the state change it writes is identical.
 */
advisors.post('/me/engagements/:id/advance', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await requireOwnEngagement(c, m.id, Number(c.req.param('id')));
    const body = await c.req.json().catch(() => ({} as any));
    return c.json(await advanceEngagement(c.env, user, m, row, body));
  } catch (e) {
    if (e instanceof PracticeRefusal) return c.json(e.body, e.status);
    return mapError(c, e);
  }
});

/**
 * POST /me/engagements/:id/renewal — record the decision the practice is
 * judged on.
 *
 * This is the only writer of `outcome` after signing and the only thing that
 * moves `cycles` past 1, which is what makes the renewal rate mean something.
 * It refuses an unsigned row rather than inventing a decision for it.
 */
advisors.post('/me/engagements/:id/renewal', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await requireOwnEngagement(c, m.id, Number(c.req.param('id')));
    const body = await c.req.json().catch(() => ({} as any));
    return c.json(await renewEngagement(c.env, user, m, row, body));
  } catch (e) {
    if (e instanceof PracticeRefusal) return c.json(e.body, e.status);
    return mapError(c, e);
  }
});

// GET /me/engagements/:id/events — D4695: the renewal history, oldest first. Engagements decided before the events
// existed have none; that is "not recorded", not "no decisions".
advisors.get('/me/engagements/:id/events', async (c) => {
  try {
    const user = await requireAuth(c);
    const m = await requireMyAdvisor(c, user);
    const row = await requireOwnEngagement(c, m.id, Number(c.req.param('id')));
    return c.json(await engagementHistory(c.env, row.id, pageWindow(c.req.query(), PRACTICE_PAGE)));
  } catch (e) {
    if (e instanceof PracticeRefusal) return c.json(e.body, e.status);
    return mapError(c, e);
  }
});

export default advisors;
