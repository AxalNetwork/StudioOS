/**
 * Task #6 — Shared event delivery (design §6/§7).
 *
 * One place that turns an event invitation into the two channels the spec
 * mandates: the recipient's in-app inbox (for users with accounts) AND an
 * email carrying the event `.ics` so the invite drops straight into a
 * calendar. Reused by the host "send invites" flow and the comp-on-publish
 * automation so both behave identically (and idempotently — callers only
 * deliver NEWLY minted/created invites).
 *
 * This does NOT build a parallel mailer: it reuses the shared email chrome
 * (`templates/email/layout.ts::wrap`) and the raw Gmail sender, plus the
 * notification pipeline (`notify`).
 */
import type { Env } from '../types';
import { notify } from './notify';
import { buildEventIcs } from './eventsCommon';
import { wrap, type EmailTemplate } from '../templates/email/layout';

export interface EventInviteTarget {
  /** Recipient account id (drives the in-app inbox row). */
  userId?: number | null;
  /** Recipient email (drives the email + .ics). */
  email?: string | null;
  name?: string | null;
  /** RSVP token — the email CTA lands on `/invite/:token`. */
  token: string;
  /** Optional personal note from the host. */
  message?: string | null;
  /** Comp invites get a slightly different subject/lead. */
  comp?: boolean;
}

function baseUrl(env: Env): string {
  return String((env as any).PUBLIC_BASE_URL || (env as any).APP_URL || 'https://axal.vc').replace(/\/$/, '');
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Human "When" line from `starts_at` (+ event timezone), best-effort. */
function formatWhen(event: any): string {
  const raw = event.starts_at;
  if (!raw) return 'Time TBD';
  const iso = String(raw).includes('T') ? String(raw) : String(raw).replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(raw);
  const tz = event.timezone || 'UTC';
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: tz, timeZoneName: 'short',
    }).format(d);
  } catch {
    return d.toUTCString();
  }
}

function formatWhere(event: any): string {
  const kind = event.location_kind || 'virtual';
  if (kind === 'virtual') return 'Online';
  const parts = [event.location_text, event.location_url].filter(Boolean);
  if (parts.length) return parts.join(' — ');
  return kind === 'hybrid' ? 'Hybrid' : 'In person';
}

/**
 * Deliver a single event invitation: in-app inbox (if the recipient has an
 * account) + email-with-.ics (if we have an address and Gmail is configured).
 * Best-effort — never throws; failures are logged by the underlying senders.
 */
export async function deliverEventInvite(
  env: Env,
  event: any,
  invite: EventInviteTarget,
): Promise<void> {
  const base = baseUrl(env);
  const subject = invite.comp
    ? `Your complimentary invite: ${event.title}`
    : `You're invited: ${event.title}`;

  // 1) In-app inbox for users with accounts.
  if (invite.userId) {
    await notify(env, {
      userId: Number(invite.userId),
      type: 'event_invitation',
      category: 'events',
      title: subject,
      body: invite.message || undefined,
      link: `/events/${event.slug}`,
      payload: { event_id: event.id, token: invite.token, comp: !!invite.comp },
    }).catch(() => {});
  }

  // 2) Email + .ics for anyone with an address.
  const hasGmail = !!(env as any).GMAIL_CLIENT_ID
    && !!(env as any).GMAIL_CLIENT_SECRET
    && !!(env as any).GMAIL_REFRESH_TOKEN;
  if (!invite.email || !hasGmail) return;

  const rsvpUrl = `${base}/invite/${encodeURIComponent(invite.token)}`;
  const when = formatWhen(event);
  const where = formatWhere(event);
  const greeting = invite.name ? `Hi ${invite.name},` : 'Hi,';
  const lead = invite.comp
    ? `You've received a complimentary invitation to ${event.title}.`
    : `You're invited to ${event.title}.`;

  const textLines = [greeting, '', lead, '', `When: ${when}`, `Where: ${where}`];
  if (invite.message) textLines.push('', invite.message);
  textLines.push('', `RSVP: ${rsvpUrl}`, '', 'A calendar invite (.ics) is attached.');

  const messageHtml = invite.message
    ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin:0 0 20px;color:#374151;font-size:14px;line-height:1.6;">${esc(invite.message)}</div>`
    : '';

  const tmpl: EmailTemplate = {
    key: 'event_invitation',
    category: 'calendar',
    severity: 'info',
    replyTo: 'support@axal.vc',
    subject,
    text: textLines.join('\n'),
    html: `<h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 8px;letter-spacing:-0.02em;">${esc(lead)}</h1>
<p style="font-size:14px;color:#6b7280;margin:0 0 20px;line-height:1.6;">${esc(greeting)}</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
  <tr><td style="padding:4px 0;color:#6b7280;font-size:13px;width:64px;">When</td><td style="padding:4px 0;color:#111827;font-size:14px;font-weight:600;">${esc(when)}</td></tr>
  <tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Where</td><td style="padding:4px 0;color:#111827;font-size:14px;font-weight:600;">${esc(where)}</td></tr>
</table>
${messageHtml}
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 8px;">
  <a href="${esc(rsvpUrl)}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 28px;border-radius:14px;">RSVP</a>
</td></tr></table>
<p style="font-size:12px;color:#9ca3af;margin:20px 0 0;line-height:1.6;">A calendar invite (.ics) is attached so you can add this to your calendar in one tap.</p>`,
  };

  const rendered = wrap(tmpl, {}, { appUrl: base });
  // A meeting invite (METHOD:REQUEST) with ORGANIZER + ATTENDEE so clients
  // render accept/decline. ORGANIZER is parsed from the email From so the .ics
  // and the envelope agree (Outlook matches them); ATTENDEE is the recipient.
  const ics = buildEventIcs(event, base, {
    method: 'REQUEST',
    organizer: parseEmailAddress(rendered.from),
    attendee: { email: invite.email, name: invite.name },
  });

  try {
    const { sendRawEmail } = await import('./email/gmail');
    await sendRawEmail(env, {
      to: invite.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      from: rendered.from,
      replyTo: rendered.replyTo,
      // The .ics METHOD and the MIME `method=` are both REQUEST — see
      // buildRawMimeMessage, which emits it inline (accept/decline) plus an
      // .ics attachment fallback.
      calendarInvite: {
        method: 'REQUEST',
        content: ics,
        filename: `${event.slug || 'event'}.ics`,
      },
    });
  } catch (e: any) {
    console.warn('[eventMessaging] invite email failed', e?.message || e);
  }
}

/** Pull a `{ email, name }` out of a From header like `Axal VC <noreply@axal.vc>`
 *  (falls back to treating the whole string as a bare address). */
function parseEmailAddress(from: string): { email: string; name?: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(String(from || ''));
  if (m) {
    const name = m[1].replace(/^"|"$/g, '').trim();
    return { email: m[2].trim(), name: name || undefined };
  }
  return { email: String(from || '').trim() };
}
