/**
 * D886 B5 (#2583): Teams' screens as the adapter reads them, element by
 * element, with the attributes it asks for.
 *
 * NOT YET RECORDED. They are built from the published reports cited in
 * `src/adapters/teamsSelectors.ts`: this repository has no Teams account. The
 * live check (#2583, step 1 §6) records each screen from a real work-or-school
 * call and a Teams free call; its recordings replace these, and a selector
 * that differs breaks these tests on purpose. The selectors here are written
 * out, not imported, so a change to `teamsSelectors.ts` must match a screen.
 *
 * No real name, link or caption is in a fixture.
 */
import type { Attrs } from '../../src/adapters/teams.ts';

export type Screen = Readonly<Record<string, readonly Attrs[]>>;

export const SCREENS = {
  launcher: { '[data-tid="joinOnWeb"]': [{}] },
  prejoin: {
    'input[data-tid="prejoin-display-name-input"]': [{}],
    '[data-tid="toggle-mute"]': [{ 'aria-pressed': 'true' }],
    '[data-tid="toggle-video"]': [{ 'aria-pressed': 'true' }],
    'button[data-tid="prejoin-join-button"]': [{}],
  },
  lobby: { '[data-tid="lobby-screen"]': [{}] },
  in_call: {
    '[data-tid="hangup-main-btn"]': [{}],
    '[data-tid="chat-button"]': [{}],
    '[data-tid="roster-button"]': [{}],
    '[data-tid="more-button"]': [{}],
  },
  captcha: { '[data-tid="captcha-challenge"]': [{}] },
  anonymous_blocked: { '[data-tid="anonymous-join-blocked"]': [{}] },
  bot_blocked: { '[data-tid="external-bot-blocked"]': [{}] },
  not_found: { '[data-tid="meeting-not-found"]': [{}] },
  ended: { '[data-tid="call-ended-screen"]': [{}] },
  denied: { '[data-tid="lobby-denied"]': [{}] },
  blank: {},
} satisfies Record<string, Screen>;

export type ScreenName = keyof typeof SCREENS;

/** Opened by a click in the call: the chat box, the People pane, the captions menu item. */
export const CHAT_OPEN: Screen = { '[data-tid="chat-compose-input"]': [{}], '[data-tid="chat-send-button"]': [{}] };
export const MORE_OPEN: Screen = { '[data-tid="closed-captions-button"]': [{}] };
export const ROSTER_ROW = '[data-tid="roster-participant"]';
export const CAPTION_ROW = '[data-tid="closed-caption-row"]';

/** A People-pane row: Teams' id for the participant, their display name, and whether it is the bot's own row. */
export const row = (id: string, name: string, self = false): Attrs => ({ 'data-participant-id': id, 'aria-label': name, 'data-is-self': self ? 'true' : 'false' });
/** A caption row's author. Its words are text, which the page driver never returns. */
export const caption = (name: string): Attrs => ({ 'data-speaker-name': name });
