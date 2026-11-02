/**
 * D1536 (#3785, deck v2 B9) — the Queue fallback of the deck generation
 * runtime: `QueueGenRuntime` implements `DeckGenRuntime` over the same D1
 * tables as `D1GenRuntime` and `DeckGenRoom`, so the A3a contract suite
 * (`deck_gen_runtime_contract.test.ts`) holds it to the same rules.
 *
 * WHEN A RUN GOES THROUGH THE QUEUE (owner decision Z = A). The Durable Object
 * drives every batch, except that a batch of more than `QUEUE_ABOVE_VARIANTS`
 * (18) variants goes through the job queue while `DECK_GEN_RUNTIME` is
 * `"queue"` and `JOB_QUEUE` is bound. `runtimeKind` in `genRooms.ts` decides;
 * `"do"` is the switch that sends every run back to the room.
 *
 * THE SAME HOLD AND QUOTE. `admit` is `D1GenRuntime.admit`: one parent hold for
 * the whole quote, keyed by the request's Idempotency-Key, so a retried request
 * is the same run and takes no second hold. Only a new run is enqueued.
 *
 * THE SAME EVENTS. Each delivery drives the run with the core's `startBatch`,
 * which emits `area_started`, `step_done`, `variant_ready`, `area_failed` and
 * `batch_done`; `area_busy` comes from the step executor. In production each
 * event is relayed to the deck's `DeckGenRoom` (`relayToRoom`), which streams
 * it on the run's existing `/events` route, so the page needs no change.
 *
 * RESUMABLE, CHARGED ONCE. A message is `{ job_type: 'deck_gen_batch',
 * payload: { batch_uid } }`. A delivery drives the run for one slice
 * (`SLICE_MS`, `DRIVERS` drivers at once, like the room's alarm) and, if the
 * run is still going, sends the next message as its last act. A delivery that
 * threw is retried by the platform; a retry (`attempts > 1`) first `rebuild`s
 * the run from D1, so a step that charged is done and one that did not runs
 * again, and nothing is charged twice. A message whose retries are spent ends
 * its run (`endExhaustedRun`): what ran is settled once, the rest is released.
 *
 * Logs hold outcomes only: never a run's uid, a member, a model's words or a figure.
 */
import type { Env, JobMessage } from '../../types';
import { D1GenRuntime, type AdmitInput, type Admitted, type BatchStatus, type DeckGenRuntime, type GenEvent, type StepExecutor } from './genRuntime';
import { stepExecutor } from './stepExecutor';
import { relayToRoom } from './genRooms';

export const DECK_GEN_JOB = 'deck_gen_batch';
/** The room's numbers, so a queue delivery drives a run as an alarm does. */
export const DRIVERS = 6;
export const SLICE_MS = 10 * 60_000;
const ACTIVE = new Set(['queued', 'running', 'cancelling']);
const UID = /^[0-9a-f-]{36}$/;

export type QueueSend = (body: JobMessage) => Promise<void>;
export type QueueRuntimeOptions = {
  execute?: StepExecutor;
  emit?: (e: GenEvent) => void | Promise<void>;
  send: QueueSend;
  /** How long one delivery drives before it hands over to the next message (`SLICE_MS`). */
  sliceMs?: number;
};

export const deckGenMessage = (uid: string, slice: number): JobMessage => ({
  job_type: DECK_GEN_JOB, payload: { batch_uid: uid }, idempotency_key: `deck-gen:${uid}:${slice}`,
});

/** The job queue as a sender; throws where `JOB_QUEUE` is unbound. */
export const jobQueueSender = (env: Env): QueueSend => async (body) => {
  if (!env.JOB_QUEUE) throw new Error('job_queue_unbound');
  await env.JOB_QUEUE.send(body);
};

export class QueueGenRuntime implements DeckGenRuntime {
  private core: D1GenRuntime;
  private send: QueueSend;
  private sliceMs: number;
  constructor(env: Env, opts: QueueRuntimeOptions) {
    this.sliceMs = opts.sliceMs ?? SLICE_MS;
    const execute = opts.execute ?? stepExecutor(env);
    this.core = new D1GenRuntime(env, (s, c) => execute(s, c), opts.emit ?? (() => {}));
    this.send = opts.send;
  }

  /** The core's admission, then one message for a new run. A run nothing would drive is stopped and refused. */
  async admit(input: AdmitInput): Promise<Admitted> {
    const a = await this.core.admit(input);
    if (!a.ok || a.replayed) return a;
    try {
      await this.send(deckGenMessage(a.uid, 0));
    } catch {
      console.warn('[deck-gen-queue] enqueue_failed');
      await this.core.cancel(a.uid, input.userId).catch(() => null);
      return { ok: false, refusal: 'runtime_unavailable', message: 'Generation runs are not available here.' };
    }
    return a;
  }

  /** One driver, as the core drives: a delivery runs `DRIVERS` of these at once (`deliver`). */
  startBatch(uid: string, opts?: { until?: number }): Promise<BatchStatus | null> { return this.core.startBatch(uid, opts); }
  cancel(uid: string, userId: number): Promise<BatchStatus | null> { return this.core.cancel(uid, userId); }
  status(uid: string): Promise<BatchStatus | null> { return this.core.status(uid); }
  rebuild(uid: string): Promise<BatchStatus | null> { return this.core.rebuild(uid); }

  /**
   * One delivery of a run's message: rebuild first when the last delivery
   * died, drive one slice, and send the next message while the run goes on.
   * Throws when a driver threw, so the platform retries the message.
   */
  async deliver(uid: string, attempts: number, opts: { slice?: number } = {}): Promise<BatchStatus | null> {
    const st0 = await this.core.status(uid);
    if (!st0 || !ACTIVE.has(st0.state)) return st0;
    if (attempts > 1) await this.core.rebuild(uid);
    const until = Date.now() + this.sliceMs;
    const ran = await Promise.allSettled(Array.from({ length: DRIVERS }, () => this.core.startBatch(uid, { until })));
    if (ran.some((r) => r.status === 'rejected')) throw new Error('driver_failed');
    const st = await this.core.status(uid);
    if (st && ACTIVE.has(st.state)) await this.send(deckGenMessage(uid, (opts.slice ?? 0) + 1));
    return st;
  }
}

/** Reads the message's run uid, or null for a message that names none. */
export function batchUidOf(body: JobMessage | undefined): string | null {
  const uid = body?.job_type === DECK_GEN_JOB ? (body.payload as any)?.batch_uid : null;
  return typeof uid === 'string' && UID.test(uid) ? uid : null;
}

/** The production runtime for one delivery: the default executor, each event relayed to the deck's room. */
export async function queueRuntimeFor(env: Env, uid: string): Promise<QueueGenRuntime> {
  const run = await env.DB.prepare('SELECT deck_id, created_by FROM deck_area_batches WHERE uid = ?1').bind(uid).first<{ deck_id: number; created_by: number }>();
  const relay = (e: GenEvent) => (run ? relayToRoom(env, Number(run.deck_id), Number(run.created_by), e) : undefined);
  const execute = stepExecutor(env, {
    onBusy: (step, attempt, ms) => relay({
      type: 'area_busy', batch_uid: step.batch_uid, seq: step.seq, card_uid: step.card_uid, area_id: step.area_id,
      element: step.element, state: 'running', attempt, wait_ms: ms, charged_microusd: -1, held_microusd: -1,
    }),
  });
  return new QueueGenRuntime(env, { execute, emit: relay, send: jobQueueSender(env) });
}

/** The job queue consumer's branch for `deck_gen_batch`: ack, or retry when the delivery failed. */
export async function consumeDeckGenMessage(
  env: Env, body: JobMessage, attempts: number,
  make: (env: Env, uid: string) => Promise<QueueGenRuntime> = queueRuntimeFor,
): Promise<'ack' | 'retry'> {
  const uid = batchUidOf(body);
  if (!uid) { console.warn('[deck-gen-queue] not_a_deck_run'); return 'ack'; }
  const slice = Number(String(body.idempotency_key ?? '').split(':').pop()) || 0;
  try {
    const rt = await make(env, uid);
    await rt.deliver(uid, attempts, { slice });
    return 'ack';
  } catch {
    console.warn('[deck-gen-queue] delivery_failed');
    return 'retry';
  }
}

/** A message whose retries are spent: the run ends, what ran is settled once and the rest of the hold is released. */
export async function endExhaustedRun(env: Env, body: JobMessage): Promise<boolean> {
  const uid = batchUidOf(body);
  if (!uid) return false;
  const core = new D1GenRuntime(env, async () => ({ ok: false, charged_microusd: 0, error_code: 'queue_exhausted' }));
  const st = await core.rebuild(uid);
  if (!st || !ACTIVE.has(st.state)) return false;
  // Nothing drives it any more: a step left running charged nothing (rebuild says so), so it goes back and is stopped.
  const ended = await core.cancel(uid, Number(st.created_by));
  return !!ended && !ACTIVE.has(ended.state);
}
