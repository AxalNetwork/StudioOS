/**
 * D886 B5 (#2583): a Teams page in memory, playing the screens in
 * `fixtures/teamsScreens.ts`. A test moves it the way Teams would (`show`,
 * `people`, `captions`, `say`); it records what the adapter did to it.
 */
import type { Attrs, TeamsPage } from '../src/adapters/teams.ts';
import type { Unsubscribe } from '../src/types.ts';
import { CAPTION_ROW, CHAT_OPEN, MORE_OPEN, ROSTER_ROW, SCREENS } from './fixtures/teamsScreens.ts';
import type { Screen, ScreenName } from './fixtures/teamsScreens.ts';

export class FakeTeamsPage implements TeamsPage {
  screen: ScreenName = 'blank';
  /** Where Join now lands: the lobby, or straight in. */
  afterJoin: ScreenName = 'lobby';
  readonly gotos: string[] = [];
  readonly clicks: string[] = [];
  readonly fills: Array<[string, string]> = [];
  /** Every attribute the adapter asked for, by selector. */
  readonly asked = new Map<string, Set<string>>();
  closed = 0;
  private toggles = new Map<string, string>();
  private chatOpen = false;
  private moreOpen = false;
  private rosterOpen = false;
  private captionsOn = false;
  private rows: Attrs[] = [];
  private captionRows: Attrs[] = [];
  private audio = new Set<(s: Float32Array, rate: number) => void>();

  constructor(first: ScreenName = 'launcher') { this.screen = first; }

  // ── what the adapter calls ──

  async goto(url: string): Promise<void> { this.gotos.push(url); }

  async query(selector: string, attrs: readonly string[]): Promise<readonly Attrs[]> {
    const set = this.asked.get(selector) ?? new Set<string>();
    for (const a of attrs) set.add(a);
    this.asked.set(selector, set);
    const found = this.visible()[selector] ?? [];
    return found.map((el) => {
      const out: Record<string, string | null> = {};
      for (const a of attrs) out[a] = this.toggles.get(`${selector}|${a}`) ?? el[a] ?? null;
      return out;
    });
  }

  async click(selector: string): Promise<void> {
    if (!(selector in this.visible())) throw new Error('not on the page');
    this.clicks.push(selector);
    if (selector === '[data-tid="joinOnWeb"]') this.screen = 'prejoin';
    else if (selector === 'button[data-tid="prejoin-join-button"]') this.screen = this.afterJoin;
    else if (selector === '[data-tid="toggle-mute"]' || selector === '[data-tid="toggle-video"]') {
      const k = `${selector}|aria-pressed`;
      this.toggles.set(k, (this.toggles.get(k) ?? 'true') === 'true' ? 'false' : 'true');
    } else if (selector === '[data-tid="chat-button"]') this.chatOpen = true;
    else if (selector === '[data-tid="roster-button"]') this.rosterOpen = true;
    else if (selector === '[data-tid="more-button"]') this.moreOpen = true;
    else if (selector === '[data-tid="closed-captions-button"]') { this.captionsOn = true; this.moreOpen = false; }
  }

  async fill(selector: string, text: string): Promise<void> {
    if (!(selector in this.visible())) throw new Error('not on the page');
    this.fills.push([selector, text]);
  }

  onAudio(on: (samples: Float32Array, rate: number) => void): Unsubscribe {
    this.audio.add(on);
    return () => { this.audio.delete(on); };
  }

  async close(): Promise<void> { this.closed += 1; }

  // ── what Teams does ──

  show(screen: ScreenName): void { this.screen = screen; }
  people(rows: Attrs[]): void { this.rows = rows; }
  captions(rows: Attrs[]): void { this.captionRows = rows; }
  say(samples: Float32Array, rate = 48000): void { for (const fn of [...this.audio]) fn(samples, rate); }
  get listeners(): number { return this.audio.size; }

  private visible(): Screen {
    const out: Record<string, readonly Attrs[]> = { ...SCREENS[this.screen] };
    if (this.screen === 'in_call') {
      if (this.chatOpen) Object.assign(out, CHAT_OPEN);
      if (this.moreOpen) Object.assign(out, MORE_OPEN);
      if (this.rosterOpen) out[ROSTER_ROW] = this.rows;
      if (this.captionsOn) out[CAPTION_ROW] = this.captionRows;
    }
    return out;
  }
}
