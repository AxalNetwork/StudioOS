/**
 * D886 B2 (#2580): a fake clock and a stub callback for the core's tests.
 * Time moves only when a test advances it, so a two-hour call runs in
 * milliseconds and every timer fires in order.
 */
import type { BotEvent, CallbackTransport, Clock, StatusReport } from '../src/types.ts';

/** Let every pending promise callback run. */
export const settle = async (rounds = 20) => { for (let i = 0; i < rounds; i += 1) await new Promise((r) => setImmediate(r)); };

export class FakeClock implements Clock {
  t = 1_000_000;
  private timers: Array<{ at: number; id: number; fn: () => void }> = [];
  private nextId = 1;

  now(): number { return this.t; }

  setTimeout(fn: () => void, ms: number): () => void {
    const id = this.nextId++;
    this.timers.push({ at: this.t + Math.max(0, ms), id, fn });
    return () => { this.timers = this.timers.filter((x) => x.id !== id); };
  }

  sleep(ms: number): Promise<void> { return new Promise((r) => { this.setTimeout(r, ms); }); }

  /** Move time forward by `ms`, firing each timer due on the way, in order. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    await settle();
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = next.at;
      next.fn();
      await settle();
    }
    this.t = end;
    await settle();
  }

  /** Advance in steps until `p` settles (for retries with backoff). */
  async until<T>(p: Promise<T>, step = 1000, maxSteps = 10_000): Promise<T> {
    let done = false;
    p.then(() => { done = true; }, () => { done = true; });
    for (let i = 0; i < maxSteps && !done; i += 1) await this.advance(step);
    return p;
  }
}

/**
 * A Worker callback in memory. It stores a chunk by `seq`, once, as D872's
 * `putChunk` does. `failChunk` makes the next N sends of a `seq` fail;
 * `lostAnswer` stores the chunk and then fails, as a dropped connection after
 * the Worker answered would.
 */
export class StubCallback implements CallbackTransport {
  readonly statuses: StatusReport[] = [];
  readonly batches: BotEvent[][] = [];
  readonly chunks = new Map<number, Uint8Array<ArrayBuffer>>();
  chunkSends = 0;
  readonly failChunk = new Map<number, number>();
  readonly lostAnswer = new Set<number>();
  failEvents = 0;
  failStatus = 0;

  async status(report: StatusReport): Promise<void> {
    if (this.failStatus > 0) { this.failStatus -= 1; throw new Error('down'); }
    this.statuses.push(report);
  }

  async events(batch: readonly BotEvent[]): Promise<void> {
    if (this.failEvents > 0) { this.failEvents -= 1; throw new Error('down'); }
    this.batches.push([...batch]);
  }

  async putChunk(seq: number, wav: Uint8Array<ArrayBuffer>): Promise<void> {
    this.chunkSends += 1;
    const left = this.failChunk.get(seq) ?? 0;
    if (left > 0) { this.failChunk.set(seq, left - 1); throw new Error('connection reset'); }
    if (!this.chunks.has(seq)) this.chunks.set(seq, wav);
    if (this.lostAnswer.delete(seq)) throw new Error('connection reset');
  }

  get allEvents(): BotEvent[] { return this.batches.flat(); }
}

/** `n` samples of a steady tone, as 16-bit PCM. */
export function tone(n: number, amp = 1000): Int16Array {
  const out = new Int16Array(n);
  for (let i = 0; i < n; i += 1) out[i] = Math.round(amp * Math.sin(i / 10));
  return out;
}
