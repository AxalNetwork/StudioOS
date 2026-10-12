/**
 * Public contact form → D1, then an email to the firm (D680).
 *
 * POST /api/contact   { name, email, message, subject?, intent?, company?, link?,
 *                       kind?, hp?, turnstileToken? }
 *   - kind ∈ {'contact','support'} (default 'contact')
 *   - intent (D680) is one of CONTACT_INTENTS — the enquiry pills on /contact
 *     (Spin-Out Lab, Investing / LP, Advising, and Licence, which the
 *     Administrators page's "Request a licence" preselects). Anything else is
 *     400 {code:'invalid_intent'}. With an intent, `subject` may be left out:
 *     it is derived as "<intent label> — <company or name>".
 *   - company (D680) is optional free text, up to 200 characters.
 *   - link (D680) is optional; when given it must be an http(s) URL of at most
 *     500 characters, else 400 {code:'invalid_link'}. It is never truncated:
 *     a cut URL is a different URL.
 *   - hp is a honeypot field — non-empty submissions are silently dropped
 *   - turnstileToken is verified via verifyTurnstile() before anything is
 *     stored — 403 {code:'turnstile_failed'} on failure (fail-closed in prod,
 *     fail-open in dev when TURNSTILE_SECRET_KEY is unset)
 *   - Stores the submission in `contact_submissions` (migration 448), then
 *     emails it to the mailbox for its intent (CONTACT_MAILBOX). Answers
 *     200 {ok:true, reference} once the row is stored, whether or not the email
 *     went: with no mail credentials the row is still there, `notified_at`
 *     stays NULL, and a warning without personal data is logged.
 *   - 500 {code:'store_failed'} when the row cannot be written.
 *
 * WHY NOT GITHUB (D680). This route used to file each submission as a GitHub
 * issue on GITHUB_REPO_OWNER/GITHUB_REPO_NAME — AxalNetwork/StudioOS, a PUBLIC
 * repository — with the sender's name, email, message, IP and user agent.
 * AGENTS.md forbids personal data on GitHub, and /contact promises "Everything
 * you send is confidential". None was ever filed; the route now makes no
 * GitHub call and reads no GitHub setting.
 *
 * The IP is never stored: `ip_hash` is a SHA-256 of the UTC day, the worker's
 * JWT_SECRET and the IP — enough to see one source sending many in a day.
 *
 * Abuse: the global `ip` bucket in middleware/rateLimit.ts caps every IP at
 * 200/min across /api/*. There is no dedicated `contact` bucket (an earlier
 * version of this comment said there was a 3/hour one; rateLimit.ts has never
 * declared it).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { verifyTurnstile } from '../services/turnstile';
import { sendNotificationEmail } from '../services/email';

const contact = new Hono<{ Bindings: Env }>();

function sanitize(input: unknown, max: number): string {
  if (typeof input !== 'string') return '';
  return input.replace(/\r\n/g, '\n').trim().slice(0, max);
}

function isLikelyEmail(s: string): boolean {
  if (s.length < 5 || s.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * D680 — the enquiry kinds /contact offers, keyed as the page sends them. The
 * page's pills are checked against this list by
 * frontend/test/contact_legal_cookies_d680.test.mjs, so the two cannot drift.
 */
export const CONTACT_INTENTS: Record<string, string> = {
  lab: 'Spin-Out Lab',
  invest: 'Investing / LP',
  advise: 'Advising',
  licence: 'Licence',
};

/**
 * D680 — who reads each enquiry: the canvas's three addresses (its CONTACT
 * view's `contactRoutes`). Investing goes to investor relations; advising and
 * licences to the network desk; the Lab, a support request and a submission
 * with no intent to the founders' desk.
 */
export const CONTACT_MAILBOX: Record<string, string> = {
  lab: 'founders@axal.vc',
  invest: 'guillaume.lauzier@axal.vc',
  advise: 'network@axal.vc',
  licence: 'network@axal.vc',
};
export const DEFAULT_CONTACT_MAILBOX = 'founders@axal.vc';

export function contactMailbox(intent: string, kind: string): string {
  if (kind === 'support' || !intent) return DEFAULT_CONTACT_MAILBOX;
  return CONTACT_MAILBOX[intent] || DEFAULT_CONTACT_MAILBOX;
}

/** SHA-256 hex of the UTC day, the worker's secret and the IP. Null without an IP. */
export async function contactIpHash(secret: string, ip: string | undefined, now = new Date()): Promise<string | null> {
  if (!ip) return null;
  const day = now.toISOString().slice(0, 10);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${day}:${secret}:${ip}`));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const MAX_CONTACT_LINK = 500;

/**
 * An optional link: '' when absent, the normalised URL when it is an http(s)
 * URL of at most MAX_CONTACT_LINK characters, null when it is anything else.
 */
export function contactLink(input: unknown): string | null {
  if (input == null) return '';
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return '';
  if (raw.length > MAX_CONTACT_LINK) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  // `href` percent-encodes spaces and the like, so the stored link is one
  // unbroken token.
  return url.href.length > MAX_CONTACT_LINK ? null : url.href;
}

contact.post('/contact', async (c) => {
  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json<Record<string, unknown>>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  // Honeypot — bots fill every input. Pretend success so they don't retry.
  const hp = sanitize(body.hp, 100);
  if (hp) return c.json({ ok: true });

  const name = sanitize(body.name, 120);
  const email = sanitize(body.email, 254);
  const message = sanitize(body.message, 5000);
  const kind = sanitize(body.kind, 20) || 'contact';
  const company = sanitize(body.company, 200);

  // D680 — the enquiry kind, from a closed set.
  const intent = sanitize(body.intent, 20);
  if (intent && !Object.prototype.hasOwnProperty.call(CONTACT_INTENTS, intent)) {
    return c.json({ error: 'invalid_intent', code: 'invalid_intent', message: 'Pick one of the enquiry types on the form.' }, 400);
  }
  const intentLabel = intent ? CONTACT_INTENTS[intent] : '';

  // D680 — an optional link, which must be an http(s) URL.
  const link = contactLink(body.link);
  if (link === null) {
    return c.json({
      error: 'invalid_link',
      code: 'invalid_link',
      message: `The link must start with http:// or https:// and be at most ${MAX_CONTACT_LINK} characters.`,
    }, 400);
  }

  // A form that names its intent need not type a subject; the subject is then
  // the intent and who is asking.
  const subject = sanitize(body.subject, 200)
    || (intentLabel && name ? `${intentLabel} — ${company || name}`.slice(0, 200) : '');

  if (!name || !email || !subject || !message) {
    return c.json({ error: 'missing_fields' }, 400);
  }
  if (!isLikelyEmail(email)) {
    return c.json({ error: 'invalid_email' }, 400);
  }
  if (message.length < 10) {
    return c.json({ error: 'message_too_short' }, 400);
  }

  // Bot protection — Cloudflare Turnstile. Fails CLOSED in production when the
  // secret is unset, fails OPEN in dev/preview (see services/turnstile.ts).
  const turnstileToken = sanitize(body.turnstileToken, 4096);
  const clientIp = c.req.header('CF-Connecting-IP') || undefined;
  const turnstileOk = await verifyTurnstile(c.env, turnstileToken, clientIp);
  if (!turnstileOk) {
    return c.json({ error: 'turnstile_failed', code: 'turnstile_failed' }, 403);
  }

  const storedKind = kind === 'support' ? 'support' : 'contact';
  const uid = crypto.randomUUID();
  const ipHash = await contactIpHash(c.env.JWT_SECRET || '', clientIp);
  const ua = (c.req.header('User-Agent') || '').slice(0, 200) || null;

  // Stored first, so a mail outage never loses an enquiry.
  try {
    await c.env.DB.prepare(
      `INSERT INTO contact_submissions
         (uid, kind, intent, name, email, company, link, subject, message, ip_hash, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid, storedKind, intent || null, name, email, company || null, link || null, subject, message, ipHash, ua).run();
  } catch (err) {
    console.error('contact: could not store the submission', (err as Error)?.message || 'unknown');
    return c.json({ error: 'store_failed', code: 'store_failed', message: 'We could not take your message just now. Please try again.' }, 500);
  }

  // Then the firm's own mailbox for the intent. Personal data is fine there.
  const to = contactMailbox(intent, storedKind);
  const lines = [
    'A new enquiry from the axal.vc contact form.',
    '',
    `Intent: ${intentLabel || 'none given'}`,
    `Kind: ${storedKind}`,
    `From: ${name} <${email}>`,
    ...(company ? [`Company or project: ${company}`] : []),
    ...(link ? [`Link: ${link}`] : []),
    `Subject: ${subject}`,
    '',
    message,
    '',
    `Reference: ${uid} (contact_submissions)`,
  ];
  const text = lines.join('\n');
  const html = `<div style="font-family:sans-serif;font-size:14px;color:#111;line-height:1.5">${lines.map((l) => escapeHtml(l)).join('<br>')}</div>`;
  let sent = false;
  try {
    sent = await sendNotificationEmail(c.env, to, `[Contact] ${subject}`, text, { html });
  } catch {
    sent = false;
  }
  if (sent) {
    try {
      await c.env.DB.prepare(
        `UPDATE contact_submissions SET notified_at = datetime('now'), updated_at = datetime('now') WHERE uid = ?`,
      ).bind(uid).run();
    } catch { /* the row and the email both exist; the stamp is bookkeeping */ }
  } else {
    // No personal data in the log: the reference and the intent only.
    console.warn(`contact: submission ${uid} stored but not emailed (intent ${intent || 'none'}); read it from contact_submissions`);
  }

  return c.json({ ok: true, reference: uid });
});

export default contact;
