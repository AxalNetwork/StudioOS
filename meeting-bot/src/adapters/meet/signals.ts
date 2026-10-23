/**
 * D886 B3 (#2581): the Meet adapter's decisions, apart from any browser.
 *
 * Pure: each takes what the page showed and returns what the adapter reports,
 * so the rules are tested without Chromium and hold no page hook.
 */
import type { FailureCode, RosterChange } from '../../types.ts';
import type { HookName } from './selectors.ts';

/** What the Meet page is showing. */
export type MeetState =
  | 'prejoin' | 'lobby' | 'in_call' | 'ended' | 'removed'
  | 'not_admitted' | 'platform_blocked' | 'link_invalid' | 'unknown';

/** The hooks `classify` reads. */
export const STATE_HOOKS = [
  'ask_to_join', 'join_now', 'lobby', 'denied', 'blocked', 'blocked_org', 'link_invalid', 'leave', 'ended', 'removed',
] as const satisfies readonly HookName[];

type StateHook = typeof STATE_HOOKS[number];

// Earlier rules win. Removal and the end come first: the page can still show a
// stale Leave button for a moment after either.
const RULES: ReadonlyArray<readonly [MeetState, readonly StateHook[]]> = [
  ['removed', ['removed']],
  ['ended', ['ended']],
  ['platform_blocked', ['blocked', 'blocked_org']],
  ['link_invalid', ['link_invalid']],
  ['not_admitted', ['denied']],
  ['in_call', ['leave']],
  ['lobby', ['lobby']],
  ['prejoin', ['ask_to_join']],
  ['prejoin', ['join_now']],
];

/** The page's state, from the hooks visible on it. */
export function classify(present: ReadonlySet<string>): MeetState {
  for (const [state, needs] of RULES) if (needs.every((h) => present.has(h))) return state;
  return 'unknown';
}

/** The states that refuse a join, as D886's failure codes. */
export const REFUSAL: Partial<Record<MeetState, FailureCode>> = {
  not_admitted: 'not_admitted',
  platform_blocked: 'platform_blocked',
  link_invalid: 'link_invalid',
};

/** The bot is out of the call: the host ended it, or removed the bot. */
export const isOut = (s: MeetState): boolean => s === 'ended' || s === 'removed';

/**
 * A Meet meeting link: https, on meet.google.com exactly, with a meeting path.
 * Anything else fails as `link_invalid` before a page is opened, so the bot
 * never visits another host. The link is never logged.
 */
export function isMeetLink(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  return u.protocol === 'https:' && u.hostname === 'meet.google.com' && u.username === '' && u.pathname.replace(/\//g, '').length > 0;
}

/** One participant-panel row as read from the page: the key, the display name, and whether it is the bot. */
export type RosterRow = readonly [key: string, name: string, isSelf: boolean];

/**
 * Turns successive participant-panel reads into B2's `RosterChange`s.
 * The bot's own row is never reported. A rename keeps the key and is not a new
 * join. An unreadable panel (`null`) changes nothing: a participant leaves only
 * when a read that worked no longer lists them.
 */
export class RosterTracker {
  private present = new Map<string, string>();

  update(read: readonly RosterRow[] | null): RosterChange[] {
    if (read === null) return [];
    const seen = new Map<string, string>();
    for (const [key, name, isSelf] of read) if (key && !isSelf) seen.set(key, name);
    const out: RosterChange[] = [];
    for (const [key, name] of seen) if (!this.present.has(key)) out.push({ kind: 'join', key, name });
    for (const [key, name] of this.present) if (!seen.has(key)) out.push({ kind: 'leave', key, name });
    this.present = seen;
    return out;
  }

  /** Everyone present now, as joins: what a new `roster` subscriber is told first (B2's contract). */
  current(): RosterChange[] {
    return [...this.present].map(([key, name]) => ({ kind: 'join', key, name }));
  }

  get count(): number { return this.present.size; }
}

/**
 * The active speaker, from the tiles whose indicator is lit. B2's
 * `SpeakerChange` names one speaker (or none), so with several lit the current
 * one is kept while it stays lit, else the first by key. `update` returns the
 * new speaker when it changed, and `undefined` when it did not; an unreadable
 * read (`null`) changes nothing.
 */
export class SpeakerTracker {
  private now: string | null = null;

  update(lit: ReadonlySet<string> | null): string | null | undefined {
    if (lit === null) return undefined;
    const next = this.now !== null && lit.has(this.now) ? this.now : ([...lit].sort()[0] ?? null);
    if (next === this.now) return undefined;
    this.now = next;
    return next;
  }
}
