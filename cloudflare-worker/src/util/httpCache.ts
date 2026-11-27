/**
 * D5318 (#5318, H10) — `jsonWithEtag`: a JSON answer with a `Cache-Control`
 * policy and a strong ETag (SHA-256 of the exact body), which answers
 * `304 Not Modified` with no body when the request's `If-None-Match` names
 * that ETag. The route still builds its body to compare, so a 304 saves the
 * bytes and the parse, never the D1 reads; the policy is what keeps the
 * browser from asking at all inside its window.
 */
import type { Context } from 'hono';

async function etagOf(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(digest).slice(0, 16)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `"${hex}"`;
}

/** True when an `If-None-Match` header names `etag` (a list, `*`, or a weak `W/` form of it). */
export function etagMatches(ifNoneMatch: string | undefined | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(',').map((t) => t.trim()).some((t) => t === '*' || t === etag || t === `W/${etag}`);
}

export async function jsonWithEtag(c: Context<any>, payload: unknown, cacheControl: string): Promise<Response> {
  const body = JSON.stringify(payload);
  const etag = await etagOf(body);
  c.header('Cache-Control', cacheControl);
  c.header('ETag', etag);
  if (etagMatches(c.req.header('if-none-match'), etag)) return c.body(null, 304);
  c.header('Content-Type', 'application/json; charset=UTF-8');
  return c.body(body, 200);
}
