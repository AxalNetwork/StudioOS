/**
 * Public contact form → GitHub Issues.
 *
 * POST /api/contact   { name, email, subject, message, kind?, hp?, turnstileToken? }
 *   - kind ∈ {'contact','support'} (default 'contact')
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
 * Abuse: the global ip bucket in middleware/rateLimit.ts caps every IP at
 * 200/min across /api/*; plus a dedicated `contact` bucket caps 3/hour/IP.
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
  const subject = sanitize(body.subject, 200);
  const message = sanitize(body.message, 5000);
  const kind = sanitize(body.kind, 20) || 'contact';

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
