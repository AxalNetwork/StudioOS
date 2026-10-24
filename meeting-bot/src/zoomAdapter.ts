/** D886 B4: Zoom orchestration behind an injected Linux Meeting SDK bridge.
 * No native SDK or credentials are packaged here. See README's Zoom boundary.
 */
import { AdapterFailure } from './types.ts';
import type { AudioFrame, JoinRequest, MeetingAdapter, RosterChange, SpeakerChange, Unsubscribe } from './types.ts';

export type ZoomObf = { token: string } | { waitingForHost: true };
/** The native sidecar must translate SDK errors into these codes, never messages. */
export class ZoomJoinFailure extends Error {
  readonly code: 'authorized_user_absent' | 'refused' | 'ended';
  constructor(code: 'authorized_user_absent' | 'refused' | 'ended') { super(code); this.code = code; }
}
/** Single-run bridge. Every async operation must honor signal and release SDK buffers. */
export interface ZoomSdkBridge {
  join(input: { meetingId: string; passcode: string; botName: string; obfToken: string; signal: AbortSignal }): Promise<void>;
  admitted(signal: AbortSignal): Promise<{ selfKey: string }>;
  sendChat(text: string): Promise<void>;
  joinAudio(signal: AbortSignal): Promise<void>;
  /** CanStartRawRecording; if false, await RequestLocalRecordingPrivilege's host response. */
  recordingAllowed(signal: AbortSignal): Promise<boolean>;
  requestRecordingPrivilege(signal: AbortSignal): Promise<boolean>;
  startRawRecording(signal: AbortSignal): Promise<void>;
  /** Mixed PCM only: 16 kHz mono signed 16-bit; borrowed SDK buffers must be copied. */
  mixedAudio(on: (samples: Int16Array) => void): Unsubscribe;
  /** Replay the current roster synchronously on subscribe, followed by changes/renames. */
  roster(on: (change: RosterChange) => void): Unsubscribe;
  speakers(on: (change: SpeakerChange) => void): Unsubscribe;
  /** Also fires when the authorizing user leaves or recording privilege is revoked. */
  ended(on: () => void): Unsubscribe;
  leave(): Promise<void>;
}

export function zoomMeeting(raw: string): { meetingId: string; passcode: string } {
  try {
    const u = new URL(raw);
    const path = /^\/(?:j\/|wc\/join\/)(\d{6,20})\/?$/.exec(u.pathname);
    if (u.protocol !== 'https:' || u.username || u.password || u.port ||
        !(u.hostname === 'zoom.us' || u.hostname.endsWith('.zoom.us')) || !path) throw 0;
    const passcode = u.searchParams.get('pwd') ?? '';
    if (passcode.length > 256 || /[\x00-\x1f\x7f]/.test(passcode)) throw 0;
    return { meetingId: path[1], passcode };
  } catch { throw new AdapterFailure('link_invalid'); }
}

const stopped = (signal: AbortSignal) => { if (signal.aborted) throw new AdapterFailure('obf_unavailable'); };
const pause = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  stopped(signal);
  const abort = () => { clearTimeout(timer); reject(new AdapterFailure('obf_unavailable')); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 3000);
  signal.addEventListener('abort', abort, { once: true });
});

export interface ZoomAdapterDeps {
  sdk: ZoomSdkBridge;
  /** B1 supplies the founder-scoped mint; OAuth credentials never enter the adapter. */
  mintObf(meetingId: string, signal: AbortSignal): Promise<ZoomObf>;
  /** Integration hook for B1's waiting_for_host state. Contains no meeting data. */
  waitingForHost(): Promise<void>;
  wait?: (signal: AbortSignal) => Promise<void>;
}

export class ZoomAdapter implements MeetingAdapter {
  readonly platform = 'zoom' as const;
  private readonly deps: ZoomAdapterDeps;
  private signal: AbortSignal = new AbortController().signal;
  private selfKey: string | null = null;
  private joined = false;
  private ready = false;
  private left = false;
  private readonly subs = new Set<Unsubscribe>();
  constructor(deps: ZoomAdapterDeps) { this.deps = deps; }

  async join(req: JoinRequest): Promise<void> {
    if (this.joined || this.left) throw new AdapterFailure('platform_blocked');
    const meeting = zoomMeeting(req.url);
    this.signal = req.signal;
    this.joined = true;
    // At most six minutes; fresh single-use OBF on every retry. No token on this instance.
    const joinSignal = AbortSignal.any([req.signal, AbortSignal.timeout(360_000)]);
    for (let attempt = 0; attempt < 120; attempt++) {
      stopped(joinSignal);
      try {
        const result = await this.deps.mintObf(meeting.meetingId, joinSignal);
        stopped(joinSignal);
        if ('token' in result) {
          if (!result.token.trim()) throw new AdapterFailure('obf_unavailable');
          await this.deps.sdk.join({ ...meeting, botName: req.botName, obfToken: result.token, signal: joinSignal });
          stopped(joinSignal);
          return;
        }
      } catch (e) {
        if (!(e instanceof ZoomJoinFailure && e.code === 'authorized_user_absent')) {
          if (e instanceof ZoomJoinFailure && e.code === 'ended') throw new AdapterFailure('meeting_ended');
          throw new AdapterFailure('obf_unavailable');
        }
      }
      await this.deps.waitingForHost();
      await (this.deps.wait ?? pause)(joinSignal);
    }
    throw new AdapterFailure('obf_unavailable');
  }

  async admitted(signal: AbortSignal): Promise<void> {
    try { this.selfKey = (await this.deps.sdk.admitted(signal)).selfKey; stopped(signal); }
    catch { throw new AdapterFailure('not_admitted'); }
    if (!this.selfKey) throw new AdapterFailure('platform_blocked');
  }

  async sendChat(text: string): Promise<void> {
    if (this.left || !this.selfKey) throw new AdapterFailure('platform_blocked');
    // The core's notice is sent before asking for raw recording, not just before subscribing.
    try {
      await this.deps.sdk.sendChat(text);
      await this.deps.sdk.joinAudio(this.signal);
      if (!(await this.deps.sdk.recordingAllowed(this.signal)) &&
          !(await this.deps.sdk.requestRecordingPrivilege(this.signal))) throw 0;
      await this.deps.sdk.startRawRecording(this.signal);
      stopped(this.signal);
      this.ready = true;
    } catch { throw new AdapterFailure('platform_blocked'); }
  }

  private subscribe(make: () => Unsubscribe): Unsubscribe {
    if (!this.ready || this.left) throw new AdapterFailure('platform_blocked');
    const off = make();
    const dispose = () => { if (this.subs.delete(dispose)) off(); };
    this.subs.add(dispose);
    return dispose;
  }
  audio(on: (frame: AudioFrame) => void): Unsubscribe {
    return this.subscribe(() => this.deps.sdk.mixedAudio(samples => {
      if (this.ready && !this.left) on({ samples: samples.slice() });
    }));
  }
  roster(on: (change: RosterChange) => void): Unsubscribe {
    return this.subscribe(() => this.deps.sdk.roster(c => { if (!this.left && c.key !== this.selfKey) on(c); }));
  }
  speakers(on: (change: SpeakerChange) => void): Unsubscribe {
    return this.subscribe(() => this.deps.sdk.speakers(c => { if (!this.left) on({ key: c.key === this.selfKey ? null : c.key }); }));
  }
  ended(on: () => void): Unsubscribe {
    return this.subscribe(() => this.deps.sdk.ended(() => {
      this.ready = false; // No late PCM after SDK end, privilege loss or founder departure.
      on();
    }));
  }
  async leave(): Promise<void> {
    if (this.left) return;
    this.left = true;
    this.ready = false;
    for (const off of this.subs) off();
    try { await this.deps.sdk.leave(); } catch { /* Already ended; never expose native messages. */ }
    this.selfKey = null;
  }
}
