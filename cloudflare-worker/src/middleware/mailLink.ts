/** D811: a service credential, independent of browser sessions and admin roles. */
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types';
import { constantTimeEqual } from '../rpc/secret';
import { withDeadline } from '../util/deadline';

export type MailLinkEnv = { Bindings: Env; Variables: { mailLinkBody: string; currentUser: null } };
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');

export async function mailLinkSignature(secret: string, method: string, path: string, timestamp: string, body: string): Promise<string> {
  const digest = hex(await crypto.subtle.digest('SHA-256', encoder.encode(body)));
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${method}\n${path}\n${timestamp}\n${digest}`)));
}

/** Fail closed, including KV errors/stalls. D1's unique claim closes KV's read/write race. */
export const mailLinkAuth = (): MiddlewareHandler<MailLinkEnv> => async (c, next) => {
  const secret = c.env.MAIL_LINK_SECRET;
  if (!secret) return c.notFound();
  const timestamp = c.req.header('X-Axal-Link-Timestamp') || '';
  const signature = c.req.header('X-Axal-Link-Signature') || '';
  const now = Math.floor(Date.now() / 1000);
  if (!/^\d{10}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 300 || !/^[a-f0-9]{64}$/.test(signature)) {
    return c.json({ error: 'mail_link_unauthorized', detail: 'A current signed request is required.' }, 401);
  }
  // Read at most 256 KiB: enough for 500 events without an unbounded allocation.
  const reader = c.req.raw.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 262144) {
        await reader.cancel();
        return c.json({ error: 'mail_link_body_too_large', detail: 'At most 256 KiB per request.' }, 413);
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body: string;
  try { body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return c.json({ error: 'mail_link_invalid_body', detail: 'UTF-8 is required.' }, 400); }
  const url = new URL(c.req.url);
  // The path includes the exact query string, binding cursors and filters too.
  const expected = await mailLinkSignature(secret, c.req.method, url.pathname + url.search, timestamp, body);
  if (!constantTimeEqual(signature, expected)) return c.json({ error: 'mail_link_unauthorized', detail: 'Invalid request signature.' }, 401);
  const nonce = `mail-link:nonce:${signature}`;
  try {
    if (await withDeadline(c.env.RATE_LIMITS.get(nonce), 2000, 'mail-link-nonce')) {
      return c.json({ error: 'mail_link_replay', detail: 'Sign this request again with a new timestamp.' }, 409);
    }
    // Retain the expiry second: the five-minute timestamp boundary is inclusive.
    await c.env.DB.prepare('DELETE FROM mail_link_nonces WHERE expires_at < ?').bind(now).run();
    const claim = await c.env.DB.prepare('INSERT OR IGNORE INTO mail_link_nonces (signature, expires_at) VALUES (?, ?)').bind(signature, now + 600).run();
    if (!claim.meta.changes) return c.json({ error: 'mail_link_replay', detail: 'Sign this request again with a new timestamp.' }, 409);
    await withDeadline(c.env.RATE_LIMITS.put(nonce, '1', { expirationTtl: 600 }), 2000, 'mail-link-nonce');
  } catch {
    return c.json({ error: 'mail_link_unavailable', detail: 'Replay protection is unreadable; retry with a new signature.' }, 503);
  }
  c.set('mailLinkBody', body);
  await next();
};
