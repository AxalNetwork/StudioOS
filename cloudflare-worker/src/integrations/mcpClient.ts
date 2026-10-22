/**
 * D847 (#2468, #2404 part 1) — the Worker as an MCP client of any provider,
 * through one client. It generalises D840's Mercury-only client; Mercury is
 * its first user (`services/mercury/mcp.ts` is now a thin caller).
 *
 * This is the other direction from D784: `src/mcp/` is StudioOS's own MCP
 * server, which outside assistants call. This file calls a provider's MCP
 * server with a member's token. The two share no code and never import each
 * other.
 *
 * WHAT A PROVIDER MAY DO is its frozen record in `mcpProviders.ts`, and
 * nothing a server says can widen it:
 *  - every endpoint discovery finds must be https on the record's `hosts`,
 *    with no userinfo and no port;
 *  - a grant wider than `accepted_scopes` is refused and revoked, and a
 *    refresh that reports a wider scope marks the row `token_rejected`;
 *  - `callTool` refuses, before any request, a tool off `read_tools`, a tool
 *    the server does not list, a tool the server annotates as not read-only
 *    or destructive, a tool whose schema differs from its pin, and every
 *    write tool (they need #2400's ticket, which does not exist yet).
 *
 * TOOL DRIFT. Each session compares the server's `tools/list` against the
 * record. A listed tool off the record (`unknown`), a pinned tool whose
 * schema changed (`changed`), a read tool annotated as writing
 * (`annotated`) and a tool with an invalid `x-mcp-header` (`invalid`) are
 * never called and are logged as one `mcp_tool_drift` line: the tool names
 * (printable ones only) and why, never a description or a schema.
 *
 * REMOTE TEXT IS DATA. A tool's description is never read, kept or shown; a
 * tool's result is returned to the provider's typed reads, which keep named
 * fields only. Neither can add a tool, a scope or a host.
 *
 * TWO ERAS (spec `2026-07-28`, `basic/versioning.mdx`):
 *  - `legacy` (`2025-06-18`): `initialize`, the server's `Mcp-Session-Id`,
 *    `notifications/initialized`, then requests. Byte for byte what D840 sent.
 *  - `modern` (`2026-07-28`): stateless. Every request carries its version,
 *    client info and capabilities in `_meta`, and the headers
 *    `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` and `Mcp-Param-*`.
 *  - `auto` sends one modern `tools/list`. A 400, 404 or 405 without a
 *    recognized modern error (-32020 to -32022) falls back to `legacy`.
 *
 * LIMITS. Every POST counts against the record's budget, the probe and the
 * handshake included; a spent budget is `rate_limited` before the request.
 * Each POST and each body read has `MCP_DEADLINE_MS`, a session has
 * `MCP_SESSION_WALL_MS`, a body is capped at `MCP_MAX_BODY_BYTES` as it
 * streams (an OAuth body at `OAUTH_MAX_BODY_BYTES`), and a redirect is
 * refused, never followed, so a token never reaches another host.
 *
 * NOTHING CREDENTIAL-SHAPED is logged, returned or thrown: an error is a code
 * and a status, never a body, a token, a code or a verifier.
 *
 * NOT HERE (#2404 part 2): the sign-in routes, the `mcp` page kind's labels
 * and the client ID metadata documents. Mercury's sign-in keeps its own
 * routes and `services/mercury/oauth.ts`.
 */
import type { Env } from '../types';
import type { IntegrationRow } from './registry';
import type { McpProvider, McpRegistration } from './mcpProviders';
import { decryptCredentials, encryptCredentials, type CredentialBlob } from './secrets';
import { acquireRefreshLease } from './refreshLease';
import { decryptColumn, encryptColumn } from '../services/columnCipher';
import { DeadlineExceeded, withDeadline } from '../util/deadline';

export type McpFetch = (url: string, init: RequestInit) => Promise<Response>;

export const LEGACY_PROTOCOL_VERSION = '2025-06-18';
export const MODERN_PROTOCOL_VERSION = '2026-07-28';
export const MCP_DEADLINE_MS = 10_000;
export const MCP_SESSION_WALL_MS = 25_000;
export const MCP_MAX_BODY_BYTES = 2 * 1024 * 1024;
export const OAUTH_MAX_BODY_BYTES = 64 * 1024;
export const MAX_TOOL_PAGES = 5;
/** Refresh this long before the access token's expiry. */
export const REFRESH_EARLY_MS = 60_000;
export const MCP_AUTH_TYPE = 'oauth_mcp';
const CLIENT_INFO = Object.freeze({ name: 'Axal VC', version: '1.0.0' });
/** The JSON-RPC errors only a modern server sends: HeaderMismatch, MissingRequiredClientCapability, UnsupportedProtocolVersion. */
const MODERN_ERRORS = new Set([-32020, -32021, -32022]);

// ─────────────────────────────────────────────────────────── errors

export type McpClientErrorCode =
  | 'path_not_allowed' | 'redirect_refused' | 'unauthorized' | 'rate_limited' | 'timeout'
  | 'network_error' | 'http_error' | 'bad_json' | 'too_large' | 'scope_insufficient' | 'unsupported_protocol';

/** A failed MCP request: a code and a status, never a body. */
export class McpClientError extends Error {
  readonly code: McpClientErrorCode;
  readonly status: number | null;
  constructor(code: McpClientErrorCode, status: number | null = null) {
    super(`mcp_${code}${status == null ? '' : `_${status}`}`);
    this.name = 'McpClientError';
    this.code = code;
    this.status = status;
  }
}

export type McpOauthErrorCode =
  | 'discovery_failed' | 'metadata_refused' | 'registration_failed' | 'token_exchange_failed'
  | 'refresh_failed' | 'scope_refused' | 'issuer_mismatch' | 'timeout' | 'network_error';

/** A failed OAuth step: a code, never a body, a token or a URL with a secret in it. */
export class McpOauthError extends Error {
  readonly code: McpOauthErrorCode;
  readonly status: number | null;
  constructor(code: McpOauthErrorCode, status: number | null = null) {
    super(`mcp_oauth_${code}${status == null ? '' : `_${status}`}`);
    this.name = 'McpOauthError';
    this.code = code;
    this.status = status;
  }
}

// ─────────────────────────────────────────────────────────── shared helpers

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** https on one of `hosts` (the host itself or a subdomain), with no userinfo and no port. */
export function onProviderHosts(raw: unknown, hosts: readonly string[]): raw is string {
  if (typeof raw !== 'string') return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  return hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}

class BodyTooLarge extends Error {}

/** The body as text, counted as it streams; above `max` the read stops. */
async function readCapped(res: Response, max: number, ms: number): Promise<string> {
  const declared = Number(res.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > max) {
    try { await res.body?.cancel(); } catch { /* nothing to free */ }
    throw new BodyTooLarge();
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const work = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      size += value.byteLength;
      if (size > max) {
        try { await reader.cancel(); } catch { /* already closed */ }
        throw new BodyTooLarge();
      }
      chunks.push(value);
    }
  })();
  try {
    await withDeadline(work, ms, 'mcp_body');
  } catch (e) {
    if (e instanceof DeadlineExceeded) reader.cancel().catch(() => {});
    throw e;
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(out);
}

const sanitizedName = (v: unknown): string =>
  typeof v === 'string' && /^[A-Za-z0-9_.\-/]{1,64}$/.test(v) ? v : '(unprintable)';

// ─────────────────────────────────────────────────────────── tool results

/**
 * A tool result's data: `structuredContent` when given, else the first text
 * content parsed as JSON. A result marked `isError` is `http_error`; a modern
 * result that is not `complete` (it asks for input) is too.
 */
export function toolData(result: unknown): unknown {
  const r = obj(result);
  if (!r) throw new McpClientError('bad_json');
  if (r.resultType !== undefined && r.resultType !== 'complete') throw new McpClientError('http_error');
  if (r.isError === true) throw new McpClientError('http_error');
  if (r.structuredContent !== undefined && r.structuredContent !== null) return r.structuredContent;
  const content = Array.isArray(r.content) ? r.content : [];
  const first = content.map(obj).find((c) => c?.type === 'text' && typeof c.text === 'string');
  if (!first) throw new McpClientError('bad_json');
  try { return JSON.parse(first.text as string); } catch { throw new McpClientError('bad_json'); }
}

/** JSON with every object's keys sorted, so equal schemas print equal. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = obj(v);
  if (o) return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** A listed tool's fingerprint: SHA-256 of its input and output schemas. Descriptions are not part of it. */
export async function toolFingerprint(tool: { inputSchema?: unknown; outputSchema?: unknown }): Promise<string> {
  const text = canonical({ inputSchema: tool.inputSchema ?? null, outputSchema: tool.outputSchema ?? null });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─────────────────────────────────────────────────────────── x-mcp-header

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const SENTINEL = /^=\?base64\?.*\?=$/s;

interface HeaderParam { path: string[]; name: string }

/** Every `x-mcp-header` key anywhere in a schema. */
function countHeaderKeys(v: unknown): number {
  if (Array.isArray(v)) return v.reduce((n: number, x) => n + countHeaderKeys(x), 0);
  const o = obj(v);
  if (!o) return 0;
  return Object.entries(o).reduce((n, [k, x]) => n + (k === 'x-mcp-header' ? 1 : 0) + countHeaderKeys(x), 0);
}

/**
 * A tool's mirrored parameters (spec `streamable-http.mdx`, "Custom Headers
 * from Tool Parameters"), or null when an annotation breaks a rule: a header
 * name that is not a token or repeats, a non-primitive or `number` parameter,
 * or an annotation not reached through `properties` alone. Such a tool is
 * excluded from the session, as the spec requires.
 */
export function headerParams(inputSchema: unknown): HeaderParam[] | null {
  const found: HeaderParam[] = [];
  let ok = true;
  const walk = (node: unknown, path: string[]) => {
    const props = obj(obj(node)?.properties);
    if (!props) return;
    for (const [k, child] of Object.entries(props)) {
      const c = obj(child);
      if (!c) continue;
      if ('x-mcp-header' in c) {
        const name = c['x-mcp-header'];
        if (typeof name !== 'string' || !TOKEN.test(name) || !['string', 'integer', 'boolean'].includes(c.type as string)) ok = false;
        else found.push({ path: [...path, k], name });
      }
      walk(c, [...path, k]);
    }
  };
  walk(inputSchema, []);
  if (!ok || found.length !== countHeaderKeys(inputSchema)) return null;
  const names = found.map((p) => p.name.toLowerCase());
  if (new Set(names).size !== names.length) return null;
  return found;
}

/** A header value as the spec encodes it: plain when safe ASCII, else `=?base64?…?=`. */
export function headerValue(v: string): string {
  const plain = /^[\x21-\x7e](?:[\x20-\x7e\t]*[\x21-\x7e])?$/.test(v) && !SENTINEL.test(v);
  if (plain) return v;
  const bytes = new TextEncoder().encode(v);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `=?base64?${btoa(bin)}?=`;
}

function paramHeaders(params: readonly HeaderParam[], args: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of params) {
    let v: unknown = args;
    for (const k of p.path) v = obj(v)?.[k];
    if (v === undefined || v === null) continue;
    let s: string;
    if (typeof v === 'string') s = v;
    else if (typeof v === 'boolean') s = v ? 'true' : 'false';
    else if (typeof v === 'number' && Number.isSafeInteger(v)) s = String(v);
    else throw new McpClientError('path_not_allowed');
    out[`Mcp-Param-${p.name}`] = headerValue(s);
  }
  return out;
}

const RESERVED_HEADERS = new Set(['authorization', 'content-type', 'accept', 'content-length', 'host', 'cookie', 'mcp-session-id', 'mcp-protocol-version', 'mcp-method', 'mcp-name']);

/** The record's fixed headers, then a connection's own; refused before any request when a name or value is unsafe. */
function fixedHeaders(...sets: Array<Readonly<Record<string, string>> | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const set of sets) {
    for (const [name, value] of Object.entries(set ?? {})) {
      const lower = name.toLowerCase();
      if (!TOKEN.test(name) || RESERVED_HEADERS.has(lower) || lower.startsWith('mcp-param-')) throw new McpClientError('path_not_allowed');
      if (typeof value !== 'string' || !/^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/.test(value)) throw new McpClientError('path_not_allowed');
      out[name] = value;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────── the session

export type McpDriftReason = 'unknown' | 'changed' | 'annotated' | 'invalid';
export interface McpToolDrift { tool: string; why: McpDriftReason }

export interface McpSessionOptions {
  accessToken: string;
  fetcher?: McpFetch;
  /** One of the record's `resources`; default the first. */
  resource?: string;
  /** Lower than the record's budget only. */
  budget?: number;
  /** `auto` resolved by an earlier session (`config_json.era`). */
  era?: 'legacy' | 'modern';
  /** A connection's own headers, checked as the record's are. */
  headers?: Readonly<Record<string, string>>;
  /** Where the drift line goes; default `console.warn`. */
  log?: (line: string) => void;
}

export interface McpSession {
  readonly era: 'legacy' | 'modern';
  /** The listed read tools this server offers, after the record, the pins and the annotations. */
  readonly offered: readonly string[];
  /** What the server listed that is never called. */
  readonly drift: readonly McpToolDrift[];
  /** POSTs made so far, the probe and the handshake included. */
  readonly requests: number;
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
}

interface JsonRpcResponse { jsonrpc?: string; id?: unknown; result?: unknown; error?: unknown }

/** The JSON-RPC answer to request `id`, from a JSON body or an event stream; null when there is none. */
function answerFor(contentType: string, body: string, id: number): JsonRpcResponse | null {
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
    } catch { return null; }
  }
  for (const c of candidates) {
    const m = obj(c);
    if (m && m.id === id && ('result' in m || 'error' in m)) return m as JsonRpcResponse;
  }
  return null;
}

const errorCode = (answer: JsonRpcResponse | null): number | null => {
  const code = obj(answer?.error)?.code;
  return typeof code === 'number' ? code : null;
};

/** The legacy versions an UnsupportedProtocolVersion error lists. */
const legacyListed = (answer: JsonRpcResponse | null): boolean => {
  const supported = obj(obj(answer?.error)?.data)?.supported;
  return Array.isArray(supported) && supported.some((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && v < MODERN_PROTOCOL_VERSION);
};

/**
 * Open one session for `provider` as the member: the era, then every page of
 * `tools/list`, compared against the record.
 */
export async function openMcpSession(provider: McpProvider, opts: McpSessionOptions): Promise<McpSession> {
  const fetcher = opts.fetcher ?? fetch;
  const url = opts.resource ?? provider.resources[0];
  if (!provider.resources.includes(url) || !onProviderHosts(url, provider.hosts)) throw new McpClientError('path_not_allowed');
  const budget = Math.min(opts.budget ?? provider.budget, provider.budget);
  const fixed = fixedHeaders(provider.headers, opts.headers);
  const wallEnd = Date.now() + MCP_SESSION_WALL_MS;
  let requests = 0;
  let nextId = 1;
  let era: 'legacy' | 'modern' = opts.era ?? (provider.era === 'auto' ? 'modern' : provider.era);
  let sessionId: string | null = null;
  let protocol: string | null = null;

  const deadline = (): number => {
    const left = wallEnd - Date.now();
    if (left <= 0) throw new McpClientError('timeout');
    return Math.min(MCP_DEADLINE_MS, left);
  };

  /** One POST. A modern 400, 404 or 405 is returned for the caller to read when `probe` is set. */
  async function post(message: Record<string, unknown>, extra: Record<string, string> = {}, probe = false): Promise<Response> {
    if (requests >= budget) throw new McpClientError('rate_limited');
    const ms = deadline();
    requests += 1;
    const headers: Record<string, string> = {
      ...fixed,
      Authorization: `Bearer ${opts.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...extra,
    };
    if (era === 'legacy') {
      if (sessionId) headers['Mcp-Session-Id'] = sessionId;
      if (protocol) headers['MCP-Protocol-Version'] = protocol;
    }
    let res: Response;
    try {
      res = await withDeadline(fetcher(url, {
        method: 'POST', redirect: 'manual', headers, body: JSON.stringify({ jsonrpc: '2.0', ...message }),
      }), ms, 'mcp_post');
    } catch (e) {
      throw new McpClientError(e instanceof DeadlineExceeded ? 'timeout' : 'network_error');
    }
    if (res.status === 0 || (res.status >= 300 && res.status < 400)) throw new McpClientError('redirect_refused', res.status || null);
    if (res.status === 401) throw new McpClientError('unauthorized', 401);
    if (res.status === 403) {
      const challenge = res.headers.get('WWW-Authenticate') || '';
      throw new McpClientError(/error\s*=\s*"?insufficient_scope/i.test(challenge) ? 'scope_insufficient' : 'unauthorized', 403);
    }
    if (res.status === 429) throw new McpClientError('rate_limited', 429);
    if (probe && [400, 404, 405].includes(res.status)) return res;
    if (res.status === 400 && era === 'modern') return res;
    if (!res.ok) throw new McpClientError('http_error', res.status);
    return res;
  }

  async function bodyOf(res: Response): Promise<string> {
    try { return await readCapped(res, MCP_MAX_BODY_BYTES, deadline()); }
    catch (e) {
      if (e instanceof BodyTooLarge) throw new McpClientError('too_large', res.status);
      if (e instanceof McpClientError) throw e;
      throw new McpClientError(e instanceof DeadlineExceeded ? 'timeout' : 'network_error');
    }
  }

  function modernMeta(params: Record<string, unknown>): Record<string, unknown> {
    return {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
        'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    };
  }

  /** A request and its result. `probe` makes a non-modern refusal answer `null` (the server is legacy). */
  async function request(method: string, params: Record<string, unknown>, extra: Record<string, string> = {}, probe = false): Promise<unknown> {
    const id = nextId++;
    const modern = era === 'modern';
    const headers = modern ? { 'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION, 'Mcp-Method': method, ...extra } : {};
    const res = await post({ id, method, params: modern ? modernMeta(params) : params }, headers, probe);
    if (!modern) {
      const sid = res.headers.get('Mcp-Session-Id');
      if (sid && /^[\x21-\x7e]{1,256}$/.test(sid)) sessionId = sid;
    }
    const answer = answerFor(res.headers.get('Content-Type') || '', await bodyOf(res), id);
    if (!res.ok) {
      const code = errorCode(answer);
      if (probe && (code === null || !MODERN_ERRORS.has(code))) return null;
      if (code === -32022) {
        if (probe && legacyListed(answer)) return null;
        throw new McpClientError('unsupported_protocol', res.status);
      }
      throw new McpClientError('http_error', res.status);
    }
    if (!answer) throw new McpClientError('bad_json');
    if (answer.error !== undefined) throw new McpClientError('http_error', res.status);
    return answer.result;
  }

  async function initialize(): Promise<void> {
    era = 'legacy';
    const init = obj(await request('initialize', {
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { ...CLIENT_INFO },
    }));
    protocol = typeof init?.protocolVersion === 'string' && /^[0-9-]{1,20}$/.test(init.protocolVersion) ? init.protocolVersion : LEGACY_PROTOCOL_VERSION;
    await post({ method: 'notifications/initialized' });
  }

  // The era. `auto` probes with the first page of `tools/list`.
  let firstPage: Record<string, unknown> | null = null;
  if (era === 'legacy') {
    await initialize();
  } else if (provider.era === 'auto' && !opts.era) {
    const probed = await request('tools/list', {}, {}, true);
    if (probed === null) await initialize(); else firstPage = obj(probed);
  }

  const listed = new Map<string, Record<string, unknown>>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_TOOL_PAGES; page++) {
    const result = page === 0 && firstPage ? firstPage : obj(await request('tools/list', cursor ? { cursor } : {}));
    for (const t of Array.isArray(result?.tools) ? result!.tools as unknown[] : []) {
      const tool = obj(t);
      if (tool && typeof tool.name === 'string' && !listed.has(tool.name)) listed.set(tool.name, tool);
    }
    cursor = typeof result?.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
    if (!cursor) break;
  }

  const drift: McpToolDrift[] = [];
  const params = new Map<string, HeaderParam[]>();
  const offered: string[] = [];
  for (const name of listed.keys()) {
    if (!provider.read_tools.includes(name) && !provider.write_tools.includes(name)) drift.push({ tool: sanitizedName(name), why: 'unknown' });
  }
  for (const name of provider.read_tools) {
    const tool = listed.get(name);
    if (!tool) continue;
    const notes = obj(tool.annotations);
    if (notes?.readOnlyHint === false || notes?.destructiveHint === true) { drift.push({ tool: name, why: 'annotated' }); continue; }
    const mirrored = headerParams(tool.inputSchema);
    if (!mirrored) { drift.push({ tool: name, why: 'invalid' }); continue; }
    if (provider.tool_pins && provider.tool_pins[name] !== await toolFingerprint(tool)) { drift.push({ tool: name, why: 'changed' }); continue; }
    params.set(name, mirrored);
    offered.push(name);
  }
  if (drift.length) {
    const line = JSON.stringify({ event: 'mcp_tool_drift', provider: provider.key, tools: drift.slice(0, 50) });
    (opts.log ?? ((l: string) => console.warn(l)))(line);
  }
  const frozenOffered = Object.freeze(offered);

  return {
    get era() { return era; },
    offered: frozenOffered,
    drift: Object.freeze(drift),
    get requests() { return requests; },
    async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
      // Refused before any request: a write tool (no ticket exists yet), a name
      // off the record, or one this server does not offer as the record allows.
      if (provider.write_tools.includes(name) || !provider.read_tools.includes(name) || !frozenOffered.includes(name)) {
        throw new McpClientError('path_not_allowed');
      }
      const extra = era === 'modern' ? { 'Mcp-Name': headerValue(name), ...paramHeaders(params.get(name) ?? [], args) } : {};
      return toolData(await request('tools/call', { name, arguments: args }, extra));
    },
  };
}

// ─────────────────────────────────────────────────────────── OAuth

export interface McpAuthServer {
  issuer: string;
  resource: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string | null;
  revocation_endpoint: string | null;
  /** RFC 9207: the server says it sends `iss` on the authorization response. */
  iss_parameter_supported: boolean;
  /** The server accepts a client ID metadata document's URL as `client_id`. */
  cimd_supported: boolean;
}

async function oauthSend(fetcher: McpFetch, url: string, init: RequestInit, onFail: McpOauthErrorCode): Promise<{ status: number; body: Record<string, unknown> | null }> {
  let res: Response;
  try {
    res = await withDeadline(fetcher(url, { ...init, redirect: 'manual' }), MCP_DEADLINE_MS, 'mcp_oauth');
  } catch (e) {
    throw new McpOauthError(e instanceof DeadlineExceeded ? 'timeout' : 'network_error');
  }
  if (res.status === 0 || (res.status >= 300 && res.status < 400)) throw new McpOauthError(onFail, res.status || null);
  let body: Record<string, unknown> | null = null;
  try { body = obj(JSON.parse(await readCapped(res, OAUTH_MAX_BODY_BYTES, MCP_DEADLINE_MS))); }
  catch (e) {
    if (e instanceof BodyTooLarge) throw new McpOauthError(onFail, res.status);
    body = null;
  }
  return { status: res.status, body };
}

const getJson = (fetcher: McpFetch, url: string) =>
  oauthSend(fetcher, url, { method: 'GET', headers: { Accept: 'application/json' } }, 'discovery_failed');

/** RFC 9728's well-known URL for a resource with a path, then the host's own. */
function resourceMetadataUrls(resource: string): string[] {
  const u = new URL(resource);
  const path = u.pathname.replace(/\/+$/, '');
  return [...(path ? [`${u.origin}/.well-known/oauth-protected-resource${path}`] : []), `${u.origin}/.well-known/oauth-protected-resource`];
}

/** RFC 8414's well-known URL for an issuer (path inserted), then OpenID's. */
function serverMetadataUrls(issuer: string): string[] {
  const u = new URL(issuer);
  const path = u.pathname.replace(/\/+$/, '');
  return [`${u.origin}/.well-known/oauth-authorization-server${path}`, `${u.origin}/.well-known/openid-configuration${path}`];
}

/** `resource_metadata` from a 401's `WWW-Authenticate`, or null. */
export function resourceMetadataFrom(challenge: string | null | undefined): string | null {
  const m = /resource_metadata\s*=\s*"([^"]{1,2048})"/i.exec(challenge ?? '');
  return m ? m[1] : null;
}

/**
 * The authorization server for one of the provider's resources, checked:
 * protected-resource metadata (a 401's `resource_metadata` first, when on the
 * provider's hosts, then the well-known URLs), whose `resource` must be the
 * one asked for; then the server's metadata, whose issuer must be identical,
 * which must offer S256, and whose every endpoint must be on the hosts.
 */
export async function discoverMcp(provider: McpProvider, opts: { fetcher?: McpFetch; resource?: string; challenge?: string | null } = {}): Promise<McpAuthServer> {
  const fetcher = opts.fetcher ?? fetch;
  const resource = opts.resource ?? provider.resources[0];
  if (!provider.resources.includes(resource)) throw new McpOauthError('metadata_refused');
  const urls = resourceMetadataUrls(resource);
  const named = resourceMetadataFrom(opts.challenge);
  if (named && onProviderHosts(named, provider.hosts)) urls.unshift(named);
  let issuer: string | null = null;
  for (const url of urls) {
    const { status, body } = await getJson(fetcher, url);
    if (status !== 200 || !body) continue;
    if (body.resource !== resource) throw new McpOauthError('metadata_refused');
    const servers = Array.isArray(body.authorization_servers) ? body.authorization_servers : [];
    issuer = typeof servers[0] === 'string' ? servers[0] : null;
    break;
  }
  if (!issuer) throw new McpOauthError('discovery_failed');
  if (!onProviderHosts(issuer, provider.hosts)) throw new McpOauthError('metadata_refused');
  for (const url of serverMetadataUrls(issuer)) {
    const { status, body } = await getJson(fetcher, url);
    if (status !== 200 || !body) continue;
    const methods = Array.isArray(body.code_challenge_methods_supported) ? body.code_challenge_methods_supported : [];
    const optional = [body.registration_endpoint, body.revocation_endpoint].filter((v) => v != null);
    if (body.issuer !== issuer || !methods.includes('S256')) throw new McpOauthError('metadata_refused');
    if (![body.authorization_endpoint, body.token_endpoint, ...optional].every((v) => onProviderHosts(v, provider.hosts))) throw new McpOauthError('metadata_refused');
    return {
      issuer,
      resource,
      authorization_endpoint: body.authorization_endpoint as string,
      token_endpoint: body.token_endpoint as string,
      registration_endpoint: (body.registration_endpoint as string | undefined) ?? null,
      revocation_endpoint: (body.revocation_endpoint as string | undefined) ?? null,
      iss_parameter_supported: body.authorization_response_iss_parameter_supported === true,
      cimd_supported: body.client_id_metadata_document_supported === true,
    };
  }
  throw new McpOauthError('discovery_failed');
}

export interface McpRegisteredClient {
  /** Where the client is found again: `cimd:<url>`, `preregistered:<provider>`, or the DCR `platform_settings` key. */
  key: string;
  method: McpRegistration;
  issuer: string;
  client_id: string;
  client_secret: string | null;
  redirect_uri: string;
}

/** A pre-registered client's ID and secret (env first, then `provider_oauth_keys`), supplied by the provider's issue. */
export type McpPreregistered = () => Promise<{ client_id: string; client_secret: string | null } | null>;

export interface McpOauthOptions {
  fetcher?: McpFetch;
  preregistered?: McpPreregistered;
}

interface StoredClient { issuer: string; client_id: string; client_secret_enc: string | null; redirect_uri: string }

async function readStoredClient(env: Env, key: string): Promise<McpRegisteredClient | null> {
  const row = await env.DB.prepare('SELECT value FROM platform_settings WHERE key = ?').bind(key).first<{ value: string }>();
  if (!row) return null;
  let v: StoredClient;
  try { v = JSON.parse(row.value) as StoredClient; } catch { return null; }
  if (typeof v?.client_id !== 'string' || typeof v.issuer !== 'string') return null;
  const secret = v.client_secret_enc ? await decryptColumn(env, 'platform_settings', 'value', key, v.client_secret_enc) : null;
  return { key, method: 'dcr', issuer: v.issuer, client_id: v.client_id, client_secret: secret, redirect_uri: v.redirect_uri };
}

const CIMD_HOSTS = ['axal.vc'];

/** DCR (RFC 7591), once per provider and redirect URI; one made with another issuer is never used. */
async function dynamicClient(env: Env, provider: McpProvider, server: McpAuthServer, redirectUri: string, fetcher: McpFetch): Promise<McpRegisteredClient> {
  const key = `${provider.client_key_prefix}${redirectUri}`;
  const stored = await readStoredClient(env, key);
  if (stored && stored.issuer === server.issuer && stored.redirect_uri === redirectUri) return stored;
  if (!server.registration_endpoint) throw new McpOauthError('registration_failed');
  const { status, body } = await oauthSend(fetcher, server.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: CLIENT_INFO.name,
      application_type: 'web',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: provider.scopes.join(' '),
    }),
  }, 'registration_failed');
  const clientId = typeof body?.client_id === 'string' && /^[\x21-\x7e]{1,256}$/.test(body.client_id) ? body.client_id : null;
  if ((status !== 200 && status !== 201) || !clientId) throw new McpOauthError('registration_failed', status);
  const secret = typeof body?.client_secret === 'string' && body.client_secret ? body.client_secret : null;
  const value: StoredClient = {
    issuer: server.issuer, client_id: clientId, redirect_uri: redirectUri,
    client_secret_enc: secret ? await encryptColumn(env, 'platform_settings', 'value', key, secret) : null,
  };
  // The first registration for a redirect URI wins a race (the read-back returns it); one made with another issuer is replaced.
  if (stored) {
    await env.DB.prepare("UPDATE platform_settings SET value = ?, updated_at = CURRENT_TIMESTAMP, updated_by = 'd847_registration' WHERE key = ?")
      .bind(JSON.stringify(value), key).run();
  } else {
    await env.DB.prepare("INSERT OR IGNORE INTO platform_settings (key, value, updated_by) VALUES (?, ?, 'd847_registration')")
      .bind(key, JSON.stringify(value)).run();
  }
  return (await readStoredClient(env, key)) ?? { key, method: 'dcr', issuer: server.issuer, client_id: clientId, client_secret: secret, redirect_uri: redirectUri };
}

/**
 * This environment's client for `redirectUri`, in the record's order:
 * pre-registered, then a client ID metadata document when the server takes
 * one, then DCR when the server offers registration.
 */
export async function mcpClientFor(env: Env, provider: McpProvider, server: McpAuthServer, redirectUri: string, opts: McpOauthOptions = {}): Promise<McpRegisteredClient> {
  for (const method of provider.registration) {
    if (method === 'preregistered') {
      const creds = opts.preregistered ? await opts.preregistered() : null;
      if (creds?.client_id) return { key: `preregistered:${provider.key}`, method, issuer: server.issuer, client_id: creds.client_id, client_secret: creds.client_secret, redirect_uri: redirectUri };
    } else if (method === 'cimd') {
      if (server.cimd_supported && onProviderHosts(provider.cimd_url, CIMD_HOSTS)) {
        return { key: `cimd:${provider.cimd_url}`, method, issuer: server.issuer, client_id: provider.cimd_url!, client_secret: null, redirect_uri: redirectUri };
      }
    } else if (server.registration_endpoint) {
      return dynamicClient(env, provider, server, redirectUri, opts.fetcher ?? fetch);
    }
  }
  throw new McpOauthError('registration_failed');
}

/** The client a stored grant names, found again for a refresh or a revoke; null when it is gone or not this provider's. */
export async function resolveMcpClient(env: Env, provider: McpProvider, server: McpAuthServer, clientKey: string, opts: McpOauthOptions = {}): Promise<McpRegisteredClient | null> {
  if (clientKey === `preregistered:${provider.key}`) {
    const creds = opts.preregistered ? await opts.preregistered() : null;
    return creds?.client_id ? { key: clientKey, method: 'preregistered', issuer: server.issuer, client_id: creds.client_id, client_secret: creds.client_secret, redirect_uri: '' } : null;
  }
  if (provider.cimd_url && clientKey === `cimd:${provider.cimd_url}`) {
    return { key: clientKey, method: 'cimd', issuer: server.issuer, client_id: provider.cimd_url, client_secret: null, redirect_uri: '' };
  }
  if (!clientKey.startsWith(provider.client_key_prefix)) return null;
  const stored = await readStoredClient(env, clientKey);
  return stored && stored.issuer === server.issuer ? stored : null;
}

/** The URL the browser is sent to: PKCE S256, the record's scopes and the resource (RFC 8707). */
export function authorizeMcpUrl(provider: McpProvider, server: McpAuthServer, client: McpRegisteredClient, p: { state: string; challenge: string }): string {
  const u = new URL(server.authorization_endpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', client.client_id);
  u.searchParams.set('redirect_uri', client.redirect_uri);
  u.searchParams.set('scope', provider.scopes.join(' '));
  u.searchParams.set('state', p.state);
  u.searchParams.set('code_challenge', p.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('resource', server.resource);
  return u.toString();
}

/**
 * RFC 9207: the authorization response's `iss`. Required when the server says
 * it sends one; when present it must be byte-equal to the issuer recorded at
 * start. On false the callback acts on nothing, `error` included.
 */
export function issuerAccepted(server: Pick<McpAuthServer, 'iss_parameter_supported'>, expectedIssuer: string, iss: string | null | undefined): boolean {
  if (iss == null || iss === '') return !server.iss_parameter_supported;
  return iss === expectedIssuer;
}

/** The member's tokens as the row stores them, encrypted. Version 2 adds `v` and `resource`. */
export interface McpCredentials extends CredentialBlob {
  access_token: string;
  refresh_token?: string;
  /** Epoch milliseconds. */
  expires_at: number | null;
  scopes: string[];
  issuer: string;
  client_key: string;
  v?: 2;
  resource?: string;
}

export const grantOverreaches = (provider: McpProvider, scopes: readonly string[]): boolean =>
  scopes.some((s) => !provider.accepted_scopes.includes(s));

function tokenHeaders(client: McpRegisteredClient): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if (client.client_secret) h.Authorization = `Basic ${btoa(`${encodeURIComponent(client.client_id)}:${encodeURIComponent(client.client_secret)}`)}`;
  return h;
}

function toCredentials(provider: McpProvider, server: McpAuthServer, body: Record<string, unknown> | null, client: McpRegisteredClient, prior: McpCredentials | null, onFail: McpOauthErrorCode): McpCredentials {
  const access = typeof body?.access_token === 'string' && body.access_token ? body.access_token : null;
  if (!access) throw new McpOauthError(onFail);
  const expiresIn = typeof body?.expires_in === 'number' && Number.isFinite(body.expires_in) && body.expires_in > 0 ? body.expires_in : null;
  // RFC 6749 §5.1: an omitted scope is the scope requested (or, on a refresh, the scope held).
  const scopes = typeof body?.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean) : prior?.scopes ?? [...provider.scopes];
  return {
    access_token: access,
    refresh_token: typeof body?.refresh_token === 'string' && body.refresh_token ? body.refresh_token : prior?.refresh_token,
    expires_at: expiresIn ? Date.now() + expiresIn * 1000 : null,
    token_type: 'Bearer',
    scopes,
    issuer: client.issuer,
    client_key: client.key,
    v: 2,
    resource: server.resource,
  };
}

/** Revoke a grant's refresh and access tokens (RFC 7009), best effort. True when the server has an endpoint and accepted both. */
export async function revokeMcpTokens(server: McpAuthServer, client: McpRegisteredClient, creds: Pick<McpCredentials, 'access_token' | 'refresh_token'>, fetcher: McpFetch = fetch): Promise<boolean> {
  if (!server.revocation_endpoint) return false;
  let all = true;
  const tokens: Array<[string | undefined, 'refresh_token' | 'access_token']> = [[creds.refresh_token, 'refresh_token'], [creds.access_token, 'access_token']];
  for (const [token, hint] of tokens) {
    if (!token) continue;
    try {
      const form = new URLSearchParams({ token, token_type_hint: hint, client_id: client.client_id });
      const { status } = await oauthSend(fetcher, server.revocation_endpoint, { method: 'POST', headers: tokenHeaders(client), body: form.toString() }, 'network_error');
      if (status !== 200) all = false;
    } catch { all = false; }
  }
  return all;
}

/** The code and verifier for the member's tokens. A grant wider than `accepted_scopes` is revoked and refused. */
export async function exchangeMcpCode(provider: McpProvider, server: McpAuthServer, client: McpRegisteredClient, p: { code: string; verifier: string }, fetcher: McpFetch = fetch): Promise<McpCredentials> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code', code: p.code, redirect_uri: client.redirect_uri,
    client_id: client.client_id, code_verifier: p.verifier, resource: server.resource,
  });
  const { status, body } = await oauthSend(fetcher, server.token_endpoint, { method: 'POST', headers: tokenHeaders(client), body: form.toString() }, 'token_exchange_failed');
  if (status !== 200) throw new McpOauthError('token_exchange_failed', status);
  const creds = toCredentials(provider, server, body, client, null, 'token_exchange_failed');
  if (grantOverreaches(provider, creds.scopes)) {
    await revokeMcpTokens(server, client, creds, fetcher);
    throw new McpOauthError('scope_refused');
  }
  return creds;
}

/** The row's credentials when they are this provider's sign-in, else null. A blob without `v` is version 1, on the default resource. */
export async function mcpCredentialsOf(env: Env, provider: McpProvider, row: IntegrationRow): Promise<McpCredentials | null> {
  if (row.auth_type !== MCP_AUTH_TYPE || row.provider_key !== provider.key) return null;
  const c = await decryptCredentials(env, row.uid, row.credentials_enc);
  if (!c || typeof c.access_token !== 'string' || typeof c.client_key !== 'string') return null;
  const creds = c as McpCredentials;
  const resource = typeof creds.resource === 'string' && provider.resources.includes(creds.resource) ? creds.resource : provider.resources[0];
  return { ...creds, resource };
}

async function markRefreshRefused(env: Env, row: IntegrationRow): Promise<void> {
  await env.DB.prepare(
    "UPDATE integrations SET status = 'error', last_error = 'token_rejected', last_error_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).bind(row.id).run();
}

/** How a caller that lost the refresh lease waits for the winner's tokens (#1903's ~3 s poll). */
export const LEASE_POLLS = 6;
export const LEASE_POLL_MS = 500;

/**
 * New tokens from the refresh token, stored before they are used, behind the
 * record's lease. The winner re-reads the row first, in case another caller
 * already refreshed. A caller that loses the lease polls the row for the
 * winner's tokens and uses them; only if none arrive does it refresh itself.
 * Null when the server refuses the refresh or reports a wider scope (the row
 * is then `error` / `token_rejected`), or there is no refresh token. No
 * step-up: the client never asks for more.
 */
export async function refreshMcpCredentials(env: Env, provider: McpProvider, row: IntegrationRow, creds: McpCredentials, opts: McpOauthOptions = {}): Promise<McpCredentials | null> {
  if (!creds.refresh_token) return null;
  const fetcher = opts.fetcher ?? fetch;
  const lease = await acquireRefreshLease(env, provider.lease, row.uid);
  const reread = async (): Promise<McpCredentials | null> => {
    const again = await env.DB.prepare('SELECT * FROM integrations WHERE id = ?').bind(row.id).first<IntegrationRow>();
    const fresh = again ? await mcpCredentialsOf(env, provider, again) : null;
    return fresh && fresh.access_token !== creds.access_token ? fresh : null;
  };
  try {
    if (lease.acquired) {
      const fresh = await reread();
      if (fresh) return fresh;
    } else {
      for (let i = 0; i < LEASE_POLLS; i++) {
        await new Promise((r) => setTimeout(r, LEASE_POLL_MS));
        const fresh = await reread();
        if (fresh) return fresh;
      }
    }
    const server = await discoverMcp(provider, { fetcher, resource: creds.resource });
    const client = await resolveMcpClient(env, provider, server, creds.client_key, opts);
    if (!client) throw new McpOauthError('refresh_failed');
    const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: creds.refresh_token, client_id: client.client_id, resource: server.resource });
    const { status, body } = await oauthSend(fetcher, server.token_endpoint, { method: 'POST', headers: tokenHeaders(client), body: form.toString() }, 'refresh_failed');
    if (status === 400 || status === 401) { await markRefreshRefused(env, row); return null; }
    if (status !== 200) throw new McpOauthError('refresh_failed', status);
    const next = toCredentials(provider, server, body, client, creds, 'refresh_failed');
    if (grantOverreaches(provider, next.scopes)) { await markRefreshRefused(env, row); return null; }
    await env.DB.prepare('UPDATE integrations SET credentials_enc = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(await encryptCredentials(env, row.uid, next), row.id).run();
    return next;
  } finally {
    await lease.release();
  }
}

export interface McpAccess {
  accessToken: string;
  scopes: string[];
  resource: string;
  fetcher?: McpFetch;
  /** A fresh access token after a 401, or null. */
  refresh: () => Promise<string | null>;
}

/** The member's access for a provider's typed reads: refreshed first when about to expire, and `refresh` for a 401. */
export async function mcpAccessFor(env: Env, provider: McpProvider, row: IntegrationRow, creds: McpCredentials, opts: McpOauthOptions = {}): Promise<McpAccess> {
  let current = creds;
  if (current.expires_at != null && current.expires_at - REFRESH_EARLY_MS <= Date.now()) {
    const fresh = await refreshMcpCredentials(env, provider, row, current, opts);
    if (fresh) current = fresh;
  }
  return {
    accessToken: current.access_token,
    scopes: current.scopes,
    resource: current.resource ?? provider.resources[0],
    fetcher: opts.fetcher,
    refresh: async () => {
      const fresh = await refreshMcpCredentials(env, provider, row, current, opts);
      if (fresh) current = fresh;
      return fresh?.access_token ?? null;
    },
  };
}

/**
 * Revoke a member's sign-in: the provider's revocation endpoint when it has
 * one (best effort), then the stored tokens are deleted and the row is
 * `disconnected`, whatever the provider answered. `provider_revoked` is false
 * when the provider has no endpoint or refused; the page then says to remove
 * Axal VC in the provider's own settings.
 */
export async function revokeMcpConnection(env: Env, provider: McpProvider, row: IntegrationRow, opts: McpOauthOptions = {}): Promise<{ provider_revoked: boolean }> {
  let providerRevoked = false;
  let creds: McpCredentials | null = null;
  try { creds = await mcpCredentialsOf(env, provider, row); } catch { creds = null; }
  if (creds) {
    try {
      const fetcher = opts.fetcher ?? fetch;
      const server = await discoverMcp(provider, { fetcher, resource: creds.resource });
      const client = await resolveMcpClient(env, provider, server, creds.client_key, opts);
      if (client) providerRevoked = await revokeMcpTokens(server, client, creds, fetcher);
    } catch { providerRevoked = false; }
  }
  await env.DB.prepare(
    "UPDATE integrations SET credentials_enc = NULL, status = 'disconnected', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
  ).bind(row.id, row.user_id).run();
  return { provider_revoked: providerRevoked };
}
