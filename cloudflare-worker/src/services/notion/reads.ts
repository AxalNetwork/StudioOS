/**
 * D1085 (#2950, #2405 part 1) — typed reads of a member's own Notion, through
 * Notion's hosted MCP server. THE INTERFACE NOTION'S PARTS USE: parts 2–6
 * read Notion through this file alone, and nothing else opens a Notion MCP
 * session (`notion_connection.test.ts` holds the tree to that).
 *
 * READ-ONLY, THREE TIMES OVER.
 *  1. THE RECORD. `MCP_PROVIDERS.notion` lists three read tools and no write
 *     tool. Notion's own grant reads and writes, so the record is the limit.
 *  2. THE SESSION. `callTool` refuses a name off the record, or one the
 *     server does not offer as the record allows, before any request.
 *  3. THIS FILE. Each read below calls one of those three names with
 *     arguments it builds itself. `queryRows` sends `mode: 'rows'` or
 *     `mode: 'view'` only: never SQL, whatever a caller passes.
 *
 * A NOTION ID IS CHECKED BEFORE IT IS SENT. Every id a caller passes must be
 * 32 hex digits, with or without the UUID dashes (`notionId`); anything else
 * (a URL, a path, an id with a query) is refused as `bad_id` and nothing is
 * requested.
 *
 * PAGE TEXT IS DATA. What a page, a title or a row says is returned as
 * strings and acted on by nothing here: no instruction in it is followed, no
 * link in it is fetched, and no text is logged. `fetchPage` computes the
 * page's fingerprint (SHA-256 of its Markdown), so later parts can tell when
 * a page changed without keeping a second copy.
 *
 * UNVERIFIED until the owner's first live sign-in (D1085.md §6): each tool's
 * argument names (`query`, `id`, `data_source_id`, `mode`, `view_id`,
 * `cursor`) and the shape of each answer. The parsers read the names Notion's
 * documentation gives and accept a structured answer or the text of one.
 */
import { MCP_PROVIDERS } from '../../integrations/mcpProviders';
import {
  McpClientError, mcpAccessFor, mcpCredentialsOf, openMcpSession, type McpAccess, type McpFetch, type McpSession,
} from '../../integrations/mcpClient';
import { mcpPreregisteredFor } from '../../integrations/mcpSignIn';
import type { IntegrationRow } from '../../integrations/registry';
import type { Env } from '../../types';

const NOTION = MCP_PROVIDERS.notion;

/** Notion's MCP server, which a member's sign-in reads through. */
export const NOTION_MCP_URL = 'https://mcp.notion.com/mcp';

/** The tools Axal VC may call: the record's `read_tools`. */
export const NOTION_READ_TOOLS = NOTION.read_tools;

/** The two query modes this file sends. SQL is never one of them. */
export const QUERY_MODES = Object.freeze(['rows', 'view'] as const);

/** The most of one page's Markdown kept. */
export const MAX_PAGE_CHARS = 200_000;

export type NotionReadErrorCode = 'not_connected' | 'bad_id' | 'unauthorized' | 'rate_limited' | 'not_allowed' | 'unreadable';

/** A read that failed: a code and a status, never a body or page text. */
export class NotionReadError extends Error {
  readonly code: NotionReadErrorCode;
  readonly status: number | null;
  constructor(code: NotionReadErrorCode, status: number | null = null) {
    super(`notion_${code}`);
    this.name = 'NotionReadError';
    this.code = code;
    this.status = status;
  }
}

const ID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** A Notion id as it is sent: 32 hex digits, with or without the UUID dashes. Anything else throws `bad_id`. */
export function notionId(raw: unknown): string {
  if (typeof raw !== 'string' || !ID_RE.test(raw)) throw new NotionReadError('bad_id');
  return raw.toLowerCase();
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const str = (v: unknown, max = 2000): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};
/** A Notion id read back from an answer, or null: never trusted as a path. */
const idOf = (v: unknown): string | null => (typeof v === 'string' && ID_RE.test(v) ? v.toLowerCase() : null);
/** An https URL on Notion's hosts, or null; never fetched here. */
const notionUrl = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && /(^|\.)notion\.(so|site|com)$/.test(u.hostname) ? u.toString() : null;
  } catch { return null; }
};
const stamp = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
const listOf = (body: unknown, ...keys: string[]): unknown[] => {
  if (Array.isArray(body)) return body;
  const root = obj(body);
  for (const k of keys) if (Array.isArray(root?.[k])) return root![k] as unknown[];
  return [];
};

export interface NotionSource { id: string; kind: 'page' | 'data_source' | 'database' | 'other'; title: string | null; url: string | null; last_edited: string | null }
export interface NotionPage { id: string; title: string | null; url: string | null; last_edited: string | null; markdown: string; fingerprint: string }
export interface NotionChild { id: string; kind: NotionSource['kind']; title: string | null }
export interface NotionProperty { name: string; type: string | null }
export interface NotionSchema { id: string; title: string | null; properties: NotionProperty[] }
export interface NotionRow { id: string; url: string | null; last_edited: string | null; properties: Record<string, string | number | boolean | null> }
export interface NotionRows { rows: NotionRow[]; next_cursor: string | null }

const kindOf = (v: unknown): NotionSource['kind'] => {
  const k = typeof v === 'string' ? v.toLowerCase().replace(/[\s-]+/g, '_') : '';
  return k === 'page' || k === 'data_source' || k === 'database' ? k : 'other';
};

function sourceOf(v: unknown): NotionSource | null {
  const o = obj(v);
  const id = idOf(o?.id);
  if (!o || !id) return null;
  return { id, kind: kindOf(o.type ?? o.object), title: str(o.title, 300), url: notionUrl(o.url), last_edited: stamp(o.last_edited_time ?? o.timestamp) };
}

/** A property's value as data: a string, a number, a boolean or null. Nested values become their text. */
function valueOf(v: unknown): string | number | boolean | null {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v.slice(0, 2000);
  if (Array.isArray(v)) return v.map((x) => valueOf(x)).filter((x) => x !== null).join(', ').slice(0, 2000) || null;
  return null;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface NotionReads {
  /** The listed read tools this server offers. */
  readonly offered: readonly string[];
  /** Pages and data sources whose title or text matches `q`. */
  searchSources(q: string): Promise<NotionSource[]>;
  /** One page: its Markdown, title, URL, last edit and fingerprint. */
  fetchPage(id: string): Promise<NotionPage>;
  /** The pages and data sources directly under a page. */
  listChildren(id: string): Promise<NotionChild[]>;
  /** A data source's properties, by name and type. */
  dataSourceSchema(id: string): Promise<NotionSchema>;
  /** A data source's rows, a page at a time: `mode: 'rows'`, or `mode: 'view'` with a view id. Never SQL. */
  queryRows(id: string, opts?: { cursor?: string | null; view?: string | null }): Promise<NotionRows>;
}

/** The session's failures in this file's words; a body is never carried. */
function asReadError(e: unknown): unknown {
  if (e instanceof NotionReadError) return e;
  if (!(e instanceof McpClientError)) return e;
  if (e.code === 'unauthorized' || e.code === 'scope_insufficient') return new NotionReadError('unauthorized', e.status);
  if (e.code === 'rate_limited') return new NotionReadError('rate_limited', e.status);
  if (e.code === 'path_not_allowed') return new NotionReadError('not_allowed', e.status);
  return new NotionReadError('unreadable', e.status);
}

/** Open one session as the member; a 401 at open tries `refresh` once. */
export async function openNotionReads(access: McpAccess): Promise<NotionReads> {
  const open = (token: string) => openMcpSession(NOTION, { accessToken: token, fetcher: access.fetcher, resource: access.resource });
  let session: McpSession;
  try {
    session = await open(access.accessToken);
  } catch (e) {
    if (!(e instanceof McpClientError && e.code === 'unauthorized')) throw asReadError(e);
    const fresh = await access.refresh();
    if (!fresh) throw new NotionReadError('unauthorized', e.status);
    try { session = await open(fresh); } catch (again) { throw asReadError(again); }
  }
  const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    try { return await session.callTool(name, args); } catch (e) { throw asReadError(e); }
  };

  return {
    offered: session.offered,

    async searchSources(q) {
      const query = typeof q === 'string' ? q.trim().slice(0, 200) : '';
      const body = await call('notion-search', { query });
      return listOf(body, 'results', 'items').map(sourceOf).filter((s): s is NotionSource => s !== null);
    },

    async fetchPage(raw) {
      const id = notionId(raw);
      const body = await call('notion-fetch', { id });
      const o = obj(body);
      // The page's text exactly as Notion sent it (capped, never trimmed): the fingerprint is over these bytes.
      const sent = typeof body === 'string' ? body : [o?.text, o?.markdown, o?.content].find((v) => typeof v === 'string');
      const markdown = typeof sent === 'string' ? sent.slice(0, MAX_PAGE_CHARS) : '';
      return {
        id: idOf(o?.id) ?? id,
        title: str(o?.title, 300),
        url: notionUrl(o?.url),
        last_edited: stamp(o?.last_edited_time ?? o?.timestamp),
        markdown,
        fingerprint: await sha256Hex(markdown),
      };
    },

    async listChildren(raw) {
      const id = notionId(raw);
      const body = await call('notion-fetch', { id });
      return listOf(obj(body)?.children ?? [], 'results').map((c) => {
        const s = sourceOf(c);
        return s ? { id: s.id, kind: s.kind, title: s.title } : null;
      }).filter((c): c is NotionChild => c !== null);
    },

    async dataSourceSchema(raw) {
      const id = notionId(raw);
      const body = await call('notion-fetch', { id });
      const o = obj(body);
      const props = obj(o?.schema ?? o?.properties) ?? {};
      return {
        id: idOf(o?.id) ?? id,
        title: str(o?.title, 300),
        properties: Object.entries(props).slice(0, 200).map(([name, p]) => ({ name: name.slice(0, 200), type: str(obj(p)?.type ?? p, 60) })),
      };
    },

    async queryRows(raw, opts = {}) {
      const id = notionId(raw);
      const view = opts.view == null ? null : notionId(opts.view);
      const cursor = typeof opts.cursor === 'string' && /^[\x21-\x7e]{1,256}$/.test(opts.cursor) ? opts.cursor : null;
      const mode: (typeof QUERY_MODES)[number] = view ? 'view' : 'rows';
      const body = await call('notion-query-data-sources', {
        data_source_id: id, mode, ...(view ? { view_id: view } : {}), ...(cursor ? { cursor } : {}),
      });
      const o = obj(body);
      const rows = listOf(body, 'results', 'rows').map((r) => {
        const x = obj(r);
        const rid = idOf(x?.id);
        if (!x || !rid) return null;
        const props: Record<string, string | number | boolean | null> = {};
        for (const [k, v] of Object.entries(obj(x.properties) ?? {}).slice(0, 200)) props[k.slice(0, 200)] = valueOf(v);
        return { id: rid, url: notionUrl(x.url), last_edited: stamp(x.last_edited_time), properties: props };
      }).filter((r): r is NotionRow => r !== null);
      const next = o?.next_cursor;
      return { rows, next_cursor: typeof next === 'string' && /^[\x21-\x7e]{1,256}$/.test(next) && o?.has_more !== false ? next : null };
    },
  };
}

/**
 * A member's connection's reads: their stored tokens (refreshed first when
 * about to expire), then one session. `not_connected` when the row is not a
 * Notion sign-in or holds no tokens.
 */
export async function notionReadsFor(env: Env, row: IntegrationRow, opts: { fetcher?: McpFetch } = {}): Promise<NotionReads> {
  const creds = await mcpCredentialsOf(env, NOTION, row);
  if (!creds) throw new NotionReadError('not_connected');
  const access = await mcpAccessFor(env, NOTION, row, creds, { fetcher: opts.fetcher, preregistered: mcpPreregisteredFor(env, NOTION) });
  return openNotionReads(access);
}
