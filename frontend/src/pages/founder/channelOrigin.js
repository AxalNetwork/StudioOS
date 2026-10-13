/**
 * D684 (#1578) — where a session came from when it did not start in StudioOS.
 *
 * A session from a connected channel (a Telegram or WhatsApp chat, a Zoom or
 * Google Meet call) is stored with `submitted_via` = the provider key and
 * `submitted_via_name` = its label (services/interviewIntake.ts). An AI
 * assistant's session (D665) is stored in the same two columns, with the OAuth
 * client id and the name the assistant gave itself. So `submitted_via_name`
 * alone cannot say which kind of source it was: the provider key does.
 *
 * A channel is the member's own conversation with their customer. It is never
 * an assistant's proposal, so it gets its own badge and does not open the
 * session on review (see assistantSession.js).
 */

/** The four channel providers, by the key the Worker stores, with the label shown. */
export const CHANNEL_ORIGINS = Object.freeze({
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  zoom: 'Zoom',
  google_meet: 'Google Meet',
});

/** The provider key when the session came from a channel, otherwise null. */
export function channelOrigin(session) {
  const via = String(session?.submitted_via || '').trim();
  return Object.hasOwn(CHANNEL_ORIGINS, via) ? via : null;
}

/** "From WhatsApp": the channel badge's text, or null for any other session. */
export function originBadge(session) {
  const key = channelOrigin(session);
  return key ? `From ${CHANNEL_ORIGINS[key]}` : null;
}
