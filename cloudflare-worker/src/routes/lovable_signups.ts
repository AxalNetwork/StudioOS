/**
 * D1312 (#3432, Lovable part 4 of #2398) — the public sign-up address a
 * landing-page experiment's Lovable app posts its form to:
 *
 *   POST /api/validate/lovable-signups/:token     form-encoded (or JSON) { email, company_website? }
 *
 * Public and unauthenticated: the token in the address is the authorisation.
 * It is not under the CORS allowlist, and adds no CORS header: a plain HTML
 * form post needs none, and a script on another origin cannot read the answer.
 * The `lovable_signup` bucket (middleware/rateLimit.ts) holds it to 6 a minute
 * per IP, failing closed. The honeypot and a repeat answer as success; an
 * unknown or turned-off address is 404. A browser's form post gets a short
 * thank-you page; a fetch gets JSON.
 *
 * Only the count is kept (services/lovable/signups.ts): never a name or an
 * email. Nothing here logs the token or the email.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { acceptSignup, readFields } from '../services/lovable/signups';

const app = new Hono<{ Bindings: Env }>();

const THANKS = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Thank you</title></head>'
  + '<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#18181b"><h1 style="font-size:1.4rem">Thank you</h1><p>You are on the list.</p></body></html>';

app.post('/:token', async (c) => {
  const fields = await readFields(c.req.raw);
  const ip = c.req.header('CF-Connecting-IP') || null;
  const outcome = await acceptSignup(c.env, c.req.param('token'), fields, ip);
  const json = (c.req.header('accept') || '').includes('application/json') || (c.req.header('content-type') || '').includes('application/json');
  if (outcome === 'not_found') return json ? c.json({ code: 'not_found', detail: 'This sign-up address is not in use.' }, 404) : c.text('This sign-up address is not in use.', 404);
  if (outcome === 'invalid_email') return json ? c.json({ code: 'invalid_email', detail: 'Enter an email address.' }, 400) : c.text('Enter an email address.', 400);
  return json ? c.json({ ok: true }) : c.html(THANKS);
});

export default app;
