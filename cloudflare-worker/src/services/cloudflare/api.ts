/**
 * D855 §4 row 5 (#3733 part 2) — a member's own Cloudflare, read-only, through
 * Cloudflare's REST API (pattern C), never through an MCP server.
 *
 * WHY NOT MCP. On 2026-10-31 Cloudflare marked its Workers Builds and Workers
 * Observability MCP servers deprecated and points to the Cloudflare API MCP
 * server at `https://mcp.cloudflare.com/mcp`, whose `execute()` runs generated
 * code against any endpoint a grant allows. The owner chose (2026-11-01, #3733)
 * to read the REST API directly, as GitHub and Stripe are read.
 *
 * THE ONLY TRANSPORT. Every call is one of the seven reads below, on
 * `https://api.cloudflare.com/client/v4`, with the member's bearer token. No
 * URL is built from anything but this base, a fixed path and identifiers
 * checked against their own shape before they are sent. Nothing here writes:
 * the three Observability calls are POSTs only because Cloudflare's telemetry
 * query takes its query as a body, and that body is built here, never taken
 * from a caller.
 *
 * WHAT COMES BACK IS DATA, NAMED FIELDS ONLY. A build keeps its id, status,
 * outcome, times, branch and commit; never its environment variables, build
 * command, author or token id. An event keeps its time, level, status, trigger
 * and error, each cut short; never its URL, which may carry a query string.
 * A log line keeps its time and text, cut short.
 *
 * ERRORS ARE CODES. A failed answer's body is read only for Cloudflare's
 * numeric error codes, never its messages. A 429, or the throttle code 971,
 * is `rate_limited`: Cloudflare then blocks the token for five minutes
 * (D855 §3.9), so `retry_after` is the answer's `Retry-After`, else 300.
 */

export const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

/**
 * The OAuth scopes a Cloudflare grant may carry, every one a read. They are
 * the scopes Cloudflare's own Workers Builds and Workers Observability servers
 * asked for (cloudflare/mcp-server-cloudflare, read 2026-11-01).
 * `offline_access` is accepted when granted but is optional; the required
 * read scopes below do not require a refresh grant.
 */
export const CLOUDFLARE_READ_SCOPES = Object.freeze([
  'user:read',
  'account:read',
  'workers:read',
  'workers_builds:read',
  'workers_observability:read',
  'offline_access',
] as const);

/** The scopes a grant must carry for every read here to answer. */
export const CLOUDFLARE_REQUIRED_SCOPES = Object.freeze([
  'account:read', 'workers:read', 'workers_builds:read', 'workers_observability:read',
] as const);

/** Seconds Cloudflare blocks a token that went over its limit (1,200 requests in 5 minutes, D855 §3.9). */
export const CLOUDFLARE_BLOCK_SECONDS = 300;
/** Cloudflare's own code for "please wait and consider throttling your request speed". */
export const CLOUDFLARE_THROTTLE_CODE = 971;

const DEADLINE_MS = 10_000;
const MAX_BODY_BYTES = 2_000_000;
/** Pages of build log read at most; a longer log says `truncated`. */
export const MAX_LOG_PAGES = 5;
export const MAX_LOG_LINES = 2_000;
/** The furthest back an Observability read looks: Workers Logs keep 7 days on the paid plan. */
export const MAX_HOURS = 72;

export class CloudflareError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly retry_after: number | null;
  // Fields are declared, not parameter properties: Node's strip-only TypeScript cannot run those.
  constructor(code: string, status: number | null = null, retryAfter: number | null = null) {
    super(code);
    this.name = 'CloudflareError';
    this.code = code;
    this.status = status;
    this.retry_after = retryAfter;
  }
}

// ───────────────────────────────────────────────────────────── identifiers

const ACCOUNT = /^[0-9a-f]{32}$/;
const TAG = /^[0-9a-f]{32}$/;
const SCRIPT = /^[a-z0-9_-]{1,63}$/;
const BUILD = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CURSOR = /^[A-Za-z0-9_=-]{1,512}$/;

function checked(pattern: RegExp, value: unknown): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new CloudflareError('bad_id', 400);
  return value;
}
export const checkAccount = (v: unknown) => checked(ACCOUNT, v);
export const checkWorkerTag = (v: unknown) => checked(TAG, v);
export const checkScript = (v: unknown) => checked(SCRIPT, v);
export const checkBuild = (v: unknown) => checked(BUILD, v);

// ───────────────────────────────────────────────────────────── grant

/**
 * A grant's scopes, held to the read list: every scope in `CLOUDFLARE_READ_SCOPES`
 * and the four `CLOUDFLARE_REQUIRED_SCOPES` present. Anything else, a write or
 * an edit included, is overreach and the grant is refused.
 */
export function checkGrantedScopes(granted: string | readonly string[] | null | undefined):
  { ok: true; scopes: string[] } | { ok: false; error: 'scope_overreach' | 'scope_insufficient'; extra: string[] } {
  const list = (typeof granted === 'string' ? granted.split(/\s+/) : [...(granted ?? [])]).map((s) => String(s).trim()).filter(Boolean);
  const allowed = new Set<string>(CLOUDFLARE_READ_SCOPES);
  const extra = list.filter((s) => !allowed.has(s));
  if (extra.length) return { ok: false, error: 'scope_overreach', extra };
  const missing = CLOUDFLARE_REQUIRED_SCOPES.filter((s) => !list.includes(s));
  if (missing.length) return { ok: false, error: 'scope_insufficient', extra: [] };
  return { ok: true, scopes: [...new Set(list)].sort() };
}

// ───────────────────────────────────────────────────────────── transport

const clip = (v: unknown, n: number): string | null => (typeof v === 'string' && v ? v.slice(0, n) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isoOf = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return new Date(v).toISOString();
  if (typeof v === 'string' && v) { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; }
  return null;
};

async function boundedText(r: Response): Promise<string> {
  const reader = r.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new CloudflareError('response_too_large', r.status); }
    chunks.push(value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const c of chunks) { body.set(c, offset); offset += c.byteLength; }
  return new TextDecoder().decode(body);
}

/** Cloudflare's numeric error codes from a v4 envelope; never a message. */
export function errorCodesOf(body: unknown): number[] {
  const errors = (body as { errors?: unknown } | null)?.errors;
  return Array.isArray(errors) ? errors.map((e) => (e as { code?: unknown })?.code).filter((c): c is number => typeof c === 'number') : [];
}

/** A failed answer as one error: a spent limit, a refused token, or its status. */
export function errorOf(status: number, codes: number[], retryAfterHeader: string | null): CloudflareError {
  if (status === 429 || codes.includes(CLOUDFLARE_THROTTLE_CODE)) {
    const header = retryAfterHeader != null && /^\d{1,5}$/.test(retryAfterHeader) ? Number(retryAfterHeader) : null;
    return new CloudflareError('rate_limited', status, header ?? CLOUDFLARE_BLOCK_SECONDS);
  }
  if (status === 401 || status === 403) return new CloudflareError('unauthorized', status);
  if (status === 404) return new CloudflareError('not_found', status);
  return new CloudflareError('api_failed', status);
}

export interface CloudflareEnvelope { result: unknown; result_info: Record<string, unknown> | null }

/** One call. `path` is a fixed path with checked identifiers; `body` is built in this file. */
async function call(token: string, method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<CloudflareEnvelope> {
  if (!token) throw new CloudflareError('not_connected');
  let r: Response;
  try {
    r = await fetch(`${CLOUDFLARE_API}${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(DEADLINE_MS),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new CloudflareError('network_error');
  }
  const text = await boundedText(r);
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (!r.ok) throw errorOf(r.status, errorCodesOf(parsed), r.headers.get('Retry-After'));
  const env = parsed as { success?: unknown; result?: unknown; result_info?: unknown } | null;
  if (!env || env.success !== true) {
    const codes = errorCodesOf(parsed);
    if (codes.includes(CLOUDFLARE_THROTTLE_CODE)) throw errorOf(429, codes, r.headers.get('Retry-After'));
    throw new CloudflareError('invalid_response', r.status);
  }
  const info = env.result_info && typeof env.result_info === 'object' ? env.result_info as Record<string, unknown> : null;
  return { result: env.result, result_info: info };
}

// ───────────────────────────────────────────────────────────── parsers

export interface AccountView { id: string; name: string | null }
export interface WorkerView { name: string; tag: string; modified_at: string | null }
export interface BuildView {
  id: string; status: string | null; outcome: string | null;
  created_at: string | null; started_at: string | null; stopped_at: string | null;
  branch: string | null; commit: string | null; commit_message: string | null; repository: string | null; source: string | null;
}
export interface LogLineView { at: string | null; text: string }
export interface EventView { at: string | null; level: string | null; status_code: number | null; trigger: string | null; error: string | null }

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function accountOf(v: unknown): AccountView | null {
  const a = v as Record<string, unknown> | null;
  if (!a || typeof a.id !== 'string' || !ACCOUNT.test(a.id)) return null;
  return { id: a.id, name: clip(a.name, 200) };
}

export function workerOf(v: unknown): WorkerView | null {
  const w = v as Record<string, unknown> | null;
  if (!w || typeof w.id !== 'string' || !SCRIPT.test(w.id) || typeof w.tag !== 'string' || !TAG.test(w.tag)) return null;
  return { name: w.id, tag: w.tag, modified_at: isoOf(w.modified_on) };
}

/** A build, named fields only: never its environment variables, commands, author or token. */
export function buildOf(v: unknown): BuildView | null {
  const b = v as Record<string, unknown> | null;
  if (!b || typeof b.build_uuid !== 'string' || !BUILD.test(b.build_uuid)) return null;
  const meta = (b.build_trigger_metadata ?? {}) as Record<string, unknown>;
  const commit = typeof meta.commit_hash === 'string' && /^[0-9a-f]{7,64}$/i.test(meta.commit_hash) ? meta.commit_hash.toLowerCase() : null;
  return {
    id: b.build_uuid,
    status: clip(b.status, 40),
    outcome: clip(b.build_outcome, 40),
    created_at: isoOf(b.created_on),
    started_at: isoOf(b.running_on),
    stopped_at: isoOf(b.stopped_on),
    branch: clip(meta.branch, 200),
    commit,
    commit_message: clip(meta.commit_message, 300),
    repository: clip(meta.repo_name, 200),
    source: clip(meta.build_trigger_source, 40),
  };
}

export function logLineOf(v: unknown): LogLineView | null {
  // Cloudflare returns each line as [timestamp, text].
  if (!Array.isArray(v) || typeof v[1] !== 'string') return null;
  return { at: isoOf(v[0]), text: v[1].slice(0, 1_000) };
}

/** An Observability event, named fields only: never its URL. */
export function eventOf(v: unknown): EventView | null {
  const e = v as Record<string, unknown> | null;
  const meta = (e?.$metadata ?? null) as Record<string, unknown> | null;
  if (!e || !meta) return null;
  const status = num(meta.statusCode);
  return {
    at: isoOf(e.timestamp),
    level: clip(meta.level, 20),
    status_code: status != null && Number.isInteger(status) ? status : null,
    trigger: clip(meta.trigger, 200),
    error: clip(meta.error, 500),
  };
}

// ───────────────────────────────────────────────────────────── the reads

/** The Observability query for a Worker's errors: built here, never a caller's. */
export function errorsQuery(script: string, hours: number, now: number): Record<string, unknown> {
  const span = Math.min(Math.max(Math.trunc(hours), 1), MAX_HOURS);
  return {
    queryId: 'axal-worker-errors',
    view: 'events',
    dry: true,
    limit: 50,
    parameters: {
      filters: [
        { key: '$metadata.service', operation: 'eq', type: 'string', value: checkScript(script) },
        { key: '$metadata.error', operation: 'exists', type: 'string' },
      ],
      filterCombination: 'and',
    },
    timeframe: { from: now - span * 3_600_000, to: now },
  };
}

/** The Observability query for how many requests a Worker served. */
export function requestsQuery(script: string, hours: number, now: number): Record<string, unknown> {
  const span = Math.min(Math.max(Math.trunc(hours), 1), MAX_HOURS);
  return {
    queryId: 'axal-worker-requests',
    view: 'calculations',
    dry: true,
    parameters: {
      filters: [{ key: '$metadata.service', operation: 'eq', type: 'string', value: checkScript(script) }],
      calculations: [{ operator: 'count', alias: 'requests' }],
    },
    timeframe: { from: now - span * 3_600_000, to: now },
  };
}

function countOf(result: unknown): number | null {
  const calcs = list((result as { calculations?: unknown } | null)?.calculations);
  const first = calcs.find((c) => (c as { alias?: unknown })?.alias === 'requests') as { aggregates?: unknown } | undefined;
  const aggregates = list(first?.aggregates);
  if (!aggregates.length) return first ? 0 : null;
  let total = 0;
  for (const a of aggregates) {
    const v = num((a as { value?: unknown })?.value);
    if (v == null) return null;
    total += v;
  }
  return total;
}

export interface CloudflareReads {
  listAccounts(): Promise<AccountView[]>;
  listWorkers(account: string): Promise<WorkerView[]>;
  listBuilds(account: string, worker: string, limit?: number): Promise<BuildView[]>;
  getBuild(account: string, build: string): Promise<BuildView | null>;
  getBuildLogs(account: string, build: string): Promise<{ lines: LogLineView[]; truncated: boolean }>;
  workerErrors(account: string, script: string, hours?: number): Promise<EventView[]>;
  workerRequests(account: string, script: string, hours?: number): Promise<{ requests: number | null; hours: number }>;
}

/** The seven reads, on one token. Each identifier is checked before anything is sent. */
export function cloudflareReads(token: string, now: () => number = Date.now): CloudflareReads {
  const acct = (a: string) => `/accounts/${checkAccount(a)}`;
  return {
    async listAccounts() {
      const r = await call(token, 'GET', '/accounts?per_page=50');
      return list(r.result).map(accountOf).filter((a): a is AccountView => a != null);
    },
    async listWorkers(account) {
      const r = await call(token, 'GET', `${acct(account)}/workers/scripts`);
      return list(r.result).map(workerOf).filter((w): w is WorkerView => w != null);
    },
    async listBuilds(account, worker, limit = 10) {
      const per = Math.min(Math.max(Math.trunc(limit) || 10, 1), 50);
      const r = await call(token, 'GET', `${acct(account)}/builds/workers/${checkWorkerTag(worker)}/builds?page=1&per_page=${per}`);
      return list(r.result).map(buildOf).filter((b): b is BuildView => b != null);
    },
    async getBuild(account, build) {
      const r = await call(token, 'GET', `${acct(account)}/builds/builds/${checkBuild(build)}`);
      return buildOf(r.result);
    },
    async getBuildLogs(account, build) {
      const base = `${acct(account)}/builds/builds/${checkBuild(build)}/logs`;
      const lines: LogLineView[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_LOG_PAGES; page += 1) {
        const r = await call(token, 'GET', cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base);
        const res = (r.result ?? {}) as { lines?: unknown; cursor?: unknown; truncated?: unknown };
        for (const l of list(res.lines)) {
          const line = logLineOf(l);
          if (line) lines.push(line);
          if (lines.length >= MAX_LOG_LINES) return { lines, truncated: true };
        }
        const next = typeof res.cursor === 'string' && CURSOR.test(res.cursor) ? res.cursor : null;
        if (!next || res.truncated !== true) return { lines, truncated: false };
        cursor = next;
      }
      return { lines, truncated: true };
    },
    async workerErrors(account, script, hours = 24) {
      const r = await call(token, 'POST', `${acct(account)}/workers/observability/telemetry/query`, errorsQuery(script, hours, now()));
      const events = list((r.result as { events?: { events?: unknown } } | null)?.events?.events);
      return events.map(eventOf).filter((e): e is EventView => e != null);
    },
    async workerRequests(account, script, hours = 24) {
      const span = Math.min(Math.max(Math.trunc(hours), 1), MAX_HOURS);
      const r = await call(token, 'POST', `${acct(account)}/workers/observability/telemetry/query`, requestsQuery(script, span, now()));
      return { requests: countOf(r.result), hours: span };
    },
  };
}
