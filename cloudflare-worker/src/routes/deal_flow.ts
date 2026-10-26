import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { investorActiveCompany } from './_investorProjectScope';
import { mapError } from './_t13t14t15_helpers';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
import { refuse } from '../util/refusal';
import { FlowError, addToFlow, dismissItem, flowEvents, inboxItems, passDeal, readFlow, scopeFor, updateFlow } from '../services/dealFlow';

/**
 * D1238 (#3251, part 2 of #2423) — an investor firm's own deal flow, at
 * /api/deals/flow (migration 618). Mounted before `dealContext` and `deals`,
 * so `flow` is never read as a deal id. The Professional gate on /api/deals/*
 * (`requireInvestorTierExcept`, index.ts) covers it unchanged.
 *
 *   GET    /                       the flow, every stage, with days in stage
 *   POST   /                       add a deal { deal_id, stage?, owner_user_id?, via_key? }
 *   PATCH  /:dealId                move, change the owner, write the note
 *   POST   /:dealId/pass           { reason, revisit?, revisit_at?, note?, via_key? }
 *   GET    /:dealId/events         what happened to it
 *   GET    /inbox                  New for you: deals not yet in the flow
 *   POST   /inbox/:key/dismiss     "Not for me" { reason? }
 *
 * An Investor's only: another role is refused, and another firm's rows are
 * never read. Nothing here writes `deals.status` or opens a deal.
 */
type Ctx = Context<{ Bindings: Env }>;
const routes = new Hono<{ Bindings: Env }>();

async function scope(c: Ctx) {
  const user = await requireAuth(c) as User;
  if (user.role !== 'investor') throw new FlowError('investor_required', 403, 'Deal flow is an investor’s own.');
  return scopeFor(user, await investorActiveCompany(c, user));
}
async function body(c: Ctx): Promise<Record<string, unknown>> {
  let v: unknown;
  try { v = await c.req.json(); } catch { v = {}; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new FlowError('invalid_request', 400, 'The request could not be read.');
  return v as Record<string, unknown>;
}
function dealId(c: Ctx): number {
  const raw = c.req.param('dealId') || '';
  if (!/^\d{1,12}$/.test(raw)) throw new FlowError('not_in_flow', 404, 'This deal is not in your deal flow.');
  return Number(raw);
}
function failure(c: Ctx, e: unknown) {
  if (e instanceof FlowError) return refuse(c, e.status, { code: e.code, message: e.sentence, extra: { code: e.code } });
  const message = e instanceof Error ? e.message : '';
  if (AUTH_ERROR_STATUSES[message]) return mapError(c, e);
  console.error('[deal-flow] unreadable');
  return c.json({ error: 'Your deal flow could not be read. Try again.', code: 'deal_flow_unreadable' }, 503);
}

// Literal paths first: `/inbox` must not be read as a deal id.
routes.get('/inbox', async (c) => { try { return c.json(await inboxItems(c.env, await scope(c))); } catch (e) { return failure(c, e); } });
routes.post('/inbox/:key/dismiss', async (c) => {
  try { const s = await scope(c); return c.json(await dismissItem(c.env, s, c.req.param('key') || '', await body(c))); } catch (e) { return failure(c, e); }
});
routes.get('/', async (c) => { try { return c.json(await readFlow(c.env, await scope(c))); } catch (e) { return failure(c, e); } });
routes.post('/', async (c) => { try { const s = await scope(c); return c.json(await addToFlow(c.env, s, await body(c)), 201); } catch (e) { return failure(c, e); } });
routes.patch('/:dealId', async (c) => { try { const s = await scope(c); return c.json(await updateFlow(c.env, s, dealId(c), await body(c))); } catch (e) { return failure(c, e); } });
routes.post('/:dealId/pass', async (c) => { try { const s = await scope(c); return c.json(await passDeal(c.env, s, dealId(c), await body(c))); } catch (e) { return failure(c, e); } });
routes.get('/:dealId/events', async (c) => { try { const s = await scope(c); return c.json(await flowEvents(c.env, s, dealId(c))); } catch (e) { return failure(c, e); } });

export default routes;
