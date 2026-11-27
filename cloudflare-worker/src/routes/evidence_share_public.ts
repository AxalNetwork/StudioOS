/**
 * D6864 (#6864, canvas D6054 RA-28, RA-36) — the public page of an evidence pack a founder shared outside Axal.
 *
 *   GET /api/share/evidence/:token  → 200 { state: 'ok', pack, link: { made_at, expires_at } }
 *                                    | 404 { state: 'not_found', error, message, title, sentence }
 *                                    | 410 { state: 'expired' | 'used_up' | 'revoked', error, message, title, sentence }
 *
 * No sign-in: the token is the capability (32 random bytes; only its SHA-256 is stored). Opening the link consumes
 * one of its views in one conditional UPDATE (services/raiseEvidenceShare.ts `openPackLink`). The pack is the copy
 * frozen when the founder made it, so it never changes after it left; a refusal names neither the venture nor any
 * evidence. Rate-limited per IP (`evidence_share_read`, middleware/rateLimit.ts). Never cached.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { openPackLink, REFUSALS } from '../services/raiseEvidenceShare';

const evidenceSharePublic = new Hono<{ Bindings: Env }>();

evidenceSharePublic.get('/:token', async (c) => {
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Robots-Tag', 'noindex');
  let result: Awaited<ReturnType<typeof openPackLink>>;
  try { result = await openPackLink(c.env, c.req.param('token')); }
  catch { return c.json({ state: 'unavailable', error: 'unavailable', message: 'This page could not be opened. Try again in a moment.', title: 'This page could not be opened', sentence: 'Try again in a moment.' }, 503); }
  if (!result.ok) {
    const r = REFUSALS[result.refusal];
    return c.json({ state: result.refusal, error: result.refusal, message: `${r.title}. ${r.sentence}`, title: r.title, sentence: r.sentence }, r.status);
  }
  return c.json({ state: 'ok', pack: result.pack, link: result.link });
});

export const mount: RouteMount = { path: '/api/share/evidence', router: evidenceSharePublic };
export default evidenceSharePublic;
