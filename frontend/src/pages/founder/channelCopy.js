/**
 * D684 (#1578) — the words the channels inbox uses for replying, from the
 * member's side. Pure, so the rules are tested without a screen.
 *
 * Two facts the copy must not blur (D684 §6, §11):
 *   · A reply is free-form only inside 24 hours. WhatsApp counts from the
 *     customer's last message; Telegram Business lets a bot act only in chats
 *     active in the last 24 hours. After that WhatsApp needs an approved
 *     template, which this phase does not send, so the composer says so and
 *     sends nothing.
 *   · Only WhatsApp reports delivery. Telegram says the message was accepted,
 *     so Telegram is "Sent", never "Delivered" or "Read".
 */

const NAME = { telegram: 'Telegram', whatsapp: 'WhatsApp' };

/** The provider's name, or "this app" for one that is not a messaging channel. */
export function providerName(provider) {
  return Object.hasOwn(NAME, provider) ? NAME[provider] : 'this app';
}

/**
 * What the composer says, from the thread read's `reply_window_open` (the
 * Worker decides it; this never recomputes it from a clock). `canReply` is
 * false when the connection's rights do not allow replying, and a thread that
 * did not say is "not recorded", not open.
 */
export function replyWindowCopy(thread) {
  const name = providerName(thread?.provider);
  if (!thread || typeof thread.reply_window_open !== 'boolean') {
    return { open: false, text: 'Not recorded whether you can reply here.' };
  }
  if (thread.reply_window_open) {
    return { open: true, text: `You can reply for 24 hours after the last message from your contact. Your reply goes out from your ${name} account.` };
  }
  if (thread.provider === 'whatsapp') {
    return { open: false, text: 'It has been more than 24 hours since your contact last wrote, so WhatsApp only allows an approved template message. Sending templates is not available yet, and nothing is sent from here.' };
  }
  return { open: false, text: `It has been more than 24 hours since this chat was last active, so ${name} does not let StudioOS reply. Reply from ${name}, or wait for your contact to write.` };
}

/**
 * One reply's status line. Telegram stops at "Sent" because Telegram never
 * reports delivery; claiming more would be inventing it.
 */
export function sendStatusLabel(provider, status) {
  if (status === 'failed') return 'Not sent';
  if (status === 'pending') return 'Sending';
  if (status === 'submitted') return 'Sent';
  if ((status === 'delivered' || status === 'read') && provider === 'whatsapp') {
    return status === 'read' ? 'Read' : 'Delivered';
  }
  if (status === 'delivered' || status === 'read') return 'Sent';
  return 'Not recorded';
}
