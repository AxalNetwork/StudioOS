/**
 * /api/ai/rail/proposals — the member's own drafts, proposals and notes from a
 * rail option's run, and their press on each (D780, #2105; D720 §9).
 *
 * Two routes, both the caller's own rows only (`services/railProposals.ts`
 * binds `user_id` on every read and write):
 *   GET  /?option=<key>&record=<type:id>&status=proposed   newest first
 *   POST /:uid/decide  { decision: 'accept' | 'edit' | 'discard', payload? }
 *
 * Deciding keeps or throws away the proposal. It writes no record: the page's
 * own Save does, through the record's own route.
 *
 * ONE AT A TIME (D777 part 3). A placement is decided by its own uid; there is
 * no bulk decision. Keeping one for a field Eadwyn never fills is refused 422
 * `{ refusal: 'never_fill' }` with the registry's sentence, and nothing is kept.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { neverFillMessage } from '../services/fills/neverFill';
import { NeverFillRefusal, decideRail, listRail, type RailDecision, type RailProposalStatus } from '../services/railProposals';

const r = new Hono<{ Bindings: Env }>();

const STATUSES: readonly RailProposalStatus[] = ['proposed', 'accepted', 'edited', 'discarded', 'withdrawn'];
const DECISIONS: readonly RailDecision[] = ['accept', 'edit', 'discard'];

r.get('/', async (c) => {
  const user = await requireAuth(c);
  const option = String(c.req.query('option') || '');
  if (!option) return c.json({ error: 'option_required' }, 400);
  const status = c.req.query('status');
  if (status && !STATUSES.includes(status as RailProposalStatus)) return c.json({ error: 'invalid_status' }, 400);
  const proposals = await listRail(c.env, user.id, {
    option, record: c.req.query('record') ?? null, status: (status as RailProposalStatus) || null,
  });
  return c.json({ proposals });
});

r.post('/:uid/decide', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const decision = String(body?.decision || '') as RailDecision;
  if (!DECISIONS.includes(decision)) return c.json({ error: 'invalid_decision' }, 400);
  const payload = body?.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : null;
  if (decision === 'edit' && !payload) return c.json({ error: 'payload_required' }, 400);
  let decided;
  try {
    decided = await decideRail(c.env, user.id, c.req.param('uid'), decision, payload);
  } catch (e) {
    if (e instanceof NeverFillRefusal) {
      return c.json({ error: 'never_fill', refusal: 'never_fill', message: neverFillMessage(e.field), field: e.field, discarded: e.discarded }, 422);
    }
    throw e;
  }
  if (!decided) return c.json({ error: 'not_open', message: 'That proposal is not yours, or it has already been decided.' }, 409);
  return c.json({ proposal: decided });
});

export default r;
