/**
 * D1361 — the connector API: a small, read-only REST surface over Axal VC's
 * own MCP tools, for an outside service that calls plain HTTP (a Lovable custom
 * connector first). Mounted at `/api/connector/v1`.
 *
 * TWO CREDENTIALS, both the member's own, both already used by `/mcp`:
 *   - an OAuth access token from Axal VC's authorization server (`/api/oauth/*`),
 *     which a Lovable custom connector obtains when the member signs in and
 *     ticks companies on the consent page (the client: `admin_connector_clients.ts`);
 *   - a member API key (D841, `axk_…`), from Account › Builder › API keys,
 *     checked by `authenticateKey` exactly as `/mcp` checks it.
 * A session cookie never authenticates here.
 *
 * NO SECOND SET OF RULES. Every data route calls the existing tool through
 * `callTool`, so the key's scope, its approved companies, the member's live
 * access to each company (`grantCompany`), the plan check, the member's own
 * call limit, the timeout, metering and the call log all apply exactly as they
 * do on `/mcp`. A route here only maps HTTP to a tool and the tool's result
 * back to HTTP.
 *
 * WHAT IS EXPOSED, and nothing else (an allow-list, not a tool proxy):
 *   GET /me                                   the connection test
 *   GET /companies                            list_companies        validate:read
 *   GET /companies/:id/validate-context       get_validate_context  validate:read
 *   GET /companies/:id/interview-guide        get_interview_guide   validate:read
 *   GET /companies/:id/build-progress         get_build_progress    build:read
 * No write, no Raise or investor data, no admin route. A key needs
 * `API_KEYS_ENABLED`; an OAuth token needs `MCP_SERVER_ENABLED`.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { getOAuthApi } from '@cloudflare/workers-oauth-provider';
import { MCP_PATH, authenticateKey, bearerOf, mcpEnabled, providerOptions, publicOrigin } from '../mcp/oauth';
import { looksLikeKey, type KeyRow } from '../services/apiKeys';
import type { GrantProps } from '../mcp/grants';
import { callTool, liveCompanies, registeredTools } from '../mcp/server';
import { grantUser, keyFailuresExceeded, recordKeyFailure, withinGrantLimit, withinUserLimit, ToolRefused } from '../mcp/grants';
import { refuse } from '../util/refusal';

/** Who is calling: a member API key, or an OAuth grant from Axal VC's own authorization server. */
type Principal = { props: GrantProps; scopes: string[]; grantId: string | null; key: KeyRow | null; expiresAt: number | null };
type C = Context<{ Bindings: Env; Variables: { who: Principal } }>;

/** A tool's refusal code, as the HTTP status this API answers it with. */
const STATUS: Readonly<Record<string, number>> = Object.freeze({
  insufficient_scope: 403,
  refused: 403,
  insufficient_tokens: 402,
  spend_limit: 402,
  ai_paused: 402,
  budget_review: 402,
  rate_limited: 429,
  timeout: 504,
  unavailable: 503,
});

export const MAX_HYPOTHESIS = 200;

const companyId = (raw: string): number | null => (/^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null);

/** Run one allow-listed tool for this key and answer its result as HTTP. */
async function runTool(c: C, who: Principal, name: string, args: Record<string, unknown>) {
  const tool = registeredTools().find((t) => t.name === name);
  if (!tool) return refuse(c, 503, { code: 'unavailable', message: 'That operation is not available right now.' });
  const result = await callTool(c.env, who.props, who.grantId, tool, args, who.scopes) as {
    content?: Array<{ text?: string }>; isError?: boolean; _meta?: Record<string, unknown>;
  };
  const executionId = typeof result._meta?.execution_id === 'string' ? result._meta.execution_id : null;
  if (executionId) c.header('X-Axal-Execution-Id', executionId);
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(result.content?.[0]?.text ?? '{}'); } catch { body = {}; }
  if (!result.isError) return c.json(body, 200);
  const code = typeof body.code === 'string' ? body.code : 'refused';
  const status = STATUS[code] ?? (Number.isInteger(body.status) ? Number(body.status) : 403);
  const message = typeof body.error === 'string' ? body.error : 'Axal VC refused that request.';
  return refuse(c, status, { code, message });
}

export const connectorApi = new Hono<{ Bindings: Env; Variables: { who: Principal } }>();

const tokenRefusal = (c: C) => {
  c.header('WWW-Authenticate', 'Bearer error="invalid_token", error_description="invalid_token"');
  return refuse(c, 401, { code: 'invalid_token', message: 'That sign-in is not valid or has expired. Connect Axal VC again.' });
};
const rateRefusal = (c: C) => {
  c.header('Retry-After', '60');
  return refuse(c, 429, { code: 'rate_limited', message: 'Too many requests. Wait a minute and try again.' });
};

/**
 * An OAuth access token from Axal VC's own authorization server (the one
 * `/mcp` uses), bound to that resource. `unwrapToken` checks it exists, is
 * unexpired and its grant stands; the grant's props are the same principal
 * `/mcp` serves (the user, the companies ticked at consent, the scopes).
 */
async function oauthPrincipal(env: Env, bearer: string): Promise<Principal | null> {
  if (!mcpEnabled(env) || !/^[^:\s]+:[^:\s]+:\S+$/.test(bearer)) return null;
  const summary = await getOAuthApi(providerOptions(env), env).unwrapToken<GrantProps>(bearer).catch(() => null);
  if (!summary?.grant?.props) return null;
  const resource = `${publicOrigin(env)}${MCP_PATH}`;
  const audience = summary.audience == null ? [] : Array.isArray(summary.audience) ? summary.audience : [summary.audience];
  if (audience.length && !audience.includes(resource)) return null;
  const scope = (summary as { scope?: string[] }).scope ?? summary.grant.scope ?? [];
  return { props: summary.grant.props, scopes: [...scope], grantId: summary.grantId, key: null, expiresAt: summary.expiresAt ?? null };
}

connectorApi.use('*', async (c, next) => {
  const bearer = bearerOf(c.req.raw);
  if (bearer && !looksLikeKey(bearer)) {
    const ip = c.req.header('CF-Connecting-IP') || 'unknown';
    if (await keyFailuresExceeded(c.env, ip)) return rateRefusal(c);
    const who = await oauthPrincipal(c.env, bearer);
    if (!who) {
      await recordKeyFailure(c.env, ip);
      return tokenRefusal(c);
    }
    c.set('who', who);
    return next();
  }
  const auth = await authenticateKey(c.req.raw, c.env, bearer);
  if (auth instanceof Response) return auth;
  c.set('who', { props: auth.props, scopes: auth.scopes, grantId: null, key: auth.key, expiresAt: null });
  await next();
});

/**
 * The connection test. Any live key passes; it answers who the key belongs to
 * only as far as the holder already knows it (the key's own name, prefix,
 * scopes and expiry, and the approved companies the member can still read).
 * No email, no other member, no secret.
 */
connectorApi.get('/me', async (c) => {
  const who = c.get('who');
  let user;
  try { user = await grantUser(c.env, who.props); } catch (e) {
    if (e instanceof ToolRefused) return who.key ? refuse(c, 401, { code: 'revoked_key', message: 'That API key has been revoked.' }) : tokenRefusal(c);
    throw e;
  }
  // Tool routes already count these in callTool; the connection test has no tool.
  if (!who.key && who.grantId && (!(await withinGrantLimit(c.env, who.grantId))
    || !(await withinUserLimit(c.env, user.id)))) return rateRefusal(c);
  const companies = await liveCompanies(c.env, who.props, user);
  return c.json({
    connected: true,
    service: 'Axal VC',
    credential: who.key
      ? { type: 'api_key', name: who.key.name, prefix: `axk_${who.key.key_id}`, scopes: who.scopes, expires_at: who.key.expires_at }
      : { type: 'oauth', name: who.props.clientName ?? null, scopes: who.scopes, expires_at: who.expiresAt ? new Date(who.expiresAt * 1000).toISOString() : null },
    companies,
  });
});

connectorApi.get('/companies', (c) => runTool(c, c.get('who'), 'list_companies', {}));

const companyRoute = (path: string, tool: string, extra?: (c: C) => Record<string, unknown> | Response) =>
  connectorApi.get(`/companies/:id/${path}`, async (c) => {
    const id = companyId(c.req.param('id'));
    if (id == null) return refuse(c, 400, { code: 'invalid_company', message: 'The company id must be a positive whole number, from GET /companies.' });
    const more = extra ? extra(c) : {};
    if (more instanceof Response) return more;
    return runTool(c, c.get('who'), tool, { company: id, ...more });
  });

companyRoute('validate-context', 'get_validate_context');
companyRoute('interview-guide', 'get_interview_guide', (c) => {
  const raw = c.req.query('hypothesis');
  if (raw == null || raw.trim() === '') return {};
  if (raw.length > MAX_HYPOTHESIS) return refuse(c, 400, { code: 'invalid_hypothesis', message: `The hypothesis filter is at most ${MAX_HYPOTHESIS} characters.` });
  return { hypothesis: raw.trim() };
});
companyRoute('build-progress', 'get_build_progress');

connectorApi.all('*', (c) => refuse(c, 404, { code: 'not_found', message: 'There is no such connector operation. See GET /api/connector/v1/me.' }));
