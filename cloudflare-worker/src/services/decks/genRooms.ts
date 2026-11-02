/**
 * D1502 part 2 (#3753, deck v2 A3a): how the Worker reaches a deck's
 * `DeckGenRoom`. Routes call only these, never the class.
 *
 * `admitDeckRun` is the one way a run starts: A3's area routes (#3764) and the
 * one-click build (#3768) call it with the run's plan, after their own access
 * check and the `deck_generate` rate bucket. Without the `DECK_GEN_ROOM`
 * binding (a Worker without Durable Objects) nothing is admitted:
 * `runtime_unavailable`, because a run that nothing drives would hold the
 * member's allowance and never finish.
 */
import type { Env } from '../../types';
import { doNamespace } from '../../util/doNamespace';
import type { AdmitInput, Admitted } from './genRuntime';

/** The HTTP status a refused admission answers with. */
export function admitStatus(refusal: string): number {
  if (refusal === 'deck_busy' || refusal === 'idempotency_key_reused') return 409;
  if (refusal === 'ai_paused' || refusal === 'runtime_unavailable') return 503;
  if (refusal === 'spend_limit' || refusal.startsWith('budget_')) return 402;
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
  const room = roomFor(env, input.deckId);
  if (!room) return { status: 503, body: { ok: false, refusal: 'runtime_unavailable', message: 'Generation runs are not available here.' } };
  const r = await room.fetch('https://deck-gen-room/admit', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-deck-user': String(input.userId) }, body: JSON.stringify(input),
  });
  return { status: r.status, body: (await r.json()) as Admitted };
}

/** Asks the room to stop the run; the room stops its waiting steps and settles. */
export async function cancelInRoom(env: Env, deckId: number, uid: string, userId: number): Promise<Response | null> {
  const room = roomFor(env, deckId);
  if (!room) return null;
  return room.fetch(`https://deck-gen-room/cancel?uid=${encodeURIComponent(uid)}`, { method: 'POST', headers: { 'x-deck-user': String(userId) } });
}

/** The run's event stream from its room. */
export async function eventsFromRoom(env: Env, deckId: number, uid: string, userId: number): Promise<Response | null> {
  const room = roomFor(env, deckId);
  if (!room) return null;
  return room.fetch(`https://deck-gen-room/events?uid=${encodeURIComponent(uid)}`, { headers: { 'x-deck-user': String(userId) } });
}
