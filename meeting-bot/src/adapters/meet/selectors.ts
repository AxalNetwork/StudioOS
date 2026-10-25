/**
 * D886 B3 (#2581): every Google Meet page hook the adapter reads or presses, in one place.
 *
 * UNVERIFIED. The S10 session that wrote these could not reach meet.google.com
 * (its network policy denies the host), so no hook was read from a live Meet
 * page. They follow Meet's accessible names and roles, and
 * `test/fixtures/meet.html` is CONSTRUCTED to match them, not recorded.
 * Measuring Meet (#2581 step 1, D886 §8, M3 and M4) replaces both: each hook is
 * checked against a recorded page and corrected here, and the fixture is
 * replaced by the recordings.
 *
 * Why one module: Meet changes its page without notice. A hook that stops
 * matching fails its own named test (`test/meet_selectors.test.ts` has one test
 * per hook) and is fixed on one line here, never inside the adapter.
 *
 * Every hook is a Playwright selector. The `text=` hooks match Meet's own
 * English words, so the bot's browser runs with `--lang=en-US`.
 */

/** The fixture states a hook can belong to: one page of `test/fixtures/meet.html` each. */
export type MeetPageName =
  | 'prejoin' | 'prejoin_open' | 'lobby' | 'denied' | 'blocked' | 'link_invalid' | 'in_call' | 'ended' | 'removed';

export interface Hook {
  readonly selector: string;
  /** What the hook is for, in a sentence. */
  readonly purpose: string;
  /** The fixture state it must appear on. */
  readonly page: MeetPageName;
}

export const HOOKS = {
  // ── the pre-join screen ──
  name_input: { selector: 'input[aria-label="Your name"]', purpose: 'the guest name field, shown to a visitor who is not signed in', page: 'prejoin' },
  mic_on: { selector: '[role="button"][aria-label^="Turn off microphone"]', purpose: 'the microphone is on; pressing it turns it off', page: 'prejoin' },
  camera_on: { selector: '[role="button"][aria-label^="Turn off camera"]', purpose: 'the camera is on; pressing it turns it off', page: 'prejoin' },
  ask_to_join: { selector: 'button:has-text("Ask to join")', purpose: 'a guest asks the host to be let in', page: 'prejoin' },
  join_now: { selector: 'button:has-text("Join now")', purpose: 'joins without a waiting room, when the meeting lets anyone with the link in', page: 'prejoin_open' },
  // ── waiting to be admitted ──
  lobby: { selector: 'text=/Asking to be let in|Please wait until a meeting host brings you into the call/i', purpose: 'the waiting room: no host has admitted the bot yet', page: 'lobby' },
  // ── refusals ──
  denied: { selector: 'text=/denied your request to join|You can.t join this call/i', purpose: 'the host refused the bot', page: 'denied' },
  blocked: { selector: 'text=/You can.t join this video call/i', purpose: 'Meet will not let this guest in', page: 'blocked' },
  blocked_org: { selector: 'text=/only people (in|from) .* can join/i', purpose: 'why: the meeting admits only its own Workspace organization', page: 'blocked' },
  link_invalid: { selector: 'text=/Check your meeting code|Invalid video call name|meeting code is invalid/i', purpose: 'the link names no meeting', page: 'link_invalid' },
  // ── in the call ──
  leave: { selector: '[role="button"][aria-label="Leave call"]', purpose: 'the bot is in the call; pressing it leaves', page: 'in_call' },
  people_button: { selector: '[role="button"][aria-label^="People"]', purpose: 'opens the participant panel', page: 'in_call' },
  participant: { selector: '[role="listitem"][data-participant-id]', purpose: 'one participant row; its data-participant-id is the participant key', page: 'in_call' },
  participant_name: { selector: '[data-participant-name]', purpose: 'inside a row: the display name, in data-participant-name', page: 'in_call' },
  participant_self: { selector: '[data-participant-self="true"]', purpose: 'inside a row: the bot itself, which is never reported', page: 'in_call' },
  speaking_tile: { selector: '[data-participant-id][data-speaking="true"]', purpose: 'a tile whose active-speaker indicator is lit', page: 'in_call' },
  chat_button: { selector: '[role="button"][aria-label^="Chat with everyone"]', purpose: 'opens the in-call chat', page: 'in_call' },
  chat_input: { selector: 'textarea[aria-label="Send a message"]', purpose: 'the chat message field', page: 'in_call' },
  chat_send: { selector: '[role="button"][aria-label="Send a message"]', purpose: 'sends the chat message', page: 'in_call' },
  // ── the end ──
  ended: { selector: 'text=/The call has ended|This call has ended/i', purpose: 'the host ended the meeting for everyone', page: 'ended' },
  removed: { selector: 'text=/You.ve been removed from the meeting|Someone has removed you from the meeting/i', purpose: 'the host removed the bot', page: 'removed' },
} as const satisfies Record<string, Hook>;

export type HookName = keyof typeof HOOKS;

/** The Playwright selector of a hook. */
export const sel = (name: HookName): string => HOOKS[name].selector;
