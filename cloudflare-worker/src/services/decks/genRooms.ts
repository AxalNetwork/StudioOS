/**
 * D1502 part 2 (#3753, deck v2 A3a): how the Worker reaches a deck's
 * `DeckGenRoom`. Routes call only these, never the class.
 *
 * `admitDeckRun` is the one way a run starts: A3's area routes (#3764) and the
 * one-click build (#3768) call it with the run's plan, after their own access
 * check and the `deck_generate` rate bucket. Without the `DECK_GEN_ROOM`
 * binding (a Worker without Durable Objects) the Queue fallback takes the run
 * when `JOB_QUEUE` is bound (D1536); with neither nothing is admitted:
 * `runtime_unavailable`, because a run that nothing drives would hold the
 * member's allowance and never finish.
 */
import type { Env } from '../../types';
import { doNamespace } from '../../util/doNamespace';
import type { AdmitInput, Admitted, BatchStatus } from './genRuntime';
import { QueueGenRuntime, eventsFromD1, runtimeFor } from './queueRuntime';

/** The HTTP status a refused admission answers with. */
export function admitStatus(refusal: string): number {
  if (refusal === 'deck_busy' || refusal === 'idempotency_key_reused') return 409;
  if (refusal === 'ai_paused' || refusal === 'runtime_unavailable') return 503;
  if (refusal === 'spend_limit' || refusal === 'hold_exhausted' || refusal.startsWith('budget_')) return 402;
  return 400;
}

/** The deck's room, or null where the binding is absent. */
export function roomFor(env: Env, deckId: number): DurableObjectStub | null {
  if (!env.DECK_GEN_ROOM) return null;
  // D264: under the branch's Durable Object jurisdiction, never an unrestricted one.
  const ns = doNamespace(env, env.DECK_GEN_ROOM);
  return ns.get(ns.idFromName(`deck:${deckId}`));
}

export async function admitDeckRun(env: Env, input: AdmitInput): Promise<{ status: number; body: Admitted }> {
  // D1536 (#3785): the room takes every run but a large one, which the Queue
  // fallback takes (decision Z); `DECK_GEN_RUNTIME = "queue"` sends every run there.
  const kind = runtimeFor(env, input.lines ?? []);
  if (kind === 'queue') {
    const a = await new QueueGenRuntime(env).admit(input);
    return { status: a.ok ? 200 : admitStatus(a.refusal), body: a };
  }
  const room = kind === 'do' ? roomFor(env, input.deckId) : null;
  if (!room) return { status: 503, body: { ok: false, refusal: 'runtime_unavailable', message: 'Generation runs are not available here.' } };
  const r = await room.fetch('https://deck-gen-room/admit', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-deck-user': String(input.userId) }, body: JSON.stringify(input),
  });
  return { status: r.status, body: (await r.json()) as Admitted };
}

/** Asks the room to stop the run; the room stops its waiting steps and settles. A queue run has no room: null, and the caller stops it in D1. */
export async function cancelInRoom(env: Env, deckId: number, uid: string, userId: number, runtime?: BatchStatus['runtime']): Promise<Response | null> {
  if (runtime === 'queue') return null;
  const room = roomFor(env, deckId);
  if (!room) return null;
  return room.fetch(`https://deck-gen-room/cancel?uid=${encodeURIComponent(uid)}`, { method: 'POST', headers: { 'x-deck-user': String(userId) } });
}

/** The run's event stream: from its room, or read from D1 for a queue run (D1536). */
export async function eventsFromRoom(env: Env, deckId: number, uid: string, userId: number, runtime?: BatchStatus['runtime']): Promise<Response | null> {
  if (runtime === 'queue') return eventsFromD1(env, uid);
  const room = roomFor(env, deckId);
  if (!room) return null;
  return room.fetch(`https://deck-gen-room/events?uid=${encodeURIComponent(uid)}`, { headers: { 'x-deck-user': String(userId) } });
}
