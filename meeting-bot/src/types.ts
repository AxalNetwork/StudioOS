/**
 * D886 B2 (#2580): the contract between the bot's core and a platform adapter.
 *
 * The core owns everything that is the same on Zoom, Google Meet and Teams:
 * the lifecycle, the recording notice, when to leave, the audio chunks and the
 * roster and speaker events. An adapter owns one platform's page or SDK and
 * nothing else. B3 (Meet), B4 (Zoom) and B5 (Teams) each implement
 * `MeetingAdapter`; `fakeAdapter.ts` is the reference implementation.
 *
 * Nothing in this file names a host: B0 (#2578) chooses where the bot runs and
 * B8 (#2586) packages it.
 */

export type Platform = 'zoom' | 'google_meet' | 'teams';

/** The failure codes D886 defines, as the bot reports them. */
export type FailureCode = 'not_admitted' | 'meeting_ended' | 'link_invalid' | 'platform_blocked' | 'obf_unavailable';

/** Why a run that recorded ended. */
export type LeaveReason = 'call_ended' | 'alone' | 'stopped' | 'time_limit';

/** The states the bot reports; B1's Durable Object is the only writer of the run's status. */
export type BotState = 'joining' | 'waiting_room' | 'recording' | 'left' | 'failed';

/** An adapter's refusal, carrying one of D886's codes and never the platform's own message. */
export class AdapterFailure extends Error {
  readonly code: FailureCode;
  constructor(code: FailureCode) {
    super(code);
    this.name = 'AdapterFailure';
    this.code = code;
  }
}

export type Unsubscribe = () => void;

/** 16 kHz mono 16-bit PCM, the format D872's chunk route admits. */
export interface AudioFrame {
  readonly samples: Int16Array;
}

/**
 * One person joining or leaving. `key` is the platform's own id for the
 * participant within this call, stable across a rename; `name` is the display
 * label they chose, never proof of who they are (D876 §3). The bot itself is
 * never reported.
 */
export interface RosterChange {
  readonly kind: 'join' | 'leave';
  readonly key: string;
  readonly name: string;
}

/** The platform's active-speaker indicator moved; `key` null means nobody is speaking. */
export interface SpeakerChange {
  readonly key: string | null;
}

export interface JoinRequest {
  readonly url: string;
  readonly botName: string;
  readonly signal: AbortSignal;
}

/**
 * One platform. Every method may throw `AdapterFailure`; any other error is
 * read as `platform_blocked`. Subscriptions return their own unsubscribe.
 */
export interface MeetingAdapter {
  readonly platform: Platform;
  /** Open the meeting and ask to join under `botName`. Resolves in the lobby or in the call. */
  join(req: JoinRequest): Promise<void>;
  /** Resolves once the host admits the bot; rejects with `not_admitted` when refused. */
  admitted(signal: AbortSignal): Promise<void>;
  /** Post one message in the meeting chat. */
  sendChat(text: string): Promise<void>;
  audio(on: (frame: AudioFrame) => void): Unsubscribe;
  roster(on: (change: RosterChange) => void): Unsubscribe;
  speakers(on: (change: SpeakerChange) => void): Unsubscribe;
  /** The call ended for everyone. */
  ended(on: () => void): Unsubscribe;
  /** Leave the call. Must not throw on a call that already ended. */
  leave(): Promise<void>;
}

/** What B1's Durable Object hands the runtime when it starts a run. */
export interface RunConfig {
  readonly runId: string;
  readonly platform: Platform;
  readonly meetingUrl: string;
  /** The recording notice posted in the meeting chat, in D886's wording. The Worker owns the text. */
  readonly notice: string;
  /** The founder's plan limit in ms: 30 minutes on a free Axal plan, 2 hours on a paid one. */
  readonly limitMs: number;
}

/** A roster or speaker event as it is sent to the callback. `n` orders and de-duplicates them. */
export type BotEvent =
  | { readonly n: number; readonly type: 'roster'; readonly kind: 'join' | 'leave'; readonly key: string; readonly name: string; readonly at_ms: number }
  | { readonly n: number; readonly type: 'speaker'; readonly key: string | null; readonly at_ms: number };

export interface StatusReport {
  readonly state: BotState;
  readonly reason?: LeaveReason;
  readonly code?: FailureCode;
  /** Counts only. */
  readonly chunks?: number;
  readonly last_seq?: number;
  readonly chunks_failed?: number;
  readonly events?: number;
  readonly events_dropped?: number;
  readonly participants?: number;
}

/**
 * How the bot talks to B1's Worker callback. `httpTransport` in `callback.ts`
 * is the HTTP implementation; tests use a stub.
 */
export interface CallbackTransport {
  status(report: StatusReport): Promise<void>;
  events(batch: readonly BotEvent[]): Promise<void>;
  /** Store one audio chunk. Sending the same `seq` twice stores it once. */
  putChunk(seq: number, wav: Uint8Array<ArrayBuffer>): Promise<void>;
}

/** Timers the core uses, injectable so tests run on a fake clock. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): () => void;
  sleep(ms: number): Promise<void>;
}

/** Where log lines go: an event name and fields already filtered by `safeFields` (`log.ts`). */
export type LogSink = (event: string, fields: Readonly<Record<string, string | number | boolean>>) => void;
