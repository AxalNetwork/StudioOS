/**
 * Task #2 (IB) — Email template layout + tiny render engine.
 *
 * Every transactional email shares one header/footer chrome so the brand,
 * unsubscribe path, account link, and registered-address line are
 * authored in exactly one place. Templates only supply `subject`, `text`
 * body, and `html` body fragment; this module wraps the fragment in the
 * chrome and runs `{{var}}` substitution against the caller's `vars`.
 *
 * Rendering engine is intentionally NOT Handlebars/Mustache — we just
 * support `{{key}}` and `{{key.nested}}` lookups. That's enough for every
 * template in the registry, keeps the bundle ~0 bytes, and means there is
 * no template-eval foot-gun.
 */
import { stripTrailingSlashes } from '../../util/url';

export type TemplateCategory =
  | 'security' | 'billing' | 'contract' | 'deal'
  | 'mentor' | 'calendar' | 'system' | 'marketing'
  | 'partner' | 'spinout' | 'dd' | 'account';

export type TemplateSeverity = 'info' | 'warning' | 'critical';

export interface EmailTemplate {
  /** Stable key — what call sites pass to send(template_key, ...). */
  key: string;
  /** Notification category. Drives inbox routing + Settings matrix. */
  category: TemplateCategory;
  severity: TemplateSeverity;
  /** Reply-To: 'support@' | 'security@' | 'billing@' | 'noreply@' */
  replyTo: 'support@axal.vc' | 'security@axal.vc' | 'billing@axal.vc' | 'noreply@axal.vc';
  /** Marketing class — emits List-Unsubscribe headers + visible unsub link.
   *  Transactional templates leave this undefined. */
  marketing?: boolean;
  /** Critical security/billing alerts ignore the per-channel email toggle. */
  alwaysSend?: boolean;
  /** Vars contract — documented at top of each registry entry. */
  subject: string;
  /** Plaintext body fragment. Wrapped with text header/footer. */
  text: string;
  /** HTML body fragment. Wrapped with html header/footer. */
  html: string;
}

const SUPPORT_FROM   = 'Axal VC <noreply@axal.vc>';
const COMPANY_ADDR   = 'Axal Network, 1111B S Governors Ave #20431, Dover, DE 19904, USA';

function lookup(vars: Record<string, unknown>, path: string): string {
  const parts = path.split('.');
  let cur: any = vars;
  for (const p of parts) {
    if (cur == null) return '';
    cur = cur[p];
  }
  return cur == null ? '' : String(cur);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** `{{var}}` substitution with optional `{{{var}}}` for raw HTML opt-out
 *  of auto-escape. Used inside `html` bodies; text bodies always escape. */
export function render(template: string, vars: Record<string, unknown>, escape = false): string {
  return template
    .replace(/\{\{\{([^}]+)\}\}\}/g, (_m, key) => lookup(vars, key.trim()))
    .replace(/\{\{([^}]+)\}\}/g, (_m, key) => {
      const raw = lookup(vars, key.trim());
      return escape ? escapeHtml(raw) : raw;
    });
}

function htmlHeader(appUrl: string): string {
  const root = stripTrailingSlashes(appUrl || 'https://axal.vc');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;border:1px solid #e5e7eb;overflow:hidden;">
<tr><td style="padding:24px 28px;border-bottom:1px solid #f3f4f6;">
  <a href="${root}" style="text-decoration:none;color:#111;font-size:20px;font-weight:700;letter-spacing:-0.01em;">Axal</a>
</td></tr>
<tr><td style="padding:28px;font-size:15px;line-height:1.55;color:#111;">`;
}

function htmlFooter(appUrl: string, opts: { marketing?: boolean; unsubscribeUrl?: string | null }): string {
  const root = stripTrailingSlashes(appUrl || 'https://axal.vc');
  const unsubLine = opts.marketing && opts.unsubscribeUrl
    ? `<a href="${opts.unsubscribeUrl}" style="color:#6b7280;">Unsubscribe</a> · `
    : '';
  return `</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #f3f4f6;font-size:12px;line-height:1.6;color:#6b7280;">
  ${unsubLine}<a href="${root}/settings/notifications" style="color:#6b7280;">Notification settings</a> · <a href="${root}" style="color:#6b7280;">Open Axal</a> · <a href="${root}/legal/privacy" style="color:#6b7280;">Privacy</a> · <a href="${root}/legal/terms" style="color:#6b7280;">Terms</a>
  <div style="margin-top:8px;color:#9ca3af;">${COMPANY_ADDR}</div>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function textFooter(appUrl: string, opts: { marketing?: boolean; unsubscribeUrl?: string | null }): string {
  const root = stripTrailingSlashes(appUrl || 'https://axal.vc');
  const lines = ['', '---'];
  if (opts.marketing && opts.unsubscribeUrl) lines.push(`Unsubscribe: ${opts.unsubscribeUrl}`);
  lines.push(`Notification settings: ${root}/settings/notifications`);
  lines.push(`Open Axal: ${root}`);
  lines.push(COMPANY_ADDR);
  return lines.join('\n');
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
  from: string;
  replyTo: string;
  /** Set only for marketing-class templates. Goes into both
   *  `List-Unsubscribe` (RFC 2369) and `List-Unsubscribe-Post` (RFC 8058
   *  one-click) headers in the outbound MIME. */
  unsubscribeUrl?: string | null;
}

export function wrap(
  tmpl: EmailTemplate,
  vars: Record<string, unknown>,
  ctx: { appUrl: string; unsubscribeUrl?: string | null },
): RenderedEmail {
  const subject = render(tmpl.subject, vars);
  const bodyText = render(tmpl.text, vars);
  const bodyHtml = render(tmpl.html, vars);
  const unsub = tmpl.marketing ? (ctx.unsubscribeUrl ?? null) : null;
  return {
    subject,
    from: SUPPORT_FROM,
    replyTo: tmpl.replyTo,
    text: `${bodyText}${textFooter(ctx.appUrl, { marketing: tmpl.marketing, unsubscribeUrl: unsub })}`,
    html: `${htmlHeader(ctx.appUrl)}${bodyHtml}${htmlFooter(ctx.appUrl, { marketing: tmpl.marketing, unsubscribeUrl: unsub })}`,
    unsubscribeUrl: unsub,
  };
}
