/** D886 B9 (#2587): provider-independent wording, shared by B2 and B7. */
export const MEETING_BOT_NAME = 'Eadwyn AI';
export const MEETING_BOT_NOTICE_VERSION = 2;
export const MEETING_BOT_NOTICE_PATH = '/privacy/interviews';
// Publish only with B1/B2/B6 consent, retention and deletion verification.
// The public page reads this same gate; canary alone cannot publish it.
export const MEETING_BOT_NOTICE_PUBLISHED = false;
export const MEETING_BOT_DISPATCH_DISCLOSURE = 'Eadwyn AI will join as a visible participant in the call.';

/** A bounded, single-line display label. The caller must send it as plain text. */
function ventureLabel(value) {
  if (typeof value !== 'string') return '';
  const clean = Array.from(value, (char) => /^[\ud800-\udfff]$/.test(char) ? '\ufffd' : char).join('');
  const line = clean.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return Array.from(line).slice(0, 80).join('').trim();
}

/**
 * The venture is selected from the run's authorized company on the server.
 * B2 sends the returned string as plain chat text once on admission, before
 * capture. A successful notice is disclosure, never a substitute for consent.
 */
export function meetingBotNotice(input = {}) {
  if (!MEETING_BOT_NOTICE_PUBLISHED) throw new Error('The meeting bot privacy notice is not published.');
  return draftMeetingBotNotice(input);
}

/** Draft/approval preview only. B2 must call the gated meetingBotNotice. */
export function draftMeetingBotNotice({ ventureName } = {}) {
  const label = ventureLabel(ventureName);
  const venture = label ? `the venture ${JSON.stringify(label)}` : 'the venture that invited me';
  return `I’m ${MEETING_BOT_NAME}, Axal’s meeting bot, here for ${venture}. `
    + 'This call is being recorded and transcribed for customer research, including participant display names and who spoke when. '
    + 'Tell the founder if you want recording to stop or ask them to delete the recording and transcript. '
    + `How it works: https://axal.vc${MEETING_BOT_NOTICE_PATH}?n=${MEETING_BOT_NOTICE_VERSION}`;
}
