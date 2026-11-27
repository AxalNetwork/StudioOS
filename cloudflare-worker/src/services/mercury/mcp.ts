/**
 * D840 (#2346) — the Worker as an MCP client of Mercury's hosted server.
 * READ-ONLY BY CONSTRUCTION, ENFORCED TWICE.
 *
 * D847 (#2468): a thin caller of the shared client. The transport — the
 * session, the budget, the deadlines, the body cap, the refused redirects
 * and the allowlist — is `integrations/mcpClient.ts`, run with Mercury's
 * frozen record (`MCP_PROVIDERS.mercury`, era `legacy`, budget 24). This
 * file keeps D840's names and its errors: every failure is re-thrown as a
 * `MercuryClientError`, so `reads.ts` and every D840 caller are unchanged.
 *
 * Mercury hosts an MCP server at `MERCURY_MCP_URL` (Streamable HTTP, JSON-RPC
 * 2.0 over POST). A member signs in with OAuth (`oauth.ts`) and the Worker
 * calls the server's tools with that member's access token. Only `reads.ts`
 * imports this file (`mercury_mcp_d840.test.ts` holds the tree to that).
 *
 *  1. THE SCOPE. The sign-in asks for `read` and `offline_access` only, and a
 *     grant that reports any other scope is refused (`oauth.ts`).
 *  2. THE TOOLS. `MERCURY_READ_TOOLS` is the frozen list of tools Axal VC may
 *     call (the record's `read_tools`). `callTool` refuses any other name
 *     before a request is made, and refuses a listed name the server's own
 *     `tools/list` does not offer. The server offers tools that create, edit,
 *     request or approve; none is on the list, and a test pins the list.
 *
 * THE SESSION. `openMercuryMcp` sends `initialize`, keeps the server's
 * `Mcp-Session-Id` for every later request, sends `notifications/initialized`
 * and reads `tools/list` (every page) once. A session lives for one Worker
 * request; nothing is cached across requests, and the server expires it.
 * The client sends POST only: no DELETE, so no request can remove anything.
 *
 * ERRORS keep the connector's existing words (`MercuryClientError`, D710):
 * a tool off the list or not offered is `path_not_allowed`, a 401 or 403 is
 * `unauthorized`, a 429 or a spent budget is `rate_limited`, a JSON-RPC error
 * or a tool result marked `isError` is `http_error`, a body that is not
 * JSON-RPC is `bad_json`. The shared client's new words map onto them: a body
 * over the cap is `http_error` 413, a 403 `insufficient_scope` is
 * `unauthorized` 403, and an unsupported protocol is `http_error`. An error
 * never carries a response body: a body may echo account data.
 *
 * UNVERIFIED (mcp.mercury.com unreachable from the building session,
 * 2026-10-21; D840.md lists each fact): the protocol version the server
 * accepts, whether it answers with JSON or an event stream (both are read),
 * that it issues a session id, and that a tool's data is JSON in its first
 * text content when it gives no `structuredContent`. The tool names are the
 * ones Mercury's server listed to an MCP client on 2026-10-21.
 */
import { MCP_PROVIDERS } from '../../integrations/mcpProviders';
import {
  LEGACY_PROTOCOL_VERSION, MCP_DEADLINE_MS as SHARED_DEADLINE_MS, McpClientError, openMcpSession,
  toolData as sharedToolData, type McpClientErrorCode, type McpSession,
} from '../../integrations/mcpClient';
import { MercuryClientError, type MercuryErrorCode, type MercuryFetch } from './client';

const MERCURY = MCP_PROVIDERS.mercury;

export const MERCURY_MCP_URL = 'https://mcp.mercury.com/mcp';

/** The MCP revision this client speaks (Streamable HTTP). */
export const MCP_PROTOCOL_VERSION = LEGACY_PROTOCOL_VERSION;

export const MCP_DEADLINE_MS = SHARED_DEADLINE_MS;

/** The most POSTs one session makes: initialize, initialized, tools/list and the calls. */
export const MCP_REQUEST_BUDGET = MERCURY.budget;

/**
 * The tools Axal VC may call, and the only names `callTool` sends. Reads
 * only: accounts, transactions, the cashflow summary, treasury, statements,
 * invoices, customers, recipients, SAFE requests, categories and the
 * organization. A tool is added to Mercury's record only with its typed read
 * in `reads.ts`.
 */
export const MERCURY_READ_TOOLS: readonly string[] = MERCURY.read_tools;

export function isReadTool(name: string): boolean {
  return MERCURY_READ_TOOLS.includes(name);
}

/** What one member's session needs: their access token, and a fetch (tests pass the fake's). */
export interface McpSessionOptions {
  accessToken: string;
  fetcher?: MercuryFetch;
  url?: string;
  budget?: number;
}

export interface MercuryMcpSession {
  /** The listed read tools this server offers. */
  readonly offered: readonly string[];
  /** POSTs made so far, initialize included. */
  readonly requests: number;
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
}

/** The shared client's words, in D710's. */
const AS_MERCURY: Record<McpClientErrorCode, [MercuryErrorCode, number | null]> = {
  path_not_allowed: ['path_not_allowed', null],
  redirect_refused: ['redirect_refused', null],
  unauthorized: ['unauthorized', null],
  rate_limited: ['rate_limited', null],
  timeout: ['timeout', null],
  network_error: ['network_error', null],
  http_error: ['http_error', null],
  bad_json: ['bad_json', null],
  too_large: ['http_error', 413],
  scope_insufficient: ['unauthorized', 403],
  unsupported_protocol: ['http_error', null],
};

function asMercury(e: unknown): unknown {
  if (!(e instanceof McpClientError)) return e;
  const [code, status] = AS_MERCURY[e.code];
  return new MercuryClientError(code, status ?? e.status);
}

/**
 * A tool result's data: `structuredContent` when given, else the first text
 * content parsed as JSON. A result marked `isError` is `http_error`.
 */
export function toolData(result: unknown): unknown {
  try { return sharedToolData(result); } catch (e) { throw asMercury(e); }
}

/** Open one session: initialize, initialized, then every page of `tools/list`. */
export async function openMercuryMcp(opts: McpSessionOptions): Promise<MercuryMcpSession> {
  let s: McpSession;
  try {
    s = await openMcpSession(MERCURY, {
      accessToken: opts.accessToken, fetcher: opts.fetcher, resource: opts.url ?? MERCURY_MCP_URL, budget: opts.budget,
    });
  } catch (e) { throw asMercury(e); }
  return {
    offered: s.offered,
    get requests() { return s.requests; },
    async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
      try { return await s.callTool(name, args); } catch (e) { throw asMercury(e); }
    },
  };
}
