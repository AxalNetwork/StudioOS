/**
 * D845 (#2471) — a member's own usage reports over `api_usage_events` (D843,
 * migration 524): AI tokens charged, calls, failures and latency, grouped by
 * day, key, provider, connector, tool or model, and the request history.
 *
 * TENANCY. Every statement here starts `WHERE e.user_id = ?` with the
 * session's user, and the hold a row names is joined only when it is the same
 * user's (`r.user_id = e.user_id`). A `key=` from the query string is
 * re-checked by `ownsKey` before it narrows anything, so another member's key
 * reads exactly as a key that does not exist.
 *
 * STATIC SQL. The grouping is chosen by a bound `CASE ?1`, never by splicing a
 * column name, so each statement is one literal with bound parameters.
 *
 * UNKNOWN IS NULL. A row's charge is the settled hold's (`reservation_uid`),
 * else the row's own `charged_microusd`, which stays NULL until metering
 * (#2466) writes it. A hold still pending or in review is NULL too: nothing is
 * charged yet. Sums use SQL `SUM`, which skips NULLs and is NULL when every
 * row is; `metered_calls` says how many rows the sum covers.
 *
 * `provider_cost_microusd` is HQ's (#2481): no member response carries it.
 */
import type { Env } from '../types';

export const REPORT_GROUPS = Object.freeze(['day', 'key', 'provider', 'connector', 'tool', 'model'] as const);
export type ReportGroup = typeof REPORT_GROUPS[number];
/** The second axis of a two-way report, with `group=day` only. */
export const REPORT_BY = Object.freeze(['key', 'provider', 'connector', 'tool'] as const);
export type ReportBy = typeof REPORT_BY[number];
/** What a row's result reads as. `insufficient_tokens` is a refusal or error whose category says so (D843). */
export const REPORT_OUTCOMES = Object.freeze(['ok', 'refused', 'rate_limited', 'insufficient_tokens', 'error'] as const);
export type ReportOutcome = typeof REPORT_OUTCOMES[number];

export const MAX_RANGE_DAYS = 92;
export const DEFAULT_RANGE_DAYS = 30;
export const GROUP_PAGE = 100;
export const EVENT_PAGE = 100;
/** Under this many calls a group's p50 is NULL: a median of two calls is noise. */
export const P50_MIN_CALLS = 5;
const MAX_TEXT = 200;

/** A query parameter this module refused, with the sentence the member reads. */
export class ReportInputError extends Error {
  code: string;
  sentence: string;
  constructor(code: string, sentence: string) { super(code); this.code = code; this.sentence = sentence; }
}

export interface Range { from: string; to: string; fromTs: string; toTs: string }

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function parseDay(v: string, name: 'from' | 'to'): number {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T00:00:00Z`) : NaN;
  if (!Number.isFinite(ms) || isoDay(ms) !== v) throw new ReportInputError(`invalid_${name}`, `Give ${name} as a UTC day, YYYY-MM-DD.`);
  return ms;
}

/**
 * The UTC days `from` to `to`, both included. Without them, the last 30 days
 * up to today; at most 92 days.
 */
export function parseRange(from: string | undefined, to: string | undefined, now = new Date()): Range {
  const toMs = to ? parseDay(to, 'to') : Date.parse(`${isoDay(now.getTime())}T00:00:00Z`);
  const fromMs = from ? parseDay(from, 'from') : toMs - (DEFAULT_RANGE_DAYS - 1) * DAY_MS;
  if (fromMs > toMs) throw new ReportInputError('invalid_range', 'The range starts after it ends.');
  if ((toMs - fromMs) / DAY_MS + 1 > MAX_RANGE_DAYS) {
    throw new ReportInputError('range_too_long', `A report covers at most ${MAX_RANGE_DAYS} days.`);
  }
  return {
    from: isoDay(fromMs), to: isoDay(toMs),
    fromTs: `${isoDay(fromMs)} 00:00:00`, toTs: `${isoDay(toMs + DAY_MS)} 00:00:00`,
  };
}

function oneOf<T extends string>(v: string | undefined, list: readonly T[], code: string, sentence: string): T | null {
  if (v === undefined || v === '') return null;
  if (!(list as readonly string[]).includes(v)) throw new ReportInputError(code, sentence);
  return v as T;
}

function text(v: string | undefined, name: string): string | null {
  if (v === undefined || v === '') return null;
  if (v.length > MAX_TEXT) throw new ReportInputError(`invalid_${name}`, `That ${name} is too long.`);
  return v;
}

/** Whether `uid` is a key this member's calls were made with. Another member's key reads as unknown. */
export async function ownsKey(env: Env, userId: number, uid: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 AS one FROM api_usage_events WHERE user_id = ? AND api_key_uid = ? LIMIT 1',
  ).bind(userId, uid).first();
  return !!row;
}

async function checkedKey(env: Env, userId: number, v: string | undefined): Promise<string | null> {
  const key = text(v, 'key');
  if (key !== null && !(await ownsKey(env, userId, key))) throw new ReportInputError('unknown_key', 'No calls were made with that key.');
  return key;
}

export interface Stats {
  calls: number;
  ok: number;
  /** Every call that did not succeed: refused + rate_limited + insufficient_tokens + error. */
  errors: number;
  refused: number;
  rate_limited: number;
  insufficient_tokens: number;
  error: number;
  charged_microusd: number | null;
  refunded_microusd: number | null;
  /** How many calls `charged_microusd` covers; the rest are not metered. */
  metered_calls: number;
  p50_ms: number | null;
}

export interface Group extends Stats {
  key: string | null;
  label: string | null;
  by_key?: string | null;
  by_label?: string | null;
}

export interface Report {
  recorded: boolean;
  recorded_since: string | null;
  range: { from: string; to: string };
  group: ReportGroup;
  by: ReportBy | null;
  key: string | null;
  totals: Stats;
  groups: Group[];
  next_cursor: string | null;
}

const int = (v: unknown) => Number(v ?? 0);
const intOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function stats(r: Record<string, unknown>): Stats {
  const s = {
    calls: int(r.calls), ok: int(r.ok), refused: int(r.refused), rate_limited: int(r.rate_limited),
    insufficient_tokens: int(r.insufficient_tokens), error: int(r.error),
  };
  return {
    calls: s.calls, ok: s.ok, errors: s.refused + s.rate_limited + s.insufficient_tokens + s.error,
    refused: s.refused, rate_limited: s.rate_limited, insufficient_tokens: s.insufficient_tokens, error: s.error,
    charged_microusd: intOrNull(r.charged_microusd), refunded_microusd: intOrNull(r.refunded_microusd),
    metered_calls: int(r.metered_calls), p50_ms: intOrNull(r.p50_ms),
  };
}

/**
 * The grouped report. ?1 is the group (NULL for the totals, which makes one
 * group of every row), ?2 the second axis or NULL. The p50 is the lower median
 * of the group's ordered durations, NULL under P50_MIN_CALLS calls.
 */
const GROUPED_SQL = `WITH rowset AS (
  SELECT
    CASE ?1 WHEN 'day' THEN substr(e.created_at, 1, 10) WHEN 'key' THEN e.api_key_uid WHEN 'provider' THEN e.provider
      WHEN 'connector' THEN e.connector WHEN 'tool' THEN e.operation WHEN 'model' THEN e.model END AS g1,
    CASE ?2 WHEN 'key' THEN e.api_key_uid WHEN 'provider' THEN e.provider WHEN 'connector' THEN e.connector
      WHEN 'tool' THEN e.operation END AS g2,
    CASE WHEN e.outcome <> 'ok' AND e.error_category = 'insufficient_tokens' THEN 'insufficient_tokens' ELSE e.outcome END AS result,
    e.duration_ms AS ms,
    CASE WHEN e.reservation_uid IS NULL THEN e.charged_microusd
      WHEN r.status IN ('settled', 'refunded') THEN r.actual_included_microusd + r.actual_topup_microusd END AS charged,
    CASE WHEN r.status IN ('settled', 'refunded')
      THEN (r.included_microusd + r.topup_microusd) - (r.actual_included_microusd + r.actual_topup_microusd) END AS refunded
  FROM api_usage_events e
  LEFT JOIN ai_budget_reservations r ON r.uid = e.reservation_uid AND r.user_id = e.user_id
  WHERE e.user_id = ?3 AND e.created_at >= ?4 AND e.created_at < ?5 AND (?6 IS NULL OR e.api_key_uid = ?6)
)
SELECT g1, g2, COUNT(*) AS calls,
  SUM(result = 'ok') AS ok, SUM(result = 'refused') AS refused, SUM(result = 'rate_limited') AS rate_limited,
  SUM(result = 'insufficient_tokens') AS insufficient_tokens, SUM(result = 'error') AS error,
  SUM(charged) AS charged_microusd, SUM(refunded) AS refunded_microusd, COUNT(charged) AS metered_calls,
  CASE WHEN COUNT(*) >= ?7 THEN MAX(CASE WHEN rn = (n + 1) / 2 THEN ms END) END AS p50_ms
FROM (
  SELECT rowset.*, ROW_NUMBER() OVER (PARTITION BY g1, g2 ORDER BY ms) AS rn, COUNT(*) OVER (PARTITION BY g1, g2) AS n
  FROM rowset
) AS ordered
GROUP BY g1, g2
ORDER BY CASE WHEN ?1 = 'day' THEN g1 END, CASE WHEN ?1 = 'day' THEN 0 ELSE -COUNT(*) END, g1, g2
LIMIT ?8 OFFSET ?9`;

function grouped(env: Env, group: ReportGroup | null, by: ReportBy | null, userId: number, range: Range,
  key: string | null, limit: number, offset: number) {
  return env.DB.prepare(GROUPED_SQL)
    .bind(group, by, userId, range.fromTs, range.toTs, key, P50_MIN_CALLS, limit, offset)
    .all<Record<string, unknown>>();
}

/** The page offset a groups cursor carries. */
function groupOffset(cursor: string | undefined): number {
  if (cursor === undefined || cursor === '') return 0;
  const n = /^g[1-9]\d{0,6}$/.test(cursor) ? Number(cursor.slice(1)) : NaN;
  if (!Number.isInteger(n)) throw new ReportInputError('invalid_cursor', 'That page cursor is not one this report gave.');
  return n;
}

/** The first day `api_usage_events` holds any row, for "Not recorded before [date]". Not a member's own date. */
export async function recordedSince(env: Env): Promise<string | null> {
  const row = await env.DB.prepare('SELECT created_at FROM api_usage_events ORDER BY id LIMIT 1').first<{ created_at: string }>();
  return row ? String(row.created_at).slice(0, 10) : null;
}

export interface ReportQuery {
  from?: string; to?: string; group?: string; by?: string; key?: string; cursor?: string;
}

/** `GET /api/developer/usage`. Throws ReportInputError for a parameter the member must fix. */
export async function usageReport(env: Env, userId: number, q: ReportQuery, now = new Date()): Promise<Report> {
  const range = parseRange(q.from, q.to, now);
  const group = oneOf(q.group, REPORT_GROUPS, 'invalid_group', 'Group by day, key, provider, connector, tool or model.') ?? 'day';
  const by = oneOf(q.by, REPORT_BY, 'invalid_by', 'Split days by key, provider, connector or tool.');
  if (by && group !== 'day') throw new ReportInputError('invalid_by', 'Only a report by day splits a second way.');
  const offset = groupOffset(q.cursor);
  const key = await checkedKey(env, userId, q.key);

  const [totals, page, recorded, since] = await Promise.all([
    grouped(env, null, null, userId, range, key, 1, 0),
    grouped(env, group, by, userId, range, key, GROUP_PAGE + 1, offset),
    env.DB.prepare('SELECT 1 AS one FROM api_usage_events WHERE user_id = ? LIMIT 1').bind(userId).first(),
    recordedSince(env),
  ]);
  const rows = page.results ?? [];
  const more = rows.length > GROUP_PAGE;
  return {
    recorded: !!recorded,
    recorded_since: since,
    range: { from: range.from, to: range.to },
    group, by, key,
    // No rows makes no group: zero calls, and NULL money, never 0.
    totals: stats(totals.results?.[0] ?? {}),
    groups: rows.slice(0, GROUP_PAGE).map((r) => {
      const g1 = r.g1 === null || r.g1 === undefined ? null : String(r.g1);
      const out: Group = { key: g1, label: group === 'key' ? null : g1, ...stats(r) };
      if (by) {
        const g2 = r.g2 === null || r.g2 === undefined ? null : String(r.g2);
        out.by_key = g2;
        out.by_label = by === 'key' ? null : g2;
      }
      return out;
    }),
    next_cursor: more ? `g${offset + GROUP_PAGE}` : null,
  };
}

export interface UsageEventRow {
  execution_id: string;
  created_at: string;
  surface: string;
  operation: string;
  outcome: ReportOutcome;
  error_category: string | null;
  duration_ms: number;
  api_key_uid: string | null;
  grant_id: string | null;
  client: string | null;
  company_id: number | null;
  model: string | null;
  provider: string | null;
  connector: string | null;
  reservation_uid: string | null;
  reserved_microusd: number | null;
  charged_microusd: number | null;
  refunded_microusd: number | null;
}

export interface EventsQuery {
  from?: string; to?: string; key?: string; outcome?: string; surface?: string; operation?: string;
  provider?: string; connector?: string; company?: string; cursor?: string;
}

/** A `(created_at, id)` position, newest first. Opaque to the client. */
function encodeCursor(createdAt: string, id: number): string {
  return btoa(JSON.stringify([createdAt, id])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(cursor: string | undefined): [string, number] | null {
  if (cursor === undefined || cursor === '') return null;
  try {
    const v = JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/')));
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v[0])
      && Number.isSafeInteger(v[1]) && v[1] > 0) return [v[0], v[1]];
  } catch { /* falls through to the refusal */ }
  throw new ReportInputError('invalid_cursor', 'That page cursor is not one this list gave.');
}

const EVENTS_SQL = `SELECT e.id, e.execution_id, e.created_at, e.surface, e.operation,
    CASE WHEN e.outcome <> 'ok' AND e.error_category = 'insufficient_tokens' THEN 'insufficient_tokens' ELSE e.outcome END AS result,
    e.error_category, e.duration_ms, e.api_key_uid, e.grant_id, e.client, e.company_id, e.model, e.provider, e.connector,
    e.reservation_uid,
    CASE WHEN e.reservation_uid IS NULL THEN e.held_microusd ELSE r.included_microusd + r.topup_microusd END AS reserved,
    CASE WHEN e.reservation_uid IS NULL THEN e.charged_microusd
      WHEN r.status IN ('settled', 'refunded') THEN r.actual_included_microusd + r.actual_topup_microusd END AS charged,
    CASE WHEN r.status IN ('settled', 'refunded')
      THEN (r.included_microusd + r.topup_microusd) - (r.actual_included_microusd + r.actual_topup_microusd) END AS refunded
  FROM api_usage_events e
  LEFT JOIN ai_budget_reservations r ON r.uid = e.reservation_uid AND r.user_id = e.user_id
  WHERE e.user_id = ?1 AND e.created_at >= ?2 AND e.created_at < ?3
    AND (?4 IS NULL OR e.api_key_uid = ?4)
    AND (?5 IS NULL OR (CASE WHEN e.outcome <> 'ok' AND e.error_category = 'insufficient_tokens' THEN 'insufficient_tokens' ELSE e.outcome END) = ?5)
    AND (?6 IS NULL OR e.surface = ?6)
    AND (?7 IS NULL OR e.operation = ?7)
    AND (?8 IS NULL OR e.provider = ?8)
    AND (?9 IS NULL OR e.connector = ?9)
    AND (?10 IS NULL OR e.company_id = ?10)
    AND (?11 IS NULL OR e.created_at < ?11 OR (e.created_at = ?11 AND e.id < ?12))
  ORDER BY e.created_at DESC, e.id DESC
  LIMIT ?13`;

/** `GET /api/developer/usage/events`: the member's own calls, newest first, never an argument or a result. */
export async function usageEvents(env: Env, userId: number, q: EventsQuery, now = new Date()) {
  const range = parseRange(q.from, q.to, now);
  const outcome = oneOf(q.outcome, REPORT_OUTCOMES, 'invalid_outcome', 'Filter by ok, refused, rate_limited, insufficient_tokens or error.');
  const surface = oneOf(q.surface, ['mcp', 'api'] as const, 'invalid_surface', 'Filter by mcp or api.');
  let company: number | null = null;
  if (q.company !== undefined && q.company !== '') {
    company = /^[1-9]\d{0,15}$/.test(q.company) ? Number(q.company) : NaN;
    if (!Number.isSafeInteger(company)) throw new ReportInputError('invalid_company', 'Give the company as its number.');
  }
  const operation = text(q.operation, 'operation');
  const provider = text(q.provider, 'provider');
  const connector = text(q.connector, 'connector');
  const after = decodeCursor(q.cursor);
  const key = await checkedKey(env, userId, q.key);

  const res = await env.DB.prepare(EVENTS_SQL).bind(
    userId, range.fromTs, range.toTs, key, outcome, surface, operation, provider, connector, company,
    after?.[0] ?? null, after?.[1] ?? null, EVENT_PAGE + 1,
  ).all<Record<string, unknown>>();
  const rows = res.results ?? [];
  const page = rows.slice(0, EVENT_PAGE);
  const last = page[page.length - 1];
  return {
    range: { from: range.from, to: range.to },
    events: page.map((r): UsageEventRow => ({
      execution_id: String(r.execution_id),
      created_at: String(r.created_at),
      surface: String(r.surface),
      operation: String(r.operation),
      outcome: r.result as ReportOutcome,
      error_category: (r.error_category as string | null) ?? null,
      duration_ms: int(r.duration_ms),
      api_key_uid: (r.api_key_uid as string | null) ?? null,
      grant_id: (r.grant_id as string | null) ?? null,
      client: (r.client as string | null) ?? null,
      company_id: intOrNull(r.company_id),
      model: (r.model as string | null) ?? null,
      provider: (r.provider as string | null) ?? null,
      connector: (r.connector as string | null) ?? null,
      reservation_uid: (r.reservation_uid as string | null) ?? null,
      reserved_microusd: intOrNull(r.reserved),
      charged_microusd: intOrNull(r.charged),
      refunded_microusd: intOrNull(r.refunded),
    })),
    next_cursor: rows.length > EVENT_PAGE && last ? encodeCursor(String(last.created_at), int(last.id)) : null,
  };
}
