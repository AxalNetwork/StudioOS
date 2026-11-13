/**
 * D810 (#2256) — the newsletter's four transactional emails: confirm
 * subscription, welcome, unsubscribed and preferences saved.
 *
 * PLACEHOLDERS, ALL FOUR. The owner's "Newsletter templates · Axal VC" design
 * holds their HTML (`confirm-subscription`, `welcome`, `unsubscribed`,
 * `preferences-saved`); until it is exported, each email is its plain-text
 * wording, and the HTML part is that same text in a minimal wrapper. When the
 * export lands, each `html` below takes the designed markup and keeps the
 * same variables.
 *
 * Every variable is escaped into the HTML. Links are built by the route from
 * APP_URL and a token; nothing here reads a request.
 */
import { escapeHtml } from '../../../services/email';

export type NewsletterEmail = { subject: string; text: string; html: string };

/** Which of the four are still the plain-text placeholder. */
export const NEWSLETTER_PLACEHOLDERS = Object.freeze(['confirm-subscription', 'welcome', 'unsubscribed', 'preferences-saved'] as const);

const FOOTER = 'Axal VC · You are receiving this because this address was entered at axal.vc.';

function htmlOf(lines: string[], links: Record<string, string> = {}): string {
  const body = lines.map((l) => {
    const linked = Object.entries(links).find(([, url]) => l.includes(url));
    if (linked) {
      const [label, url] = linked;
      return `<a href="${escapeHtml(url)}" style="color:#6d28d9;">${escapeHtml(label)}</a>`;
    }
    return escapeHtml(l);
  }).join('<br>');
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#111827;max-width:560px;">${body}</div>`;
}

function build(subject: string, lines: string[], links: Record<string, string> = {}): NewsletterEmail {
  const all = [...lines, '', FOOTER];
  return { subject, text: all.join('\n'), html: htmlOf(all, links) };
}

/** Sent on a signup: the single-use link that confirms it (48 hours). */
export function confirmSubscription(v: { confirm_url: string; topics: string[] }): NewsletterEmail {
  return build('Confirm your subscription to Axal VC', [
    'Please confirm that you want to receive email from Axal VC.',
    v.topics.length ? `You chose: ${v.topics.join(', ')}.` : 'You can choose your topics after you confirm.',
    '',
    'Confirm subscription:',
    v.confirm_url,
    '',
    'This link works once and expires in 48 hours. If you did not ask for this, ignore this email and nothing will be sent.',
  ], { 'Confirm subscription': v.confirm_url });
}

/** Sent to an address that is already subscribed and signs up again: no new consent, a way to manage it. */
export function manageExisting(v: { preferences_url: string }): NewsletterEmail {
  return build('Your Axal VC subscription', [
    'This address is already subscribed to Axal VC.',
    'To change your topics or unsubscribe, use this link:',
    v.preferences_url,
  ], { 'Manage your topics': v.preferences_url });
}

/** Sent once a subscription is confirmed. */
export function welcome(v: { topics: string[]; preferences_url: string; unsubscribe_url: string }): NewsletterEmail {
  return build('Welcome to Axal VC', [
    'Your subscription is confirmed.',
    v.topics.length ? `You will hear from us about: ${v.topics.join(', ')}.` : 'Choose your topics at any time.',
    '',
    'Manage your topics:',
    v.preferences_url,
    'Unsubscribe from everything:',
    v.unsubscribe_url,
  ], { 'Manage your topics': v.preferences_url, 'Unsubscribe from everything': v.unsubscribe_url });
}

/** Sent after an unsubscribe, from one topic or from all. */
export function unsubscribed(v: { topic_label: string | null; preferences_url: string }): NewsletterEmail {
  return build('You have been unsubscribed', [
    v.topic_label ? `You will no longer receive ${v.topic_label} from Axal VC.` : 'You will no longer receive newsletters from Axal VC.',
    'Changed your mind? Choose your topics again:',
    v.preferences_url,
  ], { 'Choose your topics': v.preferences_url });
}

/** Sent after the preferences page saves. */
export function preferencesSaved(v: { topics: string[]; preferences_url: string }): NewsletterEmail {
  return build('Your Axal VC preferences are saved', [
    v.topics.length ? `You will hear from us about: ${v.topics.join(', ')}.` : 'You have no topics on, so you will receive no newsletters.',
    'Change them at any time:',
    v.preferences_url,
  ], { 'Change them': v.preferences_url });
}
