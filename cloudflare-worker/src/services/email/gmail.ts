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
   *  attachment (used for the `.ics` on event invites). */
  attachments?: EmailAttachment[];
}

/** Scrub a value destined for a quoted MIME parameter (filename="…"). */
function safeFilename(s: string): string {
  return stripHeaderInjection(s).replace(/["\\]/g, '').slice(0, 200) || 'attachment';
}

/** The text/plain + text/html multipart/alternative block (no leading/closing
 *  envelope boundary — caller frames it). */
function alternativeBlock(boundary: string, text: string, html: string): string {
  return [
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
    `--${boundary}--`,
  ].join('\r\n');
}

export async function sendRawEmail(env: Env, opts: RawEmailOpts): Promise<boolean> {
  try {
    const accessToken = await getGmailAccessToken(env);
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

    const attachments = (opts.attachments || []).filter((a) => a && a.content);
    let rawEmail: string;
    if (attachments.length === 0) {
      // Simple multipart/alternative — unchanged legacy envelope.
      headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
      rawEmail = [...headers, ``, alternativeBlock(altBoundary, opts.text, opts.html)].join('\r\n');
    } else {
      // multipart/mixed wrapping the alternative part + each attachment.
      const mixedBoundary = `mixed_${crypto.randomUUID().replace(/-/g, '')}`;
      headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
      const parts: string[] = [
        ...headers,
        ``,
        `--${mixedBoundary}`,
        `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
        ``,
        alternativeBlock(altBoundary, opts.text, opts.html),
        ``,
      ];
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
      rawEmail = parts.join('\r\n');
    }

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
