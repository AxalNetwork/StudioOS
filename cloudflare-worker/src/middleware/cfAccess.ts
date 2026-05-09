/**
 * Task #33 — Cloudflare Access JWT verification middleware.
 *
 * When `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are both set, every
 * request to a protected route group MUST carry a valid `Cf-Access-Jwt-
 * Assertion` header (forwarded by the Access proxy after SSO). When either
 * env var is unset, the middleware is a no-op so dev/preview environments
 * without Access provisioning continue to work — the gate is bound to the
 * production deploy via wrangler secrets, not to source code.
 *
 * The JWT is signed by Cloudflare's per-team JWKS (`/cdn-cgi/access/certs`).
 * We fetch the JWKS once per isolate (cached in module scope), then verify
 * `aud`, `exp`, and `iss` claims. We deliberately do NOT use the `jose`
 * jwks-fetch helper here so we can keep the JWKS cache aligned with the
 * worker isolate lifecycle and avoid pulling in extra dependency surface.
 *
 * Apply selectively:
 *   app.use('/api/admin/*', requireCfAccess());
 *   app.use('/api/monitoring/*', requireCfAccess());
 *   app.use('/api/infra/*', requireCfAccess());
 *
 * Request-time RBAC (requireAdmin) still runs after this — Access is the
 * outer perimeter, not a replacement for in-app role checks.
 */
import type { Context, Next } from 'hono';
import { jwtVerify, importJWK, type JWK } from 'jose';
import type { Env } from '../types';

interface JwksCacheEntry {
  fetchedAt: number;
  keys: Record<string, CryptoKey>;
}

const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour
const jwksCache = new Map<string, JwksCacheEntry>();

async function loadJwks(teamDomain: string): Promise<Record<string, CryptoKey>> {
  const cached = jwksCache.get(teamDomain);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.keys;
  }
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const res = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } } as RequestInit);
  if (!res.ok) throw new Error(`CF Access JWKS fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys: JWK[] };
  const out: Record<string, CryptoKey> = {};
  for (const jwk of body.keys || []) {
    if (!jwk.kid) continue;
    try {
      out[jwk.kid] = (await importJWK(jwk, jwk.alg || 'RS256')) as CryptoKey;
    } catch (e) {
      console.warn('[cfAccess] failed to import JWK', jwk.kid, e);
    }
  }
  jwksCache.set(teamDomain, { fetchedAt: Date.now(), keys: out });
  return out;
}

export function requireCfAccess() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const teamDomain = c.env.CF_ACCESS_TEAM_DOMAIN;
    const aud = c.env.CF_ACCESS_AUD;
    // Soft no-op when not provisioned — keeps preview / replit dev unblocked.
    // Production wrangler secrets MUST set both for the gate to engage.
    if (!teamDomain || !aud) {
      return next();
    }
    const token = c.req.header('Cf-Access-Jwt-Assertion');
    if (!token) {
      return c.json({ error: 'cf_access_required' }, 403);
    }
    try {
      const issuer = `https://${teamDomain}`;
      const keys = await loadJwks(teamDomain);
      const { payload } = await jwtVerify(token, async (header) => {
        const kid = header.kid;
        if (!kid || !keys[kid]) throw new Error('unknown_kid');
        return keys[kid];
      }, { audience: aud, issuer });
      // Surface the Access identity for downstream logging without trusting
      // it for RBAC (in-app role check still runs).
      c.set('cfAccessEmail' as never, (payload.email as string) || '' as never);
      c.set('cfAccessSub' as never, (payload.sub as string) || '' as never);
    } catch (e) {
      console.warn('[cfAccess] verify failed:', (e as Error).message);
      return c.json({ error: 'cf_access_invalid' }, 403);
    }
    return next();
  };
}
