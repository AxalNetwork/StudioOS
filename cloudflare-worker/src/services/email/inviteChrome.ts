/**
 * M0 shared chrome from the Emails canvas — one shell for every outbound message.
 *
 * 600px single column, text wordmark (purple “A” block, no load-bearing images),
 * postal footer, and the three-way unsubscribe rule:
 *   broadcast      → unsubscribe required (Set A + weekly digest)
 *   transactional  → no unsubscribe (M1–M3, M5)
 *   personal       → no unsubscribe (Set B GP notes)
 */
import { escapeHtml as esc } from '../email';

export const SENDER_POSTAL =
  'Axal VC Management LLC, 16192 Coastal Hwy, Lewes, DE 19958, United States';

const HAIR = '#e8e6ee';
const FOOT_BG = '#fbfaff';
const FONT = "Inter,-apple-system,'Segoe UI',Arial,sans-serif";

export type EmailKind =
  | 'broadcast'
  | 'transactional'
  | 'personal';

export function unsubscribeAllowed(kind: EmailKind): boolean {
  return kind === 'broadcast';
}

export interface FooterLink {
  label: string;
  href: string;
  /** Muted links (e.g. unsubscribe) use grey ink per the canvas. */
  muted?: boolean;
}

export interface FooterOpts {
  to: string;
  reason?: string;
  prefsUrl?: string;
  unsubscribeUrl?: string;
  /** Extra footer links after preferences — M4 digest uses frequency + unsubscribe. */
  footLinks?: FooterLink[];
}

/** Canvas wordmark row — text only, no <img>. */
export function headerRow(chromeBadge?: string | null): string {
  const badge = chromeBadge
    ? `<span style="font-family:'Roboto Mono','SFMono-Regular',Consolas,monospace;font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:0.11em;color:#6b6577;">${esc(chromeBadge)}</span>`
    : '';
  return `<tr><td style="padding:20px 32px;border-bottom:1px solid ${HAIR};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle;padding-right:9px;">
      <div style="width:22px;height:22px;border-radius:6px;background:#7c3aed;color:#fff;font-size:10px;font-weight:800;line-height:22px;text-align:center;font-family:${FONT};">A</div>
    </td>
    <td style="vertical-align:middle;font-size:13px;font-weight:800;letter-spacing:-0.02em;color:#241f38;font-family:${FONT};">Axal VC</td>
  </tr></table>
</td>
${badge ? `<td align="right" style="vertical-align:middle;">${badge}</td>` : ''}
</tr></table>
</td></tr>`;
}

export function footerFor(kind: EmailKind, opts: FooterOpts): string {
  const prefs = opts.prefsUrl
    ? `<a href="${esc(opts.prefsUrl)}" style="color:#6d28d9;text-decoration:none;">Notification preferences</a>`
    : '';

  let tail: string;
  switch (kind) {
    case 'broadcast': {
      if (!opts.unsubscribeUrl) {
        throw new Error('broadcast email requires an unsubscribeUrl — see inviteChrome.ts');
      }
      const reason = opts.reason || `Sent to ${opts.to}.`;
      const extra = (opts.footLinks || []).map((l) => {
        const ink = l.muted ? '#6b6577' : '#6d28d9';
        return ` · <a href="${esc(l.href)}" style="color:${ink};text-decoration:none;">${esc(l.label)}</a>`;
      }).join('');
      const hasCustomUnsub = (opts.footLinks || []).some((l) => l.muted);
      const unsub = !hasCustomUnsub
        ? ` · <a href="${esc(opts.unsubscribeUrl)}" style="color:#6b6577;text-decoration:none;">Unsubscribe</a>`
        : '';
      tail = `${esc(reason)}<br>${prefs || ''}${extra}${unsub}`;
      break;
    }
    case 'transactional': {
      const reason = opts.reason || `Sent to ${opts.to}.`;
      const links = (opts.footLinks || []).map((l, i) => {
        const sep = i === 0 && prefs ? ' · ' : (i > 0 || prefs ? ' · ' : '');
        const ink = l.muted ? '#6b6577' : '#6d28d9';
        return `${sep}<a href="${esc(l.href)}" style="color:${ink};text-decoration:none;">${esc(l.label)}</a>`;
      }).join('');
      tail = `${esc(reason)}<br>${prefs}${links}`;
      break;
    }
    case 'personal': {
      const reason = opts.reason
        || 'A personal message from Guillaume Lauzier. Not a marketing list — there is nothing to unsubscribe from.';
      tail = `${esc(reason)}<br>${prefs || ''}`;
      break;
    }
  }

  const postalLine = kind === 'personal'
    ? ''
    : `<p style="font-size:11px;line-height:1.6;color:#6b6577;margin:0;font-family:${FONT};">${esc(SENDER_POSTAL)}</p>`;

  return `<tr><td style="padding:22px 32px;background:${FOOT_BG};border-top:1px solid ${HAIR};">
${postalLine}
<p style="font-size:11px;line-height:1.6;color:#6b6577;margin:${postalLine ? '8px' : '0'} 0 0;font-family:${FONT};">${tail}</p>
</td></tr>`;
}

/** 600px single-column shell. Footer is its own lavender row per the canvas. */
export function shell(
  innerHtml: string,
  footerHtml: string,
  chromeBadge?: string | null,
): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#e6e5ea;font-family:${FONT};color:#241f38;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e6e5ea;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${HAIR};">
${headerRow(chromeBadge)}
<tr><td style="padding:30px 32px 32px;font-size:15px;line-height:1.65;color:#332e45;font-family:${FONT};">
${innerHtml}
</td></tr>
${footerHtml}
</table>
</td></tr>
</table>
</body></html>`;
}
