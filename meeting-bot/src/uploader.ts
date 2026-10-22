/**
 * D886 B2 (#2580): audio chunks to the Worker, as they complete, in order.
 *
 * A chunk is sent with its `seq`; the Worker stores a repeated `seq` once
 * (D872's `putChunk`), so a send whose answer was lost is simply sent again.
 * A failed send is retried with backoff; a chunk that still fails stays
 * queued and is tried again by the next pass, so a dropped connection costs
 * time, never audio. `drain` makes the last pass when the call ends.
 */
import { RETRY_BASE_MS, RETRY_MAX_MS, RETRY_TRIES } from './constants.ts';
import { logLine } from './log.ts';
import type { Chunk } from './wav.ts';
import type { CallbackTransport, Clock, LogSink } from './types.ts';

/** Backoff for try `i` (0-based): 1 s, 2 s, 4 s … capped at 30 s. */
export function backoffMs(i: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** i);
}

/** Run `send` until it resolves or `tries` are spent. True when it went through. */
export async function withRetry(send: () => Promise<void>, clock: Clock, tries: number = RETRY_TRIES): Promise<boolean> {
  for (let i = 0; i < tries; i += 1) {
    try {
      await send();
      return true;
    } catch {
      if (i < tries - 1) await clock.sleep(backoffMs(i));
    }
  }
  return false;
}

export class ChunkUploader {
  private readonly queue: Chunk[] = [];
  private readonly stored = new Set<number>();
  private running: Promise<void> | null = null;
  private readonly transport: CallbackTransport;
  private readonly clock: Clock;
  private readonly log: LogSink;

  constructor(transport: CallbackTransport, clock: Clock, log: LogSink) {
    this.transport = transport;
    this.clock = clock;
    this.log = log;
  }

  /** Queue a chunk and start sending if nothing is. */
  add(chunk: Chunk): void {
    this.queue.push(chunk);
    if (!this.running) this.running = this.pass().finally(() => { this.running = null; });
  }

  /** Send everything still queued, once more each, and wait for it. */
  async drain(): Promise<void> {
    while (this.running) await this.running;
    if (this.queue.length) {
      this.running = this.pass();
      await this.running;
      this.running = null;
    }
  }

  get storedCount(): number { return this.stored.size; }
  get failedCount(): number { return this.queue.length; }
  /** The highest `seq` the Worker holds, or -1. */
  get lastSeq(): number { return this.stored.size ? Math.max(...this.stored) : -1; }

  /** One pass over the queue, in `seq` order. A chunk that fails every try stays queued; the rest go on. */
  private async pass(): Promise<void> {
    const kept: Chunk[] = [];
    while (this.queue.length) {
      const chunk = this.queue.shift()!;
      const ok = await withRetry(() => this.transport.putChunk(chunk.seq, chunk.wav), this.clock);
      if (ok) {
        this.stored.add(chunk.seq);
        logLine(this.log, 'chunk_stored', { seq: chunk.seq, bytes: chunk.wav.byteLength });
      } else {
        kept.push(chunk);
        logLine(this.log, 'chunk_retry_later', { seq: chunk.seq });
      }
    }
    this.queue.push(...kept);
  }
}
