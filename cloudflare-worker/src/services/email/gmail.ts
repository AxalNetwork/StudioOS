/**
 * Task #2 (IB) — Gmail raw sender with arbitrary header support.
 *
 * services/email.ts already speaks Gmail OAuth and builds a
 * multipart/alternative MIME, but it doesn't accept caller-supplied
 * extra headers (we need `List-Unsubscribe` + `List-Unsubscribe-Post`
 * on marketing class emails, plus a `Reply-To` that varies per
 * template). Re-implementing the raw envelope here keeps the legacy
 * sendVerificationEmail / sendNotificationEmail callers untouched
 * while giving the new send() pipeline the headers it needs.
 */
import type { Env } from '../../types';

async function getGmailAccessToken(env: Env): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: (env as any).GMAIL_CLIENT_ID!,
      client_secret: (env as any).GMAIL_CLIENT_SECRET!,
      refresh_token: (env as any).GMAIL_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    throw new Error(`OAuth token fetch failed: ${err?.error_description || err?.error || res.statusText}`);
  }
  const data: any = await res.json();
  if (!data.access_token) throw new Error('No access_token in OAuth response');
  return data.access_token;
}

function stripHeaderInjection(s: string): string {
  return (s || '').replace(/[\r\n]+/g, ' ').trim();
}

function b64encode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return b64.match(/.{1,76}/g)!.join('\r\n');
}

/** A file part appended after the body via a multipart/mixed wrapper. The
 *  `content` is the raw (un-encoded) string — it is base64-encoded here. */
export interface EmailAttachment {
  /** e.g. `event.ics`. Quotes / CR / LF are scrubbed before emission. */
  filename: string;
  /** Full Content-Type value, e.g. `text/calendar; method=REQUEST; charset="UTF-8"`. */
  contentType: string;
  /** Raw attachment body (NOT pre-encoded). */
  content: string;
}

/** A calendar meeting invite (.ics) to embed (Task #15). When present the ICS
 *  is emitted BOTH as an inline `text/calendar; method=…` alternative (so
 *  Gmail/Outlook render accept/decline) AND as a downloadable `.ics`
 *  attachment. The MIME `method=` always mirrors the ICS `METHOD:` so the two
 *  never disagree. */
export interface CalendarInvite {
  /** ICS METHOD — typically `'REQUEST'` for an invitation. Mirrored into the
   *  MIME `text/calendar; method=` parameter. */
  method: string;
  /** Raw ICS body (NOT pre-encoded). */
  content: string;
  /** Download filename for the attachment fallback. Defaults to `invite.ics`. */
  filename?: string;
}

export interface RawEmailOpts {
  to: string;
  subject: string;
  text: string;
  html: string;
  from: string;
  replyTo: string;
  /** Extra headers — e.g. `List-Unsubscribe`. Values are header-injection
   *  scrubbed (CR/LF collapsed to space) before emission. */
  extraHeaders?: Record<string, string>;
  /** Optional file parts. When present the body becomes a multipart/mixed
   *  envelope wrapping the multipart/alternative text+html part plus each
   *  attachment. */
  attachments?: EmailAttachment[];
  /** Optional calendar meeting invite — see {@link CalendarInvite}. */
  calendarInvite?: CalendarInvite;
}

/** Scrub a value destined for a quoted MIME parameter (filename="…"). */
function safeFilename(s: string): string {
  return stripHeaderInjection(s).replace(/["\\]/g, '').slice(0, 200) || 'attachment';
}

/** Normalise an ICS `METHOD` for use as a MIME `method=` parameter: uppercase
 *  letters only (so it can never inject extra MIME params). */
function safeCalendarMethod(m: string): string {
  return String(m || '').toUpperCase().replace(/[^A-Z]/g, '') || 'PUBLISH';
}

/** The text/plain + text/html multipart/alternative block (no leading/closing
 *  envelope boundary — caller frames it). When `calendar` is supplied a
 *  `text/calendar; method=…` part is appended so clients render the message as
 *  an actionable meeting invite (accept/decline) rather than a plain email. */
function alternativeBlock(
  boundary: string,
  text: string,
  html: string,
  calendar?: { method: string; content: string },
): string {
  const parts = [
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    b64encode(text),
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    b64encode(html),
    ``,
  ];
  if (calendar) {
    parts.push(
      `--${boundary}`,
      `Content-Type: text/calendar; method=${calendar.method}; charset="UTF-8"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      b64encode(calendar.content),
      ``,
    );
  }
  parts.push(`--${boundary}--`);
  return parts.join('\r\n');
}

/**
 * Assemble the raw RFC822 message (before base64url). Pure + exported so the
 * MIME shape — in particular that a calendar invite's `method=` matches the ICS
 * `METHOD:` — is unit-testable without the Gmail network round-trip.
 *
 * Envelopes:
 *  - no attachments + no calendar → multipart/alternative (legacy, unchanged).
 *  - otherwise → multipart/mixed wrapping the alternative part and the file
 *    parts. A calendar invite additionally rides INSIDE the alternative as a
 *    `text/calendar; method=…` part (so Gmail/Outlook render accept/decline)
 *    AND as a downloadable `.ics` attachment (the fallback for clients that
 *    only scan attachments, e.g. Apple Mail). Both carry the same `method=`.
 */
export function buildRawMimeMessage(opts: RawEmailOpts): string {
  const altBoundary = `alt_${crypto.randomUUID().replace(/-/g, '')}`;
  const safeTo      = stripHeaderInjection(opts.to);
  const safeFrom    = stripHeaderInjection(opts.from);
  const safeReply   = stripHeaderInjection(opts.replyTo);
  const safeSubject = stripHeaderInjection(opts.subject);
  const subjectEnc  = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(safeSubject)))}?=`;

  const headers: string[] = [
    `To: ${safeTo}`,
    `From: ${safeFrom}`,
    `Reply-To: ${safeReply}`,
    `Subject: ${subjectEnc}`,
    `MIME-Version: 1.0`,
  ];
  if (opts.extraHeaders) {
    for (const [k, v] of Object.entries(opts.extraHeaders)) {
      if (!k || !v) continue;
      headers.push(`${stripHeaderInjection(k)}: ${stripHeaderInjection(v)}`);
    }
  }

  const cal = opts.calendarInvite && opts.calendarInvite.content
    ? {
        method: safeCalendarMethod(opts.calendarInvite.method),
        content: opts.calendarInvite.content,
        filename: safeFilename(opts.calendarInvite.filename || 'invite.ics'),
      }
    : null;
  const attachments = (opts.attachments || []).filter((a) => a && a.content);

  // Nothing to wrap → the legacy multipart/alternative envelope, unchanged.
  if (!cal && attachments.length === 0) {
    headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    return [...headers, ``, alternativeBlock(altBoundary, opts.text, opts.html)].join('\r\n');
  }

  const mixedBoundary = `mixed_${crypto.randomUUID().replace(/-/g, '')}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
  const parts: string[] = [
    ...headers,
    ``,
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    ``,
    alternativeBlock(altBoundary, opts.text, opts.html, cal ? { method: cal.method, content: cal.content } : undefined),
    ``,
  ];
  if (cal) {
    parts.push(
      `--${mixedBoundary}`,
      `Content-Type: text/calendar; method=${cal.method}; charset="UTF-8"; name="${cal.filename}"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${cal.filename}"`,
      ``,
      b64encode(cal.content),
      ``,
    );
  }
  for (const att of attachments) {
    parts.push(
      `--${mixedBoundary}`,
      `Content-Type: ${stripHeaderInjection(att.contentType)}; name="${safeFilename(att.filename)}"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${safeFilename(att.filename)}"`,
      ``,
      b64encode(att.content),
      ``,
    );
  }
  parts.push(`--${mixedBoundary}--`);
  return parts.join('\r\n');
}

export async function sendRawEmail(env: Env, opts: RawEmailOpts): Promise<boolean> {
  try {
    const accessToken = await getGmailAccessToken(env);
    const rawEmail = buildRawMimeMessage(opts);
    const raw = btoa(unescape(encodeURIComponent(rawEmail)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      console.error('[email/gmail] send failed', err);
      return false;
    }
    return true;
  } catch (e: any) {
    console.error('[email/gmail] send threw', e?.message || e);
    return false;
  }
}
