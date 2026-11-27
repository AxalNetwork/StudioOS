/**
 * D5840 (#5840) — Search Console sync: finalized web-search daily property totals (byProperty) and weekly
 * top landing pages (byPage) for the one property a venture selected, with stable keys, atomic per-chunk
 * progress, pagination, quota-aware retry and fingerprinted revisions; plus the venture-gated weekly read.
 *
 * Never requests the `query` dimension, so no search query is read or stored. The Google access token comes
 * from the caller (`deps.accessToken`): #5839 owns the OAuth grant and the property picker, and writes
 * `search_console_selections`. Every write is guarded on this run's claim and on the selection still naming
 * the same property, so data lands only for the selected property.
 */
import type { Env, User } from '../types';
import { canAccessProject } from './projectAccess';
import {
  PROVIDER_TIMEZONE, TOP_ROWS_NOTE, UNITS, addDays, pacificDate, validDay, weekStartOf, weekStartsBetween, weekTotals,
  type DayRow,
} from './searchConsoleWeeks';

export const SEARCH_CONSOLE_ORIGIN = 'https://searchconsole.googleapis.com';
export const SEARCH_TYPE = 'web';
export const DATA_STATE = 'final';
export const LIMITS = Object.freeze({
  /** First sync: sixteen whole weeks ending with the latest requested date. */
  initialWeeks: 16,
  /** Each later sync re-reads this many days before `fetched_through`, so late corrections are seen. */
  overlapDays: 7,
  /** A final date older than this many days with no row is `not_returned`; newer ones wait for the next sync. */
  finalLagDays: 3,
  /** Weeks per chunk: each chunk is fetched in full, then written in one batch with its progress. */
  chunkWeeks: 4,
  /** Rows per totals request (Google's maximum is 25,000); the sync pages with startRow while a page is full. */
  totalsRowLimit: 25000,
  maxTotalsPages: 10,
  /** Top landing pages per week: top rows only. */
  topPagesLimit: 25,
  maxAttempts: 4,
  baseBackoffMs: 1000,
  maxBackoffMs: 30000,
  maxRequests: 60,
  maxResponseBytes: 4 * 1024 * 1024,
});
type Limits = { -readonly [K in keyof typeof LIMITS]: number };

export type SearchConsoleDeps = {
  /** #5839's token for the selected property's Google principal; throws `SearchConsoleError('grant_revoked')` when the grant is gone. */
  accessToken: (env: Env, userId: number) => Promise<string>;
  fetcher?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  limits?: Partial<Limits>;
};
/**
 * `token_busy` and `token_unavailable` (D5840 part 2) come from the token dependency: another refresh holds the
 * lease, or the connection could not be read for a reason that is not a revoked grant. Neither marks the selection.
 */
export type ErrorCode = 'property_denied' | 'grant_revoked' | 'rate_limited' | 'google_unavailable' | 'request_budget' | 'malformed_response'
  | 'token_busy' | 'token_unavailable';
export class SearchConsoleError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode) { super(code); this.code = code; }
}
/** A refusal before any provider call: the caller answers it with `status` and `code`. */
export class SearchConsoleRefusal extends Error {
  status: 400 | 403 | 404 | 409 | 503; code: string;
  constructor(status: SearchConsoleRefusal['status'], code: string) { super(code); this.status = status; this.code = code; }
}

/** `sc-domain:` plus a host name, or an http(s) URL prefix ending in `/` with no query or fragment. */
export function propertyKind(siteUrl: unknown): 'domain' | 'url_prefix' | null {
  if (typeof siteUrl !== 'string' || siteUrl.length > 2048 || /[\s\x00-\x1f\x7f]/.test(siteUrl)) return null;
  if (siteUrl.startsWith('sc-domain:')) {
    return /^sc-domain:(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(siteUrl) ? 'domain' : null;
  }
  let u: URL;
  try { u = new URL(siteUrl); } catch { return null; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || u.search || u.hash || !siteUrl.endsWith('/')) return null;
  return u.href === siteUrl ? 'url_prefix' : null;
}
export function siteUrlPath(siteUrl: string, suffix = ''): string {
  return `${SEARCH_CONSOLE_ORIGIN}/webmasters/v3/sites/${encodeURIComponent(siteUrl)}${suffix}`;
}
/** The two request bodies. Neither names the `query` dimension. */
export function totalsBody(from: string, to: string, rowLimit: number, startRow: number) {
  return { startDate: from, endDate: to, dimensions: ['date'], type: SEARCH_TYPE, aggregationType: 'byProperty', dataState: DATA_STATE, rowLimit, startRow };
}
export function pagesBody(from: string, to: string, rowLimit: number) {
  return { startDate: from, endDate: to, dimensions: ['page'], type: SEARCH_TYPE, aggregationType: 'byPage', dataState: DATA_STATE, rowLimit, startRow: 0 };
}

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

type Ctx = { env: Env; deps: Required<Omit<SearchConsoleDeps, 'limits'>>; limits: Limits; token: string | null; userId: number; requests: number; retries: number };

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
/** One provider call with bounded retries: 429 and 5xx back off (Retry-After honoured, capped); 401, 403 and 404 never retry. */
async function call(ctx: Ctx, method: 'GET' | 'POST', url: string, body?: unknown): Promise<any> {
  let last: ErrorCode = 'google_unavailable';
  for (let attempt = 1; attempt <= ctx.limits.maxAttempts; attempt++) {
    if (ctx.requests >= ctx.limits.maxRequests) throw new SearchConsoleError('request_budget');
    if (attempt > 1) ctx.retries++;
    ctx.requests++;
    if (!ctx.token) {
      try { ctx.token = await ctx.deps.accessToken(ctx.env, ctx.userId); }
      catch (e) { throw e instanceof SearchConsoleError ? e : new SearchConsoleError('grant_revoked'); }
    }
    let res: Response | null = null;
    try {
      res = await ctx.deps.fetcher(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${ctx.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { res = null; }
    if (res && res.ok) {
      const text = await res.text();
      if (text.length > ctx.limits.maxResponseBytes) throw new SearchConsoleError('malformed_response');
      try { return JSON.parse(text); } catch { throw new SearchConsoleError('malformed_response'); }
    }
    const status = res?.status ?? 0;
    if (status === 401) throw new SearchConsoleError('grant_revoked');
    if (status === 403 || status === 404) throw new SearchConsoleError('property_denied');
    if (res && !RETRYABLE.has(status)) throw new SearchConsoleError('google_unavailable');
    last = status === 429 ? 'rate_limited' : 'google_unavailable';
    if (attempt === ctx.limits.maxAttempts) break;
    const after = Number(res?.headers.get('Retry-After'));
    const wait = Number.isFinite(after) && after > 0 ? after * 1000 : ctx.limits.baseBackoffMs * 2 ** (attempt - 1);
    await ctx.deps.sleep(Math.min(ctx.limits.maxBackoffMs, wait));
  }
  throw new SearchConsoleError(last);
}

type TotalsRow = { date: string; clicks: number; impressions: number; ctr: number | null; position: number | null };
type PageRow = { page: string; clicks: number; impressions: number; ctr: number | null; position: number | null };

/** Every page of a date-only byProperty query; a failed page fails the whole range (nothing is written for it). */
async function fetchTotals(ctx: Ctx, siteUrl: string, from: string, to: string): Promise<TotalsRow[]> {
  const out: TotalsRow[] = [];
  const limit = ctx.limits.totalsRowLimit;
  for (let page = 0; ; page++) {
    if (page >= ctx.limits.maxTotalsPages) throw new SearchConsoleError('request_budget');
    const json = await call(ctx, 'POST', siteUrlPath(siteUrl, '/searchAnalytics/query'), totalsBody(from, to, limit, page * limit));
    const rows = json?.rows ?? [];
    if (!Array.isArray(rows)) throw new SearchConsoleError('malformed_response');
    for (const r of rows) {
      const date = Array.isArray(r?.keys) && r.keys.length === 1 ? r.keys[0] : null;
      if (!validDay(date) || date < from || date > to || !isCount(r.clicks) || !isCount(r.impressions)) throw new SearchConsoleError('malformed_response');
      out.push({ date, clicks: r.clicks, impressions: r.impressions, ctr: isNum(r.ctr) ? r.ctr : null, position: isNum(r.position) ? r.position : null });
    }
    if (rows.length < limit) break;
  }
  const seen = new Set(out.map((r) => r.date));
  if (seen.size !== out.length) throw new SearchConsoleError('malformed_response');
  return out;
}
async function fetchPages(ctx: Ctx, siteUrl: string, from: string, to: string): Promise<PageRow[]> {
  const json = await call(ctx, 'POST', siteUrlPath(siteUrl, '/searchAnalytics/query'), pagesBody(from, to, ctx.limits.topPagesLimit));
  const rows = json?.rows ?? [];
  if (!Array.isArray(rows) || rows.length > ctx.limits.topPagesLimit) throw new SearchConsoleError('malformed_response');
  const out: PageRow[] = rows.map((r: any) => {
    const page = Array.isArray(r?.keys) && r.keys.length === 1 ? r.keys[0] : null;
    if (typeof page !== 'string' || !page || page.length > 2048 || /[\s\x00-\x1f]/.test(page) || !isCount(r.clicks) || !isCount(r.impressions)) throw new SearchConsoleError('malformed_response');
    return { page, clicks: r.clicks, impressions: r.impressions, ctr: isNum(r.ctr) ? r.ctr : null, position: isNum(r.position) ? r.position : null };
  });
  if (new Set(out.map((r) => r.page)).size !== out.length) throw new SearchConsoleError('malformed_response');
  return out;
}

/** The venture's id when the caller may read it (`write` false) or change it (`write` true); refused otherwise. */
export async function searchConsoleVenture(env: Env, user: Pick<User, 'id' | 'role' | 'founder_id' | 'licences'>, projectId: unknown, write: boolean): Promise<number> {
  const id = Number(projectId);
  if (!Number.isInteger(id) || id <= 0) throw new SearchConsoleRefusal(400, 'project_required');
  const p = await env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL').bind(id).first<{ id: number; founder_id: number | null }>();
  if (!p) throw new SearchConsoleRefusal(404, 'project_not_found');
  if (!(await canAccessProject(env, user as User, p, { write }))) throw new SearchConsoleRefusal(403, 'forbidden');
  return p.id;
}
type Selection = { project_id: number; user_id: number; site_url: string; property_kind: 'domain' | 'url_prefix'; access_state: 'ok' | 'denied' | 'revoked' };
async function selectionOf(env: Env, projectId: number): Promise<Selection | null> {
  return env.DB.prepare('SELECT project_id, user_id, site_url, property_kind, access_state FROM search_console_selections WHERE project_id = ?').bind(projectId).first<Selection>();
}

/** The guard every write carries: this run still holds the claim and the selection still names this property with access. */
const GUARD = `EXISTS (SELECT 1 FROM search_console_sync_state s WHERE s.project_id = ? AND s.site_url = ? AND s.search_type = 'web' AND s.run_token = ?)
  AND EXISTS (SELECT 1 FROM search_console_selections sel WHERE sel.project_id = ? AND sel.site_url = ? AND sel.access_state = 'ok')`;

/** The chunk's guarded statements; the only interpolation is the fixed GUARD text above, never a value. */
const SQL_DAY_UPSERT = `INSERT INTO search_console_daily_totals (project_id, site_url, search_type, data_date, row_state, clicks, impressions, ctr, position, fingerprint, source_revision, run_id, first_fetched_at, fetched_at)
      SELECT ?, ?, 'web', ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(?), datetime(?) WHERE ` + GUARD + `
      ON CONFLICT(project_id, site_url, search_type, data_date) DO UPDATE SET row_state = excluded.row_state, clicks = excluded.clicks, impressions = excluded.impressions,
        ctr = excluded.ctr, position = excluded.position, fingerprint = excluded.fingerprint, source_revision = excluded.source_revision, run_id = excluded.run_id, fetched_at = excluded.fetched_at`;
const SQL_DAY_REVISION = `INSERT INTO search_console_revisions (project_id, site_url, search_type, dataset, period_key, source_revision, fingerprint, previous_fingerprint, previous_json, run_id, observed_at)
        SELECT ?, ?, 'web', 'daily_totals', ?, ?, ?, ?, ?, ?, datetime(?) WHERE ` + GUARD + ``;
const SQL_PAGES_DELETE = `DELETE FROM search_console_top_pages WHERE project_id = ? AND site_url = ? AND search_type = 'web' AND week_start = ? AND ` + GUARD + ``;
const SQL_PAGE_INSERT = `INSERT INTO search_console_top_pages (project_id, site_url, search_type, week_start, page, rank, clicks, impressions, ctr, position)
      SELECT ?, ?, 'web', ?, ?, ?, ?, ?, ?, ? WHERE ` + GUARD + ``;
const SQL_WEEK_UPSERT = `INSERT INTO search_console_page_weeks (project_id, site_url, search_type, week_start, week_end, fetched_through, row_limit, rows_returned, truncated, complete, fingerprint, source_revision, run_id, fetched_at)
      SELECT ?, ?, 'web', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(?) WHERE ` + GUARD + `
      ON CONFLICT(project_id, site_url, search_type, week_start) DO UPDATE SET fetched_through = excluded.fetched_through, row_limit = excluded.row_limit, rows_returned = excluded.rows_returned,
        truncated = excluded.truncated, complete = excluded.complete, fingerprint = excluded.fingerprint, source_revision = excluded.source_revision, run_id = excluded.run_id, fetched_at = excluded.fetched_at`;
const SQL_WEEK_REVISION = `INSERT INTO search_console_revisions (project_id, site_url, search_type, dataset, period_key, source_revision, fingerprint, previous_fingerprint, previous_json, run_id, observed_at)
        SELECT ?, ?, 'web', 'top_pages', ?, ?, ?, ?, ?, ?, datetime(?) WHERE ` + GUARD + ``;
const SQL_PROGRESS = `UPDATE search_console_sync_state SET initial_from = ?, fetched_through = ?, updated_at = datetime(?)
    WHERE project_id = ? AND site_url = ? AND search_type = 'web' AND ` + GUARD + ``;

export type SyncResult = {
  status: 'ok' | 'partial' | 'failed' | 'denied' | 'revoked' | 'busy';
  run_id: number; site_url: string; range_from: string | null; range_to: string | null;
  fetched_through: string | null; days_written: number; weeks_written: number; corrections: number;
  requests: number; retries: number; error_code: string | null;
};

/**
 * One sync for the venture's selected property. The first run reads the bounded initial window; later runs
 * re-read from `fetched_through - overlapDays`. Each chunk (whole weeks) is fetched in full, every totals page
 * included, then its days, its weeks' top pages, its revisions and the advanced `fetched_through` are written in
 * one D1 batch, so an interrupted run keeps the chunks before the failure and nothing of the failed one.
 */
export async function syncSearchConsole(env: Env, user: Pick<User, 'id' | 'role' | 'founder_id' | 'licences'>, projectId: unknown,
  deps: SearchConsoleDeps, opts: { trigger?: 'connect' | 'manual' | 'cron' } = {}): Promise<SyncResult> {
  const pid = await searchConsoleVenture(env, user, projectId, true);
  const sel = await selectionOf(env, pid);
  if (!sel) throw new SearchConsoleRefusal(409, 'no_property_selected');
  if (propertyKind(sel.site_url) !== sel.property_kind) throw new SearchConsoleRefusal(409, 'property_malformed');
  if (sel.access_state !== 'ok') throw new SearchConsoleRefusal(409, `property_${sel.access_state}`);
  const limits: Limits = { ...LIMITS, ...(deps.limits || {}) };
  const ctx: Ctx = {
    env, limits, token: null, userId: sel.user_id, requests: 0, retries: 0,
    deps: { accessToken: deps.accessToken, fetcher: deps.fetcher ?? fetch, now: deps.now ?? (() => new Date()), sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))) },
  };
  const site = sel.site_url;
  const nowIso = ctx.deps.now().toISOString();
  const today = pacificDate(ctx.deps.now());
  const trigger = opts.trigger ?? 'manual';

  await env.DB.prepare("INSERT INTO search_console_sync_state (project_id, site_url, search_type) VALUES (?, ?, 'web') ON CONFLICT(project_id, site_url, search_type) DO NOTHING").bind(pid, site).run();
  const runToken = crypto.randomUUID();
  const claim = await env.DB.prepare(`UPDATE search_console_sync_state SET run_token = ?, run_started_at = datetime(?)
    WHERE project_id = ? AND site_url = ? AND search_type = 'web' AND (run_token IS NULL OR datetime(run_started_at) < datetime(?, '-15 minutes'))`)
    .bind(runToken, nowIso, pid, site, nowIso).run();
  const runInsert = (status: string) => env.DB.prepare(`INSERT INTO search_console_sync_runs (project_id, site_url, search_type, trigger, status, started_at) VALUES (?, ?, 'web', ?, ?, datetime(?)) RETURNING id`)
    .bind(pid, site, trigger, status, nowIso).first<{ id: number }>();
  if (!claim.meta?.changes) {
    const busy = await runInsert('busy');
    return { status: 'busy', run_id: busy!.id, site_url: site, range_from: null, range_to: null, fetched_through: null, days_written: 0, weeks_written: 0, corrections: 0, requests: 0, retries: 0, error_code: 'sync_in_progress' };
  }
  const run = (await runInsert('running'))!;
  const state = await env.DB.prepare("SELECT initial_from, fetched_through FROM search_console_sync_state WHERE project_id = ? AND site_url = ? AND search_type = 'web'")
    .bind(pid, site).first<{ initial_from: string | null; fetched_through: string | null }>();
  const end = addDays(today, -1);
  const initialFrom = state?.initial_from ?? addDays(weekStartOf(end), -7 * (limits.initialWeeks - 1));
  let through = state?.fetched_through ?? null;
  const overlapFrom = through ? addDays(through, -limits.overlapDays) : initialFrom;
  const from = overlapFrom < initialFrom ? initialFrom : overlapFrom;
  const finalFloor = addDays(today, -limits.finalLagDays);
  const g = [pid, site, runToken, pid, site];
  let daysWritten = 0, weeksWritten = 0, corrections = 0, chunksWritten = 0;
  let status: SyncResult['status'] = 'ok'; let errorCode: string | null = null;

  try {
    const perm = await call(ctx, 'GET', siteUrlPath(site));
    const level = typeof perm?.permissionLevel === 'string' ? perm.permissionLevel : null;
    if (!level || level === 'siteUnverifiedUser' || perm?.siteUrl !== site) throw new SearchConsoleError('property_denied');
    for (let cFrom = from; cFrom <= end;) {
      const cEnd = addDays(weekStartOf(cFrom), 7 * limits.chunkWeeks - 1);
      const cTo = cEnd < end ? cEnd : end;
      const rows = await fetchTotals(ctx, site, cFrom, cTo);
      const latest = rows.reduce<string | null>((m, r) => (!m || r.date > m ? r.date : m), null);
      const reach = latest && latest > finalFloor ? latest : finalFloor;
      const cThrough = reach < cTo ? reach : cTo;
      if (cThrough < cFrom) break; // nothing in this chunk is final yet
      const pages = new Map<string, { to: string; rows: PageRow[] }>();
      for (const w of weekStartsBetween(cFrom, cThrough)) {
        const wEnd = addDays(w, 6);
        const wTo = wEnd < cThrough ? wEnd : cThrough;
        pages.set(w, { to: wTo, rows: await fetchPages(ctx, site, w < initialFrom ? initialFrom : w, wTo) });
      }
      const written = await writeChunk(env, g, { pid, site, runId: run.id, nowIso, cFrom, cThrough, rows, pages, through, initialFrom, topLimit: limits.topPagesLimit });
      if (!written) { status = chunksWritten ? 'partial' : 'failed'; errorCode = 'selection_changed'; break; }
      daysWritten += written.days; weeksWritten += written.weeks; corrections += written.corrections; chunksWritten++;
      through = through && through > cThrough ? through : cThrough;
      if (cThrough < cTo) break;
      cFrom = addDays(cTo, 1);
    }
  } catch (e) {
    if (!(e instanceof SearchConsoleError)) { status = 'failed'; errorCode = 'sync_error'; throw e; }
    errorCode = e.code;
    status = e.code === 'property_denied' ? 'denied' : e.code === 'grant_revoked' ? 'revoked' : chunksWritten ? 'partial' : 'failed';
  } finally {
    const finalStatus = status;
    const stmts = [
      env.DB.prepare(`UPDATE search_console_sync_state SET run_token = NULL, run_started_at = NULL, last_status = ?, last_error_code = ?,
        last_attempt_at = datetime(?), last_success_at = CASE WHEN ? = 'ok' THEN datetime(?) ELSE last_success_at END, updated_at = datetime(?)
        WHERE project_id = ? AND site_url = ? AND search_type = 'web' AND run_token = ?`)
        .bind(finalStatus, errorCode, nowIso, finalStatus, nowIso, nowIso, pid, site, runToken),
      env.DB.prepare(`UPDATE search_console_sync_runs SET status = ?, error_code = ?, range_from = ?, range_to = ?, requests = ?, retries = ?,
        days_written = ?, weeks_written = ?, corrections = ?, finished_at = datetime(?) WHERE id = ?`)
        .bind(finalStatus, errorCode, from, end, ctx.requests, ctx.retries, daysWritten, weeksWritten, corrections, nowIso, run.id),
    ];
    if (finalStatus === 'denied' || finalStatus === 'revoked') {
      stmts.push(env.DB.prepare("UPDATE search_console_selections SET access_state = ?, updated_at = datetime(?) WHERE project_id = ? AND site_url = ?")
        .bind(finalStatus, nowIso, pid, site));
    }
    await env.DB.batch(stmts);
  }
  return { status, run_id: run.id, site_url: site, range_from: from, range_to: end, fetched_through: through, days_written: daysWritten, weeks_written: weeksWritten, corrections, requests: ctx.requests, retries: ctx.retries, error_code: errorCode };
}

type ChunkInput = {
  pid: number; site: string; runId: number; nowIso: string; cFrom: string; cThrough: string; rows: TotalsRow[];
  pages: Map<string, { to: string; rows: PageRow[] }>; through: string | null; initialFrom: string; topLimit: number;
};
/** One atomic batch: the chunk's days, its weeks' pages, revisions and progress. Null when the guard no longer held. */
async function writeChunk(env: Env, g: unknown[], c: ChunkInput): Promise<{ days: number; weeks: number; corrections: number } | null> {
  const prior = await env.DB.prepare(`SELECT data_date, fingerprint, source_revision, row_state, clicks, impressions, ctr, position FROM search_console_daily_totals
    WHERE project_id = ? AND site_url = ? AND search_type = 'web' AND data_date BETWEEN ? AND ?`).bind(c.pid, c.site, c.cFrom, c.cThrough).all<any>();
  const priorDays = new Map((prior.results || []).map((r: any) => [r.data_date as string, r]));
  const byDate = new Map(c.rows.map((r) => [r.date, r]));
  const stmts: any[] = [];
  let days = 0, weeks = 0, corrections = 0;
  for (let day = c.cFrom; day <= c.cThrough; day = addDays(day, 1)) {
    const r = byDate.get(day);
    const values = r ? { row_state: 'reported', clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }
      : { row_state: 'not_returned', clicks: null, impressions: null, ctr: null, position: null };
    const fp = await fingerprint(values);
    const old = priorDays.get(day);
    if (old && old.fingerprint === fp) continue;
    const revision = old ? old.source_revision + 1 : 1;
    stmts.push(env.DB.prepare(SQL_DAY_UPSERT)
      .bind(c.pid, c.site, day, values.row_state, values.clicks, values.impressions, values.ctr, values.position, fp, revision, c.runId, c.nowIso, c.nowIso, ...g));
    days++;
    if (old) {
      corrections++;
      const previous = { row_state: old.row_state, clicks: old.clicks, impressions: old.impressions, ctr: old.ctr, position: old.position };
      stmts.push(env.DB.prepare(SQL_DAY_REVISION)
        .bind(c.pid, c.site, day, revision, fp, old.fingerprint, JSON.stringify(previous), c.runId, c.nowIso, ...g));
    }
  }
  for (const [week, p] of c.pages) {
    const complete = p.to === addDays(week, 6) ? 1 : 0;
    const truncated = p.rows.length >= c.topLimit ? 1 : 0;
    const fp = await fingerprint({ to: p.to, truncated, rows: p.rows });
    const old = await env.DB.prepare("SELECT fingerprint, source_revision, fetched_through, truncated, complete FROM search_console_page_weeks WHERE project_id = ? AND site_url = ? AND search_type = 'web' AND week_start = ?")
      .bind(c.pid, c.site, week).first<any>();
    if (old && old.fingerprint === fp) continue;
    const revision = old ? old.source_revision + 1 : 1;
    stmts.push(env.DB.prepare(SQL_PAGES_DELETE).bind(c.pid, c.site, week, ...g));
    p.rows.forEach((row, i) => stmts.push(env.DB.prepare(SQL_PAGE_INSERT).bind(c.pid, c.site, week, row.page, i + 1, row.clicks, row.impressions, row.ctr, row.position, ...g)));
    stmts.push(env.DB.prepare(SQL_WEEK_UPSERT)
      .bind(c.pid, c.site, week, addDays(week, 6), p.to, c.topLimit, p.rows.length, truncated, complete, fp, revision, c.runId, c.nowIso, ...g));
    weeks++;
    if (old) {
      corrections++;
      stmts.push(env.DB.prepare(SQL_WEEK_REVISION)
        .bind(c.pid, c.site, week, revision, fp, old.fingerprint, JSON.stringify({ fetched_through: old.fetched_through, truncated: old.truncated, complete: old.complete }), c.runId, c.nowIso, ...g));
    }
  }
  const nextThrough = c.through && c.through > c.cThrough ? c.through : c.cThrough;
  // Progress last: its `changes` says whether the guard held for the whole batch (one transaction).
  stmts.push(env.DB.prepare(SQL_PROGRESS).bind(c.initialFrom, nextThrough, c.nowIso, c.pid, c.site, ...g));
  const results = await env.DB.batch(stmts);
  if (!results[results.length - 1]?.meta?.changes) return null;
  return { days, weeks, corrections };
}

/**
 * The venture's weekly results for its selected property: property totals summed from stored daily
 * byProperty rows only, each week's coverage, and that week's top landing pages, labelled as top rows.
 */
export async function searchConsoleWeekly(env: Env, user: Pick<User, 'id' | 'role' | 'founder_id' | 'licences'>, projectId: unknown) {
  const pid = await searchConsoleVenture(env, user, projectId, false);
  const sel = await selectionOf(env, pid);
  if (!sel) return { property: null, reason: 'Not recorded: no Search Console property selected', weeks: [] };
  const state = await env.DB.prepare(`SELECT search_type, data_state, provider_timezone, units_json, initial_from, fetched_through, last_status, last_error_code, last_success_at
    FROM search_console_sync_state WHERE project_id = ? AND site_url = ? AND search_type = 'web'`).bind(pid, sel.site_url).first<any>();
  const property = { site_url: sel.site_url, property_kind: sel.property_kind, access_state: sel.access_state };
  const base = { property, search_type: SEARCH_TYPE, data_state: DATA_STATE, timezone: PROVIDER_TIMEZONE, units: state ? JSON.parse(state.units_json) : UNITS, top_rows_note: TOP_ROWS_NOTE };
  if (!state?.initial_from) {
    return { ...base, initial_from: null, fetched_through: null, last_status: state?.last_status ?? null, last_error_code: state?.last_error_code ?? null,
      reason: state?.last_status ? `Unreadable: the last sync failed (${state.last_error_code})` : 'Not recorded: no sync yet', weeks: [] };
  }
  const lastWeek = weekStartOf(state.fetched_through ?? state.initial_from);
  const days = await env.DB.prepare(`SELECT data_date, row_state, clicks, impressions FROM search_console_daily_totals
    WHERE project_id = ? AND site_url = ? AND search_type = 'web' AND data_date BETWEEN ? AND ? ORDER BY data_date`).bind(pid, sel.site_url, state.initial_from, addDays(lastWeek, 6)).all<DayRow>();
  const pw = await env.DB.prepare(`SELECT week_start, fetched_through, row_limit, rows_returned, truncated, complete, source_revision FROM search_console_page_weeks
    WHERE project_id = ? AND site_url = ? AND search_type = 'web'`).bind(pid, sel.site_url).all<any>();
  const pages = await env.DB.prepare(`SELECT week_start, page, rank, clicks, impressions, ctr, position FROM search_console_top_pages
    WHERE project_id = ? AND site_url = ? AND search_type = 'web' ORDER BY week_start, rank`).bind(pid, sel.site_url).all<any>();
  const failure = state.last_status && state.last_status !== 'ok' ? state.last_error_code : null;
  const pageWeeks = new Map((pw.results || []).map((r: any) => [r.week_start, r]));
  const weeks = weekStartsBetween(state.initial_from, lastWeek).map((w) => {
    const totals = weekTotals(w, (days.results || []).filter((d) => d.data_date >= w && d.data_date <= addDays(w, 6)), { fetchedThrough: state.fetched_through, initialFrom: state.initial_from, failure });
    const meta = pageWeeks.get(w);
    const top_pages = meta ? {
      fetched_through: meta.fetched_through, row_limit: meta.row_limit, rows_returned: meta.rows_returned,
      truncated: !!meta.truncated, complete: !!meta.complete, top_rows_only: true, source_revision: meta.source_revision,
      rows: (pages.results || []).filter((p: any) => p.week_start === w).map(({ week_start: _w, ...p }: any) => p),
    } : { reason: 'Not recorded: no top pages fetched for this week', rows: [] };
    return { ...totals, top_pages };
  });
  return { ...base, initial_from: state.initial_from, fetched_through: state.fetched_through, last_status: state.last_status, last_error_code: state.last_error_code, last_success_at: state.last_success_at, weeks };
}
