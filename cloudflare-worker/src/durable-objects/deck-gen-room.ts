/**
 * D1502 part 2 (#3753, deck v2 A3a): `DeckGenRoom` — one Durable Object per
 * deck that owns every generation run of that deck.
 *
 * It implements `DeckGenRuntime` (`services/decks/genRuntime.ts`) over the
 * same D1 tables as `D1GenRuntime`, so the contract suite holds it to the same
 * rules, and adds what only a long-lived object can:
 *   - **It drives the run, not the request.** `/admit` admits and sets an
 *     alarm; `alarm()` drives the run's steps with `DRIVERS` drivers at once
 *     (the `AiGovernor` throttles them per kind) in slices of `SLICE_MS`, and
 *     re-arms until the run ends. A closed tab stops nothing.
 *   - **It survives its own restart.** The first alarm in a fresh instance
 *     `rebuild`s each active run from D1 first (a step that charged is done; one
 *     that did not goes back to waiting), so nothing repeats. Cloudflare
 *     retries an alarm that throws.
 *   - **It streams.** `/events` is Server-Sent Events: a `snapshot` of the run,
 *     the run's recent events, then each event as it happens (`area_started`,
 *     `area_busy`, `step_done`, `variant_ready`, `area_failed`, `batch_done`).
 *
 * Only the Worker reaches it (`services/decks/genRooms.ts`), after the route
 * has checked who may read or stop the run; the member's id arrives in
 * `x-deck-user`.
 */
import type { Env } from '../types';
import {
  D1GenRuntime, type AdmitInput, type Admitted, type BatchStatus, type DeckGenRuntime, type GenEvent, type StepExecutor,
} from '../services/decks/genRuntime';
import { stepExecutor } from '../services/decks/stepExecutor';
import { admitStatus } from '../services/decks/genRooms';

export const DRIVERS = 6;
export const SLICE_MS = 10 * 60_000;
const RECENT = 200;
const ACTIVE = new Set(['queued', 'running', 'cancelling']);

type Stream = { uid: string; writer: WritableStreamDefaultWriter<Uint8Array> };
const enc = new TextEncoder();
const sse = (event: string, data: unknown) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

export class DeckGenRoom implements DurableObject, DeckGenRuntime {
  private state: DurableObjectState;
  private runtime: D1GenRuntime;
  private execute: StepExecutor;
  private streams = new Set<Stream>();
  private recent = new Map<string, GenEvent[]>();
  private listeners = new Set<(e: GenEvent) => void>();
  private rebuilt = new Set<string>();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.execute = stepExecutor(env, {
      onBusy: (step, attempt, ms) => this.broadcast({
        type: 'area_busy', batch_uid: step.batch_uid, seq: step.seq, card_uid: step.card_uid, area_id: step.area_id,
        element: step.element, state: 'running', attempt, wait_ms: ms, charged_microusd: -1, held_microusd: -1,
      }),
    });
    this.runtime = new D1GenRuntime(env, (s, c) => this.execute(s, c), (e) => this.broadcast(e));
  }

  /** Tests and the Queue fallback (B9): run steps with another executor. */
  useExecutor(fn: StepExecutor) { this.execute = fn; }
  /** Tests: every event this room emits. */
  onEvent(fn: (e: GenEvent) => void) { this.listeners.add(fn); }

  // ---- DeckGenRuntime ------------------------------------------------------
  admit(input: AdmitInput): Promise<Admitted> { return this.runtime.admit(input); }
  startBatch(uid: string, opts?: { until?: number }): Promise<BatchStatus | null> { return this.runtime.startBatch(uid, opts); }
  cancel(uid: string, userId: number): Promise<BatchStatus | null> { return this.runtime.cancel(uid, userId); }
  status(uid: string): Promise<BatchStatus | null> { return this.runtime.status(uid); }
  rebuild(uid: string): Promise<BatchStatus | null> { return this.runtime.rebuild(uid); }

  // ---- events --------------------------------------------------------------
  private async broadcast(e: GenEvent) {
    // `area_busy` carries no money: fill the running figures from the run.
    if (e.type === 'area_busy') {
      const st = await this.runtime.status(e.batch_uid).catch(() => null);
      e = { ...e, charged_microusd: st ? st.steps.reduce((n, s) => n + Number(s.charged_microusd || 0), 0) : 0, held_microusd: Number(st?.quote_microusd ?? 0) };
    }
    const list = this.recent.get(e.batch_uid) ?? [];
    list.push(e);
    if (list.length > RECENT) list.splice(0, list.length - RECENT);
    this.recent.set(e.batch_uid, list);
    for (const fn of this.listeners) { try { fn(e); } catch { /* a listener never stops the run */ } }
    for (const s of [...this.streams]) {
      if (s.uid !== e.batch_uid) continue;
      try {
        await s.writer.write(sse(e.type, e));
        if (e.type === 'batch_done') { this.streams.delete(s); await s.writer.close(); }
      } catch { this.streams.delete(s); }
    }
  }

  // ---- driving ---------------------------------------------------------------
  private async activeUids(): Promise<string[]> {
    return (await this.state.storage.get<string[]>('active')) ?? [];
  }
  private async kick(uid: string) {
    const active = await this.activeUids();
    if (!active.includes(uid)) await this.state.storage.put('active', [...active, uid]);
    await this.state.storage.setAlarm(Date.now());
  }

  /** Drives every active run for one slice, then re-arms while any is still going. */
  async alarm(): Promise<void> {
    const until = Date.now() + SLICE_MS;
    const still: string[] = [];
    for (const uid of await this.activeUids()) {
      if (!this.rebuilt.has(uid)) { await this.runtime.rebuild(uid); this.rebuilt.add(uid); }
      await Promise.all(Array.from({ length: DRIVERS }, () => this.runtime.startBatch(uid, { until })));
      const st = await this.runtime.status(uid);
      if (st && ACTIVE.has(st.state)) still.push(uid);
    }
    await this.state.storage.put('active', still);
    if (still.length) await this.state.storage.setAlarm(Date.now() + 1_000);
  }

  // ---- the Worker's calls ----------------------------------------------------
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const user = Number(req.headers.get('x-deck-user') || 0);
    if (!Number.isSafeInteger(user) || user <= 0) return json({ error: 'forbidden' }, 403);
    try {
      if (req.method === 'POST' && url.pathname === '/admit') {
        const input = (await req.json()) as AdmitInput;
        if (Number(input.userId) !== user) return json({ error: 'forbidden' }, 403);
        const a = await this.runtime.admit(input);
        if (a.ok) await this.kick(a.uid);
        return json(a, a.ok ? 200 : admitStatus(a.refusal));
      }
      const uid = url.searchParams.get('uid') ?? '';
      if (req.method === 'POST' && url.pathname === '/cancel') {
        const st = await this.runtime.cancel(uid, user);
        if (st && ACTIVE.has(st.state)) await this.kick(uid); // the driver stops the waiting steps and settles
        return st ? json(st) : json({ error: 'not_found' }, 404);
      }
      if (req.method === 'GET' && url.pathname === '/events') {
        const st = await this.runtime.status(uid);
        if (!st) return json({ error: 'not_found' }, 404);
        const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
        const writer = writable.getWriter();
        void (async () => {
          await writer.write(sse('snapshot', st));
          for (const e of this.recent.get(uid) ?? []) await writer.write(sse(e.type, e));
          if (ACTIVE.has(st.state)) this.streams.add({ uid, writer });
          else await writer.close();
        })().catch(() => {});
        return new Response(readable, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
      }
    } catch {
      return json({ error: 'room_failed' }, 500);
    }
    return json({ error: 'not_found' }, 404);
  }
}
