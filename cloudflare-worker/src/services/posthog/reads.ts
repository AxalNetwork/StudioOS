/**
 * D1385 (#3731, #2409 part 1) — typed reads of a founder's own PostHog,
 * through PostHog's hosted MCP server. THE INTERFACE POSTHOG'S PARTS USE:
 * parts 2–6 read PostHog through this file alone, and nothing else opens a
 * PostHog MCP session (`posthog_connection.test.ts` holds the tree to that).
 *
 * READ ONLY, FOUR TIMES OVER.
 *  1. THE RECORD. `MCP_PROVIDERS.posthog` lists 19 read tools and no write
 *     tool, no `exec`, no `execute-sql` and no person list.
 *  2. POSTHOG ITSELF. Every request carries `x-posthog-read-only: true`
 *     (the record's fixed header), which removes PostHog's write tools.
 *  3. THE SESSION. `callTool` refuses a name off the record, or one the
 *     server does not offer as the record allows, before any request.
 *  4. THIS FILE. Each read calls one of those names with arguments it builds
 *     itself. A query read takes only its own kind of query (a trends read
 *     sends a `TrendsQuery` and nothing else), never HogQL or SQL.
 *
 * ONE PROJECT. `posthogReadsFor` pins the venture's linked project with the
 * connection's own `x-posthog-project-id` header, digits only. Without one
 * only the organisation and project lists are meaningful.
 *
 * NO PERSON LEAVES THIS FILE. Every answer is scrubbed before it is returned:
 * `distinct_id`, `session_id`, person and actor fields, emails and IP
 * addresses are dropped at any depth (`scrub`). A survey response keeps its
 * answers and its time, never who gave it. Answers are data: nothing in them
 * is followed, fetched or logged.
 *
 * UNVERIFIED until the owner's first live sign-in (D1385.md §4): each tool's
 * argument names and the shape of each answer. The parsers read the names
 * PostHog's MCP source gives and accept a structured answer or its text.
 */
import { MCP_PROVIDERS } from '../../integrations/mcpProviders';
import {
  McpClientError, mcpAccessFor, mcpCredentialsOf, openMcpSession, type McpAccess, type McpFetch, type McpSession,
} from '../../integrations/mcpClient';
import { mcpPreregisteredFor } from '../../integrations/mcpSignIn';
import type { IntegrationRow } from '../../integrations/registry';
import type { Env } from '../../types';

const POSTHOG = MCP_PROVIDERS.posthog;

/** PostHog's MCP server, which a member's sign-in reads through. */
export const POSTHOG_MCP_URL = 'https://mcp.posthog.com/mcp';

/** The tools Axal VC may call: the record's `read_tools`. */
export const POSTHOG_READ_TOOLS = POSTHOG.read_tools;

/** The fetch a test stubs PostHog with; the routes take it without importing the client. */
export type PosthogFetch = McpFetch;

/** The connection's own header that pins one project. */
export const PROJECT_HEADER = 'x-posthog-project-id';

/** The query kinds each query read sends; nothing else, and never HogQL. */
export const QUERY_KINDS = Object.freeze({
  'query-trends': 'TrendsQuery',
  'query-funnel': 'FunnelsQuery',
  'query-retention': 'RetentionQuery',
  'query-lifecycle': 'LifecycleQuery',
} as const);

/** The largest query a caller may pass, as JSON. */
export const MAX_QUERY_BYTES = 8_000;
/** The most rows of any list kept. */
export const MAX_ROWS = 200;

export type PosthogReadErrorCode = 'not_connected' | 'bad_id' | 'bad_query' | 'unauthorized' | 'rate_limited' | 'not_allowed' | 'unreadable';

/** A read that failed: a code and a status, never a body or an answer. */
export class PosthogReadError extends Error {
  readonly code: PosthogReadErrorCode;
  readonly status: number | null;
  constructor(code: PosthogReadErrorCode, status: number | null = null) {
    super(`posthog_${code}`);
    this.name = 'PosthogReadError';
    this.code = code;
    this.status = status;
  }
}

/** A PostHog project id: digits only. */
export const PROJECT_ID_RE = /^[0-9]{1,18}$/;
/** Any other PostHog id (an insight short id, an experiment, survey or flag id): letters, digits, `-` and `_`. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** An id as it is sent; anything else throws `bad_id` and nothing is requested. */
export function posthogId(raw: unknown): string {
  const v = typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? String(raw) : raw;
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new PosthogReadError('bad_id');
  return v;
}

export function posthogProjectId(raw: unknown): string {
  const v = typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 ? String(raw) : raw;
  if (typeof v !== 'string' || !PROJECT_ID_RE.test(v)) throw new PosthogReadError('bad_id');
  return v;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const str = (v: unknown, max = 300): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};
const idOf = (v: unknown): string | null => {
  const s = typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : v;
  return typeof s === 'string' && ID_RE.test(s) ? s : null;
};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const stamp = (v: unknown): string | null => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);
const listOf = (body: unknown, ...keys: string[]): unknown[] => {
  const list = Array.isArray(body) ? body : (() => {
    const root = obj(body);
    for (const k of keys) if (Array.isArray(root?.[k])) return root![k] as unknown[];
    return [];
  })();
  return list.slice(0, MAX_ROWS);
};

/** The keys that name a person or a visit: dropped at any depth. */
const PERSON_KEY = /^(\$?distinct_ids?|\$?session_ids?|\$?person(s|_id|_ids|_properties)?|actors?|\$?email|emails|\$?ip|\$?user_id|uuid_person)$/i;
const MAX_DEPTH = 8;

/**
 * An answer with every person and visit identifier removed, strings capped
 * and lists cut to `MAX_ROWS`. What is left is aggregates and the founder's
 * own definitions.
 */
export function scrub(v: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return null;
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v.slice(0, 2000);
  if (Array.isArray(v)) return v.slice(0, MAX_ROWS).map((x) => scrub(x, depth + 1));
  const o = obj(v);
  if (!o) return null;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o).slice(0, 200)) {
    if (PERSON_KEY.test(k)) continue;
    out[k.slice(0, 120)] = scrub(x, depth + 1);
  }
  return out;
}

/** A caller's query, kept to its own kind and size; anything else throws `bad_query`. */
function queryOf(tool: keyof typeof QUERY_KINDS, raw: unknown): Record<string, unknown> {
  const q = obj(raw);
  if (!q) throw new PosthogReadError('bad_query');
  const kind = QUERY_KINDS[tool];
  if (q.kind !== undefined && q.kind !== kind) throw new PosthogReadError('bad_query');
  let json: string;
  try { json = JSON.stringify({ ...q, kind }); } catch { throw new PosthogReadError('bad_query'); }
  if (json.length > MAX_QUERY_BYTES || /HogQL|"query"\s*:\s*"/i.test(json)) throw new PosthogReadError('bad_query');
  return JSON.parse(json) as Record<string, unknown>;
}

export interface PosthogOrganization { id: string; name: string | null }
export interface PosthogProject { id: string; name: string | null; organization_id: string | null; region: 'US' | 'EU' | null }
export interface PosthogInsight { short_id: string; name: string | null; kind: string | null; last_refresh: string | null }
export interface PosthogExperiment { id: string; name: string | null; feature_flag_key: string | null; start_date: string | null; end_date: string | null }
export interface PosthogSurvey { id: string; name: string | null; type: string | null; start_date: string | null; end_date: string | null }
export interface PosthogSurveyResponse { at: string | null; answers: Record<string, string | number | null> }
export interface PosthogFlag { id: string; key: string | null; name: string | null; active: boolean | null; rollout_percentage: number | null }

const regionOf = (v: unknown): PosthogProject['region'] => {
  const s = typeof v === 'string' ? v.toUpperCase() : '';
  return s === 'US' || s === 'EU' ? s : null;
};

export interface PosthogReads {
  /** The listed read tools this server offers. */
  readonly offered: readonly string[];
  /** The member's organisations. */
  organizations(): Promise<PosthogOrganization[]>;
  /** The projects the member can open, for the venture's picker. */
  projects(): Promise<PosthogProject[]>;
  /** The project's saved insights, without results. */
  insights(search?: string): Promise<PosthogInsight[]>;
  /** One saved insight's definition, scrubbed. */
  insight(shortId: string): Promise<{ short_id: string; name: string | null; kind: string | null; definition: unknown }>;
  /** One saved insight's results, scrubbed. */
  runInsight(shortId: string): Promise<unknown>;
  /** A query of the read's own kind, scrubbed. */
  trends(query: Record<string, unknown>): Promise<unknown>;
  funnel(query: Record<string, unknown>): Promise<unknown>;
  retention(query: Record<string, unknown>): Promise<unknown>;
  lifecycle(query: Record<string, unknown>): Promise<unknown>;
  /** Visitors, pageviews, sessions, session length and bounce rate for a window. */
  webOverview(window: { date_from: string; date_to?: string | null }): Promise<unknown>;
  experiments(): Promise<PosthogExperiment[]>;
  experiment(id: string): Promise<PosthogExperiment | null>;
  experimentResults(id: string): Promise<unknown>;
  surveys(): Promise<PosthogSurvey[]>;
  survey(id: string): Promise<{ survey: PosthogSurvey | null; questions: Array<{ id: string | null; text: string | null; type: string | null }> }>;
  surveyStats(id: string): Promise<unknown>;
  /** A survey's answers and their times; never who gave them. */
  surveyResponses(id: string): Promise<PosthogSurveyResponse[]>;
  flags(): Promise<PosthogFlag[]>;
  flag(id: string): Promise<PosthogFlag | null>;
}

/** The session's failures in this file's words; a body is never carried. */
function asReadError(e: unknown): unknown {
  if (e instanceof PosthogReadError) return e;
  if (!(e instanceof McpClientError)) return e;
  if (e.code === 'unauthorized' || e.code === 'scope_insufficient') return new PosthogReadError('unauthorized', e.status);
  if (e.code === 'rate_limited') return new PosthogReadError('rate_limited', e.status);
  if (e.code === 'path_not_allowed') return new PosthogReadError('not_allowed', e.status);
  return new PosthogReadError('unreadable', e.status);
}

const DAY = /^\d{4}-\d{2}-\d{2}$|^-\d{1,3}[dwmy]$/;

function experimentOf(v: unknown): PosthogExperiment | null {
  const o = obj(v);
  const id = idOf(o?.id);
  if (!o || !id) return null;
  return { id, name: str(o.name), feature_flag_key: str(o.feature_flag_key, 200), start_date: stamp(o.start_date), end_date: stamp(o.end_date) };
}
function surveyOf(v: unknown): PosthogSurvey | null {
  const o = obj(v);
  const id = idOf(o?.id);
  if (!o || !id) return null;
  return { id, name: str(o.name), type: str(o.type, 60), start_date: stamp(o.start_date), end_date: stamp(o.end_date) };
}
function flagOf(v: unknown): PosthogFlag | null {
  const o = obj(v);
  const id = idOf(o?.id);
  if (!o || !id) return null;
  const groups = listOf(obj(o.filters)?.groups);
  const pct = num(obj(groups[0])?.rollout_percentage) ?? num(o.rollout_percentage);
  return { id, key: str(o.key, 200), name: str(o.name), active: typeof o.active === 'boolean' ? o.active : null, rollout_percentage: pct };
}

/**
 * Open one session as the member; a 401 at open tries `refresh` once.
 * `projectId`, when given, pins the session to that project.
 */
export async function openPosthogReads(access: McpAccess, opts: { projectId?: string | null } = {}): Promise<PosthogReads> {
  const headers = opts.projectId == null ? undefined : { [PROJECT_HEADER]: posthogProjectId(opts.projectId) };
  const open = (token: string) => openMcpSession(POSTHOG, { accessToken: token, fetcher: access.fetcher, resource: access.resource, headers });
  let session: McpSession;
  try {
    session = await open(access.accessToken);
  } catch (e) {
    if (!(e instanceof McpClientError && e.code === 'unauthorized')) throw asReadError(e);
    const fresh = await access.refresh();
    if (!fresh) throw new PosthogReadError('unauthorized', e.status);
    try { session = await open(fresh); } catch (again) { throw asReadError(again); }
  }
  const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    try { return await session.callTool(name, args); } catch (e) { throw asReadError(e); }
  };

  return {
    offered: session.offered,

    async organizations() {
      const body = await call('organizations-get', {});
      return listOf(body, 'results', 'organizations').map((v) => {
        const o = obj(v);
        const id = typeof o?.id === 'string' && ID_RE.test(o.id) ? o.id : null;
        return id ? { id, name: str(o?.name) } : null;
      }).filter((v): v is PosthogOrganization => v !== null);
    },

    async projects() {
      const body = await call('projects-get', {});
      return listOf(body, 'results', 'projects').map((v) => {
        const o = obj(v);
        const id = (() => { try { return posthogProjectId(o?.id); } catch { return null; } })();
        if (!o || !id) return null;
        const org = o.organization ?? o.organization_id;
        return { id, name: str(o.name), organization_id: typeof org === 'string' && ID_RE.test(org) ? org : null, region: regionOf(o.region ?? o.cloud) };
      }).filter((v): v is PosthogProject => v !== null);
    },

    async insights(search) {
      const q = typeof search === 'string' ? search.trim().slice(0, 100) : '';
      const body = await call('insights-list', q ? { search: q } : {});
      return listOf(body, 'results', 'insights').map((v) => {
        const o = obj(v);
        const short = idOf(o?.short_id);
        if (!o || !short) return null;
        return { short_id: short, name: str(o.name ?? o.derived_name), kind: str(obj(obj(o.query)?.source)?.kind ?? obj(o.query)?.kind, 60), last_refresh: stamp(o.last_refresh) };
      }).filter((v): v is PosthogInsight => v !== null);
    },

    async insight(raw) {
      const shortId = posthogId(raw);
      const o = obj(await call('insight-get', { insightId: shortId }));
      return {
        short_id: idOf(o?.short_id) ?? shortId,
        name: str(o?.name ?? o?.derived_name),
        kind: str(obj(obj(o?.query)?.source)?.kind ?? obj(o?.query)?.kind, 60),
        definition: scrub(o?.query ?? null),
      };
    },

    async runInsight(raw) {
      return scrub(await call('insight-query', { insightId: posthogId(raw) }));
    },

    async trends(q) { return scrub(await call('query-trends', { query: queryOf('query-trends', q) })); },
    async funnel(q) { return scrub(await call('query-funnel', { query: queryOf('query-funnel', q) })); },
    async retention(q) { return scrub(await call('query-retention', { query: queryOf('query-retention', q) })); },
    async lifecycle(q) { return scrub(await call('query-lifecycle', { query: queryOf('query-lifecycle', q) })); },

    async webOverview(window) {
      const from = typeof window?.date_from === 'string' && DAY.test(window.date_from) ? window.date_from : null;
      const to = window?.date_to == null ? null : (typeof window.date_to === 'string' && DAY.test(window.date_to) ? window.date_to : undefined);
      if (!from || to === undefined) throw new PosthogReadError('bad_query');
      return scrub(await call('query-web-overview', { dateRange: { date_from: from, ...(to ? { date_to: to } : {}) } }));
    },

    async experiments() {
      return listOf(await call('experiment-list', {}), 'results', 'experiments').map(experimentOf).filter((v): v is PosthogExperiment => v !== null);
    },
    async experiment(raw) {
      return experimentOf(await call('experiment-get', { experimentId: posthogId(raw) }));
    },
    async experimentResults(raw) {
      return scrub(await call('experiment-results-get', { experimentId: posthogId(raw) }));
    },

    async surveys() {
      return listOf(await call('surveys-get-all', {}), 'results', 'surveys').map(surveyOf).filter((v): v is PosthogSurvey => v !== null);
    },
    async survey(raw) {
      const o = obj(await call('survey-get', { surveyId: posthogId(raw) }));
      return {
        survey: surveyOf(o),
        questions: listOf(o?.questions).map((q) => {
          const x = obj(q);
          return { id: idOf(x?.id), text: str(x?.question, 500), type: str(x?.type, 60) };
        }),
      };
    },
    async surveyStats(raw) {
      return scrub(await call('survey-stats', { surveyId: posthogId(raw) }));
    },
    async surveyResponses(raw) {
      const body = await call('surveys-responses-list', { surveyId: posthogId(raw) });
      return listOf(body, 'results', 'responses').map((r) => {
        const x = obj(scrub(r));
        if (!x) return null;
        const answers: Record<string, string | number | null> = {};
        const src = obj(x.answers) ?? obj(x.properties) ?? {};
        for (const [k, v] of Object.entries(src).slice(0, 50)) {
          if (!/^\$survey_response(_[A-Za-z0-9-]{1,64})?$|^[A-Za-z0-9_-]{1,64}$/.test(k)) continue;
          answers[k] = typeof v === 'string' ? v.slice(0, 2000) : typeof v === 'number' && Number.isFinite(v) ? v : null;
        }
        return { at: stamp(x.timestamp ?? x.created_at), answers };
      }).filter((v): v is PosthogSurveyResponse => v !== null);
    },

    async flags() {
      return listOf(await call('feature-flag-get-all', {}), 'results', 'flags').map(flagOf).filter((v): v is PosthogFlag => v !== null);
    },
    async flag(raw) {
      return flagOf(await call('feature-flag-get-definition', { flagId: posthogId(raw) }));
    },
  };
}

/**
 * A member's connection's reads: their stored tokens (refreshed first when
 * about to expire), then one session, pinned to `projectId` when given.
 * `not_connected` when the row is not a PostHog sign-in or holds no tokens.
 */
export async function posthogReadsFor(
  env: Env, row: IntegrationRow, opts: { fetcher?: McpFetch; projectId?: string | null } = {},
): Promise<PosthogReads> {
  const creds = await mcpCredentialsOf(env, POSTHOG, row);
  if (!creds) throw new PosthogReadError('not_connected');
  const access = await mcpAccessFor(env, POSTHOG, row, creds, { fetcher: opts.fetcher, preregistered: mcpPreregisteredFor(env, POSTHOG) });
  return openPosthogReads(access, { projectId: opts.projectId ?? null });
}
