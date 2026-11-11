// D4494: Inbox display facts and the explicit mail confirmation/send boundary.
export const INBOX_EMPTY = 'No replies yet.';
export const INBOX_EMPTY_NOTE = 'Replies to your emails appear here when your mailbox allows reading.';
export const REPLY_ACCEPT_NOTE = 'Accept puts it in the composer. Nothing is sent until you press Send.';
const LABELS = { email: 'Email', linkedin: 'LinkedIn', whatsapp: 'WhatsApp', telegram: 'Telegram', sms: 'SMS', voice: 'Voice' };
export const channelLabel = (channel) => Object.hasOwn(LABELS, channel) ? LABELS[channel] : 'Contact log';
export const threadName = (thread) => [thread?.contact?.organization, thread?.contact?.name].filter(Boolean).join(' · ') || 'Not recorded';
export const unreadCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
export const bubbleDirection = (message) => message?.direction === 'outbound' ? 'outbound' : 'inbound';
export function messageTime(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date) : 'Not recorded';
}
export function acceptedReply(proposal) {
  // #4488 owns the proposal shape; no arbitrary non-reply proposal can fill a recipient's composer.
  const value = proposal?.decided_payload ?? proposal?.payload ?? proposal;
  const kind = value?.kind;
  const text = value?.text ?? value?.body;
  return kind === 'reply' && typeof text === 'string' && text.trim() ? text : null;
}
export const bookingHref = (contactUid) => '/calendar?new=1&with=' + encodeURIComponent(String(contactUid));
export function replySubject(thread) {
  const subject = [...(thread?.messages ?? [])].reverse().find((m) => m.subject)?.subject;
  return subject ? /^re:/i.test(subject) ? subject : 'Re: ' + subject : '';
}
/** Called only after the composer's final confirmation. Accept and draft never reach this helper. */
export async function sendConfirmedReply(api, { accountUid, recipient, subject, body }) {
  if (!accountUid || !recipient || !subject?.trim() || !body?.trim()) throw new Error('Complete the reply before sending.');
  const confirmation = await api.confirmSend(accountUid);
  if (!confirmation?.nonce) throw new Error('The send could not be confirmed. Try again.');
  const result = await api.send({ account_uid: accountUid, to: recipient, subject: subject.trim(), body, nonce: confirmation.nonce });
  if (typeof result?.sent?.uid !== 'string' || !result.sent.uid) throw new Error('The send result could not be verified. Check your mailbox.');
  return result;
}
