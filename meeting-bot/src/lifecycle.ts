/**
 * D886 B2 (#2580): one bot run, from join to leave, on any platform.
 *
 *   joining → waiting_room → recording → left
 *                    ↘           ↘
 *                     failed (one of D886's codes)
 *
 * - The bot joins as "Eadwyn AI" and waits in the lobby or waiting room until
 *   the host admits it, for at most `ADMIT_TIMEOUT_MS` (`not_admitted`).
 * - Once in, it posts the recording notice in the meeting chat **before** it
 *   listens to anything. A notice that cannot be posted ends the run as
 *   `platform_blocked`, with no audio taken.
 * - It records until the call ends, it has been alone for `ALONE_MS`, the
 *   founder presses Stop (the `stop` signal), or the plan's limit passes.
 * - Audio goes out as ~30 s WAV chunks as they complete, events in batches;
 *   both are drained after the bot leaves, then the final status is sent.
 *
 * The Worker's Durable Object (B1) is the only writer of the run's status;
 * the bot reports, it does not decide what the founder sees.
 */
import { ADMIT_TIMEOUT_MS, ALONE_MS, BOT_NAME, EVENT_FLUSH_MS, NOTICE_TRIES, PAID_LIMIT_MS } from './constants.ts';
import { EventBatcher } from './events.ts';
import { logLine } from './log.ts';
import { ChunkUploader, withRetry } from './uploader.ts';
import { Chunker } from './wav.ts';
import { AdapterFailure } from './types.ts';
import type { CallbackTransport, Clock, FailureCode, LeaveReason, LogSink, MeetingAdapter, RunConfig, StatusReport, Unsubscribe } from './types.ts';

export interface RunDeps {
  readonly adapter: MeetingAdapter;
  readonly transport: CallbackTransport;
  readonly clock?: Clock;
  readonly log?: LogSink;
  /** Aborted when the founder presses Stop. */
  readonly stop?: AbortSignal;
}

export interface RunResult extends StatusReport {
  readonly state: 'left' | 'failed';
}

/** Real timers. */
export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const silent: LogSink = () => {};

/** The run's config is the Worker's; a bad one is a bug there, refused before anything is joined. */
export function checkConfig(cfg: RunConfig): void {
  if (!cfg.notice || !cfg.notice.trim()) throw new Error('notice_required');
  if (!Number.isFinite(cfg.limitMs) || cfg.limitMs <= 0 || cfg.limitMs > PAID_LIMIT_MS) throw new Error('limit_out_of_range');
}

function meetingUrlOk(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
}

const codeOf = (err: unknown): FailureCode => (err instanceof AdapterFailure ? err.code : 'platform_blocked');

export async function runBot(cfg: RunConfig, deps: RunDeps): Promise<RunResult> {
  checkConfig(cfg);
  const { adapter, transport } = deps;
  const clock = deps.clock ?? realClock;
  const log = deps.log ?? silent;
  const stop = deps.stop ?? new AbortController().signal;
  const platform = cfg.platform;

  const report = async (r: StatusReport) => {
    logLine(log, 'status', { platform, state: r.state, reason: r.reason, code: r.code });
    if (!(await withRetry(() => transport.status(r), clock))) logLine(log, 'status_unsent', { state: r.state });
  };

  const fail = async (code: FailureCode): Promise<RunResult> => {
    await adapter.leave().catch(() => {});
    const r: RunResult = { state: 'failed', code };
    await report(r);
    return r;
  };

  if (!meetingUrlOk(cfg.meetingUrl)) return fail('link_invalid');

  // Stop before admission leaves without recording; the run still ends as `stopped`.
  const leftEarly = async (): Promise<RunResult> => {
    await adapter.leave().catch(() => {});
    const r: RunResult = { state: 'left', reason: 'stopped', chunks: 0, last_seq: -1, chunks_failed: 0, events: 0, events_dropped: 0 };
    await report(r);
    return r;
  };

  await report({ state: 'joining' });
  const waiting = new AbortController();
  const onStop = () => waiting.abort();
  stop.addEventListener('abort', onStop);
  try {
    if (stop.aborted) return await leftEarly();
    try {
      await adapter.join({ url: cfg.meetingUrl, botName: BOT_NAME, signal: waiting.signal });
    } catch (err) {
      if (stop.aborted) return await leftEarly();
      return await fail(codeOf(err));
    }
    await report({ state: 'waiting_room' });
    let cancelAdmit: () => void = () => {};
    const admitTimeout = new Promise<'timeout'>((r) => { cancelAdmit = clock.setTimeout(() => r('timeout'), ADMIT_TIMEOUT_MS); });
    const stopped = new Promise<'stopped'>((r) => {
      if (stop.aborted) r('stopped');
      else stop.addEventListener('abort', () => r('stopped'), { once: true });
    });
    const admitted = adapter.admitted(waiting.signal).then(() => 'admitted' as const);
    admitted.catch(() => {}); // a refusal after the timeout or a Stop has nothing left to fail
    let outcome: 'admitted' | 'timeout' | 'stopped';
    try {
      outcome = await Promise.race([admitted, admitTimeout, stopped]);
    } catch (err) {
      cancelAdmit();
      if (stop.aborted) return await leftEarly();
      return await fail(codeOf(err));
    }
    cancelAdmit();
    if (outcome === 'stopped') return await leftEarly();
    if (outcome === 'timeout') { waiting.abort(); return await fail('not_admitted'); }
  } finally {
    stop.removeEventListener('abort', onStop);
  }

  // The notice goes up before the bot listens to anything.
  if (!(await withRetry(() => adapter.sendChat(cfg.notice), clock, NOTICE_TRIES))) {
    logLine(log, 'notice_unsent', { platform });
    return fail('platform_blocked');
  }
  logLine(log, 'notice_posted', { platform });

  return record(cfg, adapter, transport, clock, log, stop, report);
}

async function record(
  cfg: RunConfig,
  adapter: MeetingAdapter,
  transport: CallbackTransport,
  clock: Clock,
  log: LogSink,
  stop: AbortSignal,
  report: (r: StatusReport) => Promise<void>,
): Promise<RunResult> {
  const origin = clock.now();
  const chunker = new Chunker();
  const uploader = new ChunkUploader(transport, clock, log);
  const events = new EventBatcher(transport, clock, log, origin);
  const present = new Set<string>();
  const seen = new Set<string>();
  const subs: Unsubscribe[] = [];
  const timers: Array<() => void> = [];

  let finish: (reason: LeaveReason) => void = () => {};
  const done = new Promise<LeaveReason>((r) => { finish = r; });

  let cancelAlone: (() => void) | null = null;
  const checkAlone = () => {
    if (present.size === 0 && !cancelAlone) cancelAlone = clock.setTimeout(() => finish('alone'), ALONE_MS);
    if (present.size > 0 && cancelAlone) { cancelAlone(); cancelAlone = null; }
  };

  const tick = () => {
    void events.flush();
    timers.push(clock.setTimeout(tick, EVENT_FLUSH_MS));
  };

  await report({ state: 'recording' });
  subs.push(adapter.ended(() => finish('call_ended')));
  subs.push(adapter.roster((c) => {
    if (c.kind === 'join') { present.add(c.key); seen.add(c.key); } else present.delete(c.key);
    events.roster(c);
    checkAlone();
  }));
  subs.push(adapter.speakers((c) => events.speaker(c)));
  subs.push(adapter.audio((f) => { for (const chunk of chunker.push(f.samples)) uploader.add(chunk); }));
  if (stop.aborted) finish('stopped');
  else stop.addEventListener('abort', () => finish('stopped'), { once: true });
  timers.push(clock.setTimeout(() => finish('time_limit'), cfg.limitMs));
  timers.push(clock.setTimeout(tick, EVENT_FLUSH_MS));
  checkAlone();

  const reason = await done;
  for (const u of subs) u();
  for (const t of timers) t();
  if (cancelAlone) (cancelAlone as () => void)();
  await adapter.leave().catch(() => {});
  logLine(log, 'left', { platform: cfg.platform, reason });

  const tail = chunker.flush();
  if (tail) uploader.add(tail);
  await uploader.drain();
  await events.flush();

  const r: RunResult = {
    state: 'left',
    reason,
    chunks: uploader.storedCount,
    last_seq: uploader.lastSeq,
    chunks_failed: uploader.failedCount,
    events: events.sentCount,
    events_dropped: events.droppedCount + events.pendingCount,
    participants: seen.size,
  };
  await report(r);
  return r;
}
