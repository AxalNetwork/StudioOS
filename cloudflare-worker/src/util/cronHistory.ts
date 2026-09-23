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
 * THE FORMAT IS `YYYY-MM-DD HH:MM:SS` UTC, on every write, and every
 * comparison this module makes is at MINUTE granularity in that format. A
 * tick's wall-clock `started_at` trails its scheduled minute by up to a
 * minute (production: 06:00:52 for the 06:00 tick), so comparing to the
 * second would call a punctual tick late.
 */
import type { Env } from '../types';
import { withD1Retry } from './d1Retry';
import { prevCronRun, sqlStamp } from './cronSchedule';

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
export async function latestRunPerTrigger(
  env: Env,
  exprs: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, CronRunRow | null>> {
  const ceiling = sqlStamp(now.getTime() + 60_000);
  const rows = await Promise.all(
    exprs.map((expr) =>
      env.DB.prepare(
        `SELECT trigger_name, started_at, finished_at, status, error
           FROM cron_run_history
          WHERE trigger_name = ?
            AND datetime(started_at) <= datetime(?)
          ORDER BY started_at DESC
          LIMIT 1`,
      )
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
