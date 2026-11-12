/** D5618: verify the raw bounded body before enqueueing a minimal delivery (no commit/user data). */
import { timingSafeEqual, createHmac, createHash } from 'node:crypto';
import type { Delivery, Env } from './types.ts';
export function verifySignature(body: Uint8Array, signature: string | null, secret: string): boolean {
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}
export function ownerAuthorized(request: Request, token?: string): boolean {
  if (!token) return false;
  const actual = request.headers.get('authorization') ?? '';
  return timingSafeEqual(createHash('sha256').update(actual).digest(), createHash('sha256').update(`Bearer ${token}`).digest());
}
export async function limitedBody(request: Request, max = 128 * 1024): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > max) { await reader.cancel(); throw new Error('body too large'); }
    chunks.push(value);
  }
  const result = new Uint8Array(length); let offset = 0;
  for (const value of chunks) { result.set(value, offset); offset += value.byteLength; }
  return result;
}
export async function webhook(request: Request, env: Env): Promise<Response> {
  if (!env.WEBHOOK_SECRET) return Response.json({ error: 'not configured' }, { status: 503 });
  const signature = request.headers.get('x-hub-signature-256');
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return new Response('unauthorized', { status: 401 });
  let raw: Uint8Array;
  try { raw = await limitedBody(request); } catch { return new Response('too large', { status: 413 }); }
  if (!verifySignature(raw, signature, env.WEBHOOK_SECRET)) return new Response('unauthorized', { status: 401 });
  const delivery = request.headers.get('x-github-delivery') ?? '';
  const event = request.headers.get('x-github-event') ?? '';
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(delivery) || !/^[a-z_]{1,80}$/.test(event)) return new Response('invalid headers', { status: 400 });
  let payload: { repository?: { full_name?: string }; action?: string; reason?: string; merge_group?: { head_sha?: string; head_ref?: string } };
  try { payload = JSON.parse(new TextDecoder().decode(raw)); } catch { return new Response('invalid JSON', { status: 400 }); }
  if (!payload || (payload.repository?.full_name !== env.REPOSITORY && !(event === 'ping' && !payload.repository))) return new Response('repository refused', { status: 403 });
  const group = payload.merge_group;
  if (event === 'merge_group' && (!['checks_requested','destroyed'].includes(payload.action ?? '') || !/^[a-f0-9]{40}$/.test(group?.head_sha ?? '')
    || !/^refs\/heads\/gh-readonly-queue\/main\/[A-Za-z0-9_./-]+$/.test(group?.head_ref ?? '')
    || (payload.action === 'destroyed' && !['dequeued','invalidated','merged'].includes(payload.reason ?? '')))) return new Response('invalid merge group', { status: 400 });
  const message: Delivery = { delivery, repo: env.REPOSITORY, event, action: payload.action ?? '', reason: payload.reason ?? null,
    headSha: group?.head_sha ?? null, headRef: group?.head_ref ?? null, at: Date.now() };
  await env.EVENTS.send(message);
  return Response.json({ accepted: true });
}
