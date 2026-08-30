/**
 * The one email chrome the Emails canvas specifies, and the unsubscribe rule.
 *
 * WHY THIS EXISTS. `services/email.ts` has twelve senders and each carries its
 * own copy of the header, the footer and the button styles. That is why the
 * canvas's M0 artboard is called "Shared chrome & constraints": twelve copies
 * of a chrome is twelve chances for one of them to be a year out of date, and
 * the footer is the part carrying the postal address a bulk sender is required
 * to show. New senders build on this; the existing twelve are not rewritten
 * here, because a working transactional email is the last thing to refactor
 * speculatively.
 *
 * THE CANVAS'S CONSTRAINTS, applied rather than restated:
 *   600px, single column, table-friendly spacing.
 *   Header is a wordmark and a hairline — no navigation, no hero image.
 *     "Anything an image blocker removes must not be load-bearing", so the
 *     wordmark is TEXT. There is no <img> in this file at all.
 *   Footer carries sender identity, postal address and a preferences link.
 *
 * THE UNSUBSCRIBE RULE IS THE ONE WORTH GETTING RIGHT. The canvas: unsubscribe
 * appears on the weekly digest and the broadcast invitations — never on
 * transactional mail, and never on the GP's personal notes. Both halves matter.
 * Omitting it from a broadcast is a compliance problem; showing it on a
 * password reset invites someone to unsubscribe from their own account, and
 * showing it under a note that opens "I am writing personally" contradicts the
 * sentence above it.
 *
 * So the kind is not a boolean and not an option bag: `EmailKind` has three
 * members, `footerFor` switches on all three, and the switch is exhaustive —
 * a fourth kind fails the typecheck at every call site rather than silently
 * inheriting whichever branch came last.
 */

/** Postal identity, from the canvas footer. Bulk mail must carry it. */
import { escapeHtml as esc } from '../email';

export const SENDER_POSTAL =
  'Axal VC Management LLC, 16192 Coastal Hwy, Lewes, DE 19958, United States';

export type EmailKind =
  /** Broadcast invitations and the weekly digest. Unsubscribe REQUIRED. */
  | 'broadcast'
  /** Account mail: verification, reset, signature requests. Unsubscribe FORBIDDEN. */
  | 'transactional'
  /** The GP writing to one person. Unsubscribe FORBIDDEN — see the docblock. */
  | 'personal';

export function unsubscribeAllowed(kind: EmailKind): boolean {
  return kind === 'broadcast';
}

/**
 * The reason line under the footer.
 *
 * A broadcast says why this address received it and offers the exit. The other
 * two say why there is no exit, rather than leaving a reader to wonder whether
 * the link was forgotten — "not offered, this message is essential to your
 * account" is the canvas's own wording.
 */
export function footerFor(kind: EmailKind, opts: { to: string; reason?: string; prefsUrl?: string; unsubscribeUrl?: string }): string {
  const prefs = opts.prefsUrl
    ? `<a href="${esc(opts.prefsUrl)}" style="color:#6d28d9;text-decoration:none;">Notification preferences</a>`
    : '';
  let tail: string;
  switch (kind) {
    case 'broadcast': {
      // A broadcast without a working unsubscribe link is the one failure this
      // module must not ship, so an absent URL is a programming error, not a
      // silently dropped link.
      if (!opts.unsubscribeUrl) {
        throw new Error('broadcast email requires an unsubscribeUrl — see inviteChrome.ts');
      }
      // Escape ONCE, at render. The first version escaped `to` while building
      // the default reason and then escaped the whole reason again, so an
      // address containing `<` rendered as `&amp;lt;` — visible as literal
      // "&lt;" to the reader. The transactional branch below was already
      // correct, which is exactly how a two-branch bug survives review.
      const reason = opts.reason || `Sent to ${opts.to}.`;
      tail = `${esc(reason)}${prefs ? ` ${prefs} · ` : ' '}`
        + `<a href="${esc(opts.unsubscribeUrl)}" style="color:#6d28d9;text-decoration:none;">Unsubscribe</a>`;
      break;
    }
    case 'transactional':
    case 'personal':
      tail = `${esc(opts.reason || `Sent to ${opts.to}.`)}`
        + ` Unsubscribe not offered — this message is essential to your account.`
        + `${prefs ? ` ${prefs}` : ''}`;
      break;
  }
  return `
  <div style="border-top:1px solid #e5e7eb;margin:28px 0 0;padding:16px 0 0;">
    <p style="font-size:12px;color:#6b7280;margin:0 0 6px;line-height:1.6;">${esc(SENDER_POSTAL)}</p>
    <p style="font-size:12px;color:#9ca3af;margin:0;line-height:1.6;">${tail}</p>
  </div>`;
}

/**
 * 600px single column, text wordmark, hairline. No <img>, no nav.
 */
export function shell(innerHtml: string, footerHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f6f5f8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f8;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:12px;">
<tr><td style="padding:28px 32px 0;">
  <div style="font:700 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:-0.01em;color:#18181b;">Axal VC</div>
  <div style="height:1px;background:#e5e7eb;margin:14px 0 0;"></div>
</td></tr>
<tr><td style="padding:22px 32px 28px;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#3f3f46;">
${innerHtml}
${footerHtml}
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
