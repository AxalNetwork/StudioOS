/**
 * D6897 (#6897, canvas D6054 RA-30) — the public page of a readiness snapshot a founder shared outside Axal.
 *
 *   GET /api/share/readiness/:token  → 200 { state: 'ok', snapshot, link: { made_at, expires_at } }
 *                                     | 404 { state: 'not_found', error, message, title, sentence }
 *                                     | 410 { state: 'expired' | 'used_up' | 'revoked', error, message, title, sentence }
 *
 * The same link store and rules as the evidence pack (D6864): no sign-in, the token is the capability and only its
 * SHA-256 is stored, each open consumes one view in one conditional UPDATE, and the snapshot is the copy frozen when
 * the founder made it. A pack token never opens here and a snapshot token never opens the pack page
 * (`openPackLink(env, token, 'readiness')` filters on `output`). Rate-limited per IP with the evidence pack's bucket
 * (`EVIDENCE_SHARE_READ`, middleware/rateLimit.ts). Never cached.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { openPackLink, REFUSALS } from '../services/raiseEvidenceShare';

const readinessSharePublic = new Hono<{ Bindings: Env }>();

readinessSharePublic.get('/:token', async (c) => {
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Robots-Tag', 'noindex');
  let result: Awaited<ReturnType<typeof openPackLink>>;
  try { result = await openPackLink(c.env, c.req.param('token'), 'readiness'); }
  catch { return c.json({ state: 'unavailable', error: 'unavailable', message: 'This page could not be opened. Try again in a moment.', title: 'This page could not be opened', sentence: 'Try again in a moment.' }, 503); }
  if (!result.ok) {
    const r = REFUSALS[result.refusal];
    return c.json({ state: result.refusal, error: result.refusal, message: `${r.title}. ${r.sentence}`, title: r.title, sentence: r.sentence }, r.status);
  }
  return c.json({ state: 'ok', snapshot: result.pack, link: result.link });
});

export const mount: RouteMount = { path: '/api/share/readiness', router: readinessSharePublic };
export default readinessSharePublic;
