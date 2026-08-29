/**
 * Renders a persona invitation — broadcast or the GP's personal note.
 *
 * Content comes from `personaInvites.ts`, chrome from `inviteChrome.ts`, and
 * this file is only the join. Keeping the three apart is what lets the
 * unsubscribe rule be checked once: `variant` decides `EmailKind`, `EmailKind`
 * decides the footer, and no caller gets to pass a footer of its own.
 *
 * WHY THE GP NOTE DROPS THE BULLETS. The broadcast leads with five labelled
 * benefits. The personal note opens "I am writing personally because a template
 * would undersell this" and then, in the canvas, does NOT list benefits — it is
 * three short paragraphs and one link. Rendering the bullet block under that
 * sentence would make the note disprove itself, so the two variants share the
 * shell and almost nothing else.
 */
import { escapeHtml } from '../email';
import { PERSONA_INVITES, type PersonaKey } from './personaInvites';
import { footerFor, shell, type EmailKind } from './inviteChrome';

export type InviteVariant = 'broadcast' | 'personal';

/** The variant fixes the kind — a personal note can never be a broadcast. */
export function kindFor(variant: InviteVariant): EmailKind {
  return variant === 'broadcast' ? 'broadcast' : 'personal';
}

export interface RenderInviteOpts {
  persona: PersonaKey;
  variant: InviteVariant;
  to: string;
  ctaUrl: string;
  /** Required for a broadcast; `footerFor` throws without it. */
  unsubscribeUrl?: string;
  prefsUrl?: string;
  /** Why this address received it, e.g. "because you hold a Founder licence". */
  reason?: string;
  /** Shown above the note so a personal note reads as from a person. */
  gpName?: string;
}

function button(label: string, url: string): string {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;background:#6d28d9;color:#ffffff;`
    + `text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;">`
    + `${escapeHtml(label)}</a>`;
}

export function renderInvite(o: RenderInviteOpts): { subject: string; html: string; text: string } {
  const p = PERSONA_INVITES[o.persona];
  const kind = kindFor(o.variant);
  const footer = footerFor(kind, {
    to: o.to,
    reason: o.reason,
    prefsUrl: o.prefsUrl,
    unsubscribeUrl: o.unsubscribeUrl,
  });

  if (o.variant === 'personal') {
    const paras = p.gpNote.map(
      (t) => `<p style="margin:0 0 14px;">${escapeHtml(t)}</p>`,
    ).join('\n');
    const sig = o.gpName ? `<p style="margin:18px 0 0;">— ${escapeHtml(o.gpName)}</p>` : '';
    const html = shell(`${paras}\n<p style="margin:20px 0 0;">${button(p.gpCta, o.ctaUrl)}</p>${sig}`, footer);
    const text = `${p.gpNote.join('\n\n')}\n\n${p.gpCta}: ${o.ctaUrl}${o.gpName ? `\n\n— ${o.gpName}` : ''}\n`;
    // A personal note with a marketing subject is the tell that it is not one.
    return { subject: p.gpNote[0].slice(0, 72), html, text };
  }

  const bullets = p.bullets.map(([label, detail]) =>
    `<tr><td style="padding:0 0 10px;font-size:14px;line-height:1.6;">`
    + `<strong style="color:#18181b;">${escapeHtml(label)}</strong>`
    + `<span style="color:#6b7280;"> — ${escapeHtml(detail)}</span></td></tr>`).join('\n');
  const html = shell(
    `<h1 style="font-size:21px;font-weight:700;color:#18181b;margin:0 0 10px;letter-spacing:-0.02em;">${escapeHtml(p.h1)}</h1>
<p style="margin:0 0 18px;color:#3f3f46;">${escapeHtml(p.line)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${bullets}
</table>
<p style="margin:20px 0 0;">${button(p.cta, o.ctaUrl)}</p>`,
    footer,
  );
  const text = `${p.h1}\n\n${p.line}\n\n`
    + p.bullets.map(([l, d]) => `• ${l} — ${d}`).join('\n')
    + `\n\n${p.cta}: ${o.ctaUrl}\n`;
  return { subject: p.h1, html, text };
}
