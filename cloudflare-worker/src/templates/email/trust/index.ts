/**
 * D1075 (#2967) — the two emails of the subprocessor notices: confirm the
 * subscription, and a new subprocessor's notice.
 *
 * PLACEHOLDERS, BOTH. The trust center canvas draws no email. Each is its
 * plain-text wording, and the HTML part is that same text in a minimal
 * wrapper, as the newsletter's are (`../newsletter/index.ts`).
 *
 * Every variable is escaped into the HTML. Links are built by the service
 * from APP_URL and a token; nothing here reads a request.
 */
import { escapeHtml } from '../../../services/email';

export type TrustEmail = { subject: string; text: string; html: string };

export const TRUST_EMAIL_PLACEHOLDERS = Object.freeze(['subprocessor-confirm', 'subprocessor-notice'] as const);

const FOOTER = 'Axal VC · You are receiving this because this address subscribed to subprocessor changes at axal.vc/trust.';

function build(subject: string, lines: string[], links: Record<string, string> = {}): TrustEmail {
  const all = [...lines, '', FOOTER];
  const html = all.map((l) => {
    const linked = Object.entries(links).find(([, url]) => l === url);
    return linked
      ? `<a href="${escapeHtml(linked[1])}" style="color:#6d28d9;">${escapeHtml(linked[0])}</a>`
      : escapeHtml(l);
  }).join('<br>');
  return {
    subject,
    text: all.join('\n'),
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#111827;max-width:560px;">${html}</div>`,
  };
}

/** Sent on a subscribe: the single-use link that confirms it (48 hours). */
export function subprocessorConfirm(v: { confirm_url: string }): TrustEmail {
  return build('Confirm: Axal VC subprocessor changes', [
    'Please confirm that you want an email before Axal VC adds a subprocessor.',
    '',
    'Confirm subscription:',
    v.confirm_url,
    '',
    'This link works once and expires in 48 hours. If you did not ask for this, ignore this email and nothing will be sent.',
  ], { 'Confirm subscription': v.confirm_url });
}

/** Sent to each confirmed subscriber when a new subprocessor is published, before it starts. */
export function subprocessorNotice(v: {
  name: string; purpose: string; data: string; location: string; starts_on: string; list_url: string; unsubscribe_url: string;
}): TrustEmail {
  return build(`New Axal VC subprocessor from ${v.starts_on}: ${v.name}`, [
    `From ${v.starts_on}, ${v.name} will process personal data for Axal VC.`,
    '',
    `What they do for us: ${v.purpose}`,
    `Data they see: ${v.data}`,
    `Where: ${v.location}`,
    '',
    'The full list:',
    v.list_url,
    '',
    'To stop these emails:',
    v.unsubscribe_url,
  ], { 'Our subprocessors': v.list_url, Unsubscribe: v.unsubscribe_url });
}
