/**
 * D886 B2 (#2580): a scripted platform, for the core's tests and as the
 * reference B3–B5 copy.
 *
 * A test drives it the way a meeting would: `admit()` or `refuse()` from the
 * host, `join()` / `leave()` of participants, `speak()`, `say()` with PCM, and
 * `end()` for the whole call. It records what the bot did to it: the chat
 * messages it posted, whether it joined and left, and how many listeners are
 * still attached.
 *
 * Contract every real adapter keeps, shown here:
 * - `roster` reports everyone already in the call as a `join` when subscribed,
 *   then each change; it never reports the bot itself;
 * - `audio` frames are 16 kHz mono 16-bit PCM (`toPcm16k` in `wav.ts` converts);
 * - a refusal is an `AdapterFailure` with one of D886's codes;
 * - `leave` is safe to call twice, and after the call ended.
 */
import { AdapterFailure } from './types.ts';
import type { AudioFrame, FailureCode, JoinRequest, MeetingAdapter, Platform, RosterChange, SpeakerChange, Unsubscribe } from './types.ts';

type Listener<T> = (v: T) => void;

class Topic<T> {
  readonly listeners = new Set<Listener<T>>();
  on(fn: Listener<T>): Unsubscribe {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  emit(v: T): void { for (const fn of [...this.listeners]) fn(v); }
}

export interface FakeOptions {
  readonly platform?: Platform;
  /** `join` throws this code. */
  readonly joinFails?: FailureCode;
  /** `sendChat` fails this many times before it works. */
  readonly chatFailures?: number;
  /** The bot is let straight in, with no waiting room. */
  readonly openDoor?: boolean;
}

export class FakeAdapter implements MeetingAdapter {
  readonly platform: Platform;
  readonly chat: string[] = [];
  joinedAs: string | null = null;
  joinedUrl: string | null = null;
  leaveCalls = 0;
  /** In order: what the bot did, for asserting that the notice came before listening. */
  readonly calls: string[] = [];

  private readonly opts: FakeOptions;
  private readonly people = new Map<string, string>();
  private admitResolve: (() => void) | null = null;
  private admitReject: ((e: Error) => void) | null = null;
  private isAdmitted = false;
  private chatFailuresLeft: number;
  private readonly audioTopic = new Topic<AudioFrame>();
  private readonly rosterTopic = new Topic<RosterChange>();
  private readonly speakerTopic = new Topic<SpeakerChange>();
  private readonly endTopic = new Topic<void>();

  constructor(opts: FakeOptions = {}) {
    this.opts = opts;
    this.platform = opts.platform ?? 'google_meet';
    this.chatFailuresLeft = opts.chatFailures ?? 0;
    this.isAdmitted = !!opts.openDoor;
  }

  // ── what the bot calls ──

  async join(req: JoinRequest): Promise<void> {
    this.calls.push('join');
    if (this.opts.joinFails) throw new AdapterFailure(this.opts.joinFails);
    this.joinedAs = req.botName;
    this.joinedUrl = req.url;
  }

  admitted(signal: AbortSignal): Promise<void> {
    this.calls.push('admitted');
    if (this.isAdmitted) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.admitResolve = resolve;
      this.admitReject = reject;
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  }

  async sendChat(text: string): Promise<void> {
    this.calls.push('chat');
    if (this.chatFailuresLeft > 0) { this.chatFailuresLeft -= 1; throw new Error('chat closed'); }
    this.chat.push(text);
  }

  audio(on: Listener<AudioFrame>): Unsubscribe { this.calls.push('audio'); return this.audioTopic.on(on); }

  roster(on: Listener<RosterChange>): Unsubscribe {
    this.calls.push('roster');
    const off = this.rosterTopic.on(on);
    for (const [key, name] of this.people) on({ kind: 'join', key, name });
    return off;
  }

  speakers(on: Listener<SpeakerChange>): Unsubscribe { this.calls.push('speakers'); return this.speakerTopic.on(on); }
  ended(on: () => void): Unsubscribe { return this.endTopic.on(on); }

  async leave(): Promise<void> {
    this.calls.push('leave');
    this.leaveCalls += 1;
  }

  // ── what the meeting does ──

  admit(): void { this.isAdmitted = true; this.admitResolve?.(); }
  refuse(): void { this.admitReject?.(new AdapterFailure('not_admitted')); }
  /** A participant already present before the bot subscribes is reported on subscribe. */
  arrive(key: string, name: string): void { this.people.set(key, name); this.rosterTopic.emit({ kind: 'join', key, name }); }
  depart(key: string): void {
    const name = this.people.get(key);
    if (name === undefined) return;
    this.people.delete(key);
    this.rosterTopic.emit({ kind: 'leave', key, name });
  }
  speak(key: string | null): void { this.speakerTopic.emit({ key }); }
  say(samples: Int16Array): void { this.audioTopic.emit({ samples }); }
  end(): void { this.endTopic.emit(); }

  /** Listeners still attached; zero once the bot has left. */
  get listening(): number {
    return this.audioTopic.listeners.size + this.rosterTopic.listeners.size + this.speakerTopic.listeners.size + this.endTopic.listeners.size;
  }
}
