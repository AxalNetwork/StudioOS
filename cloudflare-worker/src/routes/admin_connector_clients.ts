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
import { Hono, type Context } from 'hono';
import { getOAuthApi } from '@cloudflare/workers-oauth-provider';
import type { Env } from '../types';
import { requireSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { OAUTH_PATHS, mcpEnabled, providerOptions, publicOrigin } from '../mcp/oauth';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';

export const LOVABLE_REDIRECT_URI = 'https://api.lovable.dev/workspaces/connectors/standard/oauth/callback';
/** The pre-fix KV pointer, imported only before D1 has a current state. */
export const LOVABLE_CLIENT_KEY = 'connector_client:lovable';
export const LOVABLE_SCOPES = ['validate:read', 'build:read'] as const;

type Stored = { client_id: string; created_at: string };
type Ready = { state: 'ready'; current: Stored | null };
type Rotating = { state: 'rotating'; operation: string; previous: Stored | null; candidate?: Stored };
type State = Ready | Rotating;
/** D1 is authoritative after the first write; KV is only the pre-fix import. */
export const LOVABLE_STATE_KEY = 'connector_client:lovable';

async function stateRow(env: Env) {
  return env.DB.prepare('SELECT value FROM platform_settings WHERE key = ?')
    .bind(LOVABLE_STATE_KEY).first<{ value: string }>();
}
function decodeState(value: string): State {
  const state = JSON.parse(value);
  const client = (v: any) => v === null || (typeof v?.client_id === 'string' && !!v.client_id && typeof v.created_at === 'string');
  if (state?.state === 'ready' && client(state.current)) return state;
  if (state?.state === 'rotating' && typeof state.operation === 'string' && client(state.previous)
    && (state.candidate === undefined || (state.candidate !== null && client(state.candidate)))) return state;
  throw new Error('Invalid connector client state');
}
async function legacyCurrent(env: Env): Promise<Stored | null> {
  const stored = await env.OAUTH_KV!.get<Stored>(LOVABLE_CLIENT_KEY, 'json');
  if (stored === null) return null;
  return (decodeState(JSON.stringify({ state: 'ready', current: stored })) as Ready).current;
}
const unreadable = (c: Context<{ Bindings: Env }>) => refuse(c, 503, { code: 'connector_client_unreadable', message: 'The Lovable client could not be read or replaced. Reload to try again. An interrupted replacement needs owner recovery.' });
const busy = (c: Context<{ Bindings: Env }>) => refuse(c, 409, { code: 'connector_client_busy', message: 'A Lovable client replacement is already in progress. Reload before trying again.' });

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
  try {
    const row = await stateRow(c.env);
    const state: State = row ? decodeState(row.value) : { state: 'ready', current: await legacyCurrent(c.env) };
    if (state.state !== 'ready') return unreadable(c);
    const stored = state.current;
    const live = stored ? await getOAuthApi(providerOptions(c.env), c.env).lookupClient(stored.client_id) : null;
    return c.json({ client_id: live ? stored!.client_id : null, created_at: live ? stored!.created_at : null, ...settings(c.env) });
  } catch { return unreadable(c); }
});

adminConnectorClients.post('/lovable', async (c) => {
  const actor = await requireSuperAdminWriteBar(c);
  try {
    const row = await stateRow(c.env);
    const before: State = row ? decodeState(row.value) : { state: 'ready', current: await legacyCurrent(c.env) };
    if (before.state !== 'ready') return busy(c);
    const claim: Rotating = { state: 'rotating', operation: crypto.randomUUID(), previous: before.current };
    let claimedValue = JSON.stringify(claim);
    // An atomic, non-expiring D1 claim also fences separate Worker isolates.
    // Never expire a claim around KV side effects: a paused request may resume.
    const claimed = row
      ? await c.env.DB.prepare('UPDATE platform_settings SET value = ?, updated_at = ?, updated_by = ? WHERE key = ? AND value = ?')
        .bind(claimedValue, new Date().toISOString(), String(actor.id), LOVABLE_STATE_KEY, row.value).run()
      : await c.env.DB.prepare('INSERT OR IGNORE INTO platform_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)')
        .bind(LOVABLE_STATE_KEY, claimedValue, new Date().toISOString(), String(actor.id)).run();
    if (!claimed.success) return unreadable(c);
    if (claimed.meta.changes !== 1) return busy(c);
    const api = getOAuthApi(providerOptions(c.env), c.env);
    const made = await api.createClient({
      redirectUris: [LOVABLE_REDIRECT_URI],
      clientName: 'Lovable',
      clientUri: 'https://lovable.dev',
    });
    const current: Stored = { client_id: made.clientId, created_at: new Date().toISOString() };
    // Journal the candidate before retiring the previous client. No secret is stored.
    const candidateValue = JSON.stringify({ ...claim, candidate: current });
    const journaled = await c.env.DB.prepare('UPDATE platform_settings SET value = ? WHERE key = ? AND value = ?')
      .bind(candidateValue, LOVABLE_STATE_KEY, claimedValue).run();
    if (!journaled.success || journaled.meta.changes !== 1) return unreadable(c);
    claimedValue = candidateValue;
    // The provider deletes the old client AND revokes its grants. Failure is
    // unreadable, never a successful rotation with another credential left active.
    if (before.current) await api.deleteClient(before.current.client_id);
    const saved = await c.env.DB.prepare('UPDATE platform_settings SET value = ?, updated_at = ?, updated_by = ? WHERE key = ? AND value = ?')
      .bind(JSON.stringify({ state: 'ready', current } satisfies Ready), new Date().toISOString(), String(actor.id), LOVABLE_STATE_KEY, claimedValue).run();
    if (!saved.success || saved.meta.changes !== 1) return unreadable(c);
    await logAdminAction(c.env, actor.id, actor.email, 'lovable_connector_client_replaced', {
      operation: claim.operation, client_id: current.client_id,
      previous_client_id: before.current?.client_id ?? null,
    });
    return c.json({ client_id: made.clientId, client_secret: made.clientSecret, created_at: current.created_at, replaced: !!before.current, ...settings(c.env) }, 201);
  } catch { return unreadable(c); }
});
