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
}

export async function sendRawEmail(env: Env, opts: RawEmailOpts): Promise<boolean> {
  try {
    const accessToken = await getGmailAccessToken(env);
    const boundary = `boundary_${crypto.randomUUID().replace(/-/g, '')}`;
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
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

    const rawEmail = [
      ...headers,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      b64encode(opts.text),
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset="UTF-8"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      b64encode(opts.html),
      ``,
      `--${boundary}--`,
    ].join('\r\n');

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
