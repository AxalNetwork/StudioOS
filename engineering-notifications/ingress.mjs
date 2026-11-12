// D5664: signed raw-byte ingress; only normalized metadata enters the durable queue before acknowledgement.
import { DEFAULT_EVENTS, SECURITY_EVENTS, normalizeEvent } from './events-v1.mjs';
export async function boundedBody(request, max = 1_000_000) {
  if (Number(request.headers.get('content-length')) > max) throw new Error('payload_too_large');
  const reader = request.body?.getReader(), chunks = []; let length = 0;
  if (!reader) throw new Error('payload_missing');
  for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > max) { await reader.cancel(); throw new Error('payload_too_large'); } chunks.push(value); }
  const out = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; } return out;
}
export async function signed(bytes, signature, secret) {
  if (!secret || !/^sha256=[a-f0-9]{64}$/.test(signature || '')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sig = Uint8Array.from(signature.slice(7).match(/../g), hex => parseInt(hex, 16));
  return crypto.subtle.verify('HMAC', key, sig, bytes);
}
export async function receive(request, env) {
  const security = new URL(request.url).pathname === '/security';
  if (request.method !== 'POST' || !['/github', '/security'].includes(new URL(request.url).pathname)) return new Response('not found', { status: 404 });
  if (security !== (env.SECURITY_MODE === 'true')) return new Response('permission boundary rejected', { status: 403 });
  const bytes = await boundedBody(request);
  if (!await signed(bytes, request.headers.get('x-hub-signature-256'), security ? env.SECURITY_WEBHOOK_SECRET : env.WEBHOOK_SECRET)) return new Response('signature rejected', { status: 401 });
  const payload = JSON.parse(new TextDecoder().decode(bytes));
  const installation = security ? env.SECURITY_INSTALLATION_ID : env.INSTALLATION_ID;
  if (!installation || String(payload.installation?.id) !== installation || String(payload.repository?.id) !== env.REPOSITORY_ID || payload.repository?.full_name !== env.REPOSITORY) return new Response('source rejected', { status: 403 });
  const kind = request.headers.get('x-github-event'), allowed = JSON.parse(env.ALLOWED_EVENTS || JSON.stringify(DEFAULT_EVENTS.filter(k => !SECURITY_EVENTS.includes(k))));
  if (!allowed.includes(kind) || SECURITY_EVENTS.includes(kind) !== security) return new Response('event rejected', { status: 403 });
  const event = await normalizeEvent({ kind, deliveryId: request.headers.get('x-github-delivery'), payload, securityApproved: security });
  if (new TextEncoder().encode(JSON.stringify(event)).length > 100_000) throw new Error('normalized_payload_too_large');
  await env.EVENTS.send(event, { contentType: 'json' });
  return Response.json({ accepted: true, key: event.key }, { status: 202 });
}
