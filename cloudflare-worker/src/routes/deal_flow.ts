import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { investorActiveCompany } from './_investorProjectScope';
import { mapError } from './_t13t14t15_helpers';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
import { refuse } from '../util/refusal';
import { FlowError, addToFlow, dismissItem, flowEvents, inboxItems, passDeal, readFlow, scopeFor, updateFlow } from '../services/dealFlow';
import {
  NoteError, comparable, keepNote, newNotePayload, noteMaterial, notePrompt, parseIds, parseNote, receiptFor, savedNotes,
} from '../services/dealCompareNote';
import { run as runAI } from '../services/aiRouter';
import { storedScorecard } from '../services/ventureScoring/store';
import { AI_SURFACE } from '../services/aiSurfaces';
import { railFor, refuseRun } from '../util/railContext';

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
 * D1241 (#3254): Compare's Eadwyn note (`services/dealCompareNote.ts`).
 *   GET    /compare-note?ids=      the notes this investor saved for these ventures
 *   POST   /compare-note           { deal_ids } a draft from SCORING's bands, and its receipt; nothing is saved
 *   POST   /compare-note/keep      { receipt } Save to notes
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
/** The model runner and the stored scorecard, replaced in tests so no test reaches a provider. */
export const noteDeps = { run: runAI, scorecard: storedScorecard };

function failure(c: Ctx, e: unknown) {
  if (e instanceof NoteError) return refuse(c, e.status, { code: e.code, message: e.message, extra: { code: e.code } });
  if (e instanceof FlowError) return refuse(c, e.status, { code: e.code, message: e.sentence, extra: { code: e.code } });
  const message = e instanceof Error ? e.message : '';
  if (AUTH_ERROR_STATUSES[message]) return mapError(c, e);
  console.error('[deal-flow] unreadable');
  return c.json({ error: 'Your deal flow could not be read. Try again.', code: 'deal_flow_unreadable' }, 503);
}

// Literal paths first: `/inbox` and `/compare-note` must not be read as a deal id.
routes.get('/compare-note', async (c) => {
  try { const s = await scope(c); return c.json(await savedNotes(c.env, s.user, parseIds(c.req.query('ids')))); } catch (e) { return failure(c, e); }
});
routes.post('/compare-note', async (c) => {
  try {
    const s = await scope(c);
    const b = await body(c);
    const ids = parseIds(b.deal_ids);
    const material = await noteMaterial(c.env, s.user, ids, noteDeps.scorecard);
    if (!comparable(material)) return refuse(c, 409, { code: 'scores_not_recorded', message: 'Not enough ventures here have a score to compare. Eadwyn drafts from scores only.', extra: { code: 'scores_not_recorded' } });
    const out = await noteDeps.run(c.env, { task: 'workspace_explain', userId: s.user.id, text: notePrompt(material), maxTokens: 900,
      surface: AI_SURFACE.dealsCompare, rail: railFor(c, { page: 'Investor · Deals · Compare', option: 'draft:deals/compare-note' }) });
    const refused = refuseRun(c, { refusal: out.refusal, error: out.refusal === 'guard_unavailable' ? 'The note could not be checked. A started run may still be charged.' : undefined });
    if (refused) return refused;
    // Provider errors and model text never become an error response.
    if (!out.ok) return refuse(c, 503, { code: 'note_unreadable', message: 'Eadwyn could not draft this note. Try again.', extra: { code: 'note_unreadable' } });
    const text = parseNote(String(out.output ?? ''));
    if (!text) return refuse(c, 503, { code: 'note_ungrounded', message: 'This draft could not be checked against the scores, so it is not shown. The run may still be charged.', extra: { code: 'note_ungrounded' } });
    const cost = out.usage?.est_cost_usd;
    const costMicro = typeof cost === 'number' && cost >= 0 ? Math.round(cost * 1e6) : 0;
    const payload = newNotePayload(s.user, ids, text, costMicro);
    return c.json({ note: { text, deal_ids: ids, captured_at: payload.captured_at, ventures: material.map(({ deal_id, name, locked }) => ({ deal_id, name, locked })) },
      receipt: await receiptFor(c.env, payload) });
  } catch (e) { return failure(c, e); }
});
routes.post('/compare-note/keep', async (c) => {
  try { const s = await scope(c); const b = await body(c); const p = await keepNote(c.env, s.user, b.receipt); return c.json({ saved: { uid: p.uid, text: p.text, deal_ids: p.deal_ids, captured_at: p.captured_at } }); }
  catch (e) { return failure(c, e); }
});
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
