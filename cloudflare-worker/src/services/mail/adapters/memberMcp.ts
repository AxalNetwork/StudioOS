/**
 * D1343 (#3551) — a member's own MCP mail server as a mailbox (provider `mcp`).
 *
 * The mailbox is one of the member's custom connectors (D852) with a tool they
 * designated to send their email (`customMcp.ts`'s `mail_send`), pinned to the
 * schema they approved. The sealed credentials name only the connection and
 * its owner; the server's own tokens stay the connector's.
 *
 * A send reaches this adapter only after `routes/mail_accounts.ts` has spent
 * the composer's one-use confirmation nonce; the adapter then mints the tool's
 * one-use ticket, so nothing else can call it. Verify proves the designated
 * tool is still listed with its pinned schema, sending nothing. Disconnecting
 * the mailbox leaves the connector, which the member removes on its own page.
 */
import type { Env } from '../../../types';
import { configOf, customMcpEnabled, customRowFor, CustomMcpError, isConnectionUid, listCustomTools, sendThroughCustom, type CustomDeps } from '../../../integrations/customMcp';
import { AdapterError, type Creds, type MailAdapter, type McpCreds } from './types';

const isMcp = (c: Creds): c is McpCreds => c.kind === 'mcp';

/** The connector's resolver and fetcher: the live ones, unless a test hands its own (as `connectors_custom.ts`'s `customDepsFor`). */
export const mcpMailDeps: { current: () => CustomDeps } = { current: () => ({}) };

async function rowOf(env: Env, creds: Creds) {
  if (!isMcp(creds) || !isConnectionUid(creds.connection_uid)) throw new AdapterError('unconfigured', 'This mailbox’s connector is missing. Connect it again.');
  if (!customMcpEnabled(env)) throw new AdapterError('unconfigured', 'Custom connectors are switched off, so this mailbox cannot send.');
  const row = await customRowFor(env, creds.user_id, creds.connection_uid);
  if (!row || !configOf(row)?.mail_send) throw new AdapterError('expired', 'This mailbox’s connector, or its send tool, was removed. Choose a send tool again.');
  return row;
}

function fromCustom(e: unknown): never {
  if (e instanceof AdapterError) throw e;
  if (e instanceof CustomMcpError) {
    if (e.code === 'unauthorized') throw new AdapterError('expired', 'The sign-in to your mail server has expired. Connect it again.');
    if (e.code === 'tool_not_approved') throw new AdapterError('expired', 'Your mail server’s send tool changed since you approved it. Approve it again.');
    if (e.code === 'not_found') throw new AdapterError('unconfigured', 'This mailbox’s connector is missing. Connect it again.');
  }
  throw new AdapterError('unreachable', 'Your mail server could not be reached. Try again in a minute.');
}

export const mcpAdapter: MailAdapter = {
  async send(env, creds, msg) {
    const row = await rowOf(env, creds);
    try { return { messageId: (await sendThroughCustom(env, row, { to: msg.to, subject: msg.subject, body: msg.body }, mcpMailDeps.current())).messageId }; }
    catch (e) { return fromCustom(e); }
  },
  async verify(env, creds) {
    const row = await rowOf(env, creds);
    let tools;
    try { tools = (await listCustomTools(env, row, mcpMailDeps.current())).tools; } catch (e) { return fromCustom(e); }
    const tool = tools.find((t) => t.mail_send);
    if (!tool || tool.mail_send_changed) throw new AdapterError('expired', 'Your mail server’s send tool changed since you approved it. Approve it again.');
    return {};
  },
  // The connector is revoked on its own page; the mailbox only forgets it.
  async revoke() { /* nothing at the provider */ },
};
