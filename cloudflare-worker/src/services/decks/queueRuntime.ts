/**
 * D1536 (#3785, deck v2 B9) — the Queue fallback for the deck generation
 * runtime.
 *
 * `QueueGenRuntime` implements `DeckGenRuntime` (services/decks/genRuntime.ts)
 * over the same D1 core as `DeckGenRoom`, so the A3a contract suite holds it to
 * the same rules: one quote, one parent hold, one charge per Idempotency-Key,
 * one active run per deck, Stop charges what started, a failed area never sinks
 * the others, and a crash repeats nothing. What differs is who drives the run:
 *
 *   - **A Queue message, not an alarm.** Admission enqueues one `deck_gen_slice`
 *     message on `JOB_QUEUE`. The consumer (`driveQueuedSlice`) rebuilds the run
 *     from D1, drives it with `DRIVERS` drivers for one slice (`SLICE_MS`, inside
 *     a consumer's wall time), and, while the run is still going, sends the next
 *     slice's message. It sends a new message rather than retrying this one, so
 *     a long run never spends the message's retries. A slice that throws is
 *     retried by the queue, and its `rebuild` repeats nothing.
 *   - **Live progress from D1.** No object holds the run between slices, so the
 *     event stream (`eventsFromD1`) reads the run's rows each second and emits
 *     the same events a room emits: `area_started`, `step_done`,
 *     `variant_ready`, `area_failed`, `batch_done`.
 *
 * Which runtime takes a run (owner decision Z, answered A on #3716): the room
 * for every run, the queue for a run of more than `QUEUE_ABOVE` variant steps,
 * and the queue for every run while `DECK_GEN_RUNTIME = "queue"`. Where the
 * Worker has no room binding but has the queue, the queue takes the run. The
 * run's row records its runtime (`deck_area_batches.runtime`).
 */
import type { Env, JobMessage } from '../../types';
import {
  D1GenRuntime, type AdmitInput, type Admitted, type BatchStatus, type DeckGenRuntime, type GenEvent, type PlanLine,
  type StepExecutor, type StepRow, modelLabel,
} from './genRuntime';
import { stepExecutor } from './stepExecutor';

export const DECK_GEN_JOB = 'deck_gen_slice';
/** More variant steps than this go to the queue (decision Z). */
export const QUEUE_ABOVE = 18;
/** The steps that make a variant; guards, checks and critiques ride along. */
export const VARIANT_KINDS: ReadonlySet<string> = new Set(['text', 'image']);
export const DRIVERS = 6;
/** One slice, well inside a queue consumer's wall time. */
export const SLICE_MS = 5 * 60_000;
/** A run never takes more slices than this; past it the slice is logged and the run is left for `rebuild`. */
export const MAX_SLICES = 500;
const ACTIVE = new Set(['queued', 'running', 'cancelling']);

export type RuntimeKind = 'do' | 'queue';

/** How many steps of a plan make a variant. */
export const variantSteps = (lines: readonly PlanLine[]) => lines.filter((l) => VARIANT_KINDS.has(String(l?.kind))).length;

/** The runtime a new run goes to; null when neither is bound here. */
export function runtimeFor(env: Pick<Env, 'DECK_GEN_RUNTIME' | 'DECK_GEN_ROOM' | 'JOB_QUEUE'>, lines: readonly PlanLine[]): RuntimeKind | null {
  const room = !!env.DECK_GEN_ROOM, queue = !!env.JOB_QUEUE;
  const wantsQueue = String(env.DECK_GEN_RUNTIME ?? '').trim() === 'queue' || variantSteps(lines) > QUEUE_ABOVE;
  if (wantsQueue && queue) return 'queue';
  if (room) return 'do';
  return queue ? 'queue' : null;
}

export type SliceMessage = { uid: string; slice: number };
const sliceKey = (uid: string, slice: number) => `deckgen:${uid}:${slice}`;

/** Sends a run's next slice to the queue. */
export async function enqueueSlice(env: Env, uid: string, slice: number, delaySeconds = 0): Promise<void> {
  const body: JobMessage = { job_type: DECK_GEN_JOB, payload: { uid, slice } satisfies SliceMessage, idempotency_key: sliceKey(uid, slice) };
  await env.JOB_QUEUE!.send(body, delaySeconds ? { delaySeconds } : undefined);
}

export class QueueGenRuntime implements DeckGenRuntime {
  private env: Env;
  private core: D1GenRuntime;
  constructor(env: Env, execute?: StepExecutor, emit: (e: GenEvent) => void | Promise<void> = () => {}) {
    this.env = env;
    this.core = new D1GenRuntime(env, execute ?? stepExecutor(env), emit);
  }

  /** Admits the run, records that the queue drives it, and sends its first slice. */
  async admit(input: AdmitInput): Promise<Admitted> {
    const a = await this.core.admit(input);
    if (!a.ok || a.replayed) return a;
    await this.env.DB.prepare(`UPDATE deck_area_batches SET runtime = 'queue' WHERE uid = ?1`).bind(a.uid).run();
    if (this.env.JOB_QUEUE) {
      try { await enqueueSlice(this.env, a.uid, 0); }
      catch {
        // Nothing will drive it: stop it now, so the hold comes back at once.
        await this.core.cancel(a.uid, input.userId).catch(() => null);
        return { ok: false, refusal: 'runtime_unavailable', message: 'Generation runs are not available here.' };
      }
    }
    return a;
  }

  /** One driver, as `DeckGenRoom.startBatch` is: the contract suite's handle on the run. */
  startBatch(uid: string, opts: { until?: number } = {}): Promise<BatchStatus | null> { return this.core.startBatch(uid, opts); }
  /**
   * One slice, as the room's alarm drives one: the run is rebuilt from D1 (a
   * slice that died mid-step repeats nothing), then `DRIVERS` drivers run its
   * steps until it ends or `until` passes.
   */
  async drive(uid: string, until: number): Promise<BatchStatus | null> {
    await this.core.rebuild(uid);
    await Promise.all(Array.from({ length: DRIVERS }, () => this.core.startBatch(uid, { until })));
    return this.core.status(uid);
  }
  cancel(uid: string, userId: number): Promise<BatchStatus | null> { return this.core.cancel(uid, userId); }
  status(uid: string): Promise<BatchStatus | null> { return this.core.status(uid); }
  rebuild(uid: string): Promise<BatchStatus | null> { return this.core.rebuild(uid); }
}

export type SliceDeps = { runtime?: QueueGenRuntime; now?: () => number; enqueue?: typeof enqueueSlice };
export type SliceOutcome = { state: string | null; next: number | null };

/** The consumer's handler for one `deck_gen_slice` message. */
export async function driveQueuedSlice(env: Env, payload: Partial<SliceMessage>, deps: SliceDeps = {}): Promise<SliceOutcome> {
  const uid = typeof payload?.uid === 'string' ? payload.uid : '';
  const slice = Number.isSafeInteger(payload?.slice) && Number(payload.slice) >= 0 ? Number(payload.slice) : 0;
  if (!/^[0-9a-f-]{36}$/.test(uid)) return { state: null, next: null };
  const rt = deps.runtime ?? new QueueGenRuntime(env);
  const before = await rt.status(uid);
  if (!before || !ACTIVE.has(before.state)) return { state: before?.state ?? null, next: null };
  const now = deps.now ?? Date.now;
  const st = await rt.drive(uid, now() + SLICE_MS);
  if (!st || !ACTIVE.has(st.state)) return { state: st?.state ?? null, next: null };
  if (slice + 1 >= MAX_SLICES) {
    console.warn('[deck-gen-queue] slice cap reached', { uid, slice });
    return { state: st.state, next: null };
  }
  await (deps.enqueue ?? enqueueSlice)(env, uid, slice + 1, 1);
  return { state: st.state, next: slice + 1 };
}

// ---- live progress from D1 ---------------------------------------------------

const enc = new TextEncoder();
const sse = (event: string, data: unknown) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const secondsBetween = (a: string | null, b: string | null) => {
  if (!a || !b) return undefined;
  const ms = Date.parse(`${b.replace(' ', 'T')}Z`) - Date.parse(`${a.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 100) / 10 : undefined;
};
const parse = (s: string | null) => { if (s == null) return undefined; try { return JSON.parse(s); } catch { return undefined; } };

/**
 * The events a room would have sent, read from the run's rows: what changed
 * since `seen` (each step's last known state). Pure, so a test can hold it to
 * the room's event shapes.
 */
export function eventsBetween(st: BatchStatus, seen: Map<number, string>): GenEvent[] {
  const out: GenEvent[] = [];
  const held = Number(st.quote_microusd);
  // The run's charged-of-held, as the room sends it: every step that has ended.
  const ended = (x: StepRow) => x.state === 'done' || x.state === 'failed';
  const charged = st.steps.reduce((n, x) => n + (ended(x) ? Number(x.charged_microusd) : 0), 0);
  for (const s of st.steps) {
    const was = seen.get(s.seq) ?? 'waiting';
    if (was === s.state) continue;
    const base = { batch_uid: st.uid, seq: s.seq, card_uid: s.card_uid, area_id: s.area_id, element: s.element, held_microusd: held };
    if (was === 'waiting' && s.state !== 'stopped') out.push({ type: 'area_started', ...base, model_label: modelLabel(s.model), state: 'running', charged_microusd: charged - (ended(s) ? Number(s.charged_microusd) : 0) });
    const fin = { ...base, model_label: modelLabel(s.model_used ?? s.model), seconds: secondsBetween(s.started_at, s.ended_at), cost_microusd: Number(s.charged_microusd), charged_microusd: charged };
    if (s.state === 'done') {
      out.push({ type: 'step_done', ...fin, state: 'done' });
      const variant = parse(s.result);
      if (variant !== undefined) out.push({ type: 'variant_ready', ...fin, state: 'done', variant });
    } else if (s.state === 'failed') {
      out.push({ type: 'area_failed', ...fin, state: 'failed' });
    }
    seen.set(s.seq, s.state);
  }
  if (!ACTIVE.has(st.state) && !seen.has(-1)) {
    out.push({ type: 'batch_done', batch_uid: st.uid, state: st.state, charged_microusd: Number(st.charged_microusd), held_microusd: held });
    seen.set(-1, st.state);
  }
  return out;
}

/**
 * A queue run's live progress as Server-Sent Events: a `snapshot`, then each
 * change read from D1 every `pollMs`, until `batch_done` or `maxMs` (the
 * client's EventSource reconnects and gets a fresh snapshot).
 */
export function eventsFromD1(env: Env, uid: string, opts: { pollMs?: number; maxMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Response {
  const pollMs = opts.pollMs ?? 1000, maxMs = opts.maxMs ?? 10 * 60_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const core = new D1GenRuntime(env, async () => ({ ok: false, charged_microusd: 0 }));
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  void (async () => {
    const first = await core.status(uid);
    if (!first) { await writer.close(); return; }
    await writer.write(sse('snapshot', first));
    // What the snapshot already shows is not sent again.
    const seen = new Map<number, string>(first.steps.map((s: StepRow) => [s.seq, s.state] as [number, string]));
    if (!ACTIVE.has(first.state)) seen.set(-1, first.state);
    const end = Date.now() + maxMs;
    while (!seen.has(-1) && Date.now() < end) {
      await sleep(pollMs);
      const st = await core.status(uid);
      if (!st) break;
      for (const e of eventsBetween(st, seen)) await writer.write(sse(e.type, e));
    }
    await writer.close();
  })().catch(() => writer.close().catch(() => {}));
  return new Response(readable, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
}
