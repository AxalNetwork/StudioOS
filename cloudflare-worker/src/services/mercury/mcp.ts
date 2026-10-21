/**
 * D840 (#2346) — the Worker as an MCP client of Mercury's hosted server.
 * READ-ONLY BY CONSTRUCTION, ENFORCED TWICE.
 *
 * Mercury hosts an MCP server at `MERCURY_MCP_URL` (Streamable HTTP, JSON-RPC
 * 2.0 over POST). A member signs in with OAuth (`oauth.ts`) and the Worker
 * calls the server's tools with that member's access token. Only `reads.ts`
 * imports this file (`mercury_mcp_d840.test.ts` holds the tree to that).
 *
 *  1. THE SCOPE. The sign-in asks for `read` and `offline_access` only, and a
 *     grant that reports any other scope is refused (`oauth.ts`).
 *  2. THE TOOLS. `MERCURY_READ_TOOLS` is the frozen list of tools Axal VC may
 *     call. `callTool` refuses any other name before a request is made, and
 *     refuses a listed name the server's own `tools/list` does not offer. The
 *     server offers tools that create, edit, request or approve; none is on
 *     the list, and a test pins the list.
 *
 * THE SESSION. `openMercuryMcp` sends `initialize`, keeps the server's
 * `Mcp-Session-Id` for every later request, sends `notifications/initialized`
 * and reads `tools/list` (every page) once. A session lives for one Worker
 * request; nothing is cached across requests.
 *
 * THE BUDGET. Each POST is one Worker subrequest. A session makes at most
 * `MCP_REQUEST_BUDGET` of them, and each has `MCP_DEADLINE_MS`. A redirect is
 * refused, never followed, so the token never reaches another host.
 *
 * ERRORS keep the connector's existing words (`MercuryClientError`, D710):
 * a tool off the list or not offered is `path_not_allowed`, a 401 or 403 is
 * `unauthorized`, a 429 or a spent budget is `rate_limited`, a JSON-RPC error
 * or a tool result marked `isError` is `http_error`, a body that is not
 * JSON-RPC is `bad_json`. An error never carries a response body: a body may
 * echo account data.
 *
 * UNVERIFIED (mcp.mercury.com unreachable from the building session,
 * 2026-10-21; D840.md lists each fact): the protocol version the server
 * accepts, whether it answers with JSON or an event stream (both are read),
 * that it issues a session id, and that a tool's data is JSON in its first
 * text content when it gives no `structuredContent`. The tool names are the
 * ones Mercury's server listed to an MCP client on 2026-10-21.
 */
import { DeadlineExceeded, withDeadline } from '../../util/deadline';
import { MercuryClientError, type MercuryFetch } from './client';

export const MERCURY_MCP_URL = 'https://mcp.mercury.com/mcp';

/** The MCP revision this client speaks (Streamable HTTP). */
export const MCP_PROTOCOL_VERSION = '2025-06-18';

export const MCP_DEADLINE_MS = 10_000;

/** The most POSTs one session makes: initialize, initialized, tools/list and the calls. */
export const MCP_REQUEST_BUDGET = 24;

/**
 * The tools Axal VC may call, and the only names `callTool` sends. Reads
 * only: accounts, transactions, the cashflow summary, treasury, statements,
 * invoices, customers, recipients, SAFE requests, categories and the
 * organization. A tool is added here only with its typed read in `reads.ts`.
 */
export const MERCURY_READ_TOOLS: readonly string[] = Object.freeze([
  'getOrganization',
  'getAccounts',
  'getAccount',
  'listTransactions',
  'getTransactionById',
  'getCashflowSummary',
  'getTreasury',
  'getAccountStatements',
  'listInvoices',
  'listCustomers',
  'getRecipients',
  'getSafeRequests',
  'listCategories',
]);

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
  close(): Promise<void>;
}

interface JsonRpcResponse { jsonrpc?: string; id?: unknown; result?: unknown; error?: unknown }

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** The JSON-RPC answer to request `id`, from a JSON body or an event stream. */
function answerFor(contentType: string, body: string, id: number): JsonRpcResponse {
  const candidates: unknown[] = [];
  if (/text\/event-stream/i.test(contentType)) {
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      try { candidates.push(JSON.parse(data)); } catch { /* not JSON: skipped */ }
    }
  } else {
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed)) candidates.push(...parsed); else candidates.push(parsed);
    } catch { throw new MercuryClientError('bad_json'); }
  }
  for (const c of candidates) {
    const m = obj(c);
    if (m && m.id === id && ('result' in m || 'error' in m)) return m as JsonRpcResponse;
  }
  throw new MercuryClientError('bad_json');
}

/**
 * A tool result's data: `structuredContent` when given, else the first text
 * content parsed as JSON. A result marked `isError` is `http_error`.
 */
export function toolData(result: unknown): unknown {
  const r = obj(result);
  if (!r) throw new MercuryClientError('bad_json');
  if (r.isError === true) throw new MercuryClientError('http_error');
  if (r.structuredContent !== undefined && r.structuredContent !== null) return r.structuredContent;
  const content = Array.isArray(r.content) ? r.content : [];
  const first = content.map(obj).find((c) => c?.type === 'text' && typeof c.text === 'string');
  if (!first) throw new MercuryClientError('bad_json');
  try { return JSON.parse(first.text as string); } catch { throw new MercuryClientError('bad_json'); }
}

/** Open one session: initialize, initialized, then every page of `tools/list`. */
export async function openMercuryMcp(opts: McpSessionOptions): Promise<MercuryMcpSession> {
  const fetcher = opts.fetcher ?? fetch;
  const url = opts.url ?? MERCURY_MCP_URL;
  const budget = opts.budget ?? MCP_REQUEST_BUDGET;
  let requests = 0;
  let nextId = 1;
  let sessionId: string | null = null;
  let protocol: string | null = null;

  async function post(message: Record<string, unknown>): Promise<Response> {
    if (requests >= budget) throw new MercuryClientError('rate_limited');
    requests += 1;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${opts.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    if (protocol) headers['MCP-Protocol-Version'] = protocol;
    let res: Response;
    try {
      res = await withDeadline(fetcher(url, {
        method: 'POST', redirect: 'manual', headers, body: JSON.stringify({ jsonrpc: '2.0', ...message }),
      }), MCP_DEADLINE_MS, 'mercury_mcp');
    } catch (e) {
      throw new MercuryClientError(e instanceof DeadlineExceeded ? 'timeout' : 'network_error');
    }
    if (res.status === 0 || (res.status >= 300 && res.status < 400)) throw new MercuryClientError('redirect_refused', res.status || null);
    if (res.status === 401 || res.status === 403) throw new MercuryClientError('unauthorized', res.status);
    if (res.status === 429) throw new MercuryClientError('rate_limited', 429);
    if (!res.ok) throw new MercuryClientError('http_error', res.status);
    return res;
  }

  async function request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = nextId++;
    const res = await post({ id, method, params });
    const sid = res.headers.get('Mcp-Session-Id');
    if (sid && /^[\x21-\x7e]{1,256}$/.test(sid)) sessionId = sid;
    let body: string;
    try { body = await withDeadline(res.text(), MCP_DEADLINE_MS, 'mercury_mcp'); }
    catch (e) { throw new MercuryClientError(e instanceof DeadlineExceeded ? 'timeout' : 'network_error'); }
    const answer = answerFor(res.headers.get('Content-Type') || '', body, id);
    if (answer.error !== undefined) throw new MercuryClientError('http_error', res.status);
    return answer.result;
  }

  const init = obj(await request('initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'Axal VC', version: '1.0.0' },
  }));
  protocol = typeof init?.protocolVersion === 'string' && /^[0-9-]{1,20}$/.test(init.protocolVersion) ? init.protocolVersion : MCP_PROTOCOL_VERSION;
  await post({ method: 'notifications/initialized' });

  const listed = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const result = obj(await request('tools/list', cursor ? { cursor } : {}));
    for (const t of Array.isArray(result?.tools) ? result!.tools as unknown[] : []) {
      const name = obj(t)?.name;
      if (typeof name === 'string') listed.add(name);
    }
    cursor = typeof result?.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
    if (!cursor) break;
  }
  const offered = Object.freeze(MERCURY_READ_TOOLS.filter((t) => listed.has(t)));

  return {
    offered,
    get requests() { return requests; },
    async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
      // Refused before any request: a name off the list, or one this server does not offer.
      if (!isReadTool(name) || !offered.includes(name)) throw new MercuryClientError('path_not_allowed');
      return toolData(await request('tools/call', { name, arguments: args }));
    },
    async close(): Promise<void> {
      // Best effort, and only when the budget allows: the session also expires on the server.
      if (!sessionId || requests >= budget) return;
      requests += 1;
      try {
        await withDeadline(fetcher(url, {
          method: 'DELETE', redirect: 'manual',
          headers: { Authorization: `Bearer ${opts.accessToken}`, 'Mcp-Session-Id': sessionId },
        }), MCP_DEADLINE_MS, 'mercury_mcp');
      } catch { /* the server's own expiry ends it */ }
    },
  };
}
