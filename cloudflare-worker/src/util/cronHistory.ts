/**
 * End-of-cron run-history finalize write, extracted from the scheduled
 * handler's `finally` block so the retry-on-overload path is unit-testable.
 *
 * The `cron_run_history` INSERT is the last thing every tick does, so it's the
 * write most likely to hit a transient "D1 DB is overloaded" right after a
 * heavy burst. Wrapping it in `withD1Retry` lets the run summary still land
 * after a blip instead of logging `cron history write failed`. A non-transient
 * error (e.g. a real schema bug) is NOT retried — it surfaces immediately so we
 * never mask bugs behind backoff.
 *
 * Mirrors the `util/reembedSweep.ts` extraction: the scheduled handler calls
 * this helper so the production path is exactly what the tests exercise.
 */
import type { Env } from '../types';
import { withD1Retry } from './d1Retry';

export interface CronRunHistoryRecord {
  /** The cron trigger key (the cron expression that fired). */
  triggerName: string;
  /** When the tick started, formatted `YYYY-MM-DD HH:MM:SS` (UTC). */
  startedAt: string;
  /** Non-null when the batch threw; persisted to the `error` column. */
  cronError: string | null;
  /** Per-branch summary fragments; joined with ` | ` (empty -> NULL). */
  summary: string[];
}

/**
 * Persist one `cron_run_history` row, retrying only transient D1 overload
 * blips. Resolves once the row lands; rejects (without retry) on a real
 * SQL/schema error so the caller's catch can log `cron history write failed`.
 */
export async function writeCronRunHistory(
  env: Env,
  rec: CronRunHistoryRecord,
  opts?: { retries?: number; baseDelayMs?: number; now?: () => Date },
): Promise<void> {
  const clock = opts?.now ?? (() => new Date());
  const finishedAt = clock().toISOString().replace('T', ' ').slice(0, 19);
  await withD1Retry(
    () =>
      env.DB.prepare(
        `INSERT INTO cron_run_history (trigger_name, started_at, finished_at, status, summary, error)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          rec.triggerName,
          rec.startedAt,
          finishedAt,
          rec.cronError ? 'failed' : 'completed',
          rec.summary.join(' | ') || null,
          rec.cronError,
        )
        .run(),
    { retries: opts?.retries, baseDelayMs: opts?.baseDelayMs },
  );
}
