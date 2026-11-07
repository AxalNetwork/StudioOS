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
 * D1600 (#3879) adds what follows a run (`services/decks/batchFollowUp.ts`):
 *
 *   POST /api/decks/areas/batches/:uid/retry-failed  a new run of only the
 *                                               failed areas (pd2b), linked by
 *                                               `parent_batch_uid`, under what
 *                                               is left of the first run's quote
 *   GET  /api/decks/:id/batches?state=done&unseen=1  the return banner (pd2c):
 *                                               finished runs nobody opened
 *   POST /api/decks/areas/batches/:uid/seen     clears one from the banner
 *
 * Retry: only the member who started the run, with an `Idempotency-Key` of 8
 * to 64 characters; anyone else gets 404, like a stranger. 409
 * `nothing_to_retry` when no area is failed; 402 `hold_exhausted`, with the
 * retry's quote and what is left, when the first run's quote cannot cover it
 * (the page then asks for a new quote through the start route). The same key
 * again answers the first answer and charges nothing. The banner and Seen are
 * for the deck's writers (`projectOwned` with write); others get 404.
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
import { projectOwned } from '../services/decks/access';
import { roleOf } from '../services/decks/ensembles';
import { refuse } from '../util/refusal';
import { D1GenRuntime, modelLabel, type BatchStatus, type StepRow } from '../services/decks/genRuntime';
import { admitDeckRun, admitStatus, cancelInRoom, eventsFromRoom } from '../services/decks/genRooms';
import {
  MAX_RETRY_AREAS, RETRY_KEY, holdRemaining, markSeen, retryAnswer, retryPlan, rootOf, unseenBatches,
} from '../services/decks/batchFollowUp';

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

/** D4374 (#4374): a run's state in words. A run the stuck-run sweep closed reads "Stopped · timed out", never "Running". */
export const STATE_LINES: Readonly<Record<string, string>> = Object.freeze({
  queued: 'Waiting to start', running: 'Running', cancelling: 'Stopping', done: 'Done', cancelled: 'Stopped', failed: 'Failed',
});
export function stateLine(state: string, stopReason: string | null | undefined): string {
  if (state === 'cancelled' && stopReason === 'timed_out') return 'Stopped · timed out';
  return STATE_LINES[state] ?? state;
}

/** What pd2b and pd2c draw: the run, its running "charged so far of held", and one row per step. The step's request stays in D1. */
export function runView(st: BatchStatus) {
  const charged = st.steps.reduce((n, s) => n + Number(s.charged_microusd || 0), 0);
  return {
    uid: st.uid, deck_id: Number(st.deck_id), class: st.class, state: st.state,
    stop_reason: st.stop_reason ?? null, state_line: stateLine(st.state, st.stop_reason),
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
      // D1551 (#3798): draft, refine, judge or a plain variant, so pd2b's row says which pass it is.
      role: roleOf(s.kind, parsed(s.input) as Record<string, unknown> | null),
      model_label: modelLabel(s.model_used ?? s.model), state: s.state, seconds: secondsOf(s),
      cost_microusd: Number(s.charged_microusd || 0), fallback_used: !!Number(s.fallback_used), error_code: s.error_code,
      result: parsed(s.result),
    })),
  };
}

const notFound = (c: any) => refuse(c, 404, { code: 'run_not_found', message: 'That generation run is not available.' });

async function readable(c: any, uid: string, opts: { write?: boolean } = {}): Promise<{ user: { id: number }; st: BatchStatus } | Response> {
  const user = await requireAuth(c);
  const st = await reader(c.env).status(uid).catch(() => null);
  if (!st) return notFound(c);
  try { await projectOwned(c, user, Number(st.project_id), opts); } catch { return notFound(c); }
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
  const res = await eventsFromRoom(c.env, Number(r.st.deck_id), r.st.uid, Number(r.user.id), r.st.runtime).catch(() => null);
  if (!res) return refuse(c, 503, { code: 'runtime_unavailable', message: 'Live progress is not available here. Read the run instead.' });
  return res;
});

deckBatches.post(`/areas/batches/:uid${UID}/cancel`, async (c) => {
  const r = await readable(c, c.req.param('uid'));
  if (r instanceof Response) return r;
  if (Number(r.st.created_by) !== Number(r.user.id)) return refuse(c, 403, { code: 'not_your_run', message: 'Only the member who started this run can stop it.' });
  const res = await cancelInRoom(c.env, Number(r.st.deck_id), r.st.uid, Number(r.user.id), r.st.runtime).catch(() => null);
  let st: BatchStatus | null;
  if (res && res.ok) st = (await res.json()) as BatchStatus;
  else st = await reader(c.env).cancel(r.st.uid, Number(r.user.id)); // no room (or a queue run): stop it in D1 and settle what started
  if (!st) return refuse(c, 404, { code: 'run_not_found', message: 'That generation run is not available.' });
  return c.json(runView(st));
});

// ---- D1600 (#3879): retry the failed areas, and the return banner ------------

/** `{ areas?: string[] }`, or null when the body is not that. */
async function areasOf(c: any): Promise<string[] | null | 'invalid'> {
  const text = await c.req.text().catch(() => '');
  if (!text.trim()) return null;
  let body: any;
  try { body = JSON.parse(text); } catch { return 'invalid'; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'invalid';
  if (body.areas === undefined || body.areas === null) return null;
  const a = body.areas;
  if (!Array.isArray(a) || !a.length || a.length > MAX_RETRY_AREAS || a.some((x: unknown) => typeof x !== 'string' || !x || x.length > 120)) return 'invalid';
  return a as string[];
}

deckBatches.post(`/areas/batches/:uid${UID}/retry-failed`, async (c) => {
  const r = await readable(c, c.req.param('uid'), { write: true });
  if (r instanceof Response) return r;
  // The run's starter only: its quote is theirs. To anyone else the run is not there.
  if (Number(r.st.created_by) !== Number(r.user.id)) return notFound(c);
  const key = c.req.header('Idempotency-Key') ?? '';
  if (!RETRY_KEY.test(key)) return refuse(c, 400, { code: 'invalid_idempotency_key', message: 'Send an Idempotency-Key of 8 to 64 letters, digits or . _ : -.' });
  const deckId = Number(r.st.deck_id);
  const root = rootOf(r.st);
  // The same key again is the first answer: nothing is planned, held or charged.
  const same = await c.env.DB.prepare('SELECT * FROM deck_area_batches WHERE idem_key = ?1').bind(key).first<any>();
  if (same) {
    if (Number(same.created_by) !== Number(r.user.id) || Number(same.deck_id) !== deckId || same.parent_batch_uid !== root) {
      return refuse(c, 409, { code: 'idempotency_key_reused', message: 'That Idempotency-Key belongs to another run.' });
    }
    return c.json(await retryAnswer(c.env, same));
  }
  const areas = await areasOf(c);
  if (areas === 'invalid') return refuse(c, 400, { code: 'invalid_areas', message: 'Send { areas: [area id, …] } or no body.' });
  const plan = await retryPlan(c.env, deckId, root, areas);
  if (!plan.lines.length) return refuse(c, 409, { code: 'nothing_to_retry', message: 'No area of this build failed.' });
  const exhausted = async () => refuse(c, 402, {
    code: 'hold_exhausted', message: 'What is left of this build\'s hold cannot cover the retry. Confirm a new quote to run it.',
    extra: { quote: { microusd: plan.quote }, hold_remaining_microusd: await holdRemaining(c.env, deckId, root) },
  });
  if (plan.quote > (await holdRemaining(c.env, deckId, root))) return exhausted();
  const admitted = await admitDeckRun(c.env, {
    deckId, projectId: Number(r.st.project_id), userId: Number(r.user.id), cls: 'areas', idemKey: key, lines: plan.lines, parentBatchUid: root,
  });
  if (!admitted.body.ok) {
    if (admitted.body.refusal === 'hold_exhausted') return exhausted();
    return refuse(c, admitted.status || admitStatus(admitted.body.refusal), { code: admitted.body.refusal, message: admitted.body.message });
  }
  if (admitted.body.replayed) {
    const child = await c.env.DB.prepare('SELECT * FROM deck_area_batches WHERE uid = ?1').bind(admitted.body.uid).first<any>();
    if (child) return c.json(await retryAnswer(c.env, child));
  }
  return c.json({ batch_uid: admitted.body.uid, retried: plan.retried, quote: { microusd: admitted.body.quote_microusd } });
});

deckBatches.get('/:id{[0-9]+}/batches', async (c) => {
  const user = await requireAuth(c);
  if (c.req.query('state') !== 'done' || c.req.query('unseen') !== '1') {
    return refuse(c, 400, { code: 'unsupported_filter', message: 'Ask for state=done&unseen=1.' });
  }
  const deckId = Number(c.req.param('id'));
  const deck = await c.env.DB.prepare('SELECT project_id FROM pitch_decks WHERE id = ?1').bind(deckId).first<{ project_id: number }>();
  const gone = () => refuse(c, 404, { code: 'deck_not_found', message: 'That deck is not available.' });
  if (!deck) return gone();
  try { await projectOwned(c, user, Number(deck.project_id), { write: true }); } catch { return gone(); }
  return c.json({ batches: await unseenBatches(c.env, deckId) });
});

deckBatches.post(`/areas/batches/:uid${UID}/seen`, async (c) => {
  const r = await readable(c, c.req.param('uid'), { write: true });
  if (r instanceof Response) return r;
  await markSeen(c.env, r.st.uid);
  return c.json({ ok: true });
});

export default deckBatches;
