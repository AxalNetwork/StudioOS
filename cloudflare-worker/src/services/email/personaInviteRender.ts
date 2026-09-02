/**
 * Renders a persona invitation — broadcast (Set A) or GP personal note (Set B).
 *
 * Content from `personaInvites.ts`, chrome from `inviteChrome.ts`, fragments
 * from `canvasEmailParts.ts`. The variant fixes EmailKind; callers cannot
 * override the footer unsubscribe rule.
 */
import { escapeHtml } from '../email';
import {
  bulletBox,
  ctaButton,
  greetingBand,
  h1,
  inviterBlock,
  paragraph,
} from './canvasEmailParts';
import { PERSONA_INVITES, type PersonaKey } from './personaInvites';
import { footerFor, shell, type EmailKind } from './inviteChrome';

export type InviteVariant = 'broadcast' | 'personal';

export function kindFor(variant: InviteVariant): EmailKind {
  return variant === 'broadcast' ? 'broadcast' : 'personal';
}

export interface RenderInviteOpts {
  persona: PersonaKey;
  variant: InviteVariant;
  to: string;
  ctaUrl: string;
  unsubscribeUrl?: string;
  prefsUrl?: string;
  reason?: string;
  /** First name for Set B greeting band — required for personal variant. */
  firstName?: string;
}

function broadcastSubject(persona: PersonaKey): string {
  if (persona === 'advisor') return 'You\u2019re invited to join Axal VC as an advisor';
  if (persona === 'investor') return 'You\u2019re invited to join Axal VC as an investor';
  return `You\u2019re invited to join Axal VC as a ${persona}`;
}

function broadcastReason(): string {
  return 'You received this because someone at Axal VC invited you. This is a one-time invitation, not a subscription.';
}

export function renderInvite(o: RenderInviteOpts): { subject: string; html: string; text: string } {
  const p = PERSONA_INVITES[o.persona];
  const kind = kindFor(o.variant);

  if (o.variant === 'personal') {
    const first = (o.firstName || o.to.split('@')[0] || 'there').trim();
    const footer = footerFor(kind, {
      to: o.to,
      reason: o.reason,
      prefsUrl: o.prefsUrl,
    });
    const paras = p.gpNote.map((t, i) => paragraph(t, i === 0 ? 0 : 14)).join('\n');
    const body = `${greetingBand(first)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
<tr><td>
${paras}
<div style="margin-top:20px;">${ctaButton(p.gpCta, o.ctaUrl)}</div>
${inviterBlock({ includePostal: true })}
</td></tr></table>`;
    const html = shell(body, footer);
    const text = `Hi ${first},\n\n${p.gpNote.join('\n\n')}\n\n${p.gpCta}: ${o.ctaUrl}\n\n— ${p.label}\n`;
    return { subject: 'A note about Axal VC', html, text };
  }

  const footer = footerFor(kind, {
    to: o.to,
    reason: o.reason || broadcastReason(),
    prefsUrl: o.prefsUrl,
    unsubscribeUrl: o.unsubscribeUrl,
  });
  const body = `${h1(p.h1)}
${paragraph(p.line)}
${bulletBox(p.bullets)}
<div style="margin-top:24px;">${ctaButton(p.cta, o.ctaUrl)}</div>
${inviterBlock({ showInvitedBy: true })}`;
  const html = shell(body, footer);
  const text = `${p.h1}\n\n${p.line}\n\n`
    + p.bullets.map(([l, d]) => `• ${l} — ${d}`).join('\n')
    + `\n\n${p.cta}: ${o.ctaUrl}\n`;
  return { subject: broadcastSubject(o.persona), html, text };
}

/** Convenience for routes — enqueue a persona invite through the send pipeline. */
export { broadcastSubject, broadcastReason };
