/** App-wide TikTok deauthorization callback (#5291). */
import { Hono } from 'hono';
import type { Env } from '../types';
import { loadOauthCreds } from '../services/providerOauthKeys';

const router = new Hono<{ Bindings: Env }>();

export async function verifyTikTokSignature(secret: string, header: string, body: string, now = Date.now()): Promise<boolean> {
  const fields = new URLSearchParams(header.replaceAll(',', '&'));
  const timestamp = fields.get('t');
  const signature = fields.get('s');
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || !signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  if (fields.getAll('t').length !== 1 || fields.getAll('s').length !== 1) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const encode = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encode.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = Uint8Array.from(signature.match(/../g)!, pair => Number.parseInt(pair, 16));
  return crypto.subtle.verify('HMAC', key, bytes, encode.encode(`${timestamp}.${body}`));
}

router.post('/', async c => {
  const app = await loadOauthCreds(c.env, 'tiktok');
  if (!app) return c.json({ error: 'tiktok_unavailable' }, 503);
  const body = await c.req.text();
  if (!await verifyTikTokSignature(app.secret, c.req.header('TikTok-Signature') ?? '', body)) {
    return c.json({ error: 'invalid_signature' }, 401);
  }
  let event: Record<string, unknown>;
  try { event = JSON.parse(body); } catch { return c.json({ error: 'invalid_event' }, 400); }
  if (!event || event.client_key !== app.id) return c.json({ error: 'invalid_event' }, 400);
  if (event.event !== 'authorization.removed') return c.json({ ok: true });
  if (typeof event.user_openid !== 'string' || !event.user_openid ||
      typeof event.create_time !== 'number' || !Number.isSafeInteger(event.create_time)) {
    return c.json({ error: 'invalid_event' }, 400);
  }
  const cutoff = event.create_time;
  // The same three conditions in both statements, written out: no interpolation in the query text.
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM integration_companies WHERE integration_id IN (SELECT id FROM integrations
                       WHERE provider_key = 'tiktok' AND external_account_id = ? AND unixepoch(updated_at) <= ?)`)
      .bind(event.user_openid, cutoff),
    c.env.DB.prepare(`DELETE FROM integrations
                       WHERE provider_key = 'tiktok' AND external_account_id = ? AND unixepoch(updated_at) <= ?`)
      .bind(event.user_openid, cutoff),
  ]);
  return c.json({ ok: true });
});

export const mount = { path: '/api/tiktok/webhook', router: router };
