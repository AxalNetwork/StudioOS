/**
 * The client address, for logs and for evidence fields.
 *
 * CF-Connecting-IP comes first. Cloudflare appends to an incoming
 * X-Forwarded-For rather than replacing it, so that header's first hop is
 * whatever the client sent. `middleware/rateLimit.ts` uses this same
 * precedence and stays inline — it is the hot path, and this file is the
 * one definition every other reader shares.
 */
const MAX_LEN = 64;

export function clientIp(req: Request): string {
  const cf = (req.headers.get('cf-connecting-ip') || '').trim();
  if (cf) return cf.slice(0, MAX_LEN);
  const hop = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  if (hop) return hop.slice(0, MAX_LEN);
  return 'unknown';
}
