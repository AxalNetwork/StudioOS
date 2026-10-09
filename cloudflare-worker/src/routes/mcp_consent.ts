/**
 * D666 (#1496) — the SPA's half of connecting an AI assistant (D665):
 *
 *   GET    /api/mcp/consent/:id            the parked request: client, redirect host, scopes, grantable companies
 *   POST   /api/mcp/consent/:id/approve    { companies: [id…] } → { redirectTo }
 *   POST   /api/mcp/consent/:id/deny       → { redirectTo } carrying access_denied
 *   GET    /api/connectors/assistants      the caller's grants (never a token)
 *   DELETE /api/connectors/assistants/:id  revoke one grant, at once
 *
 * All signed in (`requireAuth`), and all 404 with MCP_SERVER_ENABLED off.
 *
 * A REQUEST ID IS SINGLE-USE. Approve or deny deletes the parked request and
 * leaves a tombstone for its remaining lifetime, so a second use answers 409
 * ("used") and an unknown or lapsed id 410 ("expired"). KV has no
 * compare-and-set, so two answers racing within KV's propagation window could
 * both read the request; both would be the same signed-in user's own answer.
 *
 * NOTHING IS AUTO-APPROVED. The redirect host is returned beside the client's
 * self-declared name so the page can show where the connection goes.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { logActorAct } from '../services/actorLog';
import { CONSENT_TTL_SECONDS, SCOPES, consentKey, mcpEnabled, oauthHelpers, type ParkedRequest } from '../mcp/oauth';
import { grantableCompanies, lastUsedKey, type GrantProps } from '../mcp/grants';

type C = Context<{ Bindings: Env }>;
const usedKey = (id: string) => `mcp_consent_used:${id}`;
const ID = /^[a-f0-9]{32}$/;

const notFound = (c: C) => c.json({ detail: 'Not found' }, 404);

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
    scopes: [...SCOPES],
    companies: await grantableCompanies(c.env, user),
    expires_at: new Date(p.createdAt + CONSENT_TTL_SECONDS * 1000).toISOString(),
  });
});

mcpConsent.post('/:id/approve', async (c) => {
  const user = await signedIn(c); if (user instanceof Response) return user;
  const id = c.req.param('id');
  const p = await parked(c, id); if (p instanceof Response) return p;
  const body = (await c.req.json().catch(() => ({}))) as { companies?: unknown };
  const asked = Array.isArray(body.companies) ? body.companies.map(Number) : [];
  if (!asked.length || asked.some((n) => !Number.isInteger(n) || n <= 0)) return c.json({ detail: 'Tick at least one company' }, 400);
  // Checked again here: the page's list is not trusted.
  const allowed = new Set((await grantableCompanies(c.env, user)).map((x) => x.id));
  if (asked.some((n) => !allowed.has(n))) return c.json({ detail: 'You can only connect companies you can write to' }, 403);
  const helpers = oauthHelpers(c.env);
  const client = await helpers.lookupClient(p.authRequest.clientId);
  if (!client) return c.json({ detail: 'This assistant is no longer registered. Start again from your assistant.' }, 410);
  await spend(c, id);
  const companies = [...new Set(asked)];
  const props: GrantProps = {
    userId: Number(user.id), companies, clientName: client.clientName?.trim() || null,
    redirectHost: hostOf(p.authRequest.redirectUri), grantedAt: Math.floor(Date.now() / 1000),
  };
  const scope = (p.authRequest.scope || []).filter((s) => (SCOPES as readonly string[]).includes(s));
  const { redirectTo } = await helpers.completeAuthorization({
    request: p.authRequest, userId: String(user.id),
    metadata: { clientName: props.clientName, redirectHost: props.redirectHost, companies, grantedAt: props.grantedAt },
    scope: scope.length ? scope : [...SCOPES], props,
  });
  await logActorAct(c.env, user, 'mcp_grant_approved', { client: props.clientName, redirect_host: props.redirectHost, companies });
  return c.json({ redirectTo });
});

mcpConsent.post('/:id/deny', async (c) => {
  const user = await signedIn(c); if (user instanceof Response) return user;
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

assistantGrants.get('/', async (c) => {
  const user = await signedIn(c); if (user instanceof Response) return user;
  const helpers = oauthHelpers(c.env);
  const out: unknown[] = [];
  let cursor: string | undefined;
  do {
    const page = await helpers.listUserGrants(String(user.id), cursor ? { cursor } : undefined);
    for (const g of page.items) {
      const m = (g.metadata || {}) as { clientName?: string | null; redirectHost?: string | null; companies?: number[] };
      const ids = Array.isArray(m.companies) ? m.companies.map(Number).filter(Number.isInteger) : [];
      const names = ids.length
        ? ((await c.env.DB.prepare('SELECT id, name FROM projects WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all<{ id: number; name: string | null }>()).results || [])
        : [];
      out.push({
        id: g.id,
        client_name: m.clientName || null,
        redirect_host: m.redirectHost || (g.redirectUri ? hostOf(g.redirectUri) : null),
        companies: ids.map((cid) => ({ id: cid, name: names.find((n) => n.id === cid)?.name || null })),
        connected_at: g.createdAt ? new Date(g.createdAt * 1000).toISOString() : null,
        last_used_at: (await c.env.OAUTH_KV!.get(lastUsedKey(g.id))) || null,
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
