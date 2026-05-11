/**
 * Task #30 — Public (no-auth) endpoints for the Market-Intel watchlist
 * digest. Currently exposes a single GET /unsubscribe?u=<id>&t=<sig>
 * that verifies an HMAC token tied to the user id and removes ALL of
 * that user's watchlist rows.
 *
 * Mounted at /api/market-intel-public so it sits OUTSIDE the auth wall
 * applied to /api/market-intel — links in the digest email must work
 * without an active session.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { ensureMarketIntelSchema } from '../services/market_intel/schema';
import { verifyUnsubscribeToken } from '../services/market_intel/digest';

const marketIntelPublic = new Hono<{ Bindings: Env }>();

marketIntelPublic.get('/unsubscribe', async (c) => {
  const userIdRaw = c.req.query('u') || '';
  const token = c.req.query('t') || '';
  const userId = parseInt(userIdRaw, 10);
  if (!Number.isFinite(userId) || userId <= 0 || !token) {
    return c.html(unsubscribePage('Invalid unsubscribe link.'), 400);
  }
  const ok = await verifyUnsubscribeToken(c.env, userId, token);
  if (!ok) return c.html(unsubscribePage('Invalid unsubscribe link.'), 400);
  await ensureMarketIntelSchema(c.env);
  try {
    await c.env.DB.prepare(
      `DELETE FROM market_intel_watchlist WHERE user_id = ?`,
    ).bind(userId).run();
  } catch (e) {
    console.warn('[mi unsubscribe] delete failed', e);
    return c.html(unsubscribePage('Could not process your request — please try again later.'), 500);
  }
  return c.html(unsubscribePage("You've been unsubscribed from sector watchlist digests. Re-pin sectors any time from /market-intelligence."));
});

function unsubscribePage(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Axal — Unsubscribed</title>
<style>body{font-family:'Space Grotesk',system-ui,sans-serif;max-width:540px;margin:80px auto;padding:0 24px;color:#111}</style>
</head><body><h1 style="font-weight:600">Axal StudioOS</h1>
<p>${message.replace(/</g, '&lt;')}</p></body></html>`;
}

export default marketIntelPublic;
