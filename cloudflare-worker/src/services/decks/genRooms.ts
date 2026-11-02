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
 *
 * D1536 (#3785, B9): a run of more than `QUEUE_ABOVE_VARIANTS` variants goes
 * through the job queue instead (`queueRuntime.ts`) while `DECK_GEN_RUNTIME`
 * is `"queue"` and `JOB_QUEUE` is bound (`runtimeKind`). It takes the same hold
 * and quote, and its events reach the same room's stream through `relayToRoom`.
 */
import type { Env } from '../../types';
import { doNamespace } from '../../util/doNamespace';
import type { AdmitInput, Admitted, GenEvent, PlanLine } from './genRuntime';

/** D1536 (owner decision Z = A): the Durable Object drives a batch of up to this many variants; a larger one goes through the queue. */
export const QUEUE_ABOVE_VARIANTS = 18;
/** The plan lines that write a proposal (a variant): an area's text or an image. Checks, critiques and retries are steps of those. */
export const VARIANT_KINDS: ReadonlySet<string> = new Set(['text', 'image']);
export const variantCount = (lines: readonly PlanLine[]): number => (Array.isArray(lines) ? lines.filter((l) => VARIANT_KINDS.has(String(l?.kind))).length : 0);

/** Which runtime drives a run: `"queue"` only above the threshold, with the switch on and the queue bound. */
export function runtimeKind(env: Env, lines: readonly PlanLine[]): 'do' | 'queue' {
  if (env.DECK_GEN_RUNTIME !== 'queue' || !env.JOB_QUEUE) return 'do';
  return variantCount(lines) > QUEUE_ABOVE_VARIANTS ? 'queue' : 'do';
}

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
  if (runtimeKind(env, input.lines) === 'queue') {
    const { QueueGenRuntime, jobQueueSender } = await import('./queueRuntime');
    const body = await new QueueGenRuntime(env, { send: jobQueueSender(env) }).admit(input);
    return { status: body.ok ? 200 : admitStatus(body.refusal), body };
  }
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

/** D1536: hands an event of a queue-driven run to its deck's room, which streams it. A failed relay never stops the run. */
export async function relayToRoom(env: Env, deckId: number, userId: number, e: GenEvent): Promise<void> {
  const room = roomFor(env, deckId);
  if (!room) return;
  try {
    await room.fetch('https://deck-gen-room/relay', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-deck-user': String(userId) }, body: JSON.stringify(e),
    });
  } catch { /* the run goes on; the page reads the run instead */ }
}
