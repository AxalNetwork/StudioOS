/**
 * D1361 — the OAuth client a Lovable custom connector signs members in with.
 * Mounted at `/api/admin/connector-clients`, Super Admin only.
 *
 * WHY A ROUTE. Dynamic client registration (`/api/oauth/register`) makes
 * clients that expire after seven days (`CLIENT_REGISTRATION_TTL_SECONDS`),
 * which would break every Lovable workspace's connection weekly. This makes
 * one client that does not expire, through the provider's own `createClient`.
 *
 * WHAT THE CLIENT CAN DO. Nothing on its own. Its only redirect is Lovable's
 * fixed callback; PKCE (S256) is required by `authorize`; each member still
 * signs in, ticks the companies and scopes on the consent page, and can
 * revoke the grant in Account › Builder. So the client secret, entered once
 * per Lovable workspace, is a client identifier, not access to anyone's data.
 *
 *   GET  /lovable          { client_id | null, created_at | null, redirect_uri, … }   never the secret
 *   POST /lovable          201 { client_id, client_secret, … }   the secret, once; replaces any earlier client
 */
import { Hono } from 'hono';
import { getOAuthApi } from '@cloudflare/workers-oauth-provider';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { OAUTH_PATHS, mcpEnabled, providerOptions, publicOrigin } from '../mcp/oauth';
import { refuse } from '../util/refusal';

export const LOVABLE_REDIRECT_URI = 'https://api.lovable.dev/workspaces/connectors/standard/oauth/callback';
/** Where the current client's id is kept, beside the provider's own records. */
export const LOVABLE_CLIENT_KEY = 'connector_client:lovable';
export const LOVABLE_SCOPES = ['validate:read', 'build:read'] as const;

type Stored = { client_id: string; created_at: string };

const settings = (env: Env) => {
  const origin = publicOrigin(env);
  return {
    redirect_uri: LOVABLE_REDIRECT_URI,
    authorization_url: `${origin}${OAUTH_PATHS.authorize}`,
    token_url: `${origin}${OAUTH_PATHS.token}`,
    scopes: LOVABLE_SCOPES.join(' '),
    pkce: true,
    api_base_url: `${origin}/api/connector/v1`,
  };
};

export const adminConnectorClients = new Hono<{ Bindings: Env }>();

adminConnectorClients.use('*', async (c, next) => {
  await requireSuperAdmin(c);
  if (!mcpEnabled(c.env)) return refuse(c, 503, { code: 'oauth_unavailable', message: 'Axal VC\'s OAuth server is switched off here (MCP_SERVER_ENABLED).' });
  await next();
});

adminConnectorClients.get('/lovable', async (c) => {
  const stored = await c.env.OAUTH_KV!.get<Stored>(LOVABLE_CLIENT_KEY, 'json').catch(() => null);
  const live = stored ? await getOAuthApi(providerOptions(c.env), c.env).lookupClient(stored.client_id).catch(() => null) : null;
  return c.json({ client_id: live ? stored!.client_id : null, created_at: live ? stored!.created_at : null, ...settings(c.env) });
});

adminConnectorClients.post('/lovable', async (c) => {
  const api = getOAuthApi(providerOptions(c.env), c.env);
  const before = await c.env.OAUTH_KV!.get<Stored>(LOVABLE_CLIENT_KEY, 'json').catch(() => null);
  const made = await api.createClient({
    redirectUris: [LOVABLE_REDIRECT_URI],
    clientName: 'Lovable',
    clientUri: 'https://lovable.dev',
  });
  const stored: Stored = { client_id: made.clientId, created_at: new Date().toISOString() };
  await c.env.OAUTH_KV!.put(LOVABLE_CLIENT_KEY, JSON.stringify(stored));
  // The earlier client stops working: its secret may have been seen. Grants it made stay with their members until revoked.
  if (before?.client_id && before.client_id !== made.clientId) await api.deleteClient(before.client_id).catch(() => undefined);
  return c.json({ client_id: made.clientId, client_secret: made.clientSecret, created_at: stored.created_at, replaced: !!before, ...settings(c.env) }, 201);
});
