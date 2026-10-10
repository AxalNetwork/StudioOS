/**
 * D666 (#1496) — the StudioOS MCP server's OAuth 2.1 provider (D665, #1495),
 * through `@cloudflare/workers-oauth-provider`: dynamic client registration
 * (RFC 7591), PKCE (S256 only), authorization-server metadata (RFC 8414) and
 * protected-resource metadata (RFC 9728).
 *
 * THE PATHS. `/api/mcp` is the protected resource. The authorization server's
 * own endpoints sit at `/api/oauth/*`, OUTSIDE `/api/mcp`, because the
 * provider treats everything under its `apiRoute` as a resource that needs a
 * token, and a founder reaching the authorize endpoint has none yet. The two
 * discovery documents are at `/.well-known/oauth-*`, which wrangler.toml's
 * `run_worker_first` sends to this Worker instead of the SPA's fallback.
 *
 * THE FLAG. With `MCP_SERVER_ENABLED` anything but "true", `routeMcp` answers
 * 404 for every one of those paths and the provider is never built.
 *
 * CONSENT GOES THROUGH THE SPA. The SPA signs requests with a bearer token
 * from localStorage, not a cookie, so a plain redirect to the authorize
 * endpoint says nothing about who is signed in. The authorize endpoint parks
 * the parsed request in OAUTH_KV for ten minutes and redirects to
 * `/connect/assistant?request=<id>`; the SPA reads and answers it through
 * `routes/mcp_consent.ts`, signed in. Nothing is ever auto-approved.
 */
import { OAuthProvider, getOAuthApi, type OAuthProviderOptions, type AuthRequest } from '@cloudflare/workers-oauth-provider';
import type { Env } from '../types';
import { mcpApiHandler } from './server';

export const MCP_PATH = '/api/mcp';
export const OAUTH_PATHS = { authorize: '/api/oauth/authorize', token: '/api/oauth/token', register: '/api/oauth/register' } as const;
export const SCOPES = ['validate:read', 'validate:write'] as const;
export const CONSENT_TTL_SECONDS = 600;
export const CLIENT_REGISTRATION_TTL_SECONDS = 7 * 86_400;
export const PUBLIC_OAUTH_LIMITS = { register: 10, authorize: 30 } as const;
export const requestedScopes = (scope: readonly string[] | undefined) => [...new Set(scope ?? [])].filter((s) => (SCOPES as readonly string[]).includes(s));
const HOUR = 3600;
const DAY = 86_400;

export const mcpEnabled = (env: Env) => env.MCP_SERVER_ENABLED === 'true' && !!env.OAUTH_KV;

/** The origin the resource is named by: production's apex unless a deployment says otherwise. */
export function publicOrigin(env: Env): string {
  const raw = String(env.MCP_PUBLIC_ORIGIN || '').trim();
  try { if (raw) return new URL(raw).origin; } catch { /* fall through */ }
  return 'https://axal.vc';
}

/** Every path this module answers; the Worker's fetch sends these here before `app.fetch`. */
export function isMcpPath(pathname: string): boolean {
  if (pathname.startsWith(`${MCP_PATH}/consent/`)) return false; // the SPA's consent API, in routes/mcp_consent.ts
  return pathname === MCP_PATH
    || pathname.startsWith(`${MCP_PATH}/`)
    || Object.values(OAUTH_PATHS).includes(pathname as any)
    || pathname.startsWith('/.well-known/oauth-authorization-server')
    || pathname.startsWith('/.well-known/oauth-protected-resource');
}

/** A parked consent request, keyed by a random id. */
export const consentKey = (id: string) => `mcp_consent:${id}`;
export interface ParkedRequest { authRequest: AuthRequest; createdAt: number }

/** The authorize endpoint: check the request, park it, and send the founder to the SPA's consent page. */
async function authorize(request: Request, env: Env, helpers: ReturnType<typeof getOAuthApi>): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== OAUTH_PATHS.authorize || request.method !== 'GET') return new Response(null, { status: 404 });
  let authRequest: AuthRequest;
  try {
    authRequest = await helpers.parseAuthRequest(request);
  } catch {
    return Response.json({ error: 'invalid_request', detail: 'The authorization request could not be read' }, { status: 400 });
  }
  // PKCE is required, and only S256 (the provider refuses `plain` itself).
  if (!authRequest.codeChallenge || authRequest.codeChallengeMethod !== 'S256') {
    return Response.json({ error: 'invalid_request', detail: 'PKCE with S256 is required' }, { status: 400 });
  }
  const scopes = requestedScopes(authRequest.scope);
  if (!scopes.length) return Response.json({ error: 'invalid_scope', detail: 'Request validate:read or validate:write.' }, { status: 400 });
  authRequest.scope = scopes;
  const client = await helpers.lookupClient(authRequest.clientId);
  if (!client) return Response.json({ error: 'invalid_client', detail: 'Unknown client' }, { status: 400 });
  const id = crypto.randomUUID().replace(/-/g, '');
  const parked: ParkedRequest = { authRequest, createdAt: Date.now() };
  await env.OAUTH_KV!.put(consentKey(id), JSON.stringify(parked), { expirationTtl: CONSENT_TTL_SECONDS });
  return Response.redirect(`${url.origin}/connect/assistant?request=${id}`, 302);
}

export function providerOptions(env: Env): OAuthProviderOptions<Env> {
  const origin = publicOrigin(env);
  return {
    apiRoute: `${origin}${MCP_PATH}`,
    apiHandler: mcpApiHandler,
    defaultHandler: { fetch: (req: Request, e: Env) => authorize(req, e, getOAuthApi(providerOptions(e), e)) } as any,
    authorizeEndpoint: `${origin}${OAUTH_PATHS.authorize}`,
    tokenEndpoint: `${origin}${OAUTH_PATHS.token}`,
    clientRegistrationEndpoint: `${origin}${OAUTH_PATHS.register}`,
    clientRegistrationTTL: CLIENT_REGISTRATION_TTL_SECONDS,
    accessTokenTTL: HOUR,
    refreshTokenTTL: 30 * DAY,
    refreshTokenIdleTTL: 30 * DAY,
    scopesSupported: [...SCOPES],
    resourceMetadata: {
      resource: `${origin}${MCP_PATH}`,
      authorization_servers: [origin],
      scopes_supported: [...SCOPES],
      bearer_methods_supported: ['header'],
      resource_name: 'StudioOS',
    },
  };
}

/** The OAuth helpers for the SPA's consent and grants routes. */
export const oauthHelpers = (env: Env) => getOAuthApi(providerOptions(env), env);

/** Answer an MCP or OAuth path, or 404 with the flag off. */
export async function routeMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!mcpEnabled(env)) return new Response(JSON.stringify({ detail: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  const path = new URL(request.url).pathname;
  const bucket = path === OAUTH_PATHS.register ? 'register' : path === OAUTH_PATHS.authorize ? 'authorize' : null;
  if (bucket && !(await withinPublicOAuthLimit(env, request, bucket))) {
    return Response.json({ error: 'rate_limited', detail: 'Too many requests. Wait a minute.' }, { status: 429, headers: { 'Retry-After': '60' } });
  }
  return new OAuthProvider(providerOptions(env)).fetch(request, env, ctx);
}

/** Edge per-IP throttle, before the provider; fail closed when the counter is unavailable.
 * KV counters are best effort across edges. Durable D1 guards protect stored daily quotas.
 */
export async function withinPublicOAuthLimit(env: Env, request: Request, bucket: keyof typeof PUBLIC_OAUTH_LIMITS, now = Date.now()): Promise<boolean> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = `mcp_public:${bucket}:${ip}:${Math.floor(now / 60_000)}`;
  try {
    const count = Number((await env.RATE_LIMITS.get(key)) || 0) + 1;
    await env.RATE_LIMITS.put(key, String(count), { expirationTtl: 120 });
    return count <= PUBLIC_OAUTH_LIMITS[bucket];
  } catch { return false; }
}
