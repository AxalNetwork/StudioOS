/**
 * Public contact form → GitHub Issues.
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
 *   - turnstileToken is verified via verifyTurnstile() before any issue is
 *     created — 403 {code:'turnstile_failed'} on failure (fail-closed in prod,
 *     fail-open in dev when TURNSTILE_SECRET_KEY is unset)
 *   - Creates a GitHub Issue in GITHUB_REPO_OWNER/GITHUB_REPO_NAME
 *   - Returns 503 {code:'github_token_missing'} when the secret is unset
 *
 * Token: GITHUB_ISSUES_TOKEN (Worker secret, scope: `repo` or fine-grained
 * `issues:write` on the StudioOS repo).
 *
 * WHERE A SUBMISSION GOES (D680). `wrangler.toml` sets GITHUB_REPO_OWNER and
 * GITHUB_REPO_NAME to AxalNetwork/StudioOS in both [vars] and
 * [env.production.vars], and that repository is public. So the issue this
 * route files — name, email, message, company, link, IP and user agent — is
 * readable by anyone. That is why /contact does not print the canvas's
 * "Everything you send is confidential" line.
 *
 * Abuse: the global `ip` bucket in middleware/rateLimit.ts caps every IP at
 * 200/min across /api/*. There is no dedicated `contact` bucket (an earlier
 * version of this comment said there was a 3/hour one; rateLimit.ts has never
 * declared it).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { verifyTurnstile } from '../services/turnstile';

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
  // `href` percent-encodes spaces and the like, so the link cannot break out
  // of its line in the issue's markdown.
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

  // A form that names its intent need not type a subject; the issue title is
  // then the intent and who is asking.
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

  const token = c.env.GITHUB_ISSUES_TOKEN;
  const owner = c.env.GITHUB_REPO_OWNER;
  const repo = c.env.GITHUB_REPO_NAME;
  if (!token || !owner || !repo) {
    return c.json({ error: 'github_token_missing', code: 'github_token_missing' }, 503);
  }

  const labelKind = kind === 'support' ? 'support' : 'contact-form';
  const issueTitle = `[${labelKind}] ${subject}`;
  const ip = c.req.header('CF-Connecting-IP') || 'unknown';
  const ua = (c.req.header('User-Agent') || 'unknown').slice(0, 200);
  const issueBody = [
    `**From:** ${name} <${email}>`,
    `**Kind:** ${labelKind}`,
    ...(intentLabel ? [`**Intent:** ${intentLabel}`] : []),
    ...(company ? [`**Company or project:** ${company}`] : []),
    ...(link ? [`**Link:** ${link}`] : []),
    '',
    '---',
    '',
    message,
    '',
    '---',
    `_Submitted via axal.vc contact form · IP ${ip} · UA ${ua}_`,
  ].join('\n');

  try {
    const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'axal-studioos-contact-form',
      },
      body: JSON.stringify({
        title: issueTitle,
        body: issueBody,
        labels: [labelKind],
      }),
    });
    if (!ghRes.ok) {
      const text = await ghRes.text().catch(() => '');
      console.error('contact: github issue create failed', ghRes.status, text.slice(0, 500));
      return c.json({ error: 'github_create_failed', status: ghRes.status }, 502);
    }
    const json = (await ghRes.json().catch(() => ({}))) as { number?: number; html_url?: string };
    return c.json({ ok: true, issue_number: json.number ?? null, issue_url: json.html_url ?? null });
  } catch (err) {
    console.error('contact: github request error', err);
    return c.json({ error: 'github_request_failed' }, 502);
  }
});

export default contact;
