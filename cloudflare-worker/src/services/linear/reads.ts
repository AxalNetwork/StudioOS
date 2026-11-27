/**
 * D855 §4 row 2 (#3733 part 1) — typed reads of a member's own Linear,
 * through Linear's read-only MCP server. THE INTERFACE LINEAR'S FEEDS USE:
 * nothing else opens a Linear MCP session (`linear_mcp_d855.test.ts` holds the
 * tree to that).
 *
 * READ-ONLY, FOUR TIMES OVER.
 *  1. LINEAR'S SERVER. The record's only resource is `/readonly`, which
 *     exposes no write tool.
 *  2. LINEAR'S GRANT. The sign-in asks for `read` and accepts nothing wider.
 *  3. THE RECORD AND THE SESSION. `MCP_PROVIDERS.linear` lists six read tools
 *     and no write tool, and `callTool` refuses any other name before a request.
 *  4. THIS FILE. Each read below calls one of those six names with arguments
 *     it builds itself; a caller passes values, never tool names.
 *
 * AN IDENTIFIER IS CHECKED BEFORE IT IS SENT. An issue is its key (`ENG-123`)
 * or a UUID; a project or team is a UUID, a team may also be its key (`ENG`).
 * Anything else (a URL, a path, a query) is refused as `bad_id` and nothing is
 * requested.
 *
 * ISSUE TEXT IS DATA. What a title, a description or a comment says is
 * returned as capped strings and acted on by nothing here: no instruction in
 * it is followed, no link in it is fetched, and no text is logged.
 *
 * UNVERIFIED until the first live sign-in (D855.md §7): each tool's argument
 * names (`query`, `team`, `limit`, `id`, `issueId`) and each answer's shape.
 * The parsers accept a structured answer or the text of one, and keep named
 * fields only.
 */
import { MCP_PROVIDERS } from '../../integrations/mcpProviders';
import {
  McpClientError, mcpAccessFor, mcpCredentialsOf, openMcpSession, type McpAccess, type McpFetch, type McpSession,
} from '../../integrations/mcpClient';
import { mcpPreregisteredFor } from '../../integrations/mcpSignIn';
import type { IntegrationRow } from '../../integrations/registry';
import type { Env } from '../../types';

const LINEAR = MCP_PROVIDERS.linear;

/** Linear's read-only MCP server, which a member's sign-in reads through. */
export const LINEAR_MCP_URL = 'https://mcp.linear.app/mcp/readonly';

/** The tools Axal VC may call: the record's `read_tools`. */
export const LINEAR_READ_TOOLS = LINEAR.read_tools;

/** The most items one list read asks for. */
export const MAX_LIST = 50;
/** The most of one description or comment body kept. */
export const MAX_BODY_CHARS = 20_000;

export type LinearReadErrorCode = 'not_connected' | 'bad_id' | 'unauthorized' | 'rate_limited' | 'not_allowed' | 'unreadable';

/** A read that failed: a code and a status, never a body or issue text. */
export class LinearReadError extends Error {
  readonly code: LinearReadErrorCode;
  readonly status: number | null;
  constructor(code: LinearReadErrorCode, status: number | null = null) {
    super(`linear_${code}`);
    this.name = 'LinearReadError';
    this.code = code;
    this.status = status;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISSUE_KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,9}-\d{1,7}$/;
const TEAM_KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,9}$/;

/** An issue as it is sent: its key (`ENG-123`) or a UUID. Anything else throws `bad_id`. */
export function issueId(raw: unknown): string {
  if (typeof raw !== 'string' || !(ISSUE_KEY_RE.test(raw) || UUID_RE.test(raw))) throw new LinearReadError('bad_id');
  return UUID_RE.test(raw) ? raw.toLowerCase() : raw.toUpperCase();
}

/** A project as it is sent: a UUID. */
export function projectId(raw: unknown): string {
  if (typeof raw !== 'string' || !UUID_RE.test(raw)) throw new LinearReadError('bad_id');
  return raw.toLowerCase();
}

/** A team as it is sent: its key (`ENG`) or a UUID. */
export function teamId(raw: unknown): string {
  if (typeof raw !== 'string' || !(TEAM_KEY_RE.test(raw) || UUID_RE.test(raw))) throw new LinearReadError('bad_id');
  return UUID_RE.test(raw) ? raw.toLowerCase() : raw.toUpperCase();
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const str = (v: unknown, max = 300): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};
/** An id read back from an answer: a UUID or an issue key, never trusted as a path. */
const idOf = (v: unknown): string | null => (typeof v === 'string' && (UUID_RE.test(v) || ISSUE_KEY_RE.test(v)) ? v : null);
/** An https URL on linear.app, or null; never fetched here. */
const linearUrl = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password && /(^|\.)linear\.app$/.test(u.hostname) ? u.toString() : null;
  } catch { return null; }
};
const stamp = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
const named = (v: unknown): string | null => str(obj(v)?.name ?? v, 120);
const listOf = (body: unknown, ...keys: string[]): unknown[] => {
  if (Array.isArray(body)) return body;
  const root = obj(body);
  for (const k of keys) if (Array.isArray(root?.[k])) return root![k] as unknown[];
  return [];
};
const CURSOR_RE = /^[A-Za-z0-9+/=_-]{1,200}$/;
/**
 * Where a list answer says the next page is: its cursor, and whether it said
 * there is no more. An answer that says neither leaves `done` to the caller.
 */
const pageOf = (body: unknown): { next: string | null; last: boolean | null } => {
  const o = obj(body);
  const info = obj(o?.pageInfo);
  const has = info?.hasNextPage ?? o?.hasNextPage;
  if (has === false) return { next: null, last: true };
  const c = info?.endCursor ?? o?.cursor ?? o?.nextCursor ?? o?.endCursor;
  return { next: typeof c === 'string' && CURSOR_RE.test(c) ? c : null, last: null };
};
const limitOf = (v: unknown): number => (Number.isSafeInteger(v) && (v as number) > 0 ? Math.min(v as number, MAX_LIST) : MAX_LIST);

export interface LinearIssue {
  id: string;
  identifier: string | null;
  title: string | null;
  state: string | null;
  priority: number | null;
  team: string | null;
  project: string | null;
  url: string | null;
  updated_at: string | null;
}
export interface LinearIssueDetail extends LinearIssue { description: string | null; labels: string[] }
export interface LinearComment { id: string; body: string | null; author: string | null; created_at: string | null }
export interface LinearProject { id: string; name: string | null; state: string | null; progress: number | null; target_date: string | null; url: string | null }
export interface LinearTeam { id: string; key: string | null; name: string | null }
/** D1601 (#3880): a completed issue as a deck counts it: its id and when it was completed, nothing else. */
export interface LinearCompleted { id: string; completed_at: string | null }
export interface LinearCompletedPage { issues: LinearCompleted[]; next: string | null; done: boolean }

function issueOf(v: unknown): LinearIssue | null {
  const o = obj(v);
  const id = idOf(o?.id);
  if (!o || !id) return null;
  const priority = typeof o.priority === 'number' && Number.isFinite(o.priority) ? o.priority : null;
  return {
    id,
    identifier: typeof o.identifier === 'string' && ISSUE_KEY_RE.test(o.identifier) ? o.identifier : null,
    title: str(o.title),
    state: named(o.state ?? o.status),
    priority,
    team: named(o.team),
    project: named(o.project),
    url: linearUrl(o.url),
    updated_at: stamp(o.updatedAt ?? o.updated_at),
  };
}

function projectOf(v: unknown): LinearProject | null {
  const o = obj(v);
  const id = idOf(o?.id);
  if (!o || !id) return null;
  const progress = typeof o.progress === 'number' && Number.isFinite(o.progress) ? o.progress : null;
  return {
    id, name: str(o.name), state: named(o.state ?? o.status), progress,
    target_date: stamp(o.targetDate ?? o.target_date), url: linearUrl(o.url),
  };
}

export interface LinearReads {
  /** The listed read tools this server offers. */
  readonly offered: readonly string[];
  /** Issues, newest first: optionally one team's, optionally matching `query`. */
  listIssues(opts?: { query?: string | null; team?: string | null; limit?: number }): Promise<LinearIssue[]>;
  /** One issue: its fields, labels and description. */
  getIssue(id: string): Promise<LinearIssueDetail>;
  /** One issue's comments. */
  listComments(issue: string): Promise<LinearComment[]>;
  /** The workspace's projects: the roadmap. */
  listProjects(opts?: { limit?: number }): Promise<LinearProject[]>;
  /** One project. */
  getProject(id: string): Promise<LinearProject>;
  /** The teams the grant can see. */
  listTeams(): Promise<LinearTeam[]>;
  /**
   * D1601 (#3880): one page of issues completed and updated within the last
   * `days`, as ids and completion dates only: no title, assignee or text is
   * kept. `next` is the cursor of the following page. `done` is true only
   * when the answer said it was the last page, or came back short of the cap
   * with no cursor; a full page with no cursor is not done.
   */
  listCompleted(opts: { days: number; cursor?: string | null }): Promise<LinearCompletedPage>;
}

/** The session's failures in this file's words; a body is never carried. */
function asReadError(e: unknown): unknown {
  if (e instanceof LinearReadError) return e;
  if (!(e instanceof McpClientError)) return e;
  if (e.code === 'unauthorized' || e.code === 'scope_insufficient') return new LinearReadError('unauthorized', e.status);
  if (e.code === 'rate_limited') return new LinearReadError('rate_limited', e.status);
  if (e.code === 'path_not_allowed') return new LinearReadError('not_allowed', e.status);
  return new LinearReadError('unreadable', e.status);
}

/** Open one session as the member; a 401 at open tries `refresh` once. */
export async function openLinearReads(access: McpAccess): Promise<LinearReads> {
  const open = (token: string) => openMcpSession(LINEAR, { accessToken: token, fetcher: access.fetcher, resource: access.resource });
  let session: McpSession;
  try {
    session = await open(access.accessToken);
  } catch (e) {
    if (!(e instanceof McpClientError && e.code === 'unauthorized')) throw asReadError(e);
    const fresh = await access.refresh();
    if (!fresh) throw new LinearReadError('unauthorized', e.status);
    try { session = await open(fresh); } catch (again) { throw asReadError(again); }
  }
  const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    try { return await session.callTool(name, args); } catch (e) { throw asReadError(e); }
  };

  return {
    offered: session.offered,

    async listIssues(opts = {}) {
      const query = typeof opts.query === 'string' ? opts.query.trim().slice(0, 200) : '';
      const team = opts.team == null ? null : teamId(opts.team);
      const body = await call('list_issues', { ...(query ? { query } : {}), ...(team ? { team } : {}), limit: limitOf(opts.limit) });
      return listOf(body, 'issues', 'nodes', 'results').map(issueOf).filter((i): i is LinearIssue => i !== null).slice(0, MAX_LIST);
    },

    async getIssue(raw) {
      const id = issueId(raw);
      const body = await call('get_issue', { id });
      const base = issueOf(body);
      if (!base) throw new LinearReadError('unreadable');
      const o = obj(body)!;
      const labels = listOf(o.labels, 'nodes').map(named).filter((l): l is string => l !== null).slice(0, 50);
      return { ...base, description: str(o.description, MAX_BODY_CHARS), labels };
    },

    async listComments(raw) {
      const issue = issueId(raw);
      const body = await call('list_comments', { issueId: issue });
      return listOf(body, 'comments', 'nodes', 'results').map((c) => {
        const o = obj(c);
        const id = idOf(o?.id);
        if (!o || !id) return null;
        return { id, body: str(o.body, MAX_BODY_CHARS), author: named(o.user ?? o.author), created_at: stamp(o.createdAt ?? o.created_at) };
      }).filter((c): c is LinearComment => c !== null).slice(0, MAX_LIST);
    },

    async listProjects(opts = {}) {
      const body = await call('list_projects', { limit: limitOf(opts.limit) });
      return listOf(body, 'projects', 'nodes', 'results').map(projectOf).filter((p): p is LinearProject => p !== null).slice(0, MAX_LIST);
    },

    async getProject(raw) {
      const id = projectId(raw);
      const project = projectOf(await call('get_project', { query: id }));
      if (!project) throw new LinearReadError('unreadable');
      return project;
    },

    async listTeams() {
      const body = await call('list_teams', {});
      return listOf(body, 'teams', 'nodes', 'results').map((t) => {
        const o = obj(t);
        const id = typeof o?.id === 'string' && UUID_RE.test(o.id) ? o.id : null;
        if (!o || !id) return null;
        return { id, key: typeof o.key === 'string' && TEAM_KEY_RE.test(o.key) ? o.key : null, name: str(o.name, 120) };
      }).filter((t): t is LinearTeam => t !== null).slice(0, MAX_LIST);
    },

    async listCompleted({ days, cursor }) {
      const span = Number.isSafeInteger(days) && days > 0 && days <= 366 ? days : 90;
      if (cursor != null && !(typeof cursor === 'string' && CURSOR_RE.test(cursor))) throw new LinearReadError('bad_id');
      const after = cursor ?? null;
      // UNVERIFIED (D1601.md): `state` takes a state type and `updatedAt` an ISO-8601 duration.
      const body = await call('list_issues', { state: 'completed', updatedAt: `-P${span}D`, includeArchived: true, limit: MAX_LIST, ...(after ? { cursor: after } : {}) });
      const rows = listOf(body, 'issues', 'nodes', 'results');
      const issues = rows.map((v) => {
        const o = obj(v);
        const id = idOf(o?.id);
        return o && id ? { id, completed_at: stamp(o.completedAt ?? o.completed_at) } : null;
      }).filter((i): i is LinearCompleted => i !== null).slice(0, MAX_LIST);
      const page = pageOf(body);
      return { issues, next: page.next, done: page.last ?? (!page.next && rows.length < MAX_LIST) };
    },
  };
}

/**
 * A member's connection's reads: their stored tokens (refreshed first when
 * about to expire), then one session. `not_connected` when the row is not a
 * Linear sign-in or holds no tokens.
 */
export async function linearReadsFor(env: Env, row: IntegrationRow, opts: { fetcher?: McpFetch } = {}): Promise<LinearReads> {
  const creds = await mcpCredentialsOf(env, LINEAR, row);
  if (!creds) throw new LinearReadError('not_connected');
  const access = await mcpAccessFor(env, LINEAR, row, creds, { fetcher: opts.fetcher, preregistered: mcpPreregisteredFor(env, LINEAR) });
  return openLinearReads(access);
}
