/**
 * D2407 (#2407 part 1) — a founder's own Beehiiv newsletter, through
 * Beehiiv's hosted MCP server (`MCP_PROVIDERS.beehiiv`).
 *
 * A member connects only by "Sign in with Beehiiv": the generic MCP sign-in
 * (`routes/connector_mcp_oauth.ts`, D1080) serves the record and writes the
 * `oauth_mcp` row. `connect` takes no key (decision A1: no API key fallback),
 * so a paste is refused and nothing reaches Beehiiv or is stored. Every read
 * goes through `services/beehiiv/reads.ts`.
 *
 *   connect        403 support_session_refused for a support session; 410
 *                  sign_in_only otherwise: there is no key to paste
 *   disconnect     the grant revoked at Beehiiv, best effort, then the stored
 *                  tokens deleted (`revokeMcpConnection`), then every
 *                  `beehiiv_publication_links` row of this connection
 *                  removed; the generic route deletes the row after. Landed
 *                  figures and the ledger stay, so a reconnect never brings a
 *                  deleted figure back. A support session may disconnect.
 *   revokeGranted  a grant the route refused, revoked at Beehiiv, best effort
 *   ready          D751: whether a sign-in can register (`mcpReadiness`)
 *
 * PUBLISHING, DRAFT ONLY (#2407 part 3, D1319's adapter). Every call comes
 * from `routes/publish.ts` or `services/publishCore.ts`, after the founder's
 * own steps; nothing here is reached by a sync, a cron or Eadwyn.
 *   listDestinations  the publications the member's sign-in sees, each
 *                     "Draft only: not sent to subscribers". They arrive
 *                     switched off for every company (PUBLISH's rule).
 *   publishPreview    `previewDraft`: the title and email-safe HTML `publish`
 *                     sends, and the problems that keep Send off. No request.
 *   publish           `createBeehiivDraft`: one draft, never a post (no
 *                     `status`), with a one-time publish ticket.
 *   NO retract        retract kind `none`: Axal VC never deletes or edits a
 *                     founder's post. "Delete it on Beehiiv", then Mark as
 *                     removed, as PUBLISH draws it.
 *   NO findPublished  no read tool lists drafts (UNVERIFIED), so Check is not
 *                     offered: an unknown outcome is looked for in Beehiiv.
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
import { beehiivReadsFor } from '../../services/beehiiv/reads';
import { BEEHIIV_AUDIENCE, createBeehiivDraft, previewDraft } from '../../services/beehiiv/drafts';

type C = Context<{ Bindings: Env }>;

const BEEHIIV = MCP_PROVIDERS.beehiiv;

/** A support session acting as the member (`impersonated_by`, as Mercury's reads it). */
const isSupportSession = async (c: C) => !!(await selectJwt(c))?.payload.impersonated_by;

export const SIGN_IN_ONLY = 'Connect Beehiiv with Sign in with Beehiiv. Axal VC never asks for a Beehiiv API key.';

async function connect(c: C, _user: User, _input: ConnectInput): Promise<ConnectResult> {
  if (await isSupportSession(c)) {
    throw new ConnectRefusal(403, 'support_session_refused', 'A support session cannot connect a member\'s Beehiiv.');
  }
  throw new ConnectRefusal(410, 'sign_in_only', SIGN_IN_ONLY);
}

async function disconnect(c: C, _user: User, row: IntegrationRow): Promise<void> {
  if (row.provider_key !== BEEHIIV.key) return;
  if (row.auth_type === MCP_AUTH_TYPE) {
    await revokeMcpConnection(c.env, BEEHIIV, row, { preregistered: mcpPreregisteredFor(c.env, BEEHIIV) });
  }
  await c.env.DB.prepare('DELETE FROM beehiiv_publication_links WHERE integration_id = ?').bind(row.id).run();
}

/** A grant refused after it was issued: its tokens revoked at Beehiiv, best effort. */
async function revokeGranted(env: Env, result: ConnectResult): Promise<void> {
  const creds = result.credentials as Partial<McpCredentials>;
  if (typeof creds?.access_token !== 'string' || typeof creds.client_key !== 'string') return;
  try {
    const server = await discoverMcp(BEEHIIV, { resource: typeof creds.resource === 'string' ? creds.resource : undefined });
    const client = await resolveMcpClient(env, BEEHIIV, server, creds.client_key, { preregistered: mcpPreregisteredFor(env, BEEHIIV) });
    if (client) await revokeMcpTokens(server, client, { access_token: creds.access_token, refresh_token: creds.refresh_token });
  } catch { /* best effort: the refusal stands either way */ }
}

const ready = (env: Env) => mcpReadiness(env, BEEHIIV, mcpPreregisteredFor(env, BEEHIIV));

/** The publications this sign-in can see, as PUBLISH's places: the draft goes to the one the founder switches on. */
async function listDestinations(env: Env, row: IntegrationRow) {
  if (row.provider_key !== BEEHIIV.key) return [];
  const reads = await beehiivReadsFor(env, row);
  return (await reads.publications()).map((p) => ({ external_account_id: p.id, display_name: p.name ?? p.id, audience_label: BEEHIIV_AUDIENCE }));
}

const publishPreview = async (_env: Env, _row: IntegrationRow, input: Parameters<typeof previewDraft>[0]) => previewDraft(input);

const publish = (env: Env, row: IntegrationRow, envelope: Parameters<typeof createBeehiivDraft>[2]) => createBeehiivDraft(env, row, envelope);

registerProvider({ key: 'beehiiv', connect, disconnect, revokeGranted, ready, listDestinations, publishPreview, publish });
