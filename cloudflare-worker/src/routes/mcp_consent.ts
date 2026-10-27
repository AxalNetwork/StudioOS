/**
 * D666 (#1496) — the SPA's half of connecting an AI assistant (D665):
 *
 *   GET    /api/mcp/consent/:id            the parked request: client, full redirect URI, scopes, grantable companies
 *   POST   /api/mcp/consent/:id/approve    { companies: [id…] } → { redirectTo }
 *   POST   /api/mcp/consent/:id/deny       → { redirectTo } carrying access_denied
 *   GET    /api/connectors/assistants      the caller's grants (never a token); D1316 adds scopes, the recognised
 *                                       assistant, each company's still_owned, the last call and 30-day counts
 *   DELETE /api/connectors/assistants/:id  revoke one grant (KV reaches other edges within about a minute)
 *
 * All signed in (`requireAuth`), and all 404 with MCP_SERVER_ENABLED off.
 *
 * A REQUEST ID IS SINGLE-USE. Approve or deny deletes the parked request and
 * leaves a tombstone for its remaining lifetime, so a second use answers 409
 * ("used") and an unknown or lapsed id 410 ("expired"). KV has no
 * compare-and-set, so two answers racing within KV's propagation window could
 * both read the request; both would be the same signed-in user's own answer.
 *
 * NOTHING IS AUTO-APPROVED. The full redirect URI is returned beside the client's
 * self-declared name so the page can show where the connection goes.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { logActorAct } from '../services/actorLog';
import { CONSENT_TTL_SECONDS, SCOPES, requestedScopes, consentKey, mcpEnabled, oauthHelpers, type ParkedRequest } from '../mcp/oauth';
import { assistantIdentity } from '../mcp/assistantIdentity';
import { grantableCompanies, lastUsedKey, type GrantProps } from '../mcp/grants';
import { ownsVenture } from './_founder_validate_helpers';

type C = Context<{ Bindings: Env }>;
const usedKey = (id: string) => `mcp_consent_used:${id}`;
const ID = /^[a-f0-9]{32}$/;

const notFound = (c: C) => c.json({ detail: 'Not found' }, 404);

/**
 * D846 (#2467): what each scope lets the assistant do, as the consent page
 * shows it. Server-written, so a scope this page does not know is never
 * approved unseen. The connector-backed reads are StudioOS's own records of a
 * connection, never a live call to the provider (D713).
 */
export const SCOPE_COPY: Record<(typeof SCOPES)[number], string> = {
  'validate:read': 'Read your Validate context',
  'validate:write': 'Submit interviews for your review',
  'build:read': 'Read your Build progress, from the records your connected tools fed',
  'raise:read': 'Read your Raise context',
  'connectors:read': 'See which tools you have connected, their status and last sync. Never their tokens.',
};

async function signedIn(c: C): Promise<User | Response> {
  if (!mcpEnabled(c.env)) return notFound(c);
  try { return (await requireAuth(c)) as User; } catch { return c.json({ detail: 'Unauthorized' }, 401); }
}

const hostOf = (uri: string) => { try { return new URL(uri).host; } catch { return null; } };

/** The parked request, or the Response that says why not. */
async function parked(c: C, id: string): Promise<ParkedRequest | Response> {
  if (!ID.test(id)) return c.json({ detail: 'This request has expired. Start again from your assistant.' }, 410);
  if (await c.env.OAUTH_KV!.get(usedKey(id))) return c.json({ detail: 'This request was already used. Start again from your assistant.' }, 409);
  const raw = await c.env.OAUTH_KV!.get(consentKey(id));
  if (!raw) return c.json({ detail: 'This request has expired. Start again from your assistant.' }, 410);
  const p = JSON.parse(raw) as ParkedRequest;
  if (Date.now() - p.createdAt > CONSENT_TTL_SECONDS * 1000) return c.json({ detail: 'This request has expired. Start again from your assistant.' }, 410);
  return p;
}

/** Spend the request: delete it, and remember it was used for its remaining lifetime. */
async function spend(c: C, id: string) {
  await c.env.OAUTH_KV!.put(usedKey(id), '1', { expirationTtl: CONSENT_TTL_SECONDS });
  await c.env.OAUTH_KV!.delete(consentKey(id));
}

export const mcpConsent = new Hono<{ Bindings: Env }>();

mcpConsent.get('/:id', async (c) => {
  const user = await signedIn(c); if (user instanceof Response) return user;
  const p = await parked(c, c.req.param('id')); if (p instanceof Response) return p;
  const client = await oauthHelpers(c.env).lookupClient(p.authRequest.clientId);
  return c.json({
    client_name: client?.clientName?.trim() || null,
    redirect_host: hostOf(p.authRequest.redirectUri),
    redirect_uri: p.authRequest.redirectUri,
    ...assistantIdentity(p.authRequest.redirectUri),
    scopes: requestedScopes(p.authRequest.scope),
    scope_labels: requestedScopes(p.authRequest.scope).map((scope) => ({ scope, label: SCOPE_COPY[scope as keyof typeof SCOPE_COPY] })),
    companies: await grantableCompanies(c.env, user),
    expires_at: new Date(p.createdAt + CONSENT_TTL_SECONDS * 1000).toISOString(),
  });
});

mcpConsent.post('/:id/approve', async (c) => {
  const user = await signedIn(c); if (user instanceof Response) return user;
  if ((await selectJwt(c))?.payload.impersonated_by) return c.json({ detail: 'A support session cannot answer assistant consent.' }, 403);
  const id = c.req.param('id');
  const p = await parked(c, id); if (p instanceof Response) return p;
  const body = (await c.req.json().catch(() => ({}))) as { companies?: unknown };
  const asked = Array.isArray(body.companies) ? body.companies.map(Number) : [];
  if (!asked.length || asked.some((n) => !Number.isInteger(n) || n <= 0)) return c.json({ detail: 'Tick at least one company' }, 400);
  // Checked again here: the page's list is not trusted.
  const allowed = new Set((await grantableCompanies(c.env, user)).map((x) => x.id));
  if (asked.some((n) => !allowed.has(n))) return c.json({ detail: 'You can only connect companies you own' }, 403);
  const helpers = oauthHelpers(c.env);
  const client = await helpers.lookupClient(p.authRequest.clientId);
  if (!client) return c.json({ detail: 'This assistant is no longer registered. Start again from your assistant.' }, 410);
  const scope = requestedScopes(p.authRequest.scope);
  if (!scope.length) return c.json({ detail: `Request at least one of ${SCOPES.join(', ')}.` }, 400);
  await spend(c, id);
  const companies = [...new Set(asked)];
  const props: GrantProps = {
    userId: Number(user.id), clientId: p.authRequest.clientId, companies, clientName: client.clientName?.trim() || null,
    redirectHost: hostOf(p.authRequest.redirectUri), redirectUri: p.authRequest.redirectUri, grantedAt: Math.floor(Date.now() / 1000),
  };
  const { redirectTo } = await helpers.completeAuthorization({
    request: p.authRequest, userId: String(user.id),
    metadata: { clientId: props.clientId, clientName: props.clientName, redirectHost: props.redirectHost, companies, grantedAt: props.grantedAt },
    scope, props, revokeExistingGrants: false,
  });
  await logActorAct(c.env, user, 'mcp_grant_approved', { client: props.clientName, redirect_host: props.redirectHost, companies });
  return c.json({ redirectTo });
});

mcpConsent.post('/:id/deny', async (c) => {
  const user = await signedIn(c); if (user instanceof Response) return user;
  if ((await selectJwt(c))?.payload.impersonated_by) return c.json({ detail: 'A support session cannot answer assistant consent.' }, 403);
  const id = c.req.param('id');
  const p = await parked(c, id); if (p instanceof Response) return p;
  await spend(c, id);
  const to = new URL(p.authRequest.redirectUri);
  to.searchParams.set('error', 'access_denied');
  if (p.authRequest.state) to.searchParams.set('state', p.authRequest.state);
  await logActorAct(c.env, user, 'mcp_grant_denied', { redirect_host: to.host });
  return c.json({ redirectTo: to.toString() });
});

export const assistantGrants = new Hono<{ Bindings: Env }>();

/** D1316: the call log's window for a grant's counts. */
export const GRANT_COUNT_DAYS = 30;

/**
 * D1316 (#3474): each grant's last call and its calls in the last 30 days, from
 * the `mcp_tool_call` lines that name it (`details.grant`, written since D1316).
 * One bound statement over the caller's own lines; `null` when it cannot be read.
 */
const GRANT_CALLS_SQL = `SELECT json_extract(details, '$.grant') AS grant_id, MAX(created_at) AS last_at,
    SUM(created_at >= ?2) AS calls,
    SUM(created_at >= ?2 AND json_extract(details, '$.outcome') = 'ok') AS ok,
    SUM(created_at >= ?2 AND json_extract(details, '$.outcome') = 'refused') AS refused,
    SUM(created_at >= ?2 AND json_extract(details, '$.outcome') = 'rate_limited') AS rate_limited,
    SUM(created_at >= ?2 AND json_extract(details, '$.outcome') IN ('error', 'timeout')) AS failed
  FROM activity_logs
  WHERE user_id = ?1 AND action = 'mcp_tool_call' AND json_extract(details, '$.grant') IS NOT NULL
  GROUP BY grant_id`;

interface GrantCalls { last_at: string | null; calls: number; ok: number; refused: number; rate_limited: number; failed: number }

async function grantCalls(env: Env, userId: number, now = Date.now()): Promise<Map<string, GrantCalls> | null> {
  const since = new Date(now - GRANT_COUNT_DAYS * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  try {
    const r = await env.DB.prepare(GRANT_CALLS_SQL).bind(userId, since).all<Record<string, unknown>>();
    return new Map((r.results || []).map((row) => [String(row.grant_id), {
      last_at: row.last_at ? String(row.last_at) : null,
      calls: Number(row.calls || 0), ok: Number(row.ok || 0), refused: Number(row.refused || 0),
      rate_limited: Number(row.rate_limited || 0), failed: Number(row.failed || 0),
    }]));
  } catch (e) {
    console.warn('[mcp] grant calls unreadable', (e as Error)?.message || 'unknown');
    return null;
  }
}

/** The store's `YYYY-MM-DD HH:MM:SS` (UTC) as ISO 8601. */
const isoOf = (at: string) => `${at.replace(' ', 'T')}${/Z|[+-]\d\d:?\d\d$/.test(at) ? '' : 'Z'}`;

assistantGrants.get('/', async (c) => {
  const user = await signedIn(c); if (user instanceof Response) return user;
  const helpers = oauthHelpers(c.env);
  const calls = await grantCalls(c.env, Number(user.id));
  const out: unknown[] = [];
  let cursor: string | undefined;
  do {
    const page = await helpers.listUserGrants(String(user.id), cursor ? { cursor } : undefined);
    for (const g of page.items) {
      const m = (g.metadata || {}) as { clientName?: string | null; redirectHost?: string | null; companies?: number[] };
      const ids = Array.isArray(m.companies) ? m.companies.map(Number).filter(Number.isInteger) : [];
      const rows = ids.length
        ? ((await c.env.DB.prepare('SELECT id, name, founder_id, deleted_at FROM projects WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all<{ id: number; name: string | null; founder_id: number | null; deleted_at: string | null }>()).results || [])
        : [];
      const mine = calls?.get(g.id) ?? null;
      // D1316: the call log first; the KV key (31 days) only when the log names no call for this grant.
      const kvLast = mine?.last_at ? null : (await c.env.OAUTH_KV!.get(lastUsedKey(g.id))) || null;
      out.push({
        id: g.id,
        client_name: m.clientName || null,
        redirect_host: m.redirectHost || (g.redirectUri ? hostOf(g.redirectUri) : null),
        // D1316: recognised from the callback the grant was made for, never from the self-declared name.
        ...assistantIdentity(g.redirectUri || ''),
        scopes: Array.isArray(g.scope) ? g.scope : [],
        companies: ids.map((cid) => {
          const row = rows.find((n) => n.id === cid);
          return { id: cid, name: row?.name || null, still_owned: !!row && !row.deleted_at && ownsVenture(row, user) };
        }),
        connected_at: g.createdAt ? new Date(g.createdAt * 1000).toISOString() : null,
        last_used_at: mine?.last_at ? isoOf(mine.last_at) : kvLast,
        last_call_at: mine?.last_at ? isoOf(mine.last_at) : kvLast,
        last_call_source: mine?.last_at ? 'call_log' : kvLast ? 'last_use' : null,
        // Null when the log could not be read: never zero calls in its place.
        calls_30d: calls === null ? null : {
          total: mine?.calls ?? 0, ok: mine?.ok ?? 0, refused: mine?.refused ?? 0,
          rate_limited: mine?.rate_limited ?? 0, failed: mine?.failed ?? 0,
        },
      });
    }
    cursor = page.cursor;
  } while (cursor);
  return c.json({ grants: out });
});

assistantGrants.delete('/:grantId', async (c) => {
  const user = await signedIn(c); if (user instanceof Response) return user;
  const grantId = c.req.param('grantId');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(grantId)) return c.json({ detail: 'Not found' }, 404);
  const helpers = oauthHelpers(c.env);
  // Only the caller's own grant: the provider keys grants by user.
  let found = false; let cursor: string | undefined;
  do {
    const page = await helpers.listUserGrants(String(user.id), cursor ? { cursor } : undefined);
    if (page.items.some((g) => g.id === grantId)) found = true;
    cursor = page.cursor;
  } while (cursor && !found);
  if (!found) return c.json({ detail: 'Not found' }, 404);
  await helpers.revokeGrant(grantId, String(user.id));
  await c.env.OAUTH_KV!.delete(lastUsedKey(grantId)).catch(() => {});
  await logActorAct(c.env, user, 'mcp_grant_revoked', { grant: grantId });
  return c.json({ revoked: true });
});
