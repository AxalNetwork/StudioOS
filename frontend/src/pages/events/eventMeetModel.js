// #5871 (D3724 gap 13, D5871, NE1): "Create the meeting for me" in the event
// editor. The rules and words of the press, kept pure for the tests.
//
// The press asks the Save for a Google Meet link (`add_meet: true`). The
// Worker makes it on the host's own Google account inside that Save, before
// the row is written, and deletes it again if the write fails, so pressing
// and walking away leaves nothing in anyone's calendar.

/** The formats with a meeting: Online and Hybrid. Never In person. */
export const MEET_FORMATS = Object.freeze(['virtual', 'hybrid']);

export const meetOffered = (locationKind) => MEET_FORMATS.includes(locationKind);

export const MEET_WORDS = Object.freeze({
  press: 'Create the meeting for me · Google Meet',
  asked: 'A Google Meet link will be made on your Google account when you save.',
  undo: 'Don’t create it',
  made: 'Made on your Google account. Cancelling the event removes it from your Google Calendar.',
  // NE1 draws Zoom beside the press, greyed: words, never a button that does nothing.
  zoom: 'Zoom: not available yet. It will be once its app is verified.',
  connect: 'Connect Google',
  fallback: 'Google Meet could not make the link. Try again in a minute, or paste a link.',
});

/** Where a refusal that needs Google connected sends the host. */
export const CONNECT_HREF = '/account/connectors/google';

const CONNECT_CODES = new Set(['meet_not_connected', 'meet_reconnect']);
const MEET_CODES = new Set(['meet_host_only', 'meet_in_person', 'meet_event_cancelled', 'support_session_refused']);

/** True when a failed Save was refused because of its Meet link, not its other fields. */
export function isMeetRefusal(e) {
  const code = typeof e?.code === 'string' ? e.code : '';
  return code.startsWith('meet_') || MEET_CODES.has(code);
}

/**
 * The refusal as the editor shows it: the Worker's own sentence (D1211's
 * `MEETING_ERRORS`, never provider text), and whether to offer Connect Google.
 * Null when the error was not about the Meet link.
 */
export function meetRefusal(e) {
  if (!isMeetRefusal(e)) return null;
  const text = typeof e?.message === 'string' && e.message.trim() ? e.message.trim() : MEET_WORDS.fallback;
  return { text, connect: CONNECT_CODES.has(e.code) };
}

/** The Save's extra field: `add_meet` only when the press was made and the format has a meeting. */
export function meetPayload(state, locationKind) {
  return state === 'asked' && meetOffered(locationKind) ? { add_meet: true } : {};
}
