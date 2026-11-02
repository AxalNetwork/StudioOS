/**
 * D1502 part 2 (#3753, deck v2 A3a) — a deck generation run, read, streamed and
 * stopped. Runs start through `services/decks/genRooms.ts`'s `admitDeckRun`
 * (A3's area routes, #3764, and the one-click build, #3768); these routes are
 * how the page follows one.
 *
 *   GET  /api/decks/areas/batches/:uid          the run and its steps: resume
 *                                               after a closed tab (pd2b, pd2c)
 *   GET  /api/decks/areas/batches/:uid/events   Server-Sent Events from the
 *                                               deck's `DeckGenRoom`
 *   POST /api/decks/areas/batches/:uid/cancel   Stop: steps that started are
 *                                               charged; the rest are released
 *
 * Who: whoever may read the run's deck (`projectOwned`) reads and follows it;
 * only the member who started it stops it (403 `not_your_run`). A run that does
 * not exist, or whose deck the member may not read, is 404, so a uid tells a
 * stranger nothing. Each step names its model, or "No model · free"; what a
 * step has not recorded yet (its seconds before it ends) is null, never 0.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { projectOwned } from '../middleware/projectContentAccess';
import { refuse } from '../util/refusal';
import { D1GenRuntime, modelLabel, type BatchStatus, type StepRow } from '../services/decks/genRuntime';
import { cancelInRoom, eventsFromRoom } from '../services/decks/genRooms';

const deckBatches = new Hono<{ Bindings: Env }>();
const UID = '{[0-9a-f-]{36}}';

/** Reads only: the D1 runtime never drives a step from here. */
const reader = (env: Env) => new D1GenRuntime(env, async () => ({ ok: false, charged_microusd: 0, error_code: 'read_only' }));

const secondsOf = (s: StepRow): number | null => {
  if (!s.started_at || !s.ended_at) return null;
  const ms = Date.parse(`${s.ended_at.replace(' ', 'T')}Z`) - Date.parse(`${s.started_at.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 100) / 10 : null;
};
const parsed = (v: string | null): unknown => { if (!v) return null; try { return JSON.parse(v); } catch { return null; } };

/** What pd2b and pd2c draw: the run, its running "charged so far of held", and one row per step. The step's request stays in D1. */
export function runView(st: BatchStatus) {
  const charged = st.steps.reduce((n, s) => n + Number(s.charged_microusd || 0), 0);
  return {
    uid: st.uid, deck_id: Number(st.deck_id), class: st.class, state: st.state,
    quote_microusd: Number(st.quote_microusd), held_microusd: Number(st.quote_microusd), charged_microusd: charged,
    created_at: st.created_at, started_at: st.started_at, settled_at: st.settled_at,
    counts: {
      done: st.steps.filter((s) => s.state === 'done').length,
      running: st.steps.filter((s) => s.state === 'running').length,
      waiting: st.steps.filter((s) => s.state === 'waiting').length,
      failed: st.steps.filter((s) => s.state === 'failed').length,
      stopped: st.steps.filter((s) => s.state === 'stopped').length,
    },
    steps: st.steps.map((s) => ({
      seq: Number(s.seq), card_uid: s.card_uid, area_id: s.area_id, element: s.element, kind: s.kind,
      model_label: modelLabel(s.model_used ?? s.model), state: s.state, seconds: secondsOf(s),
      cost_microusd: Number(s.charged_microusd || 0), fallback_used: !!Number(s.fallback_used), error_code: s.error_code,
      result: parsed(s.result),
    })),
  };
}

async function readable(c: any, uid: string): Promise<{ user: { id: number }; st: BatchStatus } | Response> {
  const user = await requireAuth(c);
  const st = await reader(c.env).status(uid).catch(() => null);
  if (!st) return refuse(c, 404, { code: 'run_not_found', message: 'That generation run is not available.' });
  try { await projectOwned(c, user, Number(st.project_id)); } catch { return refuse(c, 404, { code: 'run_not_found', message: 'That generation run is not available.' }); }
  return { user: user as { id: number }, st };
}

deckBatches.get(`/areas/batches/:uid${UID}`, async (c) => {
  const r = await readable(c, c.req.param('uid'));
  if (r instanceof Response) return r;
  return c.json(runView(r.st));
});

deckBatches.get(`/areas/batches/:uid${UID}/events`, async (c) => {
  const r = await readable(c, c.req.param('uid'));
  if (r instanceof Response) return r;
  const res = await eventsFromRoom(c.env, Number(r.st.deck_id), r.st.uid, Number(r.user.id)).catch(() => null);
  if (!res) return refuse(c, 503, { code: 'runtime_unavailable', message: 'Live progress is not available here. Read the run instead.' });
  return res;
});

deckBatches.post(`/areas/batches/:uid${UID}/cancel`, async (c) => {
  const r = await readable(c, c.req.param('uid'));
  if (r instanceof Response) return r;
  if (Number(r.st.created_by) !== Number(r.user.id)) return refuse(c, 403, { code: 'not_your_run', message: 'Only the member who started this run can stop it.' });
  const res = await cancelInRoom(c.env, Number(r.st.deck_id), r.st.uid, Number(r.user.id)).catch(() => null);
  let st: BatchStatus | null;
  if (res && res.ok) st = (await res.json()) as BatchStatus;
  else st = await reader(c.env).cancel(r.st.uid, Number(r.user.id)); // no room: stop it in D1 and settle what started
  if (!st) return refuse(c, 404, { code: 'run_not_found', message: 'That generation run is not available.' });
  return c.json(runView(st));
});

export default deckBatches;
