/**
 * D886 B5 (#2583): every Microsoft Teams web-client selector the adapter uses,
 * and the rule for which links it joins. Nothing else in the adapter names a
 * piece of Teams' page, so when Teams changes its page this file is the one
 * to change.
 *
 * PROVISIONAL. These come from published reports of the Teams web client (the
 * `data-tid` attributes, the launcher's "Continue on this browser", the
 * pre-join screen), not from a recording: this repository has no Teams
 * account. The live check (#2583, step 1 §6) records each screen; its
 * recordings replace `test/fixtures/teamsScreens.ts`, and any selector that
 * differs changes here.
 *
 * The adapter reads ATTRIBUTES ONLY, never an element's text. A participant's
 * name comes from an attribute of their roster row, a speaker's from the
 * caption row's author attribute. A caption's words are the element's text,
 * so the adapter cannot read them, by construction.
 */

/** One thing to find on the page, and the attributes to read from each match. */
export interface Probe {
  readonly selector: string;
  readonly attrs: readonly string[];
}

const probe = (selector: string, ...attrs: string[]): Probe => Object.freeze({ selector, attrs: Object.freeze(attrs) });

export const TEAMS = Object.freeze({
  // The launcher: "Open the Teams app" or "Continue on this browser".
  continueInBrowser: probe('[data-tid="joinOnWeb"]'),
  // The pre-join screen: the guest's name, the mic and camera, and Join now.
  nameInput: probe('input[data-tid="prejoin-display-name-input"]'),
  micToggle: probe('[data-tid="toggle-mute"]', 'aria-pressed'),
  cameraToggle: probe('[data-tid="toggle-video"]', 'aria-pressed'),
  joinButton: probe('button[data-tid="prejoin-join-button"]'),
  // Waiting: the ordinary lobby, and the "Suspected threats" approval (D886 §Teams 3).
  lobby: probe('[data-tid="lobby-screen"]'),
  // In the call: the hang-up button is there only once admitted.
  hangup: probe('[data-tid="hangup-main-btn"]'),
  // Refusals, each mapped to one of D886's codes in `screenOf`.
  captcha: probe('[data-tid="captcha-challenge"]'),
  anonymousBlocked: probe('[data-tid="anonymous-join-blocked"]'),
  botBlocked: probe('[data-tid="external-bot-blocked"]'),
  denied: probe('[data-tid="lobby-denied"]'),
  notFound: probe('[data-tid="meeting-not-found"]'),
  ended: probe('[data-tid="call-ended-screen"]'),
  // The meeting chat, for the recording notice.
  chatButton: probe('[data-tid="chat-button"]'),
  chatCompose: probe('[data-tid="chat-compose-input"]'),
  chatSend: probe('[data-tid="chat-send-button"]'),
  // The People pane: one row per participant, keyed by Teams' id for them in this call.
  rosterButton: probe('[data-tid="roster-button"]'),
  rosterRow: probe('[data-tid="roster-participant"]', 'data-participant-id', 'aria-label', 'data-is-self'),
  // Live captions: who is speaking, from the newest caption row's author. Never its words.
  moreButton: probe('[data-tid="more-button"]'),
  captionsOn: probe('[data-tid="closed-captions-button"]'),
  captionRow: probe('[data-tid="closed-caption-row"]', 'data-speaker-name'),
});

/** The roster row's attributes: the participant's key, their display name, and the bot's own row. */
export const ROSTER_KEY = 'data-participant-id';
export const ROSTER_NAME = 'aria-label';
export const ROSTER_SELF = 'data-is-self';
/** The caption row's author: a display name, matched to a roster key. */
export const CAPTION_SPEAKER = 'data-speaker-name';

export type TeamsLinkKind = 'work' | 'free';

const WORK_HOST = 'teams.microsoft.com';
const FREE_HOST = 'teams.live.com';

/**
 * The link the bot opens, or null when it is not a Teams meeting link (the
 * bot reports `link_invalid` without opening anything):
 *   - work or school: https://teams.microsoft.com/l/meetup-join/… or /meet/…
 *   - Teams free (personal): https://teams.live.com/meet/…
 * Its own query (a passcode `p`, the tenant context) is kept as given, and
 * `launchAgent=join_only` asks the launcher to join in the browser rather
 * than offer the app. The link is never logged.
 */
export function teamsJoinUrl(raw: string): { url: string; kind: TeamsLinkKind } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  let kind: TeamsLinkKind | null = null;
  if (host === WORK_HOST && /^\/(l\/meetup-join|meet)\/[^/]+/.test(u.pathname)) kind = 'work';
  if (host === FREE_HOST && /^\/meet\/[^/]+/.test(u.pathname)) kind = 'free';
  if (!kind) return null;
  u.searchParams.set('launchAgent', 'join_only');
  return { url: u.toString(), kind };
}
