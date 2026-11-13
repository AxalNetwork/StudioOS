/**
 * D886 B2 (#2580): roster and speaker events, batched to the Worker.
 *
 * Every event gets `n`, counting from 1, so the Worker can order them and
 * drop one it already holds. `at_ms` is the time since recording started, the
 * same origin as the audio chunks' `start_ms`, so B6 can lay the speaker
 * timeline over the transcript. A batch that fails stays at the head of the
 * queue for the next flush; past `EVENT_QUEUE_MAX` the oldest are dropped and
 * counted, never silently.
 */
import { EVENT_BATCH_MAX, EVENT_QUEUE_MAX } from './constants.ts';
import { logLine } from './log.ts';
import { withRetry } from './uploader.ts';
import type { BotEvent, CallbackTransport, Clock, LogSink, RosterChange, SpeakerChange, RosterParticipant } from './types.ts';

type Pending = BotEvent;

export class EventBatcher {
  private queue: Pending[] = [];
  private n = 0;
  private readonly participants = new Map<string, RosterParticipant>();
  private sent = 0;
  private dropped = 0;
  private lastSpeaker: string | null | undefined = undefined;
  private flushing: Promise<void> | null = null;
  private readonly transport: CallbackTransport;
  private readonly clock: Clock;
  private readonly log: LogSink;
  private readonly origin: number;
  private readonly signal?: AbortSignal;

  constructor(transport: CallbackTransport, clock: Clock, log: LogSink, origin: number, signal?: AbortSignal) {
    this.transport = transport;
    this.clock = clock;
    this.log = log;
    this.origin = origin;
    this.signal = signal;
  }

  roster(change: RosterChange): void {
    if (!change.key || change.key.length > 128 || !change.name || change.name.length > 160) return;
    const old = this.participants.get(change.key);
    if (!old && this.participants.size >= 500) { this.dropped++; return; }
    this.participants.set(change.key, { id: change.key, name: change.name,
      joined_ms: old?.joined_ms ?? this.at(), left_ms: change.kind === 'leave' ? this.at() : null });
    this.push({ n: ++this.n, type: 'roster', participants: [...this.participants.values()].map(p => ({...p})) });
  }

  /** One event per change of active speaker; a repeat of the current speaker is not an event. */
  speaker(change: SpeakerChange): void {
    if (change.key === this.lastSpeaker) return;
    this.lastSpeaker = change.key;
    this.push({ n: ++this.n, type: 'speaker', participant_id: change.key, at_ms: this.at() });
  }

  get sentCount(): number { return this.sent; }
  get droppedCount(): number { return this.dropped; }
  get pendingCount(): number { return this.queue.length; }

  /** Send what is queued, in batches of at most `EVENT_BATCH_MAX`. Concurrent calls share one flush. */
  flush(tries?: number): Promise<void> {
    if (!this.flushing) this.flushing = this.run(tries).finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private at(): number {
    return Math.max(0, this.clock.now() - this.origin);
  }

  private push(e: Pending): void {
    this.queue.push(e);
    if (this.queue.length > EVENT_QUEUE_MAX) {
      const over = this.queue.length - EVENT_QUEUE_MAX;
      this.queue.splice(0, over);
      this.dropped += over;
      logLine(this.log, 'events_dropped', { count: over });
    }
    if (this.queue.length >= EVENT_BATCH_MAX) void this.flush();
  }

  private async run(tries?: number): Promise<void> {
    while (this.queue.length && !this.signal?.aborted) {
      const batch = this.queue.slice(0, EVENT_BATCH_MAX);
      const ok = await withRetry(() => this.transport.events(batch), this.clock, tries,this.signal);
      if (!ok) {
        logLine(this.log, 'events_retry_later', { count: batch.length });
        return;
      }
      // Events dropped for overflow while this batch was in flight shift the queue; remove by `n`.
      const last = batch[batch.length - 1].n;
      this.queue = this.queue.filter((e) => e.n > last);
      this.sent += batch.length;
    }
  }
}
