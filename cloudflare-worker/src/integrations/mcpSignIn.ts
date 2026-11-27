/**
 * D1080 (#2945, #2404 part 2) — what the generic MCP sign-in
 * (`routes/connector_mcp_oauth.ts`) shares with the rest of the Worker: which
 * records it serves, where they call back, whether Axal holds their client,
 * the pre-registered client's loader, and the revoke a disconnect runs.
 *
 * A record is served by the generic routes only when its `callback_path` is
 * `/api/integrations/mcp/<key>/callback`. Mercury's is its own
 * (`routes/mercury_oauth.ts`, D840), so the generic routes answer 404 for it
 * until #2404 part 3 moves it.
 *
 * PRE-REGISTERED CLIENTS. A record whose `registration` names
 * `preregistered` reads its client ID and secret from HQ › Integration keys
 * (`loadOauthCreds`, env first), so its key must be a `MANAGED_PROVIDERS`
 * key, and `CALLBACK_URL` (exhaustive over that union) then shows
 * `mcpCallbackUrl(key)`. `mcp_providers.test.ts` holds every record to it.
 */
import type { Env } from '../types';
import type { IntegrationRow } from './registry';
import { MCP_PROVIDERS, type McpProvider } from './mcpProviders';
import { MCP_AUTH_TYPE, revokeMcpConnection, type McpFetch, type McpPreregistered } from './mcpClient';
import { loadOauthCreds, MANAGED_PROVIDERS, oauthCredsReady, type ManagedProviderKey } from '../services/providerOauthKeys';
import { callbackBase } from '../util/url';

export const MCP_SIGN_IN_BASE = '/api/integrations/mcp';

export const mcpCallbackPath = (key: string) => `${MCP_SIGN_IN_BASE}/${key}/callback`;
export const mcpCimdPath = (key: string) => `${MCP_SIGN_IN_BASE}/${key}/client.json`;
/** The client ID metadata document's URL: on axal.vc only. */
export const mcpCimdUrl = (key: string) => `https://axal.vc${mcpCimdPath(key)}`;

/** The callback URL HQ › Integration keys shows for a pre-registered record (`CALLBACK_URL`). */
export const mcpCallbackUrl = (key: string) => (env: Env): string => `${callbackBase(env)}${mcpCallbackPath(key)}`;

/** The record the generic routes serve for `key`, or null (unknown, or a provider with its own routes). */
export function genericMcpProvider(providers: Readonly<Record<string, McpProvider>>, key: string): McpProvider | null {
  if (!Object.hasOwn(providers, key)) return null;
  const record = providers[key];
  return record.key === key && record.callback_path === mcpCallbackPath(key) ? record : null;
}

const isManaged = (key: string): key is ManagedProviderKey => (MANAGED_PROVIDERS as string[]).includes(key);

/** The pre-registered client's ID and secret, from HQ › Integration keys; null for a key the console does not hold. */
export function mcpPreregisteredFor(env: Env, record: McpProvider): McpPreregistered | undefined {
  if (!record.registration.includes('preregistered')) return undefined;
  return async () => {
    if (!isManaged(record.key)) return null;
    const creds = await loadOauthCreds(env, record.key);
    return creds ? { client_id: creds.id, client_secret: creds.secret || null } : null;
  };
}

/**
 * D751 for an MCP record: `true` when a sign-in can register (a client ID
 * metadata document on axal.vc, or DCR, which the server's own metadata
 * decides at start) or HQ holds the pre-registered client; `false` when only
 * a pre-registered client would do and none is held; `null` when that could
 * not be read.
 */
export async function mcpReadiness(env: Env, record: McpProvider, loader?: McpPreregistered): Promise<boolean | null> {
  if (record.registration.some((m) => m === 'dcr' || (m === 'cimd' && record.cimd_url === mcpCimdUrl(record.key)))) return true;
  if (!record.registration.includes('preregistered')) return false;
  try {
    if (loader) return !!(await loader())?.client_id;
    return isManaged(record.key) ? await oauthCredsReady(env, record.key) : false;
  } catch { return null; }
}

/**
 * A disconnect's revoke, run before the row is deleted: for a member's MCP
 * sign-in of a record without its own `disconnect` (Mercury has one), the
 * provider's revocation endpoint, best effort. Whether the provider accepted
 * it, the tokens are deleted. Null when the row is not such a sign-in.
 */
export async function mcpDisconnect(
  env: Env,
  row: IntegrationRow,
  deps: { providers?: Readonly<Record<string, McpProvider>>; fetcher?: McpFetch } = {},
): Promise<{ provider_revoked: boolean } | null> {
  if (row.auth_type !== MCP_AUTH_TYPE) return null;
  const record = genericMcpProvider(deps.providers ?? MCP_PROVIDERS, row.provider_key);
  if (!record) return null;
  return revokeMcpConnection(env, record, row, { fetcher: deps.fetcher, preregistered: mcpPreregisteredFor(env, record) });
}
