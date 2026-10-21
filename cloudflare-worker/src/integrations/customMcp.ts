/**
 * D852 (#2475) — a remote MCP server a member adds by URL: configure, discover,
 * approve tools one by one, check health and revoke. Behind
 * `CUSTOM_MCP_ENABLED`, off unless set to `true`.
 *
 * It runs on D847's shared client (`mcpClient.ts`). A custom server is a
 * record built per connection (`customProvider`), never one of the frozen
 * `MCP_PROVIDERS`: its one resource is the URL the member pasted, its hosts
 * are that URL's host and its OAuth issuer's host, and its read tools are
 * exactly the tools the member approved, each pinned to the fingerprint of the
 * schema they approved. The client then refuses, before any request:
 *  - a tool the member has not approved;
 *  - an approved tool whose schema has changed since (`changed`: it needs
 *    approving again), or that the server now annotates as writing;
 *  - every write tool. Only a tool the server annotates read-only and not
 *    destructive can be approved in v1.
 *
 * SSRF. The pasted URL, and every URL the client then fetches (discovery,
 * registration, token, revocation, the MCP server), must be https on port
 * 443, a name and not an IP literal, off private suffixes (`localhost`,
 * `.local`, `.internal`, …) and off Axal's own hosts; and its host must be
 * one of the connection's hosts and resolve, by DNS over HTTPS, only to public
 * addresses. Private, loopback, link-local (169.254/16, the cloud metadata
 * address included), carrier-grade NAT, documentation, multicast and reserved
 * ranges, in IPv4 and IPv6 (mapped and NAT64 forms read as IPv4), are refused.
 * The check runs per host per request, through `guardedFetcher`, so a host
 * that starts resolving to a private address is refused on its next use.
 * Workers cannot pin the address `fetch` connects to, so a rebinding between
 * the lookup and the connection is not excluded here; Workers' egress does not
 * reach private networks either.
 *
 * CAPS. The client's: 10 s per request and per body, 25 s per session, 2 MiB
 * per MCP body and 64 KiB per OAuth body, no redirect followed, 12 requests
 * per session. This file adds 5 s and 64 KiB per DNS answer, 64 KiB per
 * protected-resource document, and 25 approved tools and 10 servers per member.
 *
 * REMOTE TEXT IS DATA. A tool's name, schema and the server's description are
 * shown to the member for approval, the description marked untrusted, cut to
 * 1,000 characters and stripped of control characters. None of it is ever
 * placed in an AI prompt as an instruction, and nothing a server says adds a
 * tool, a scope or a host. A tool's result is returned as `{ untrusted: true,
 * data }`.
 *
 * STORAGE. One `integrations` row per server: `provider_key = 'custom:<uid>'`,
 * `auth_type = 'oauth_mcp'`, the tokens encrypted as every connection's are,
 * and `config_json` holding `pattern: 'mcp'`, the URL, the hosts, the accepted
 * scopes and the approvals. Revoking calls the server's revocation endpoint
 * when it has one, then deletes the row and the connection's registered
 * client: nothing of it is kept.
 */
import type { Env } from '../types';
import type { IntegrationRow } from './registry';
import { mcpProvider, type McpProvider } from './mcpProviders';
import {
  authorizeMcpUrl, discoverMcp, exchangeMcpCode, mcpAccessFor, mcpClientFor, mcpCredentialsOf, McpClientError, openMcpSession,
  resolveMcpClient, revokeMcpConnection, toolFingerprint, MCP_AUTH_TYPE, MCP_DEADLINE_MS, MCP_MAX_BODY_BYTES,
  type McpAuthServer, type McpCredentials, type McpFetch, type McpRegisteredClient, type McpSession, type McpToolDrift,
} from './mcpClient';
import { DeadlineExceeded, withDeadline } from '../util/deadline';

export const CUSTOM_CALLBACK_PATH = '/api/connectors/custom/oauth/callback';
export const CUSTOM_STATE_PROVIDER = 'custom_mcp';
export const CUSTOM_LIMITS = Object.freeze({ servers: 10, approved: 25, budget: 12, description: 1000, tools: 200 });
const DNS_DEADLINE_MS = 5_000;
const SMALL_BODY_BYTES = 64 * 1024;
const DOH_URL = 'https://cloudflare-dns.com/dns-query';
/** Axal's own hosts: a custom server is never one of them or under one. */
export const AXAL_HOSTS = Object.freeze(['axal.vc']);

/** Whether custom connectors are on in this environment. */
export function customMcpEnabled(env: Pick<Env, 'CUSTOM_MCP_ENABLED'> | Record<string, unknown>): boolean {
  return String((env as Record<string, unknown>).CUSTOM_MCP_ENABLED ?? '').trim().toLowerCase() === 'true';
}

// ─────────────────────────────────────────────────────────── errors

export type CustomMcpErrorCode =
  | 'url_refused' | 'host_private' | 'host_unresolved' | 'discovery_failed' | 'not_found' | 'tool_not_listed'
  | 'tool_writes' | 'tool_not_approved' | 'too_many_tools' | 'unreachable' | 'unauthorized';

/** A refusal with a fixed code; never a URL, a body or a token. */
export class CustomMcpError extends Error {
  readonly code: CustomMcpErrorCode;
  readonly detail: string | null;
  constructor(code: CustomMcpErrorCode, detail: string | null = null) {
    super(`custom_mcp_${code}`);
    this.name = 'CustomMcpError';
    this.code = code;
    this.detail = detail;
  }
}

// ─────────────────────────────────────────────────────────── the URL

export type UrlRefusal = 'bad_url' | 'not_https' | 'userinfo' | 'port' | 'ip_literal' | 'private_name' | 'axal_host' | 'fragment' | 'query';

const PRIVATE_SUFFIXES = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home.arpa', 'corp', 'invalid', 'onion'];

/** Why a URL is refused before any lookup, or null. `ownHost` is the host this request came to. */
export function customUrlRefusal(raw: unknown, ownHost: string | null = null): UrlRefusal | null {
  if (typeof raw !== 'string' || !raw || raw.length > 2048) return 'bad_url';
  let u: URL;
  try { u = new URL(raw); } catch { return 'bad_url'; }
  if (u.protocol !== 'https:') return 'not_https';
  if (u.username || u.password) return 'userinfo';
  if (u.port && u.port !== '443') return 'port';
  if (u.hash) return 'fragment';
  // A query string could carry a key; nothing secret is kept in a connection's config or a log.
  if (u.search) return 'query';
  const host = u.hostname.toLowerCase();
  if (host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) return 'ip_literal';
  if (!host.includes('.') || PRIVATE_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) return 'private_name';
  const own = ownHost ? ownHost.toLowerCase().replace(/:\d+$/, '') : null;
  if ([...AXAL_HOSTS, ...(own ? [own] : [])].some((h) => host === h || host.endsWith(`.${h}`))) return 'axal_host';
  return null;
}

// ─────────────────────────────────────────────────────────── addresses

function v4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
  return parts.map(Number);
}

function v4Public([a, b, c]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;           // this net, private, loopback, multicast and reserved, broadcast
  if (a === 100 && b >= 64 && b <= 127) return false;                         // carrier-grade NAT
  if (a === 169 && b === 254) return false;                                   // link-local, the metadata address
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;             // IETF protocol assignments, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false;                      // benchmarking
  if (a === 198 && b === 51 && c === 100) return false;                       // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false;                        // TEST-NET-3
  return true;
}

/** An IPv6 address as eight 16-bit groups, or null. A dotted IPv4 tail becomes its two groups. */
function v6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  if (s.includes('%')) return null;
  const tail = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const f = v4(tail[2]);
    if (!f) return null;
    s = `${tail[1]}${((f[0] << 8) | f[1]).toString(16)}:${((f[2] << 8) | f[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (h: string) => (h ? h.split(':') : []);
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if (![...head, ...rest].every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const known = head.length + rest.length;
  if (halves.length === 1 ? known !== 8 : known > 7) return null;
  const fill = halves.length === 2 ? Array(8 - known).fill(0) : [];
  return [...head, ...fill.map(String), ...rest].map((g) => parseInt(g, 16));
}

/** Whether an address a host resolved to may be fetched: public unicast only. */
export function isPublicAddress(ip: string): boolean {
  const four = v4(ip);
  if (four) return v4Public(four);
  const g = v6(ip);
  if (!g) return false;
  if (g.every((x) => x === 0)) return false;                                  // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false;        // ::1
  const embedded = [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4Public(embedded);  // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return false;                      // IPv4-compatible (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b) return v4Public(embedded);            // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return false;                               // unique local, the metadata fd00:ec2::254 included
  if ((g[0] & 0xffc0) === 0xfe80) return false;                               // link-local
  if ((g[0] & 0xff00) === 0xff00) return false;                               // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false;                       // documentation
  if (g[0] === 0x2002) return v4Public([g[1] >> 8, g[1] & 0xff, g[2] >> 8, g[2] & 0xff]);  // 6to4
  return true;
}

/** Every address `host` resolves to (A and AAAA). Throws when it cannot be read. */
export type Resolver = (host: string) => Promise<string[]>;

/** DNS over HTTPS, read with a deadline and a size cap. */
export function dohResolver(fetcher: McpFetch = fetch): Resolver {
  return async (host: string) => {
    const out: string[] = [];
    for (const type of ['A', 'AAAA']) {
      const url = `${DOH_URL}?name=${encodeURIComponent(host)}&type=${type}`;
      const res = await withDeadline(fetcher(url, { method: 'GET', redirect: 'manual', headers: { Accept: 'application/dns-json' } }), DNS_DEADLINE_MS, 'custom_mcp_dns');
      if (!res.ok) throw new Error('dns_unreadable');
      const body = JSON.parse(await smallText(res));
      const want = type === 'A' ? 1 : 28;
      for (const a of Array.isArray(body?.Answer) ? body.Answer : []) {
        if (a?.type === want && typeof a.data === 'string') out.push(a.data);
      }
    }
    return out;
  };
}

/** A small body as text, refused above `SMALL_BODY_BYTES`. */
async function smallText(res: Response): Promise<string> {
  const declared = Number(res.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > SMALL_BODY_BYTES) throw new Error('too_large');
  const text = await withDeadline(res.text(), DNS_DEADLINE_MS, 'custom_mcp_body');
  if (text.length > SMALL_BODY_BYTES) throw new Error('too_large');
  return text;
}

/** `ok` when `host` resolves, and only to public addresses. */
export async function guardHost(host: string, resolve: Resolver): Promise<'ok' | 'host_private' | 'host_unresolved'> {
  let addresses: string[];
  try { addresses = await resolve(host); } catch { return 'host_unresolved'; }
  if (!addresses.length) return 'host_unresolved';
  return addresses.every(isPublicAddress) ? 'ok' : 'host_private';
}

/**
 * The fetcher the shared client is given for a custom server: every URL must
 * pass `customUrlRefusal`, sit on exactly one of `hosts`, and its host resolve
 * to public addresses only (checked once per host per call of this function).
 * A refused URL is never fetched; the client sees a network error. When
 * `capture` is given, `tools/list` answers are copied to it (read again with
 * the client's own cap), so the member can be shown what the server lists.
 */
export function guardedFetcher(hosts: readonly string[], resolve: Resolver, base: McpFetch = fetch, capture?: Array<Record<string, unknown>>, ownHost: string | null = null): McpFetch {
  const verdicts = new Map<string, Promise<string>>();
  return async (url: string, init: RequestInit) => {
    if (customUrlRefusal(url, ownHost)) throw new TypeError('custom_mcp_url_refused');
    const host = new URL(url).hostname.toLowerCase();
    if (!hosts.includes(host)) throw new TypeError('custom_mcp_host_refused');
    if (!verdicts.has(host)) verdicts.set(host, guardHost(host, resolve));
    if (await verdicts.get(host) !== 'ok') throw new TypeError('custom_mcp_host_refused');
    const res = await base(url, { ...init, redirect: 'manual' });
    if (capture && typeof init.body === 'string' && /"method"\s*:\s*"tools\/list"/.test(init.body) && res.ok) {
      try { capture.push(...listedTools(res.headers.get('Content-Type') || '', await cappedText(res.clone()))); } catch { /* unreadable: the client reports it */ }
    }
    return res;
  };
}

async function cappedText(res: Response): Promise<string> {
  const declared = Number(res.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MCP_MAX_BODY_BYTES) throw new Error('too_large');
  const text = await withDeadline(res.text(), MCP_DEADLINE_MS, 'custom_mcp_capture');
  if (text.length > MCP_MAX_BODY_BYTES) throw new Error('too_large');
  return text;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

/** The tools in a `tools/list` answer, from JSON or an event stream. */
function listedTools(contentType: string, body: string): Array<Record<string, unknown>> {
  const messages: unknown[] = [];
  if (/text\/event-stream/i.test(contentType)) {
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (data) { try { messages.push(JSON.parse(data)); } catch { /* skipped */ } }
    }
  } else {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) messages.push(...parsed); else messages.push(parsed);
  }
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    const tools = obj(obj(m)?.result)?.tools;
    if (Array.isArray(tools)) for (const t of tools) { const tool = obj(t); if (tool) out.push(tool); }
  }
  return out;
}

// ─────────────────────────────────────────────────────────── the record

export interface CustomConfig {
  pattern: 'mcp';
  url: string;
  hosts: string[];
  accepted_scopes: string[];
  /** Approved tool name → the fingerprint of the schema approved. */
  approved: Record<string, string>;
  era?: 'legacy' | 'modern';
  drift?: McpToolDrift[];
  checked_at?: string;
}

export const customKey = (uid: string) => `custom:${uid}`;
export const isConnectionUid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);

/** A connection's record: its URL, its hosts, its approved read tools pinned, and no write tool. */
export function customProvider(uid: string, cfg: Pick<CustomConfig, 'url' | 'hosts' | 'accepted_scopes' | 'approved' | 'era'>): McpProvider {
  const approved = cfg.approved ?? {};
  return mcpProvider({
    key: customKey(uid),
    resources: [cfg.url],
    hosts: cfg.hosts,
    scopes: [],
    accepted_scopes: cfg.accepted_scopes,
    read_tools: Object.keys(approved),
    write_tools: [],
    publish_issue: null,
    registration: ['dcr'],
    cimd_url: null,
    era: cfg.era ?? 'auto',
    budget: CUSTOM_LIMITS.budget,
    headers: {},
    session: 'per_request',
    tool_pins: { ...approved },
    lease: CUSTOM_STATE_PROVIDER,
    state_provider: CUSTOM_STATE_PROVIDER,
    client_key_prefix: `custom_mcp_client:${uid}:`,
    callback_path: CUSTOM_CALLBACK_PATH,
  });
}

export function configOf(row: Pick<IntegrationRow, 'config_json'>): CustomConfig | null {
  let c: unknown;
  try { c = JSON.parse(row.config_json || 'null'); } catch { return null; }
  const o = obj(c);
  if (!o || o.pattern !== 'mcp' || typeof o.url !== 'string' || !Array.isArray(o.hosts)) return null;
  return {
    pattern: 'mcp',
    url: o.url,
    hosts: (o.hosts as unknown[]).filter((h): h is string => typeof h === 'string'),
    accepted_scopes: Array.isArray(o.accepted_scopes) ? (o.accepted_scopes as unknown[]).filter((s): s is string => typeof s === 'string') : [],
    approved: Object.fromEntries(Object.entries(obj(o.approved) ?? {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
    era: o.era === 'legacy' || o.era === 'modern' ? o.era : undefined,
    drift: Array.isArray(o.drift) ? o.drift as McpToolDrift[] : undefined,
    checked_at: typeof o.checked_at === 'string' ? o.checked_at : undefined,
  };
}

// ─────────────────────────────────────────────────────────── sign-in

export interface CustomDeps {
  resolve?: Resolver;
  fetcher?: McpFetch;
  /** The host this request came to; never a custom server's. */
  ownHost?: string | null;
  log?: (line: string) => void;
}

const resolverOf = (deps: CustomDeps) => deps.resolve ?? dohResolver(deps.fetcher ?? fetch);

function hostOf(url: string): string { return new URL(url).hostname.toLowerCase(); }

/** RFC 9728's well-known URLs for the resource, path first. */
function resourceMetadataUrls(resource: string): string[] {
  const u = new URL(resource);
  const path = u.pathname.replace(/\/+$/, '');
  return [...(path ? [`${u.origin}/.well-known/oauth-protected-resource${path}`] : []), `${u.origin}/.well-known/oauth-protected-resource`];
}

/**
 * Configure: the URL is checked, its host resolved, its protected-resource
 * metadata read for the issuer and the scopes it supports, the issuer checked
 * the same way, then D847's discovery and registration run on the two hosts.
 */
export async function prepareCustomSignIn(env: Env, p: { url: string; uid: string; redirectUri: string }, deps: CustomDeps = {}): Promise<{
  provider: McpProvider; server: McpAuthServer; client: McpRegisteredClient; config: CustomConfig;
}> {
  const refusal = customUrlRefusal(p.url, deps.ownHost ?? null);
  if (refusal) throw new CustomMcpError('url_refused', refusal);
  const resolve = resolverOf(deps);
  const resHost = hostOf(p.url);
  const resVerdict = await guardHost(resHost, resolve);
  if (resVerdict !== 'ok') throw new CustomMcpError(resVerdict);
  const probe = guardedFetcher([resHost], resolve, deps.fetcher ?? fetch, undefined, deps.ownHost ?? null);
  let issuer: string | null = null;
  let scopes: string[] = [];
  for (const url of resourceMetadataUrls(p.url)) {
    let res: Response;
    try { res = await withDeadline(probe(url, { method: 'GET', headers: { Accept: 'application/json' } }), MCP_DEADLINE_MS, 'custom_mcp_meta'); }
    catch (e) { if (e instanceof DeadlineExceeded) throw new CustomMcpError('discovery_failed'); continue; }
    if (res.status !== 200) continue;
    let body: Record<string, unknown> | null = null;
    try { body = obj(JSON.parse(await smallText(res))); } catch { body = null; }
    if (!body || body.resource !== p.url) throw new CustomMcpError('discovery_failed');
    const servers = Array.isArray(body.authorization_servers) ? body.authorization_servers : [];
    issuer = typeof servers[0] === 'string' ? servers[0] : null;
    scopes = Array.isArray(body.scopes_supported) ? (body.scopes_supported as unknown[]).filter((s): s is string => typeof s === 'string' && /^[\x21-\x7e]{1,128}$/.test(s)).slice(0, 50) : [];
    break;
  }
  if (!issuer) throw new CustomMcpError('discovery_failed');
  const issuerRefusal = customUrlRefusal(issuer, deps.ownHost ?? null);
  if (issuerRefusal) throw new CustomMcpError('url_refused', `issuer_${issuerRefusal}`);
  const issuerHost = hostOf(issuer);
  const issuerVerdict = await guardHost(issuerHost, resolve);
  if (issuerVerdict !== 'ok') throw new CustomMcpError(issuerVerdict);
  const config: CustomConfig = {
    pattern: 'mcp',
    url: p.url,
    hosts: [...new Set([resHost, issuerHost])],
    accepted_scopes: [...new Set([...scopes, 'offline_access'])],
    approved: {},
  };
  const provider = customProvider(p.uid, config);
  const fetcher = guardedFetcher(config.hosts, resolve, deps.fetcher ?? fetch, undefined, deps.ownHost ?? null);
  let server: McpAuthServer;
  let client: McpRegisteredClient;
  try {
    server = await discoverMcp(provider, { fetcher });
    client = await mcpClientFor(env, provider, server, p.redirectUri, { fetcher });
  } catch {
    throw new CustomMcpError('discovery_failed');
  }
  return { provider, server, client, config };
}

export { authorizeMcpUrl, MCP_AUTH_TYPE };

/** The callback: the hosts checked again, the client found again by its key, and the code exchanged. */
export async function completeCustomSignIn(env: Env, p: { uid: string; config: CustomConfig; code: string; verifier: string; clientKey: string; redirectUri: string }, deps: CustomDeps = {}): Promise<McpCredentials> {
  if (customUrlRefusal(p.config.url, deps.ownHost ?? null)) throw new CustomMcpError('url_refused');
  const provider = customProvider(p.uid, p.config);
  const fetcher = guardedFetcher(p.config.hosts, resolverOf(deps), deps.fetcher ?? fetch, undefined, deps.ownHost ?? null);
  try {
    const server = await discoverMcp(provider, { fetcher });
    const client = await resolveMcpClient(env, provider, server, p.clientKey, { fetcher });
    if (!client || client.redirect_uri !== p.redirectUri) throw new CustomMcpError('discovery_failed');
    return await exchangeMcpCode(provider, server, client, { code: p.code, verifier: p.verifier }, fetcher);
  } catch (e) {
    if (e instanceof CustomMcpError) throw e;
    throw new CustomMcpError('unauthorized');
  }
}

// ─────────────────────────────────────────────────────────── a connection

/** A member's custom connection by its uid, or null. */
export async function customRowFor(env: Env, userId: number, uid: string): Promise<IntegrationRow | null> {
  if (!isConnectionUid(uid)) return null;
  return env.DB.prepare('SELECT * FROM integrations WHERE user_id = ? AND provider_key = ?').bind(userId, customKey(uid)).first<IntegrationRow>();
}

/** How many custom connections a member holds. */
export async function customCount(env: Env, userId: number): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM integrations WHERE user_id = ? AND provider_key LIKE 'custom:%'").bind(userId).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

async function saveConfig(env: Env, row: IntegrationRow, cfg: CustomConfig): Promise<void> {
  await env.DB.prepare('UPDATE integrations SET config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
    .bind(JSON.stringify(cfg), row.id, row.user_id).run();
}

interface Opened { cfg: CustomConfig; provider: McpProvider; session: McpSession; listed: Array<Record<string, unknown>> }

/** A session as the member, refreshed once on a 401; the listed tools captured when asked. */
async function openCustom(env: Env, row: IntegrationRow, deps: CustomDeps, captureList: boolean): Promise<Opened> {
  const cfg = configOf(row);
  const uid = row.provider_key.startsWith('custom:') ? row.provider_key.slice(7) : '';
  if (!cfg || !isConnectionUid(uid)) throw new CustomMcpError('not_found');
  const provider = customProvider(uid, cfg);
  const resolve = resolverOf(deps);
  const creds = await mcpCredentialsOf(env, provider, row);
  if (!creds) throw new CustomMcpError('unauthorized');
  const plainFetcher = guardedFetcher(cfg.hosts, resolve, deps.fetcher ?? fetch, undefined, deps.ownHost ?? null);
  const access = await mcpAccessFor(env, provider, row, creds, { fetcher: plainFetcher });
  const attempt = async (token: string) => {
    const listed: Array<Record<string, unknown>> = [];
    const fetcher = guardedFetcher(cfg.hosts, resolve, deps.fetcher ?? fetch, captureList ? listed : undefined, deps.ownHost ?? null);
    const session = await openMcpSession(provider, { accessToken: token, fetcher, era: cfg.era, log: deps.log });
    return { session, listed };
  };
  try {
    return { cfg, provider, ...(await attempt(access.accessToken)) };
  } catch (e) {
    if (!(e instanceof McpClientError) || e.code !== 'unauthorized') throw e instanceof McpClientError ? new CustomMcpError('unreachable', e.code) : e;
    const fresh = await access.refresh();
    if (!fresh) throw new CustomMcpError('unauthorized');
    try { return { cfg, provider, ...(await attempt(fresh)) }; }
    catch (again) { throw again instanceof McpClientError ? new CustomMcpError(again.code === 'unauthorized' ? 'unauthorized' : 'unreachable', again.code) : again; }
  }
}

const PRINTABLE_NAME = /^[A-Za-z0-9_.\-/]{1,64}$/;

/** The server's description as data: control characters removed, cut to the limit. */
export function untrustedText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const clean = v.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim();
  return clean ? clean.slice(0, CUSTOM_LIMITS.description) : null;
}

export interface CustomTool {
  name: string;
  /** The server's own words: untrusted, shown as data, never an instruction. */
  description: string | null;
  input_schema: unknown;
  output_schema: unknown;
  /** Annotated read-only and not destructive: the only tools that can be approved in v1. */
  read_only: boolean;
  fingerprint: string;
  approved: boolean;
  /** Approved, but its schema has changed since: approve it again to use it. */
  changed: boolean;
}

/** What the server lists, for the member to approve, each tool marked approved, changed or read-only. */
export async function listCustomTools(env: Env, row: IntegrationRow, deps: CustomDeps = {}): Promise<{ tools: CustomTool[]; drift: readonly McpToolDrift[]; untrusted: true }> {
  const { cfg, session, listed } = await openCustom(env, row, deps, true);
  const seen = new Set<string>();
  const tools: CustomTool[] = [];
  for (const t of listed) {
    const name = t.name;
    if (typeof name !== 'string' || !PRINTABLE_NAME.test(name) || seen.has(name) || tools.length >= CUSTOM_LIMITS.tools) continue;
    seen.add(name);
    const notes = obj(t.annotations);
    const fingerprint = await toolFingerprint(t as { inputSchema?: unknown; outputSchema?: unknown });
    const approved = Object.hasOwn(cfg.approved, name);
    tools.push({
      name,
      description: untrustedText(t.description),
      input_schema: t.inputSchema ?? null,
      output_schema: t.outputSchema ?? null,
      read_only: notes?.readOnlyHint === true && notes?.destructiveHint !== true,
      fingerprint,
      approved,
      changed: approved && cfg.approved[name] !== fingerprint,
    });
  }
  return { tools, drift: session.drift, untrusted: true };
}

/** Approve one tool: listed now, annotated read-only, pinned to the schema the member saw. */
export async function approveCustomTool(env: Env, row: IntegrationRow, name: string, deps: CustomDeps = {}): Promise<CustomConfig> {
  const { tools } = await listCustomTools(env, row, deps);
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new CustomMcpError('tool_not_listed');
  if (!tool.read_only) throw new CustomMcpError('tool_writes');
  const cfg = configOf(row)!;
  if (!Object.hasOwn(cfg.approved, name) && Object.keys(cfg.approved).length >= CUSTOM_LIMITS.approved) throw new CustomMcpError('too_many_tools');
  cfg.approved = { ...cfg.approved, [name]: tool.fingerprint };
  await saveConfig(env, row, cfg);
  return cfg;
}

/** Withdraw a tool's approval. No request is made. */
export async function unapproveCustomTool(env: Env, row: IntegrationRow, name: string): Promise<CustomConfig> {
  const cfg = configOf(row);
  if (!cfg) throw new CustomMcpError('not_found');
  const { [name]: _gone, ...rest } = cfg.approved;
  cfg.approved = rest;
  await saveConfig(env, row, cfg);
  return cfg;
}

/**
 * Call an approved read tool, for Eadwyn or a flow that the member set going;
 * never on its own. Refused before any request when the tool is not approved;
 * the client refuses it too when its schema changed or it is annotated as
 * writing. The result is data.
 */
export async function callCustomTool(env: Env, row: IntegrationRow, name: string, args: Record<string, unknown> = {}, deps: CustomDeps = {}): Promise<{ untrusted: true; data: unknown }> {
  if (!customMcpEnabled(env)) throw new CustomMcpError('not_found');
  const cfg = configOf(row);
  if (!cfg || !Object.hasOwn(cfg.approved, name)) throw new CustomMcpError('tool_not_approved');
  const { session } = await openCustom(env, row, deps, false);
  if (!session.offered.includes(name)) throw new CustomMcpError('tool_not_approved', 'changed');
  try {
    return { untrusted: true, data: await session.callTool(name, args) };
  } catch (e) {
    throw e instanceof McpClientError ? new CustomMcpError(e.code === 'path_not_allowed' ? 'tool_not_approved' : 'unreachable', e.code) : e;
  }
}

/**
 * Health and drift: one session, its era kept, and the approved tools it no
 * longer offers recorded (`changed` needs approving again). The row reads
 * `active` when every approved tool is offered, else `error` with
 * `mcp_tool_drift`; `unreachable` and `unauthorized` mark it `error` too.
 */
export async function checkCustomHealth(env: Env, row: IntegrationRow, deps: CustomDeps = {}): Promise<{ status: 'ok' | 'drift' | 'unreachable' | 'unauthorized'; drift: McpToolDrift[] }> {
  let opened: Opened;
  try {
    opened = await openCustom(env, row, deps, false);
  } catch (e) {
    const status = e instanceof CustomMcpError && e.code === 'unauthorized' ? 'unauthorized' : 'unreachable';
    await env.DB.prepare("UPDATE integrations SET status = 'error', last_error = ?, last_error_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?")
      .bind(status === 'unauthorized' ? 'token_rejected' : 'unreachable', row.id, row.user_id).run();
    return { status, drift: [] };
  }
  const { cfg, session } = opened;
  const approved = Object.keys(cfg.approved);
  const drift = session.drift.filter((d) => approved.includes(d.tool));
  for (const name of approved) {
    if (!session.offered.includes(name) && !drift.some((d) => d.tool === name)) drift.push({ tool: name, why: 'unknown' });
  }
  const next: CustomConfig = { ...cfg, era: session.era, drift, checked_at: new Date().toISOString() };
  await saveConfig(env, row, next);
  if (drift.length) {
    await env.DB.prepare("UPDATE integrations SET status = 'error', last_error = 'mcp_tool_drift', last_error_at = CURRENT_TIMESTAMP, last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?")
      .bind(row.id, row.user_id).run();
    return { status: 'drift', drift };
  }
  await env.DB.prepare("UPDATE integrations SET status = 'active', last_error = NULL, last_error_at = NULL, last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?")
    .bind(row.id, row.user_id).run();
  return { status: 'ok', drift: [] };
}

/**
 * Revoke: the server's revocation endpoint when it has one (best effort,
 * through the guard), then the row and this connection's registered client
 * are deleted. Nothing of the connection is kept.
 */
export async function revokeCustomConnection(env: Env, row: IntegrationRow, deps: CustomDeps = {}): Promise<{ provider_revoked: boolean }> {
  const cfg = configOf(row);
  const uid = row.provider_key.startsWith('custom:') ? row.provider_key.slice(7) : '';
  let providerRevoked = false;
  if (cfg && isConnectionUid(uid) && row.auth_type === MCP_AUTH_TYPE) {
    const provider = customProvider(uid, cfg);
    const fetcher = guardedFetcher(cfg.hosts, resolverOf(deps), deps.fetcher ?? fetch, undefined, deps.ownHost ?? null);
    try { providerRevoked = (await revokeMcpConnection(env, provider, row, { fetcher })).provider_revoked; } catch { providerRevoked = false; }
  }
  await env.DB.prepare('DELETE FROM integrations WHERE id = ? AND user_id = ?').bind(row.id, row.user_id).run();
  if (isConnectionUid(uid)) {
    await env.DB.prepare("DELETE FROM platform_settings WHERE key LIKE ? ESCAPE '\\'").bind(`custom\\_mcp\\_client:${uid}:%`).run();
  }
  return { provider_revoked: providerRevoked };
}
