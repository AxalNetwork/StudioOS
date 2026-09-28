/**
 * "What have I spent on AI this month?" — the caller's own meter.
 *
 * Phase 4 opened with a false premise recorded in the UI layer: `AssistRail`
 * and `ui/index.js` both said there was "no eadwyn AI Gateway yet". There is
 * one. `services/aiRouter.ts` routes twenty-three task classes (its `TaskClass`
 * union; sixteen when this was written) across Workers AI
 * models with a fallback chain, a llama-guard safety pass, content-hash
 * caching, per-user $/day and $/month KV caps, an org-wide kill switch, and a
 * row in `ai_usage_logs` for every call. What was missing is much narrower:
 * nothing exposed any of it to the person spending the money. The only rollup
 * over `ai_usage_logs` is `/api/monitoring/ai-usage`, which is `requireAdmin`.
 *
 * So the rail's spend meter had no source, and the component took `totalSpend`
 * and `planCap` as props — numbers a caller passes in. This module is the real
 * source.
 *
 * TWO NUMBERS, NOT ONE, and they are deliberately not merged:
 *
 *   spend_usd     Σ est_cost_usd from `ai_usage_logs` — durable and complete,
 *                 the auditable record of what was actually charged.
 *   enforced_usd  the KV counter at `ai_spend:<user>:<period>` — what the
 *                 router will actually check before allowing the next call.
 *
 * They can legitimately disagree. aiRouter's own note says KV has no atomic
 * increment and concurrent calls may lose updates, so the enforced figure can
 * undercount; the KV keys also carry a TTL and expire, while D1 rows do not.
 * Reporting one number would mean either showing a meter that does not match
 * what refuses the next call, or showing an enforcement counter as if it were
 * an invoice. Both are reported, each labelled.
 *
 * RECORDED VS ZERO. A user who has made no calls has spent $0 — that is a
 * fact. A table that is absent, or a query that failed, is NOT $0; it is an
 * absence of record, and drawing an empty meter from it asserts something the
 * platform does not know. `recorded: false` with `spend_usd: null` is the
 * honest answer there, and the same rule the fund surfaces follow.
 */
import type { Env } from '../types';
import { aiUsageSelfScope } from './tenancyScope';
import type { Actor } from './tenancyScope';

export interface AiSpendPeriod {
  /** 'YYYY-MM' for the month, 'YYYY-MM-DD' for the day. */
  key: string;
  /** Σ est_cost_usd over the period. `null` when nothing is recorded. */
  spend_usd: number | null;
  /** The cap the router enforces for this period, from budgetCaps(). */
  cap_usd: number;
  /** The KV counter the router actually checks. `null` when unavailable. */
  enforced_usd: number | null;
  calls: number;
}

export interface AiSpendReport {
  recorded: boolean;
  month: AiSpendPeriod;
  today: AiSpendPeriod;
  last_run: {
    task: string;
    model: string;
    cost_usd: number;
    /**
     * The row's token counts, as `ai_usage_logs` recorded them (D401). NULL
     * where the row's zero is not a count:
     *   - a cached answer or a refusal called no model, so nothing was
     *     billed in either direction and "0 in / 0 out" would read as a tiny
     *     run rather than no run;
     *   - a ZERO on a live call: a STREAMED call records completion 0 because
     *     the router forwards the body without reading it (aiRouter.ts, "we
     *     don't see the completion side"), and a transcription is billed by
     *     audio minute and records prompt 0.
     * They are the same figures `est_cost_usd` was computed from, so where the
     * provider omitted its usage they are the router's text-length estimate —
     * the rail labels them as the log's figures, not as a meter reading.
     */
    prompt_tokens: number | null;
    completion_tokens: number | null;
    cached: boolean;
    fallback_used: boolean;
    refusal: string | null;
    at: string;
  } | null;
  /**
   * FALSE WHEN THE LAST-RUN READ FAILED (D401). `last_run: null` used to mean
   * both "no calls yet" and "the query threw", and the rail could only say
   * the first. Now `null` + `true` is no calls, and `false` is unreadable.
   */
  last_run_recorded: boolean;
  by_task: Array<{ task: string; calls: number; spend_usd: number }>;
  /** The same split for the task breakdown the rail's average is drawn from. */
  by_task_recorded: boolean;
  /**
   * This month's spend per page (D404, migration 319): one entry per recorded
   * `surface`, plus ONE entry with `surface: null` for the month's runs that
   * carry no page — every row written before migration 319, and every run
   * from a caller that sends none. The null entry is reported rather than
   * dropped, so a reader can see how much of the month is unattributed
   * instead of reading a page's figure as the whole.
   */
  by_surface: Array<{ surface: string | null; calls: number; spend_usd: number }>;
  /** False when that read failed — including before migration 319 is applied. */
  by_surface_recorded: boolean;
}

/** UTC, sortable, no locale drift — the same keys aiRouter writes. */
function monthKey(now: Date): string { return now.toISOString().slice(0, 7); }
function dayKey(now: Date): string { return now.toISOString().slice(0, 10); }

interface MinimalKV { get(key: string): Promise<string | null> }

function kv(env: Env): MinimalKV | null {
  const e = env as unknown as { AI_SPEND?: MinimalKV; TOKENS?: MinimalKV };
  return e.AI_SPEND || e.TOKENS || null;
}

/**
 * Read one KV spend counter. Returns null rather than 0 when the store is
 * absent or the read throws — "we cannot see the enforcement counter" is a
 * different statement from "the counter is zero", and the meter says so.
 */
async function readEnforced(env: Env, key: string): Promise<number | null> {
  const store = kv(env);
  if (!store) return null;
  try {
    const v = await store.get(`ai_spend:${key}`);
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

/**
 * The caps aiRouter enforces. Read from the same env vars with the same
 * defaults rather than re-declared, so the meter cannot draw a cap the router
 * does not use. A test pins the two lists against each other.
 */
export const SPEND_CAP_VARS = {
  day: 'WORKERS_AI_BUDGET_USD_DAY',
  month: 'WORKERS_AI_BUDGET_USD_MONTH',
} as const;
export const SPEND_CAP_DEFAULTS = { day: 5, month: 50 } as const;

function caps(env: Env): { day: number; month: number } {
  const e = env as unknown as Record<string, string | undefined>;
  const num = (v: string | undefined, fallback: number) => {
    const n = v != null ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    day: num(e[SPEND_CAP_VARS.day], SPEND_CAP_DEFAULTS.day),
    month: num(e[SPEND_CAP_VARS.month], SPEND_CAP_DEFAULTS.month),
  };
}

/**
 * @param now injected so the caller controls the clock — the period boundary
 *        is the whole question this answers, and a test that cannot move the
 *        clock can only assert the shape, never the boundary.
 */
export async function loadMyAiSpend(env: Env, actor: Actor, now: Date): Promise<AiSpendReport> {
  const scope = aiUsageSelfScope(actor);
  const cap = caps(env);
  const mKey = monthKey(now);
  const dKey = dayKey(now);
  // 'YYYY-MM-DD HH:MM:SS' — the shape aiRouter writes into created_at, so a
  // string comparison orders correctly without a date function.
  const asAt = now.toISOString().slice(0, 19).replace('T', ' ');

  const empty = (key: string, cap_usd: number): AiSpendPeriod =>
    ({ key, spend_usd: null, cap_usd, enforced_usd: null, calls: 0 });

  // One query per period rather than a CASE-folded single scan: D1 is cheap
  // here (the table is indexed on (user_id, created_at)) and two plain
  // aggregates are far easier to read as correct than one nested one.
  // Two literal query strings rather than one with an interpolated length.
  // `substr(created_at, 1, ${n})` would have put a computed value into the SQL
  // text; it is only ever 7 or 10 here, but the shape is the one the tenancy
  // work spent a whole pass removing, and a later caller passing a
  // request-derived prefix would inherit it silently.
  const SUM_SQL = {
    month: `SELECT COUNT(*) AS calls, COALESCE(SUM(u.est_cost_usd), 0) AS spend
              FROM ai_usage_logs u
             WHERE ${scope.sql} AND substr(u.created_at, 1, 7) = ?`,
    day: `SELECT COUNT(*) AS calls, COALESCE(SUM(u.est_cost_usd), 0) AS spend
            FROM ai_usage_logs u
           WHERE ${scope.sql} AND substr(u.created_at, 1, 10) = ?`,
  } as const;

  const sum = async (period: 'month' | 'day', prefix: string) => {
    try {
      const row = await env.DB.prepare(SUM_SQL[period])
        .bind(...scope.binds, prefix).first<{ calls: number; spend: number }>();
      // A successful query with no rows still returns a row here (COUNT(*)),
      // so `null` back means the statement itself did not run.
      if (!row) return null;
      return { calls: Number(row.calls) || 0, spend: Number(row.spend) || 0 };
    } catch {
      // Table absent on a partial DB, or the query failed. Not zero.
      return null;
    }
  };

  const [mRow, dRow] = await Promise.all([sum('month', mKey), sum('day', dKey)]);
  const recorded = mRow !== null;

  const month: AiSpendPeriod = mRow
    ? { key: mKey, spend_usd: mRow.spend, cap_usd: cap.month, enforced_usd: null, calls: mRow.calls }
    : empty(mKey, cap.month);
  const today: AiSpendPeriod = dRow
    ? { key: dKey, spend_usd: dRow.spend, cap_usd: cap.day, enforced_usd: null, calls: dRow.calls }
    : empty(dKey, cap.day);

  const id = scope.binds[0];
  if (typeof id === 'number') {
    const [mEnf, dEnf] = await Promise.all([
      readEnforced(env, `${id}:${mKey}`),
      readEnforced(env, `${id}:${dKey}`),
    ]);
    month.enforced_usd = mEnf;
    today.enforced_usd = dEnf;
  }

  let last_run: AiSpendReport['last_run'] = null;
  let by_task: AiSpendReport['by_task'] = [];
  // Only a read that RAN can report its result. When the totals themselves
  // were unreadable neither query runs, and both stay false.
  let last_run_recorded = false;
  let by_task_recorded = false;
  let by_surface: AiSpendReport['by_surface'] = [];
  let by_surface_recorded = false;
  if (recorded) {
    try {
      // Bounded by `now`, like every other figure in this report. Without the
      // bound the "last run" was simply the caller's most recent row, which
      // could sit AFTER the instant the rest of the report describes — a
      // receipt for a call that has not happened as far as this response is
      // concerned. Harmless with a wall clock, incoherent the moment the
      // clock is anything else, and the report is explicitly as-at `now`.
      const r = await env.DB.prepare(
        `SELECT u.task, u.model, u.est_cost_usd, u.prompt_tokens, u.completion_tokens,
                u.cached, u.fallback_used, u.refusal, u.created_at
           FROM ai_usage_logs u
          WHERE ${scope.sql} AND u.created_at <= ?
          ORDER BY u.created_at DESC, u.id DESC LIMIT 1`,
      ).bind(...scope.binds, asAt).first<any>();
      if (r) {
        // No model was called for a cached answer or a refusal, so neither
        // direction has a count. On a live call a ZERO is not a count either:
        // a streamed call records no completion side, and a transcription
        // is billed by audio minute and records no prompt tokens. Only a
        // positive figure is one the router actually wrote down.
        const called = !r.cached && !r.refusal;
        const tok = (v: unknown) => {
          const n = Number(v);
          return Number.isFinite(n) && n > 0 ? n : null;
        };
        const tokensIn = called ? tok(r.prompt_tokens) : null;
        const tokensOut = called ? tok(r.completion_tokens) : null;
        last_run = {
          task: String(r.task ?? ''),
          model: String(r.model ?? ''),
          cost_usd: Number(r.est_cost_usd) || 0,
          prompt_tokens: tokensIn,
          completion_tokens: tokensOut,
          cached: !!r.cached,
          fallback_used: !!r.fallback_used,
          refusal: r.refusal ?? null,
          at: String(r.created_at ?? ''),
        };
      }
      last_run_recorded = true;
    } catch { /* leave null and unrecorded — an unreadable last run is not "no run" */ }

    try {
      const rows = await env.DB.prepare(
        `SELECT u.task AS task, COUNT(*) AS calls, COALESCE(SUM(u.est_cost_usd), 0) AS spend
           FROM ai_usage_logs u
          WHERE ${scope.sql} AND substr(u.created_at, 1, 7) = ?
          GROUP BY u.task
          ORDER BY spend DESC`,
      ).bind(...scope.binds, mKey).all<{ task: string; calls: number; spend: number }>();
      by_task = (rows.results || []).map((t) => ({
        task: String(t.task),
        calls: Number(t.calls) || 0,
        spend_usd: Number(t.spend) || 0,
      }));
      by_task_recorded = true;
    } catch { /* the totals above still stand; the breakdown is unrecorded, not empty */ }

    try {
      // Grouped on the column itself, so NULL is one group: the month's
      // unattributed runs. A missing column (migration 319 not yet applied)
      // throws here and leaves the breakdown unrecorded rather than empty.
      const rows = await env.DB.prepare(
        `SELECT u.surface AS surface, COUNT(*) AS calls, COALESCE(SUM(u.est_cost_usd), 0) AS spend
           FROM ai_usage_logs u
          WHERE ${scope.sql} AND substr(u.created_at, 1, 7) = ?
          GROUP BY u.surface
          ORDER BY spend DESC`,
      ).bind(...scope.binds, mKey).all<{ surface: string | null; calls: number; spend: number }>();
      by_surface = (rows.results || []).map((t) => ({
        surface: t.surface == null ? null : String(t.surface),
        calls: Number(t.calls) || 0,
        spend_usd: Number(t.spend) || 0,
      }));
      by_surface_recorded = true;
    } catch { /* unrecorded, not empty */ }
  }

  return { recorded, month, today, last_run, last_run_recorded, by_task, by_task_recorded, by_surface, by_surface_recorded };
}
