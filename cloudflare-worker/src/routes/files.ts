/**
 * Task #33 — One-time signed R2 download endpoint.
 *
 * Mounted at `/api/files`. The only public route is `GET /dl/:token` which
 * verifies a token minted via services/signedDownload.ts and streams the
 * R2 object through the worker. The bucket itself is private — there is
 * no other publicly-reachable path to the bytes.
 *
 * Why route-level instead of inlining into each domain (esign / kyc / …)?
 *   - One audit trail format, one place to evolve TTL / consume semantics.
 *   - Lets future routes (DD data room in #35, exports in others) use the
 *     same primitive without re-implementing token verification.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { verifyAndConsumeToken } from '../services/signedDownload';

const files = new Hono<{ Bindings: Env }>();

files.get('/dl/:token', async (c) => {
  if (!c.env.FILES) return c.json({ error: 'storage_not_configured' }, 503);
  const token = c.req.param('token');
  if (!token) return c.json({ error: 'token_required' }, 400);

  const verified = await verifyAndConsumeToken(c.env, token);
  if ('error' in verified) {
    // Generic 403 — never tell the caller WHICH check failed.
    return c.json({ error: 'forbidden' }, 403);
  }

  const obj = await c.env.FILES.get(verified.key);
  if (!obj) return c.json({ error: 'not_found' }, 404);

  // Audit the download. user_id is the issuing admin/user; if absent, fall
  // back to the audience tag so the row still attributes the action.
  try {
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`
    ).bind(
      'signed_download',
      JSON.stringify({ key: verified.key, audience: verified.audience, jti: verified.jti }),
      `aud:${verified.audience}`,
      verified.userId ?? null,
    ).run();
  } catch (e) {
    console.error('[files] audit log insert failed', e);
  }

  // Filename: take the basename of the R2 key. Callers should encode the
  // human filename into the key when they need a specific download name.
  const slash = verified.key.lastIndexOf('/');
  const filename = slash >= 0 ? verified.key.slice(slash + 1) : verified.key;
  const contentType = obj.httpMetadata?.contentType || 'application/octet-stream';
  return new Response(obj.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
      'Cache-Control': 'private, max-age=0, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
});

export default files;
