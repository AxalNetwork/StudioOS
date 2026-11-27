/**
 * D4666 (#4666) — the estimate a member approves is bound to the operation that runs.
 *
 * An operation is one `mail_draft` run: its fingerprint is a hash of everything the model will be given (the
 * task, the token ceiling and every message: the recipient, purpose, tone, length, the ticked sources, the
 * live blocks and, for a revision, the exact subject and body being revised and the instruction). A quote
 * is `{ member, fingerprint, hold, model, expiry }` signed by the Worker, so nothing about it is stored and
 * nothing in it can be edited by the client. The run is refused, before the router reserves anything, unless
 * the quote it brings is the member's own, unexpired, for this fingerprint and this model, and covers the
 * hold the router would reserve now.
 */
import type { Env } from '../../types';

export const QUOTE_TTL_SECONDS = 600;

export type Quote = { u: number; f: string; h: number; m: string; e: number };

const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) => {
  let s = '';
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmac(env: Env, data: string): Promise<ArrayBuffer> {
  const secret = String((env as any).JWT_SECRET ?? '');
  if (!secret) throw new Error('quote signing unavailable');
  const key = await crypto.subtle.importKey('raw', enc.encode(`mail-draft-quote:v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(data));
}

/** A hash of everything the model will see. A different prompt, ceiling or task is a different operation. */
export async function operationFingerprint(opts: { task: string; maxTokens?: number; messages?: Array<{ role: string; content: string }> }): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(JSON.stringify([opts.task, opts.maxTokens ?? null, opts.messages ?? []])));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signQuote(env: Env, q: { userId: number; fingerprint: string; hold: number; model: string }, now = Date.now()): Promise<{ quote: string; expires_at: string }> {
  const exp = Math.floor(now / 1000) + QUOTE_TTL_SECONDS;
  const payload = b64u(enc.encode(JSON.stringify({ u: q.userId, f: q.fingerprint, h: q.hold, m: q.model, e: exp } satisfies Quote)));
  return { quote: `q1.${payload}.${b64u(await hmac(env, payload))}`, expires_at: new Date(exp * 1000).toISOString() };
}

export type QuoteCheck = { ok: true; quote: Quote } | { ok: false; why: 'missing' | 'invalid' | 'expired' | 'other_member' | 'changed' | 'repriced' };

/** Whether `token` approves this member running this fingerprint on this model at no more than `hold` now. */
export async function checkQuote(env: Env, token: unknown, now: { userId: number; fingerprint: string; hold: number; model: string }, at = Date.now()): Promise<QuoteCheck> {
  if (typeof token !== 'string' || !token) return { ok: false, why: 'missing' };
  const [v, payload, sig] = token.split('.');
  if (v !== 'q1' || !payload || !sig || token.length > 2000) return { ok: false, why: 'invalid' };
  let q: Quote;
  try {
    const want = new Uint8Array(await hmac(env, payload));
    const got = unb64u(sig);
    if (want.length !== got.length || !want.every((b, i) => b === got[i])) return { ok: false, why: 'invalid' };
    q = JSON.parse(new TextDecoder().decode(unb64u(payload)));
  } catch { return { ok: false, why: 'invalid' }; }
  if (!Number.isFinite(q?.e) || q.e * 1000 < at) return { ok: false, why: 'expired' };
  if (q.u !== now.userId) return { ok: false, why: 'other_member' };
  if (q.f !== now.fingerprint || q.m !== now.model) return { ok: false, why: 'changed' };
  if (!Number.isFinite(q.h) || now.hold > q.h) return { ok: false, why: 'repriced' };
  return { ok: true, quote: q };
}
