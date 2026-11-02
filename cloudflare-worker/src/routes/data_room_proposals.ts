/**
 * #4170 (D4170) — Eadwyn's proposals for a data room: checklist matches,
 * folders for top-level files, and gaps (`services/dataRoomProposals.ts`).
 *
 *   GET  /api/data-room/:projectUid/proposals              { proposals: [...] }
 *   POST /api/data-room/:projectUid/proposals/quote        { quote: { hold_microusd, model, confirm_quote } }
 *   POST /api/data-room/:projectUid/proposals/run          body { confirm_quote } → { proposals, cost }
 *                                                          402 quote_required: no run without the quote
 *   POST /api/data-room/:projectUid/proposals/:uid/accept  → { proposal, change }
 *   POST /api/data-room/:projectUid/proposals/:uid/dismiss → { proposal }
 *   POST /api/data-room/:projectUid/proposals/:uid/undo    → { proposal, change }   match and folder only
 *
 * WHO. The room's owner and its co-founders: the people who may match, move
 * and rename files in the room (D1103, `roomProject`). Anyone else, an admin
 * included, gets 404 as on every founder-side room route. A proposal is its
 * proposer's own row: another member's is 409 `not_open`. A member who lost
 * write access to the room since they asked cannot accept: the gate is read
 * on every press.
 *
 * WHAT A PRESS WRITES. Accept: the one file field the proposal names, or for
 * a gap nothing but the proposal. Dismiss: the proposal only. Every press
 * records its actor (`decided_by_user_id`) and one activity row on the room.
 *
 * Mounted by the route registry (#4105), after the room's own router.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { quoteRun, run } from '../services/aiRouter';
import { refuseRun } from '../util/railContext';
import { refuse } from '../util/refusal';
import { mapError } from './_t13t14t15_helpers';
import { logCycleWrite } from '../services/cycleActivity';
import { proposeRail } from '../services/railProposals';
import { roomProject } from './data_room';
import {
  OPTION_OF, PROPOSALS_PAGE, acceptProposal, dismissProposal, listProposals, proposalsFrom, quoteDigest, recordOf, roomFacts,
  runOptions, undoProposal, type Outcome,
} from '../services/dataRoomProposals';

const proposals = new Hono<{ Bindings: Env }>();

const NOT_FOUND = { detail: 'Project not found' };

async function roomOf(c: any) {
  const user = await requireAuth(c);
  const room = await roomProject(c, user, c.req.param('projectUid'));
  return { user, room: room ? { id: Number(room.project.id), uid: String(room.project.uid) } : null };
}

/** The quote for this member and room now, with the digest a run must carry. */
async function quoteFor(c: any, userId: number, room: { id: number; uid: string }) {
  const facts = await roomFacts(c.env, room.id);
  const opts = runOptions(userId, room.uid, facts);
  const q = await quoteRun(c.env, opts);
  if (!q.ok) return { facts, opts, q, confirm: null as string | null };
  return { facts, opts, q, confirm: await quoteDigest(userId, room.uid, facts, q.model, q.hold_microusd) };
}

proposals.get('/:projectUid/proposals', async (c) => {
  try {
    const { user, room } = await roomOf(c);
    if (!room) return c.json(NOT_FOUND, 404);
    return c.json({ proposals: await listProposals(c.env, Number(user.id), room.id, room.uid) });
  } catch (e) { return mapError(c, e); }
});

proposals.post('/:projectUid/proposals/quote', async (c) => {
  try {
    const { user, room } = await roomOf(c);
    if (!room) return c.json(NOT_FOUND, 404);
    const got = await quoteFor(c, Number(user.id), room);
    if (!got.q.ok) return refuseRun(c, got.q) ?? refuse(c, 503, { code: 'model_unavailable', message: 'Eadwyn cannot be asked right now. Nothing was charged.' });
    return c.json({ quote: { hold_microusd: got.q.hold_microusd, model: got.q.model, confirm_quote: got.confirm } });
  } catch (e) { return mapError(c, e); }
});

proposals.post('/:projectUid/proposals/run', async (c) => {
  try {
    const { user, room } = await roomOf(c);
    if (!room) return c.json(NOT_FOUND, 404);
    const userId = Number(user.id);
    const body = await c.req.json().catch(() => ({} as any));
    const got = await quoteFor(c, userId, room);
    if (!got.q.ok) return refuseRun(c, got.q) ?? refuse(c, 503, { code: 'model_unavailable', message: 'Eadwyn cannot be asked right now. Nothing was charged.' });
    // No run without the quote the member saw: the room, the model and the hold it named.
    if (typeof body?.confirm_quote !== 'string' || body.confirm_quote !== got.confirm) {
      return refuse(c, 402, {
        code: 'quote_required', message: 'Confirm the cost before Eadwyn reads the room. Nothing was run.',
        extra: { quote: { hold_microusd: got.q.hold_microusd, model: got.q.model, confirm_quote: got.confirm } },
      });
    }
    const res = await run(c.env, { ...got.opts, model: got.q.model });
    if (!res.ok) {
      const stop = refuseRun(c, res);
      if (stop) return stop;
      return refuse(c, 503, { code: 'model_unavailable', message: 'Eadwyn could not answer. Nothing was charged and nothing changed.' });
    }
    const usageLogId = res.usageLogId ?? null;
    const charged = usageLogId
      ? await c.env.DB.prepare('SELECT charged_microusd FROM ai_usage_logs WHERE id = ? AND user_id = ?').bind(usageLogId, userId).first<{ charged_microusd: number | null }>().catch(() => null)
      : null;
    const cost = { usage_log_id: usageLogId, charged_microusd: charged?.charged_microusd == null ? null : Number(charged.charged_microusd) };
    const made = proposalsFrom(res.output ?? '', got.facts);
    // A new reading replaces the member's earlier open proposals for this room.
    await c.env.DB.prepare(
      `UPDATE ai_rail_proposals SET status = 'withdrawn', updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND rail_page = ? AND record_ref = ? AND status = 'proposed' AND rail_option IN (?, ?, ?)`,
    ).bind(userId, PROPOSALS_PAGE, recordOf(room.uid), OPTION_OF.match, OPTION_OF.folder, OPTION_OF.gap).run();
    for (const p of made) {
      await proposeRail(c.env, {
        userId, page: PROPOSALS_PAGE, option: OPTION_OF[p.type], record: recordOf(room.uid), kind: 'proposal',
        payload: p as unknown as Record<string, unknown>, model: res.usage?.model ?? got.q.model, usageLogId,
      });
    }
    await logCycleWrite(c.env, { projectId: room.id, userId, cycle: 'raise', module: 'data-room', entityId: null,
      action: 'proposals_asked', summary: `Eadwyn proposed ${made.length} change${made.length === 1 ? '' : 's'}` });
    return c.json({ proposals: await listProposals(c.env, userId, room.id, room.uid), cost });
  } catch (e) { return mapError(c, e); }
});

const ACTION = { accept: 'proposal_accepted', dismiss: 'proposal_dismissed', undo: 'proposal_undone' } as const;
const SUMMARY: Record<string, string> = {
  accept: 'Eadwyn proposal accepted', dismiss: 'Eadwyn proposal dismissed', undo: 'Eadwyn proposal undone',
};

/** One press on one of the member's own proposals; the room's gate is read on every press. */
function press(verb: 'accept' | 'dismiss' | 'undo', act: typeof acceptProposal) {
  return async (c: any) => {
    try {
      const { user, room } = await roomOf(c);
      if (!room) return c.json(NOT_FOUND, 404);
      const userId = Number(user.id);
      const out: Outcome = await act(c.env, userId, room, String(c.req.param('uid') || ''));
      if (!out.ok) return refuse(c, out.status, { code: out.code, message: out.message });
      const fileId = out.change && typeof out.change.file_id === 'number' ? out.change.file_id : null;
      await logCycleWrite(c.env, { projectId: room.id, userId, cycle: 'raise', module: 'data-room', entityId: fileId,
        action: ACTION[verb], summary: SUMMARY[verb] });
      return c.json({ proposal: out.proposal, change: out.change });
    } catch (e) { return mapError(c, e); }
  };
}

proposals.post('/:projectUid/proposals/:uid/accept', press('accept', acceptProposal));
proposals.post('/:projectUid/proposals/:uid/dismiss', press('dismiss', dismissProposal));
proposals.post('/:projectUid/proposals/:uid/undo', press('undo', undoProposal));

export default proposals;

export const mount: RouteMount = { path: '/api/data-room', router: proposals };
