/**
 * D1085 (#2950, #2405 part 1) — a founder's own Notion, read-only, through
 * Notion's hosted MCP server.
 *
 * A member connects only by "Sign in with Notion": the generic MCP sign-in
 * (`routes/connector_mcp_oauth.ts`, D1080) serves the record
 * (`MCP_PROVIDERS.notion`) and writes the `oauth_mcp` row. `connect` takes
 * no token, so a paste is refused and nothing reaches Notion or is stored.
 * Every read goes through `services/notion/reads.ts`.
 *
 *   connect        403 support_session_refused for a support session; 410
 *                  sign_in_only otherwise: there is no token to paste
 *   disconnect     the grant revoked at Notion, best effort, then the stored
 *                  tokens deleted (`revokeMcpConnection`); the generic route
 *                  deletes the row after. A support session may disconnect.
 *   revokeGranted  a grant the route refused, revoked at Notion, best effort
 *   ready          D751: whether a sign-in can register (`mcpReadiness`)
 */
import type { Context } from 'hono';
import type { Env, User } from '../../types';
import { ConnectRefusal, registerProvider, type ConnectInput, type ConnectResult, type IntegrationRow } from '../registry';
import { MCP_PROVIDERS } from '../mcpProviders';
import {
  MCP_AUTH_TYPE, discoverMcp, resolveMcpClient, revokeMcpConnection, revokeMcpTokens, type McpCredentials,
} from '../mcpClient';
import { mcpPreregisteredFor, mcpReadiness } from '../mcpSignIn';
import { selectJwt } from '../../auth';

type C = Context<{ Bindings: Env }>;

const NOTION = MCP_PROVIDERS.notion;

/** A support session acting as the member (`impersonated_by`, as Mercury's reads it). */
const isSupportSession = async (c: C) => !!(await selectJwt(c))?.payload.impersonated_by;

export const SIGN_IN_ONLY = 'Connect Notion with Sign in with Notion. Axal VC never asks for a Notion token.';

async function connect(c: C, _user: User, _input: ConnectInput): Promise<ConnectResult> {
  if (await isSupportSession(c)) {
    throw new ConnectRefusal(403, 'support_session_refused', 'A support session cannot connect a member\'s Notion.');
  }
  throw new ConnectRefusal(410, 'sign_in_only', SIGN_IN_ONLY);
}

async function disconnect(c: C, _user: User, row: IntegrationRow): Promise<void> {
  if (row.auth_type !== MCP_AUTH_TYPE || row.provider_key !== NOTION.key) return;
  await revokeMcpConnection(c.env, NOTION, row, { preregistered: mcpPreregisteredFor(c.env, NOTION) });
}

/** A grant refused after it was issued: its tokens revoked at Notion, best effort. */
async function revokeGranted(env: Env, result: ConnectResult): Promise<void> {
  const creds = result.credentials as Partial<McpCredentials>;
  if (typeof creds?.access_token !== 'string' || typeof creds.client_key !== 'string') return;
  try {
    const server = await discoverMcp(NOTION, { resource: typeof creds.resource === 'string' ? creds.resource : undefined });
    const client = await resolveMcpClient(env, NOTION, server, creds.client_key, { preregistered: mcpPreregisteredFor(env, NOTION) });
    if (client) await revokeMcpTokens(server, client, { access_token: creds.access_token, refresh_token: creds.refresh_token });
  } catch { /* best effort: the refusal stands either way */ }
}

const ready = (env: Env) => mcpReadiness(env, NOTION, mcpPreregisteredFor(env, NOTION));

registerProvider({ key: 'notion', connect, disconnect, revokeGranted, ready });
