/**
 * `cron_run_history` — every write to it, every read of it, and what a row
 * means. One module, so the handler that records a tick and the two screens
 * that read the record (HQ · Platform and the Admin Console's Cron tab)
 * cannot drift apart about any of the three (D201).
 *
 * TWO WRITES, BECAUSE A TICK ENDS ONE OF TWO WAYS.
 *
 *   writeCronRunHistory   the tick that holds the lease and ran the minute:
 *                         `completed`, or `failed` when the batch threw.
 *   recordLeaseHeldFire   the tick that found the lease already held and ran
 *                         NOTHING. Until D201 it returned without a row, so
 *                         the record showed which expression WON THE LEASE,
 *                         not whether the work ran. Five of the six declared
 *                         triggers read as silent on HQ while their work ran
 *                         every day under the every-minute ticker's name.
 *
 * WHAT A ROW MEANS, as HQ reads it (`triggerState`):
 *
 *   completed   the tick ran the minute
 *   deduped     a tick scheduled for the SAME minute held the lease, and this
 *               minute's work runs under that tick's row
 *   skipped     the lease was held by a tick scheduled for a DIFFERENT minute
 *               (an overrun, or this tick delivered late); this tick ran
 *               nothing, and no other tick runs this minute's
 *               wall-clock-gated work either
 *   failed      the batch threw
 *
 * RETENTION (D237). `pruneCronRunHistory` keeps CRON_HISTORY_RETENTION_DAYS
 * (30) days of rows, and ALWAYS the newest row of every trigger however old.
 * Nothing deleted from this table before D237: production held 152,331 rows
 * on 2026-09-24, 108,976 of them older than 30 days.
 *
 *   Why 30 days. Two things read this table. `latestRunPerTrigger` reads
 *   only each trigger's newest row, which the sweep never deletes, so a
 *   weekly trigger whose last run was 40 days ago still reads by that run
 *   and not as `never`. The Cron tab pages the raw list newest first, 100 at
 *   a time. At about 1,500 rows a day, 30 days is some 450 pages, far past
 *   anything a person pages to. Nothing reads a row by age beyond that, and
 *   no report totals the table over time.
 *
 *   Why batches, and the cap. Each statement deletes at most
 *   PRUNE_BATCH_ROWS (500) rows, by id from a LIMITed subquery, so no single
 *   statement holds the database for long. One sweep runs at most
 *   PRUNE_MAX_BATCHES (50) statements, 25,000 rows. The first sweep met
 *   about 109,000 rows and clears them over five daily runs. After that a
 *   day adds far fewer rows than the cap, so one run clears the day.
 *
 * THE FORMAT IS `YYYY-MM-DD HH:MM:SS` UTC, on every write, and every
 * comparison this module makes is at MINUTE granularity in that format. A
 * tick's wall-clock `started_at` trails its scheduled minute by up to a
 * minute (production: 06:00:52 for the 06:00 tick), so comparing to the
 * second would call a punctual tick late.
 */
import type { Env } from '../types';
import { withD1Retry } from './d1Retry';
import { prevCronRun, sqlStamp } from './cronSchedule';
import { branchOf } from './branch';

/**
 * The cron expressions `wrangler.toml` declares, in `[triggers]` and again in
 * `[env.production.triggers]`. NOT kept in sync by hand:
 * `cron_record_d201.test.ts` parses both tables and fails when this list and
 * either one disagree. The expression is the key, because the scheduled handler
 * stores `event.cron` as `trigger_name`; the name is for display only.
 *
 * Weekdays are CLOUDFLARE'S numbering, 1 = Sunday. The weekly entry was
 * `0 9 * * 1` until D201 and fired on Sundays; `2` is Monday.
 */
export const CRON_TRIGGERS: ReadonlyArray<{ name: string; expr: string }> = [
  { name: 'scheduled', expr: '* * * * *' },
  { name: 'cleanup', expr: '0 3 * * *' },
  { name: 'mi_refresh', expr: '0 */6 * * *' },
  { name: 'mi_snapshot', expr: '0 4 * * *' },
  { name: 'daily_digest', expr: '0 9 * * *' },
  { name: 'weekly_digest', expr: '0 9 * * 2' },
];

/**
 * D238 — the crons a BRANCH fires: the queue drain and the nightly cleanup.
 * The worker's copy of `BRANCH_CRONS` in `scripts/lib/branchConfig.mjs`, which
 * writes each branch's wrangler `[triggers]` from its own list. The two may
 * never differ, and `cron_triggers_branch_d238.test.ts` fails when they do.
 * `cron_record_d201.test.ts` keeps asserting it is a subset of CRON_TRIGGERS.
 */
export const BRANCH_CRONS: readonly string[] = ['* * * * *', '0 3 * * *'];

/**
 * The triggers THIS deployment fires, and so the ones it is graded against.
 * HQ keeps CRON_TRIGGERS. A branch reads its own two: graded against HQ's six,
 * four of them would read "never fired" for ever, which is false, because a
 * branch never fires them.
 */
export function triggersFor(env: Pick<Env, 'BRANCH_CODE'>): ReadonlyArray<{ name: string; expr: string }> {
  if (branchOf(env) === null) return CRON_TRIGGERS;
  return CRON_TRIGGERS.filter((t) => BRANCH_CRONS.includes(t.expr));
}

/**
 * The four states HQ reads a trigger in, in precedence order. There is no
 * `running`: every write sets `finished_at`, so no writer can leave a row that
 * would read that way, and a state nothing can produce is decoration.
 */
export const TRIGGER_STATES = ['never', 'stale', 'failed', 'ok'] as const;
export type TriggerState = (typeof TRIGGER_STATES)[number];

/**
 * Row statuses that mean the minute's work did not run. `error` is legacy:
 * no writer produces it now, but rows from before D201 may carry it. The
 * Admin Console's Cron tab colours the same set red, and
 * `cron_record_d201.test.ts` fails when its copy and this one differ.
 */
export const FAILED_STATUSES: ReadonlySet<string> = new Set(['failed', 'error', 'skipped']);

/**
 * How long after its scheduled minute a trigger's row may still be missing
 * before HQ calls the trigger silent. Measured rather than chosen: a scheduled
 * invocation may run for up to 15 minutes (Cloudflare workers/platform/limits,
 * "Duration"), and the row is written as the tick ENDS, in its `finally`. The
 * sixteenth minute covers dispatch lag: production ticks start up to 52
 * seconds after their minute. Any shorter grace calls a long-running tick
 * silent while it is still working.
 */
export const STALE_GRACE_MINUTES = 16;

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
 * Persist the row of a tick that ran, retrying only transient D1 overload
 * blips. The INSERT is the last thing every tick does, so it is the write
 * most likely to meet "D1 DB is overloaded" right after a heavy burst.
 * Resolves once the row lands; rejects (without retry) on a real SQL or
 * schema error, so the caller's catch can log `cron history write failed`
 * rather than a real bug hiding behind backoff.
 */
export async function writeCronRunHistory(
  env: Env,
  rec: CronRunHistoryRecord,
  opts?: { retries?: number; baseDelayMs?: number; now?: () => Date },
): Promise<void> {
  const clock = opts?.now ?? (() => new Date());
  const finishedAt = sqlStamp(clock().getTime());
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

/**
 * The value a tick writes into the `cron:queue:lease` key: an id only it
 * knows, the minute it was scheduled for, and the expression that fired it.
 * A tick that finds the lease held can then say WHICH tick holds it, which
 * is the whole difference between `deduped` and `skipped`. The handler's
 * `finally` compares the whole string, so the id alone still decides who
 * releases the lease.
 */
export function leaseHolderValue(id: string, scheduledTime: number, cron: string): string {
  return `${id}|${scheduledTime}|${cron}`;
}

/**
 * Read a lease value back. A value with no `|` is a bare UUID written by the
 * handler before D201, which records no scheduled time; that can only be read
 * within the lease's 90-second life after the deploy that changed the format.
 */
export function parseLeaseHolder(value: string): { scheduledTime: number | null; cron: string | null } {
  const first = value.indexOf('|');
  if (first < 0) return { scheduledTime: null, cron: null };
  const second = value.indexOf('|', first + 1);
  const schedText = second < 0 ? value.slice(first + 1) : value.slice(first + 1, second);
  const sched = Number(schedText);
  return {
    scheduledTime: schedText !== '' && Number.isFinite(sched) ? sched : null,
    cron: second < 0 ? null : value.slice(second + 1) || null,
  };
}

export interface LeaseHeldFire {
  /** The expression of the tick that found the lease held. */
  triggerName: string;
  /** That tick's `event.scheduledTime`, in milliseconds. */
  scheduledTime: number;
  /** The lease value it read. */
  holder: string;
}

const hhmm = (ms: number) => sqlStamp(ms).slice(11, 16);
const minuteOf = (ms: number) => Math.floor(ms / 60_000);

/** Which of the two states a lease-held tick is, and the sentence that says why. */
export function classifyLeaseHeld(fire: LeaseHeldFire): { status: 'deduped' | 'skipped'; text: string } {
  const holder = parseLeaseHolder(fire.holder);
  const who = holder.cron ? `the '${holder.cron}' tick` : 'the tick';
  if (holder.scheduledTime === null) {
    return {
      status: 'skipped',
      text: 'The lease was held by a tick whose scheduled time was not recorded, so it cannot be said '
        + 'whether that tick ran this minute; this tick ran nothing.',
    };
  }
  const theirs = minuteOf(holder.scheduledTime);
  const ours = minuteOf(fire.scheduledTime);
  if (theirs === ours) {
    return {
      status: 'deduped',
      text: `${who[0].toUpperCase()}${who.slice(1)} scheduled for the same minute holds the lease, so this `
        + 'minute\'s work runs under that tick\'s row.',
    };
  }
  return {
    status: 'skipped',
    text: `The lease was held by ${who} scheduled for ${hhmm(holder.scheduledTime)} UTC, `
      + (theirs < ours ? 'which had not finished' : 'a later minute than this one')
      + '; this tick ran nothing.',
  };
}

/**
 * Record a tick that found the lease held. It NEVER throws: this runs where
 * the handler is about to return having done nothing, and a throw there
 * would fail the scheduled event itself, which a skipped minute should not
 * do. Returns the status it wrote, or null when the write failed.
 *
 * `started_at` is the tick's SCHEDULED minute, the moment the row stands
 * for; `finished_at` is now.
 */
export async function recordLeaseHeldFire(
  env: Env,
  fire: LeaseHeldFire,
  opts?: { retries?: number; baseDelayMs?: number; now?: () => Date },
): Promise<'deduped' | 'skipped' | null> {
  try {
    const clock = opts?.now ?? (() => new Date());
    const nowMs = clock().getTime();
    const scheduled = Number.isFinite(fire.scheduledTime) ? fire.scheduledTime : nowMs;
    const { status, text } = classifyLeaseHeld({ ...fire, scheduledTime: scheduled });
    await withD1Retry(
      () =>
        env.DB.prepare(
          `INSERT INTO cron_run_history (trigger_name, started_at, finished_at, status, summary, error)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            fire.triggerName,
            sqlStamp(minuteOf(scheduled) * 60_000),
            sqlStamp(nowMs),
            status,
            status === 'deduped' ? text : null,
            status === 'skipped' ? text : null,
          )
          .run(),
      { retries: opts?.retries, baseDelayMs: opts?.baseDelayMs },
    );
    return status;
  } catch (e) {
    console.error('[cron] lease-held record failed', e);
    return null;
  }
}

export interface CronRunRow {
  trigger_name: string;
  started_at: string | null;
  finished_at: string | null;
  status: string | null;
  error: string | null;
}

/**
 * The newest row for each expression, one indexed read per trigger
 * (`idx_crh_trigger_time`). This replaced a `GROUP BY trigger_name` over the
 * whole table, which read every row on every Platform load (150,444 in
 * production on 2026-09-23) and was written twice, once per screen. Rejects
 * when the table cannot be read; the caller says so rather than showing an
 * empty record.
 *
 * A ROW DATED AFTER THE NEXT MINUTE IS NOT A RUN, and it is skipped. No tick
 * can write one: a tick's row is dated at or before the moment it is written.
 * But the retired `POST /api/infra/cron-log` let any admin bind any
 * `started_at`, and one row dated in the future would be the newest for ever,
 * reading `ok` over a trigger that had stopped. The minute of slack is clock
 * skew between the isolate that wrote a row and the one reading it.
 */
/**
 * The newest row of one trigger, no later than a ceiling. One statement for
 * BOTH its readers, `latestRunPerTrigger` and the prune's keep list, so the
 * row the prune protects is exactly the row the screens read.
 */
const NEWEST_ROW_SQL = `SELECT id, trigger_name, started_at, finished_at, status, error
           FROM cron_run_history
          WHERE trigger_name = ?
            AND datetime(started_at) <= datetime(?)
          ORDER BY started_at DESC
          LIMIT 1`;

export async function latestRunPerTrigger(
  env: Env,
  exprs: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, CronRunRow | null>> {
  const ceiling = sqlStamp(now.getTime() + 60_000);
  const rows = await Promise.all(
    exprs.map((expr) =>
      env.DB.prepare(NEWEST_ROW_SQL)
        .bind(expr, ceiling)
        .first<CronRunRow>(),
    ),
  );
  return new Map(exprs.map((expr, i) => [expr, rows[i] ?? null]));
}

/**
 * Read one trigger's newest row against its own schedule.
 *
 *   never    no row at all
 *   stale    the newest row is older than the last minute the expression was
 *            scheduled to fire, allowing the grace
 *   failed   the newest row's work did not run (`failed`, `skipped`, or the
 *            legacy `error`)
 *   ok       otherwise
 *
 * In that precedence: a trigger that stopped firing is newer news than the
 * failure of its last run. `expected_at` is null only when the expression
 * cannot be parsed, and then the trigger cannot be stale, since nothing says
 * when it should have fired.
 */
export function triggerState(
  expr: string,
  row: CronRunRow | null,
  now: Date = new Date(),
  graceMinutes: number = STALE_GRACE_MINUTES,
): { state: TriggerState; expected_at: string | null } {
  const expected_at = prevCronRun(expr, new Date(now.getTime() - graceMinutes * 60_000));
  if (!row || !row.started_at) return { state: 'never', expected_at };
  // Normalised to the store's format before comparing, so a stray ISO value
  // (the retired /cron-log route bound whatever it was sent) reads by its
  // time and not by where 'T' sorts against ' '.
  const started = String(row.started_at).replace('T', ' ').slice(0, 16);
  if (expected_at && started < expected_at.slice(0, 16)) return { state: 'stale', expected_at };
  if (FAILED_STATUSES.has(String(row.status || ''))) return { state: 'failed', expected_at };
  return { state: 'ok', expected_at };
}

/* ------------------------------------------------------------------ *
 * Retention (D237). The reasons for the window and the cap are in the  *
 * file header.                                                         *
 * ------------------------------------------------------------------ */

export const CRON_HISTORY_RETENTION_DAYS = 30;
export const PRUNE_BATCH_ROWS = 500;
export const PRUNE_MAX_BATCHES = 50;
/** D1 binds at most 100 parameters, and the delete binds two besides the keep list. */
const MAX_KEEP_IDS = 90;

export interface CronPruneResult {
  /** False when the table could not be read, or the keep list could not be built. */
  readable: boolean;
  deleted: number;
  batches: number;
  /** The newest row of each trigger, which the sweep never deletes. */
  kept: number;
  /** True when the per-sweep cap stopped it with old rows still left. */
  capped: boolean;
}

/**
 * Delete rows older than the retention window, keeping each trigger's newest
 * row. It never throws: it runs inside the scheduled handler, and a failed
 * prune must not fail the tick.
 *
 * THE KEEP LIST IS BUILT FIRST, and if it cannot be built nothing is deleted.
 * Deleting without it could remove a weekly trigger's only row and turn it
 * into `never fired`, the one wrong answer this sweep can produce. A row
 * written while the sweep runs is newer than the window, so it is never a
 * candidate and the keep list cannot go stale mid-sweep.
 */
export async function pruneCronRunHistory(
  env: Env,
  opts?: { now?: Date; batchRows?: number; maxBatches?: number },
): Promise<CronPruneResult> {
  const now = opts?.now ?? new Date();
  const batchRows = opts?.batchRows ?? PRUNE_BATCH_ROWS;
  const maxBatches = opts?.maxBatches ?? PRUNE_MAX_BATCHES;
  const cutoff = sqlStamp(now.getTime() - CRON_HISTORY_RETENTION_DAYS * 86_400_000);
  const ceiling = sqlStamp(now.getTime() + 60_000);
  const result: CronPruneResult = { readable: false, deleted: 0, batches: 0, kept: 0, capped: false };

  let keep: number[];
  try {
    const names = await env.DB.prepare('SELECT DISTINCT trigger_name FROM cron_run_history')
      .all<{ trigger_name: string }>();
    const triggers = (names.results || []).map((r) => r.trigger_name);
    if (triggers.length > MAX_KEEP_IDS) {
      console.warn('[cron] cron_run_history prune skipped: too many trigger names to keep', triggers.length);
      return result;
    }
    const newest = await Promise.all(
      triggers.map((t) => env.DB.prepare(NEWEST_ROW_SQL).bind(t, ceiling).first<{ id: number }>()),
    );
    keep = newest.map((r) => Number(r?.id)).filter((id) => Number.isInteger(id));
  } catch (e) {
    console.error('[cron] cron_run_history prune could not build its keep list', e);
    return result;
  }
  result.readable = true;
  result.kept = keep.length;

  const keepClause = keep.length ? `AND id NOT IN (${keep.map(() => '?').join(', ')})` : '';
  const sql = `DELETE FROM cron_run_history
                WHERE id IN (
                  SELECT id FROM cron_run_history
                   WHERE datetime(started_at) < datetime(?)
                     ${keepClause}
                   LIMIT ?
                )`;
  try {
    while (result.batches < maxBatches) {
      const r = await env.DB.prepare(sql).bind(cutoff, ...keep, batchRows).run();
      result.batches += 1;
      const n = Number((r.meta as { changes?: number } | undefined)?.changes);
      if (!Number.isFinite(n)) break;
      result.deleted += n;
      if (n < batchRows) return result;
    }
    result.capped = result.batches >= maxBatches;
  } catch (e) {
    console.error('[cron] cron_run_history prune failed after', result.deleted, 'rows', e);
  }
  return result;
}
