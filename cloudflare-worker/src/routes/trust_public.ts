/**
 * D1075 (#2967, part 3 of #2425) — the public trust center's reads and the
 * subprocessor notices, mounted at /api/public. No sign-in.
 *
 *   GET  /trust            the published blocks, the subprocessors, the
 *                          latest changes. Each part is read on its own: one
 *                          that cannot be read is `{ unreadable: true }` and
 *                          the others still answer (one failed block never
 *                          blanks the page). A block never published is
 *                          `null`, and the page keeps its "Not recorded" line.
 *   GET  /trust/changes?limit=   the change log, newest first (at most 200)
 *   GET  /trust/matrix     "What we check, and for whom", from the obligations
 *                          the Worker seeds, every profile including Explorer
 *
 *   POST /trust/subprocessors/subscribe { email, turnstileToken, hp }
 *        Turnstile, then a pending row and the confirm email. The answer is
 *        the same for every address.
 *   GET  /trust/subprocessors/confirm?token=      changes nothing: a page with
 *                                                 one button (mail scanners
 *                                                 open every link, D810)
 *   POST /trust/subprocessors/confirm?token=      confirms, once
 *   GET  /trust/subprocessors/unsubscribe?token=  changes nothing: a page
 *   POST /trust/subprocessors/unsubscribe?token=  unsubscribes, once; also the
 *                                                 RFC 8058 one-click target
 *
 * Rate limits (middleware/rateLimit.ts): the reads share `public_trust` (per
 * IP, fail-open); subscribe and confirm share `trust_subscribe` (per IP,
 * fail-closed). Unsubscribe is outside both, as the newsletter's is: a
 * capped unsubscribe is an unsubscribe lost, and its signed token cannot be
 * guessed. Confirm and unsubscribe are CSRF-exempt (their token authorises).
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { mapError } from './_t13t14t15_helpers';
import { verifyTurnstile } from '../services/turnstile';
import { escapeHtml } from '../services/email';
import { BLOCK_KEYS, blocksIn, changes, publicBody, publicMatrix, publicSubprocessors } from '../services/trustContent';
import { SUBSCRIBE_ANSWER, canStoreAddresses, confirm, confirmRow, subscribe, unsubscribe } from '../services/subprocessorNotices';

const r = new Hono<{ Bindings: Env }>();

const UNREADABLE = { unreadable: true, message: 'This part could not be read just now. Try again.' } as const;
const LATEST_CHANGES = 10;

/** One part of the read, or `UNREADABLE` when its store cannot be read. Counts only in the log. */
async function part<T>(name: string, read: () => Promise<T>): Promise<T | typeof UNREADABLE> {
  try { return await read(); } catch { console.warn('[trust-public] part unreadable', name); return UNREADABLE; }
}

r.get('/trust', async (c) => {
  const [blocks, subprocessors, latest] = await Promise.all([
    part('blocks', async () => {
      const published = await blocksIn(c.env, 'published');
      const out: Record<string, unknown> = {};
      for (const k of BLOCK_KEYS) {
        const b = published[k];
        out[k] = b ? { key: k, label: b.label, body: publicBody(k, b.body), checked_at: b.checked_at, published_at: b.published_at } : null;
      }
      return out;
    }),
    part('subprocessors', () => publicSubprocessors(c.env)),
    part('changes', () => changes(c.env, LATEST_CHANGES)),
  ]);
  c.header('Cache-Control', 'public, max-age=60');
  return c.json({ blocks, subprocessors, changes: latest, read_at: new Date().toISOString() });
});

r.get('/trust/changes', async (c) => {
  try {
    const limit = Number(c.req.query('limit') || 50);
    c.header('Cache-Control', 'public, max-age=60');
    return c.json(await changes(c.env, Number.isFinite(limit) ? limit : 50));
  } catch (e) { return mapError(c, e); }
});

r.get('/trust/matrix', (c) => {
  c.header('Cache-Control', 'public, max-age=300');
  return c.json(publicMatrix());
});

// ---------------------------------------------------------------- subprocessor notices

function wantsHtml(c: Context<{ Bindings: Env }>): boolean {
  const accept = c.req.header('Accept') || '';
  return accept.includes('text/html') && !accept.includes('application/json');
}

function page(c: Context<{ Bindings: Env }>, status: number, title: string, body: string) {
  return c.html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} · Axal VC</title></head>`
    + `<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:64px auto;padding:0 16px;color:#111827;line-height:1.6">`
    + `<h1 style="font-size:20px">${escapeHtml(title)}</h1>${body}</body></html>`,
    status as any,
  );
}

const button = (action: string, label: string) =>
  `<form method="post" action="${escapeHtml(action)}"><button type="submit" style="font:inherit;padding:10px 18px;border-radius:8px;border:1px solid #111827;background:#111827;color:#fff;cursor:pointer">${escapeHtml(label)}</button></form>`;

const TOKEN_LINES = {
  token_invalid: 'This link has already been used or is not valid.',
  token_expired: 'This link has expired. Subscribe again to get a new one.',
} as const;

function refused(c: Context<{ Bindings: Env }>, code: keyof typeof TOKEN_LINES) {
  const message = TOKEN_LINES[code];
  return wantsHtml(c) ? page(c, 410, 'Link not valid', `<p>${escapeHtml(message)}</p>`) : c.json({ error: code, code, message }, 410);
}

async function unconfigured(c: Context<{ Bindings: Env }>) {
  if (await canStoreAddresses(c.env)) return null;
  return c.json({ error: 'subscriptions_unconfigured', code: 'subscriptions_unconfigured', message: 'Subscriptions are not open yet.' }, 503);
}

r.post('/trust/subprocessors/subscribe', async (c) => {
  try {
    const off = await unconfigured(c);
    if (off) return off;
    let body: Record<string, unknown> = {};
    try { body = await c.req.json<Record<string, unknown>>(); } catch { return c.json({ error: 'invalid_json' }, 400); }
    // Honeypot: the same answer, nothing done.
    if (typeof body.hp === 'string' && body.hp.trim()) return c.json(SUBSCRIBE_ANSWER);
    const token = typeof body.turnstileToken === 'string' ? body.turnstileToken.slice(0, 4096) : '';
    if (!(await verifyTurnstile(c.env, token, c.req.header('CF-Connecting-IP') || undefined))) {
      return c.json({ error: 'turnstile_failed', code: 'turnstile_failed' }, 403);
    }
    if (!(await subscribe(c.env, body.email))) {
      return c.json({ error: 'invalid_email', code: 'invalid_email', message: 'Enter a valid email address.' }, 400);
    }
    return c.json(SUBSCRIBE_ANSWER);
  } catch (e) { return mapError(c, e); }
});

r.get('/trust/subprocessors/confirm', async (c) => {
  try {
    const off = await unconfigured(c);
    if (off) return off;
    const token = c.req.query('token') || '';
    const row = await confirmRow(c.env, token);
    if (typeof row === 'string') return refused(c, row);
    if (!wantsHtml(c)) return c.json({ ok: true, status: 'pending' });
    return page(c, 200, 'Confirm your subscription', '<p>Press the button to get an email before Axal VC adds a subprocessor.</p>'
      + button(`/api/public/trust/subprocessors/confirm?token=${encodeURIComponent(token)}`, 'Confirm subscription'));
  } catch (e) { return mapError(c, e); }
});

r.post('/trust/subprocessors/confirm', async (c) => {
  try {
    const off = await unconfigured(c);
    if (off) return off;
    const out = await confirm(c.env, c.req.query('token') || '');
    if (out !== true) return refused(c, out);
    return wantsHtml(c)
      ? page(c, 200, 'Subscription confirmed', '<p>Thank you. We will email you before a new subprocessor starts.</p>')
      : c.json({ ok: true, status: 'confirmed' });
  } catch (e) { return mapError(c, e); }
});

r.get('/trust/subprocessors/unsubscribe', async (c) => {
  const token = c.req.query('token') || '';
  if (!wantsHtml(c)) return c.json({ ok: true, status: 'pending' });
  return page(c, 200, 'Unsubscribe', '<p>Press the button to stop subprocessor emails from Axal VC.</p>'
    + button(`/api/public/trust/subprocessors/unsubscribe?token=${encodeURIComponent(token)}`, 'Unsubscribe'));
});

r.post('/trust/subprocessors/unsubscribe', async (c) => {
  try {
    const off = await unconfigured(c);
    if (off) return off;
    const out = await unsubscribe(c.env, c.req.query('token'));
    if (out !== true) return refused(c, out);
    return wantsHtml(c)
      ? page(c, 200, 'Unsubscribed', '<p>You will get no more subprocessor emails from Axal VC.</p>')
      : c.json({ ok: true, status: 'unsubscribed' });
  } catch (e) { return mapError(c, e); }
});

export default r;
