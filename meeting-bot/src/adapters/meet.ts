/**
 * D886 B3 (#2581): the Google Meet adapter, B2's `MeetingAdapter` for Meet.
 *
 * - **Join:** the bot opens the link as a guest named `botName` ("Eadwyn AI"),
 *   with the microphone and camera off, and asks to join. It resolves in the
 *   waiting room, or in the call when the meeting lets anyone in.
 * - **Admitted:** it resolves once a host admits the bot.
 * - **In the call,** it reads every `pollMs`:
 *   - the participant panel, for the roster (`RosterTracker`);
 *   - the lit active-speaker indicators, for the speaker (`SpeakerTracker`);
 *   - the page's state, for the end of the call or removal by the host. Both
 *     end the bot's call; B2 has no code for removal, so it reads as `ended`.
 * - **Audio** comes from the page itself (`meet/capture.ts`), as B2's 16 kHz
 *   mono frames through `toPcm16k`.
 *
 * D886's codes:
 * - `link_invalid`: not a Meet link, or Meet says it names no meeting;
 * - `platform_blocked`: a Workspace that admits only its own organization, or
 *   any page this adapter cannot read;
 * - `not_admitted`: the host denied the request;
 * - `meeting_ended`: the call ended before the bot was admitted.
 *
 * **Privacy:** nothing here logs. The core's `logLine` is the only log, and it
 * writes codes and counts. The link, display names and the chat text never
 * leave the page and the callback.
 *
 * **UNVERIFIED:** every page hook is in `meet/selectors.ts`, built without access
 * to Meet. See there.
 */
import { AdapterFailure } from '../types.ts';
import type { AudioFrame, Clock, JoinRequest, MeetingAdapter, RosterChange, SpeakerChange, Unsubscribe } from '../types.ts';
import { toPcm16k } from '../wav.ts';
import { realClock } from '../lifecycle.ts';
import { CAPTURE_BINDING, CAPTURE_SCRIPT, decodeBlock } from './meet/capture.ts';
import type { MeetPage } from './meet/page.ts';
import { sel, type HookName } from './meet/selectors.ts';
import { REFUSAL, RosterTracker, STATE_HOOKS, SpeakerTracker, classify, isMeetLink, isOut, type MeetState, type RosterRow } from './meet/signals.ts';

export type { MeetPage, MeetLocator } from './meet/page.ts';

type Listener<T> = (v: T) => void;

class Topic<T> {
  readonly listeners = new Set<Listener<T>>();
  on(fn: Listener<T>): Unsubscribe {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  emit(v: T): void { for (const fn of [...this.listeners]) fn(v); }
}

export interface MeetOptions {
  readonly clock?: Clock;
  /** How often the page is read in the call, and while waiting. */
  readonly pollMs?: number;
  /** How long one join step (the pre-join screen, then the answer to Ask to join) may take. */
  readonly stepTimeoutMs?: number;
}

export class MeetAdapter implements MeetingAdapter {
  readonly platform = 'google_meet' as const;

  private readonly page: MeetPage;
  private readonly clock: Clock;
  private readonly pollMs: number;
  private readonly stepTimeoutMs: number;
  private readonly rosterState = new RosterTracker();
  private readonly speakerState = new SpeakerTracker();
  private readonly audioTopic = new Topic<AudioFrame>();
  private readonly rosterTopic = new Topic<RosterChange>();
  private readonly speakerTopic = new Topic<SpeakerChange>();
  private readonly endTopic = new Topic<void>();
  private inCall = false;
  private out = false;
  private watching: Promise<void> | null = null;
  private prepared = false;

  constructor(page: MeetPage, opts: MeetOptions = {}) {
    this.page = page;
    this.clock = opts.clock ?? realClock;
    this.pollMs = opts.pollMs ?? 500;
    this.stepTimeoutMs = opts.stepTimeoutMs ?? 30_000;
  }

  // ── reading the page ──

  private async visible(hook: HookName): Promise<boolean> {
    try { return await this.page.locator(sel(hook)).first().isVisible(); } catch { return false; }
  }

  async state(): Promise<MeetState> {
    const seen = await Promise.all(STATE_HOOKS.map(async (h) => [h, await this.visible(h)] as const));
    return classify(new Set(seen.filter(([, ok]) => ok).map(([h]) => h)));
  }

  /** Reads the page until its state is one of `wanted`, or `ms` pass; the last state seen.
   * A page that has gone (the browser died) is `platform_blocked`, never a wait that cannot end. */
  private async waitFor(wanted: (s: MeetState) => boolean, ms: number, signal?: AbortSignal): Promise<MeetState> {
    const until = this.clock.now() + ms;
    for (;;) {
      if (this.page.isClosed()) throw new AdapterFailure('platform_blocked');
      const s = await this.state();
      if (wanted(s) || this.clock.now() >= until || signal?.aborted) return s;
      await this.clock.sleep(this.pollMs);
    }
  }

  async readRoster(): Promise<RosterRow[] | null> {
    try {
      return await this.page.locator(sel('participant')).evaluateAll((rows, [nameSel, selfSel]) => rows.map((row) => {
        const named = row.matches(nameSel) ? row : row.querySelector(nameSel);
        const self = row.matches(selfSel) || !!row.querySelector(selfSel);
        return [row.getAttribute('data-participant-id') || '', named ? named.getAttribute('data-participant-name') || '' : '', self] as RosterRow;
      }), [sel('participant_name'), sel('participant_self')] as const);
    } catch { return null; }
  }

  async readSpeaking(): Promise<Set<string> | null> {
    try {
      const keys = await this.page.locator(sel('speaking_tile')).evaluateAll(
        (tiles) => tiles.map((t) => String(t.getAttribute('data-participant-id') || '')), null);
      return new Set(keys.filter(Boolean));
    } catch { return null; }
  }

  // ── B2's contract ──

  async join(req: JoinRequest): Promise<void> {
    if (!isMeetLink(req.url)) throw new AdapterFailure('link_invalid');
    if (!this.prepared) {
      await this.page.exposeFunction(CAPTURE_BINDING, (rate: number, b64: string) => this.onBlock(rate, b64));
      await this.page.addInitScript({ content: CAPTURE_SCRIPT });
      this.prepared = true;
    }
    await this.page.goto(req.url, { waitUntil: 'domcontentloaded' });
    const first = await this.waitFor((s) => s === 'prejoin' || s in REFUSAL || isOut(s), this.stepTimeoutMs, req.signal);
    this.refuseOn(first);
    if (first !== 'prejoin') throw new AdapterFailure('platform_blocked');
    if (await this.visible('name_input')) await this.page.locator(sel('name_input')).first().fill(req.botName);
    // Each toggle is pressed only while it says it is on, so it is never turned back on.
    for (const hook of ['mic_on', 'camera_on'] as const) {
      if (await this.visible(hook)) await this.page.locator(sel(hook)).first().click();
    }
    await this.page.locator(sel((await this.visible('join_now')) ? 'join_now' : 'ask_to_join')).first().click();
    const next = await this.waitFor((s) => s === 'lobby' || s === 'in_call' || s in REFUSAL || isOut(s), this.stepTimeoutMs, req.signal);
    this.refuseOn(next);
    if (next === 'in_call') await this.entered();
    else if (next !== 'lobby') throw new AdapterFailure('platform_blocked');
  }

  async admitted(signal: AbortSignal): Promise<void> {
    if (this.inCall) return;
    // The core owns the admission timeout (B2's ADMIT_TIMEOUT_MS) and aborts `signal` at it.
    const s = await this.waitFor((x) => x === 'in_call' || x in REFUSAL || isOut(x), Number.POSITIVE_INFINITY, signal);
    if (signal.aborted) throw new Error('aborted');
    this.refuseOn(s);
    if (s !== 'in_call') throw new AdapterFailure('platform_blocked');
    await this.entered();
  }

  async sendChat(text: string): Promise<void> {
    if (!(await this.visible('chat_input'))) await this.page.locator(sel('chat_button')).first().click();
    await this.page.locator(sel('chat_input')).first().fill(text);
    await this.page.locator(sel('chat_send')).first().click();
  }

  audio(on: Listener<AudioFrame>): Unsubscribe { return this.audioTopic.on(on); }

  roster(on: Listener<RosterChange>): Unsubscribe {
    const off = this.rosterTopic.on(on);
    for (const change of this.rosterState.current()) on(change);
    return off;
  }

  speakers(on: Listener<SpeakerChange>): Unsubscribe { return this.speakerTopic.on(on); }
  ended(on: () => void): Unsubscribe { return this.endTopic.on(on); }

  async leave(): Promise<void> {
    // Out first, so the watch never reads the bot's own leaving as the call ending.
    const wasIn = !this.out;
    this.out = true;
    if (wasIn && (await this.visible('leave'))) {
      try { await this.page.locator(sel('leave')).first().click(); } catch { /* the call may have just ended */ }
    }
    await this.watching;
    this.watching = null;
  }

  /** How many people other than the bot the panel lists. */
  get participants(): number { return this.rosterState.count; }

  // ── inside ──

  private refuseOn(s: MeetState): void {
    const code = REFUSAL[s];
    if (code) throw new AdapterFailure(code);
    if (isOut(s) && !this.inCall) throw new AdapterFailure('meeting_ended');
  }

  private async entered(): Promise<void> {
    this.inCall = true;
    if (await this.visible('people_button')) {
      try { await this.page.locator(sel('people_button')).first().click(); } catch { /* the roster reads null until it opens */ }
    }
    try { await this.page.evaluate(() => { (globalThis as unknown as { __eadwynCapture?: { on: boolean } }).__eadwynCapture!.on = true; }, null); } catch { /* no capture: no audio */ }
    await this.poll();
    this.watching = this.watch();
  }

  private onBlock(rate: number, b64: string): void {
    if (this.out || !this.inCall || !Number.isFinite(rate) || rate <= 0) return;
    const samples = toPcm16k(decodeBlock(b64), rate);
    if (samples.length) this.audioTopic.emit({ samples });
  }

  /** One read of the page: roster and speaker changes, then whether the bot is out. */
  async poll(): Promise<MeetState> {
    for (const change of this.rosterState.update(await this.readRoster())) this.rosterTopic.emit(change);
    const speaker = this.speakerState.update(await this.readSpeaking());
    if (speaker !== undefined) this.speakerTopic.emit({ key: speaker });
    return this.state();
  }

  private async watch(): Promise<void> {
    while (!this.out) {
      await this.clock.sleep(this.pollMs);
      if (this.out) return;
      // A page that has gone ends the bot's call, like the call ending.
      const s = this.page.isClosed() ? 'ended' : await this.poll();
      if (isOut(s)) {
        this.out = true;
        this.endTopic.emit();
        return;
      }
    }
  }
}
