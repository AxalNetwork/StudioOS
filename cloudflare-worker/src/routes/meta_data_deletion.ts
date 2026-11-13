/** D5292: authenticated-by-signature Meta deletion callback and completion receipt. */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../types';
import { constantTimeEqual } from '../rpc/secret';
import { metaApp } from '../services/meta/app';

const routes = new Hono<{ Bindings: Env }>();
const encoder = new TextEncoder();
const hex = (value: ArrayBuffer) => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function sign(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, encoder.encode(value));
}

export async function verifiedMetaUser(secret: string, value: string): Promise<string | null> {
  const parts = /^([\w-]{43})\.([\w-]{1,4096})$/.exec(value);
  if (!secret.trim() || !parts) return null;
  try {
    if (!constantTimeEqual(hex(decode(parts[1]).buffer), hex(await sign(secret, parts[2])))) return null;
    const data = JSON.parse(new TextDecoder().decode(decode(parts[2])));
    const age = Math.floor(Date.now() / 1000) - data.issued_at;
    return data.algorithm === 'HMAC-SHA256' && Number.isSafeInteger(data.issued_at) && age >= -300 && age <= 86400
      && typeof data.user_id === 'string' && /^\d{1,32}$/.test(data.user_id) ? data.user_id : null;
  } catch {
    return null;
  }
}

routes.post('/', bodyLimit({ maxSize: 8192 }), async c => {
  const { webhookSecret } = metaApp(c.env);
  const body = await c.req.formData().catch(() => null);
  const signed = body?.get('signed_request');
  const account = typeof signed === 'string' ? await verifiedMetaUser(webhookSecret, signed) : null;
  if (!account) return c.json({ error: 'invalid_signed_request' }, 400);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM integration_logs WHERE provider_key = 'facebook' AND integration_id IN (SELECT id FROM integrations WHERE provider_key = 'facebook' AND external_account_id = ?)").bind(account),
      c.env.DB.prepare("DELETE FROM integration_companies WHERE integration_id IN (SELECT id FROM integrations WHERE provider_key = 'facebook' AND external_account_id = ?)").bind(account),
      c.env.DB.prepare("DELETE FROM integrations WHERE provider_key = 'facebook' AND external_account_id = ?").bind(account),
    ]);
  } catch {
    return c.json({ error: 'facebook_deletion_failed' }, 503);
  }
  const nonce = crypto.randomUUID();
  const code = `${nonce}.${hex(await sign(webhookSecret, `facebook-deletion:${nonce}`))}`;
  return c.json({ url: `https://axal.vc/api/meta/data-deletion/${code}`, confirmation_code: code });
});

routes.get('/:code', async c => {
  const { webhookSecret } = metaApp(c.env);
  const match = /^([0-9a-f-]{36})\.([0-9a-f]{64})$/.exec(c.req.param('code'));
  c.header('Cache-Control', 'no-store');
  if (!webhookSecret.trim() || !match || !constantTimeEqual(match[2], hex(await sign(webhookSecret, `facebook-deletion:${match[1]}`)))) {
    return c.text('Confirmation not found.', 404);
  }
  return c.text('The Facebook connection data deletion request is complete.');
});

export default routes;
