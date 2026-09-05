/**
 * Task #2 (IB) — Email template layout + tiny render engine.
 *
 * Every transactional email shares one header/footer chrome so the brand,
 * unsubscribe path, account link, and registered-address line are
 * authored in exactly one place. Templates only supply `subject`, `text`
 * body, and `html` body fragment; this module wraps the fragment in the
 * canvas M0 chrome from `services/email/inviteChrome.ts`.
 */
import { stripTrailingSlashes } from '../../util/url';
import { footerFor, SENDER_POSTAL, shell } from '../../services/email/inviteChrome';

export type TemplateCategory =
  | 'security' | 'billing' | 'contract' | 'deal'
  | 'advisor' | 'calendar' | 'system' | 'marketing'
  | 'partner' | 'spinout' | 'dd' | 'account';

export type TemplateSeverity = 'info' | 'warning' | 'critical';

export interface EmailTemplate {
  key: string;
  category: TemplateCategory;
  severity: TemplateSeverity;
  replyTo: 'support@axal.vc' | 'security@axal.vc' | 'billing@axal.vc' | 'noreply@axal.vc';
  marketing?: boolean;
  alwaysSend?: boolean;
  subject: string;
  text: string;
  html: string;
}

const SUPPORT_FROM = 'Axal VC <noreply@axal.vc>';
/** Re-export for tests and callers that read the registered address from layout. */
export const COMPANY_ADDR = SENDER_POSTAL;

function lookup(vars: Record<string, unknown>, path: string): string {
  const parts = path.split('.');
  let cur: any = vars;
  for (const p of parts) {
    if (cur == null) return '';
    if (p === '__proto__' || p === 'constructor' || p === 'prototype') return '';
    cur = cur[p];
  }
  return cur == null ? '' : String(cur);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function render(template: string, vars: Record<string, unknown>, escape = false): string {
  return template
    .replace(/\{\{\{([^{}]+)\}\}\}/g, (_m, key) => lookup(vars, key.trim()))
    .replace(/\{\{([^{}]+)\}\}/g, (_m, key) => {
      const raw = lookup(vars, key.trim());
      return escape ? escapeHtml(raw) : raw;
    });
}

function wrapChrome(
  bodyHtml: string,
  appUrl: string,
  opts: { marketing?: boolean; unsubscribeUrl?: string | null; to?: string },
): string {
  const root = stripTrailingSlashes(appUrl || 'https://axal.vc');
  const prefsUrl = `${root}/account/notifications`;
  const to = opts.to || 'you';
  const kind = opts.marketing && opts.unsubscribeUrl ? 'broadcast' as const : 'transactional' as const;
  const footer = footerFor(kind, {
    to,
    prefsUrl,
    unsubscribeUrl: kind === 'broadcast' ? (opts.unsubscribeUrl ?? undefined) : undefined,
  });
  return shell(bodyHtml, footer);
}

function textFooter(appUrl: string, opts: { marketing?: boolean; unsubscribeUrl?: string | null }): string {
  const root = stripTrailingSlashes(appUrl || 'https://axal.vc');
  const lines = ['', '---'];
  if (opts.marketing && opts.unsubscribeUrl) lines.push(`Unsubscribe: ${opts.unsubscribeUrl}`);
  lines.push(`Notification settings: ${root}/account/notifications`);
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
  unsubscribeUrl?: string | null;
}

export function wrap(
  tmpl: EmailTemplate,
  vars: Record<string, unknown>,
  ctx: { appUrl: string; unsubscribeUrl?: string | null; to?: string },
): RenderedEmail {
  const subject = render(tmpl.subject, vars);
  const bodyText = render(tmpl.text, vars);
  const bodyHtml = render(tmpl.html, vars);
  const unsub = tmpl.marketing ? (ctx.unsubscribeUrl ?? null) : null;
  const to = ctx.to || (typeof vars.email === 'string' ? vars.email : undefined);
  return {
    subject,
    from: SUPPORT_FROM,
    replyTo: tmpl.replyTo,
    text: `${bodyText}${textFooter(ctx.appUrl, { marketing: tmpl.marketing, unsubscribeUrl: unsub })}`,
    html: wrapChrome(bodyHtml, ctx.appUrl, { marketing: tmpl.marketing, unsubscribeUrl: unsub, to }),
    unsubscribeUrl: unsub,
  };
}
