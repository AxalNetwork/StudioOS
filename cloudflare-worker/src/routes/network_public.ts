/**
 * Task #1 — Public photo proxy for network_profiles.
 *
 * Mounted at /api/public so it bypasses the /api/admin/* CF-Access
 * perimeter. Only serves active profiles. The FILES R2 bucket stays
 * private — bytes flow through the Worker.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { ensureNetworkProfilesSchema } from '../services/networkProfilesSchema';

const r = new Hono<{ Bindings: Env }>();

r.get('/network/:id/photo', async (c) => {
  await ensureNetworkProfilesSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.notFound();
  const row = await c.env.DB.prepare(
    `SELECT photo_r2_key FROM network_profiles WHERE id = ? AND is_active = 1`,
  ).bind(id).first<{ photo_r2_key: string | null }>();
  if (!row || !row.photo_r2_key) return c.notFound();
  if (!c.env.FILES) return c.notFound();
  if (!row.photo_r2_key.startsWith('network/')) return c.notFound();
  const obj = await c.env.FILES.get(row.photo_r2_key);
  if (!obj) return c.notFound();
  const contentType = obj.httpMetadata?.contentType || 'application/octet-stream';
  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // Short TTL so toggling is_active=0 propagates quickly (admins
      // expect deactivation to hide the photo within a minute or two).
      'Cache-Control': 'public, max-age=60, s-maxage=60',
    },
  });
});

export default r;
