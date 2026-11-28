/**
 * D9033 (#9033) — the monitoring log tables keep 30 days, pruned every night
 * in bounded batches.
 *
 * WHAT IT PRUNES. Four tables that grow with traffic and that nothing reads by
 * age beyond a short window:
 *
 *   system_metrics    one row per metered `/api/*` request and per job
 *                     (middleware/observability.ts, queue-consumer.ts,
 *                     services/queueWorker.ts); every reader uses a window of
 *                     an hour or less. Admin comparisons over longer periods
 *                     read `analytics_snapshots` (the 02:05 snapshot).
 *   error_logs        request and job errors; holds `user_id` (personal data).
 *   rate_limit_logs   rate-limit decisions; holds `user_id` (personal data).
 *   cf_dlq_mirror     dead letters of the Cloudflare job queue, kept as long
 *                     as `dead_letter_queue` keeps its rows (Jobs.cleanup).
 *
 * LOG_RETENTION_DAYS (30) is the cutoff `POST /api/monitoring/cleanup` used
 * before this file, and `dead_letter_queue`'s. The route now calls this same
 * function, so the manual button and the cron cannot drift apart.
 *
 * WHERE IT RUNS. `runLogPrune` is called from the scheduled handler's 03:00
 * block in `index.ts`, beside `Jobs.cleanup`, on every deployment (each one
 * writes its own tables). Each table is one cron sub-task, `log prune <table>`,
 * recorded done (with what it deleted) or failed in the tick's
 * `cron_run_history.task_outcomes`; a failing table does not stop the others.
 *
 * WHY BATCHES. Each statement deletes at most `batchRows` (LOG_PRUNE_BATCH_ROWS,
 * 500) rows, by rowid from a LIMITed subquery, so no statement holds the
 * database for long. One run deletes at most `maxBatches`
 * (LOG_PRUNE_MAX_BATCHES, 40) batches per table, 20,000 rows; a table with
 * more old rows than that is `capped` and the next night continues.
 *
 * THE COMPARISON. `col < ? AND datetime(col) < datetime(?)`: the bare range
 * lets SQLite walk the table's time index (idx_metrics_ts, idx_errlog_ts,
 * idx_rl_ts, idx_cf_dlq_time) instead of scanning the table, and the
 * `datetime()` term is the exact test (D124: an ISO `T` stamp and a
 * `datetime('now')` stamp compare correctly only through it). A row the bare
 * term passes over (an ISO stamp on the cutoff's own date) is kept one more
 * day, never deleted early.
 */
import type { Env } from '../types';

export const LOG_RETENTION_DAYS = 30;
export const LOG_PRUNE_BATCH_ROWS = 500;
export const LOG_PRUNE_MAX_BATCHES = 40;

/** Each pruned table and its time column. The names are fixed here, never taken from a caller. */
export const LOG_TABLES = [
  { table: 'system_metrics', column: 'timestamp' },
  { table: 'error_logs', column: 'created_at' },
  { table: 'rate_limit_logs', column: 'created_at' },
  { table: 'cf_dlq_mirror', column: 'received_at' },
] as const;

export type LogTable = (typeof LOG_TABLES)[number]['table'];

export interface LogPruneResult {
  table: LogTable;
  ok: boolean;
  deleted: number;
  batches: number;
  /** True when the run stopped at maxBatches: old rows may remain for the next run. */
  capped: boolean;
  error?: unknown;
}

/** `YYYY-MM-DD HH:MM:SS`, the format `datetime('now')` writes. */
export function logCutoff(now: Date, days = LOG_RETENTION_DAYS): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * The rows one batch deletes: up to `?3` rows of `table` older than the cutoff
 * (`?1`, `?2`), found through the table's time index. Exported so a test can
 * read its query plan.
 */
export function pruneCandidatesSql(table: LogTable, column: string): string {
  return `SELECT rowid FROM ${table} WHERE ${column} < ? AND datetime(${column}) < datetime(?) LIMIT ?`;
}

/** Prune every log table older than the cutoff, each on its own; one table failing never stops the next. */
export async function pruneLogTables(
  env: Env,
  opts?: { now?: Date; batchRows?: number; maxBatches?: number },
): Promise<{ cutoff: string; results: LogPruneResult[] }> {
  const cutoff = logCutoff(opts?.now ?? new Date());
  const batchRows = opts?.batchRows ?? LOG_PRUNE_BATCH_ROWS;
  const maxBatches = opts?.maxBatches ?? LOG_PRUNE_MAX_BATCHES;
  const results: LogPruneResult[] = [];
  for (const { table, column } of LOG_TABLES) {
    const r: LogPruneResult = { table, ok: false, deleted: 0, batches: 0, capped: false };
    const sql = `DELETE FROM ${table} WHERE rowid IN (${pruneCandidatesSql(table, column)})`;
    try {
      while (r.batches < maxBatches) {
        const res = await env.DB.prepare(sql).bind(cutoff, cutoff, batchRows).run();
        r.batches += 1;
        const n = Number((res.meta as { changes?: number } | undefined)?.changes ?? 0);
        r.deleted += Number.isFinite(n) ? n : 0;
        if (!(n >= batchRows)) break;
      }
      r.capped = r.batches >= maxBatches && r.deleted >= r.batches * batchRows;
      r.ok = true;
    } catch (e) {
      r.error = e;
    }
    results.push(r);
  }
  return { cutoff, results };
}

/** What the tick records: one sub-task per table. `failed` is the tick's own `taskFailed`. */
export interface LogPruneTasks {
  done(task: string, note?: string): void;
  failed(task: string, ...detail: unknown[]): void;
}

/** The 03:00 cron's call: prune, then record each table as done (with its count) or failed. */
export async function runLogPrune(env: Env, now: Date, tasks: LogPruneTasks): Promise<LogPruneResult[]> {
  const { results } = await pruneLogTables(env, { now });
  for (const r of results) {
    const task = `log prune ${r.table}`;
    if (r.ok) tasks.done(task, `deleted=${r.deleted} batches=${r.batches}${r.capped ? ' capped' : ''}`);
    else tasks.failed(task, r.error);
  }
  return results;
}
