/**
 * D886 B5 (#2583): Microsoft Teams, joined from a browser as the guest
 * "Eadwyn AI". It implements B2's `MeetingAdapter`; the core (`lifecycle.ts`)
 * does everything else.
 *
 *   join      the link (work or school, or Teams free) → the launcher's
 *             "Continue on this browser" → the pre-join screen, name filled,
 *             microphone and camera off → Join now. Resolves in the lobby or
 *             in the call.
 *   admitted  waits in the lobby, ordinary or "Suspected threats" (Teams'
 *             2026 external-bot detection), until the organizer admits it.
 *   sendChat  the recording notice, through the meeting chat.
 *   roster    the People pane: everyone but the bot, by Teams' id for them.
 *   speakers  live captions' speaker names, matched to roster ids. Captions
 *             are Teams' own attribution; the per-tile speaking outline is
 *             reported to be on for everyone, so it is not used. A caption's
 *             words are never read: the page driver returns attributes only.
 *   audio     the call audio the page captures, through `toPcm16k`.
 *
 * Refusals, as D886's codes (never Teams' own message):
 *   platform_blocked  a captcha (never solved), anonymous join turned off by
 *                     the organizer's policy, a detected bot blocked
 *                     (`BlockDetectedBots`), or a screen it does not know;
 *   not_admitted      the organizer denied it in the lobby;
 *   link_invalid      not a Teams meeting link, or "meeting not found";
 *   meeting_ended     the call ended before it was let in.
 *
 * The browser is behind `TeamsPage`, so this file has no dependency and its
 * tests drive it on recorded screens. B8 (#2586) gives it a Playwright page.
 * Every selector is in `teamsSelectors.ts`.
 */
import { AdapterFailure } from '../types.ts';
import type { AudioFrame, Clock, FailureCode, JoinRequest, MeetingAdapter, RosterChange, SpeakerChange, Unsubscribe } from '../types.ts';
import { toPcm16k } from '../wav.ts';
import { realClock } from '../lifecycle.ts';
import { CAPTION_SPEAKER, ROSTER_KEY, ROSTER_NAME, ROSTER_SELF, TEAMS, teamsJoinUrl } from './teamsSelectors.ts';
import type { Probe } from './teamsSelectors.ts';

/** One element's attributes, as asked for; a missing attribute is null. */
export type Attrs = Readonly<Record<string, string | null>>;

/**
 * What the adapter needs from a browser page. Attributes only: no method
 * returns an element's text, so a caption's or a chat message's words can
 * never reach the adapter.
 */
export interface TeamsPage {
  goto(url: string): Promise<void>;
  /** Each element matching `selector`, in page order, with the attributes named; [] when none. */
  query(selector: string, attrs: readonly string[]): Promise<readonly Attrs[]>;
  click(selector: string): Promise<void>;
  fill(selector: string, text: string): Promise<void>;
  /** The call's audio as the page captures it: mono float samples in [-1, 1] at `rate` Hz. */
  onAudio(on: (samples: Float32Array, rate: number) => void): Unsubscribe;
  close(): Promise<void>;
}

export interface TeamsOptions {
  readonly clock?: Clock;
  /** How often the page is read. */
  readonly pollMs?: number;
  /** How long joining may take before an unknown screen counts as `platform_blocked`. */
  readonly joinTimeoutMs?: number;
}

export const POLL_MS = 1000;
export const JOIN_TIMEOUT_MS = 60_000;

/** The screen the page is on, from what is visible; refusals first. */
export type TeamsScreen =
  | 'captcha' | 'anonymous_blocked' | 'bot_blocked' | 'not_found' | 'ended' | 'denied'
  | 'in_call' | 'lobby' | 'prejoin' | 'launcher' | 'unknown';

const SCREENS: ReadonlyArray<readonly [TeamsScreen, Probe]> = [
  ['captcha', TEAMS.captcha],
  ['anonymous_blocked', TEAMS.anonymousBlocked],
  ['bot_blocked', TEAMS.botBlocked],
  ['not_found', TEAMS.notFound],
  ['ended', TEAMS.ended],
  ['denied', TEAMS.denied],
  ['in_call', TEAMS.hangup],
  ['lobby', TEAMS.lobby],
  ['prejoin', TEAMS.joinButton],
  ['launcher', TEAMS.continueInBrowser],
];

/** The code a refusal screen is reported as; null for a screen that is not one. */
export const SCREEN_CODE: Readonly<Partial<Record<TeamsScreen, FailureCode>>> = Object.freeze({
  captcha: 'platform_blocked',
  anonymous_blocked: 'platform_blocked',
  bot_blocked: 'platform_blocked',
  not_found: 'link_invalid',
  ended: 'meeting_ended',
  denied: 'not_admitted',
});

const has = async (page: TeamsPage, p: Probe) => (await page.query(p.selector, p.attrs)).length > 0;

export async function screenOf(page: TeamsPage): Promise<TeamsScreen> {
  for (const [screen, p] of SCREENS) if (await has(page, p)) return screen;
  return 'unknown';
}

export class TeamsAdapter implements MeetingAdapter {
  readonly platform = 'teams' as const;
  private readonly page: TeamsPage;
  private readonly clock: Clock;
  private readonly pollMs: number;
  private readonly joinTimeoutMs: number;
  private left = false;
  /** Who is in the call, by Teams' id, as the roster last read them. */
  private readonly people = new Map<string, string>();

  constructor(page: TeamsPage, opts: TeamsOptions = {}) {
    this.page = page;
    this.clock = opts.clock ?? realClock;
    this.pollMs = opts.pollMs ?? POLL_MS;
    this.joinTimeoutMs = opts.joinTimeoutMs ?? JOIN_TIMEOUT_MS;
  }

  async join(req: JoinRequest): Promise<void> {
    const link = teamsJoinUrl(req.url);
    if (!link) throw new AdapterFailure('link_invalid');
    await this.page.goto(link.url);
    const deadline = this.clock.now() + this.joinTimeoutMs;
    let asked = false;
    for (;;) {
      if (req.signal.aborted) throw new AdapterFailure('platform_blocked');
      const screen = await screenOf(this.page);
      const code = SCREEN_CODE[screen];
      if (code) throw new AdapterFailure(code);
      if (screen === 'lobby' || screen === 'in_call') return;
      if (screen === 'launcher') await this.page.click(TEAMS.continueInBrowser.selector);
      if (screen === 'prejoin' && !asked) {
        await this.page.fill(TEAMS.nameInput.selector, req.botName);
        await this.switchOff(TEAMS.micToggle);
        await this.switchOff(TEAMS.cameraToggle);
        await this.page.click(TEAMS.joinButton.selector);
        asked = true;
      }
      if (this.clock.now() >= deadline) throw new AdapterFailure('platform_blocked');
      await this.clock.sleep(this.pollMs);
    }
  }

  async admitted(signal: AbortSignal): Promise<void> {
    for (;;) {
      if (signal.aborted) throw new AdapterFailure('not_admitted');
      const screen = await screenOf(this.page);
      if (screen === 'in_call') return;
      const code = SCREEN_CODE[screen];
      if (code) throw new AdapterFailure(code);
      await this.clock.sleep(this.pollMs);
    }
  }

  async sendChat(text: string): Promise<void> {
    if (!(await has(this.page, TEAMS.chatCompose))) await this.page.click(TEAMS.chatButton.selector);
    await this.page.fill(TEAMS.chatCompose.selector, text);
    await this.page.click(TEAMS.chatSend.selector);
  }

  audio(on: (frame: AudioFrame) => void): Unsubscribe {
    return this.page.onAudio((samples, rate) => {
      const pcm = toPcm16k(samples, rate);
      if (pcm.length) on({ samples: pcm });
    });
  }

  roster(on: (change: RosterChange) => void): Unsubscribe {
    let opened = false;
    let known = new Map<string, string>();
    return this.every(async () => {
      // Off the call's screen (it ended, the page is reloading) the pane is gone: that is not everyone leaving.
      if (!(await this.inCall())) return;
      if (!opened) {
        if (!(await has(this.page, TEAMS.rosterRow))) await this.page.click(TEAMS.rosterButton.selector);
        opened = true;
      }
      const now = await this.readRoster();
      for (const [key, name] of now) if (!known.has(key)) on({ kind: 'join', key, name });
      for (const [key, name] of known) if (!now.has(key)) on({ kind: 'leave', key, name });
      known = now;
    });
  }

  speakers(on: (change: SpeakerChange) => void): Unsubscribe {
    let captionsOn = false;
    let last: string | null | undefined;
    return this.every(async () => {
      if (!(await this.inCall())) return;
      if (!captionsOn) {
        if (!(await has(this.page, TEAMS.captionRow))) {
          await this.page.click(TEAMS.moreButton.selector);
          await this.page.click(TEAMS.captionsOn.selector);
        }
        captionsOn = true;
      }
      if (!this.people.size) await this.readRoster();
      const rows = await this.page.query(TEAMS.captionRow.selector, TEAMS.captionRow.attrs);
      const name = rows.at(-1)?.[CAPTION_SPEAKER] ?? null;
      const key = name === null ? null : this.keyFor(name);
      // No caption yet, or a name that is not exactly one participant's: nothing is attributed.
      if (!key || key === last) return;
      last = key;
      on({ key });
    });
  }

  ended(on: () => void): Unsubscribe {
    let fired = false;
    return this.every(async () => {
      if (fired) return;
      const screen = await screenOf(this.page);
      if (screen === 'ended') { fired = true; on(); }
    });
  }

  async leave(): Promise<void> {
    if (this.left) return;
    this.left = true;
    try {
      if (await has(this.page, TEAMS.hangup)) await this.page.click(TEAMS.hangup.selector);
    } catch { /* the call may already be gone */ }
    try { await this.page.close(); } catch { /* already closed */ }
  }

  // ── helpers ──

  private inCall(): Promise<boolean> { return has(this.page, TEAMS.hangup); }

  /** Turn a pre-join toggle off when it reads as on; a toggle the page does not show is left alone. */
  private async switchOff(p: Probe): Promise<void> {
    const [el] = await this.page.query(p.selector, p.attrs);
    if (el && el['aria-pressed'] === 'true') await this.page.click(p.selector);
  }

  /** Everyone in the People pane but the bot, by Teams' id. */
  private async readRoster(): Promise<Map<string, string>> {
    const rows = await this.page.query(TEAMS.rosterRow.selector, TEAMS.rosterRow.attrs);
    const now = new Map<string, string>();
    for (const r of rows) {
      const key = r[ROSTER_KEY];
      if (!key || r[ROSTER_SELF] === 'true') continue;
      now.set(key, r[ROSTER_NAME] ?? '');
    }
    this.people.clear();
    for (const [k, v] of now) this.people.set(k, v);
    return now;
  }

  /** The one participant with this display name; undefined when none or several have it. */
  private keyFor(name: string): string | undefined {
    const keys = [...this.people].filter(([, n]) => n === name).map(([k]) => k);
    return keys.length === 1 ? keys[0] : undefined;
  }

  /** Run `fn` now and every `pollMs` until unsubscribed. A failed read is skipped, never logged. */
  private every(fn: () => Promise<void>): Unsubscribe {
    let stopped = false;
    let cancel: () => void = () => {};
    const tick = async () => {
      if (stopped) return;
      try { await fn(); } catch { /* the next read tries again */ }
      if (!stopped) cancel = this.clock.setTimeout(() => { void tick(); }, this.pollMs);
    };
    void tick();
    return () => { stopped = true; cancel(); };
  }
}
