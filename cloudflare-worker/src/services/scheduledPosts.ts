/**
 * D250 — the scheduled-post sweep: the clock that sends a Telegram or X post
 * someone scheduled. Both consoles have offered "Schedule" since they were
 * built, and until D250 nothing ever sent a scheduled post: it sat at
 * 'scheduled' for ever. The send itself is not here. It is the console's own
 * `sendTelegramPost` / `sendXPost`, the same function the Send button calls,
 * so the enabled check, the claim, the lint, the send and the record cannot
 * differ between a click and the clock.
 *
 * HQ ONLY. The scheduled handler calls this under `hqCadences`: both consoles
 * are Super-Admin-only, and the bot token and the X client are HQ's.
 *
 * ONE PASS, IN FOUR STEPS, each its own statement so one failing costs only
 * itself:
 *   1. A row stuck in 'sending' for STALE_SENDING_MINUTES becomes 'failed',
 *      with a reason. It is NEVER re-sent: a send that died after Telegram or
 *      X accepted it would post twice. The console's Send is the retry.
 *   2. A 'scheduled' row whose `scheduled_for` SQLite cannot read
 *      (`datetime()` is NULL) becomes 'failed', with the value it could not
 *      read. It is never skipped for ever.
 *   3. Due rows are read `datetime(scheduled_for) <= datetime(?)`, bound to the
 *      tick's own minute (D239). `datetime()` on BOTH sides: the column has
 *      held ISO strings, SQL strings and strings with an offset, and a bare
 *      comparison is the ISO-versus-SQL defect this repo has shipped four
 *      times. `scheduled_for` is in check-timestamp-comparisons' TTL_COLUMN.
 *   4. Each due row goes through the console's send in mode 'clock', whose
 *      claim matches only a row still 'scheduled' and due, so two overlapping
 *      ticks send it once. At most SEND_CAP_PER_TICK sends a tick, each under
 *      SEND_DEADLINE_MS; what is left is logged and goes next minute.
 *
 * WHO A CLOCK SEND IS RECORDED AS. The admin who scheduled it, `scheduled_by`
 * (migration 290). A row scheduled before 290 has none, and falls back to
 * `created_by`, the admin who drafted it. Production held no scheduled row
 * of either kind when 290 was written, so no row takes that fallback today.
 */
import type { Env } from '../types';
import { sqlStamp } from '../util/cronSchedule';
import { withDeadline } from '../util/deadline';
import { sendTelegramPost } from '../routes/admin_telegram';
import { sendXPost } from '../routes/admin_x';
import { ensureTelegramSchema } from './telegramSchema';
import { ensureXSchema } from './xSchema';

/** A tick sends at most this many posts, both consoles together. */
export const SEND_CAP_PER_TICK = 10;
/** One send may take this long before the tick stops waiting on it. */
export const SEND_DEADLINE_MS = 25_000;
/**
 * A row still 'sending' after this is failed, never re-sent. A scheduled
 * invocation may run 15 minutes (Cloudflare's "Duration" limit, D201); twice
 * that leaves no live send it could be.
 */
export const STALE_SENDING_MINUTES = 30;

// Each table's three statements as complete literals: the two tables differ
// only in their name and X's thread heads, and SQL text is never assembled
// from a value (check-sql-prepare).
const TABLES = [
  {
    console: 'telegram',
    stale: `UPDATE telegram_posts
               SET status = 'failed',
                   send_error = 'The send started at ' || updated_at || ' UTC and never finished. It is not re-sent automatically, because the post may already be live; check the channel, then send it by hand if it is not.',
                   updated_at = datetime('now')
             WHERE status = 'sending' AND datetime(updated_at) <= datetime(?)`,
    unreadable: `UPDATE telegram_posts
                    SET status = 'failed',
                        send_error = 'The scheduled time ' || COALESCE('"' || scheduled_for || '"', '(none)') || ' could not be read as a time, so it was never due. Set the time again.',
                        updated_at = datetime('now')
                  WHERE status = 'scheduled' AND datetime(scheduled_for) IS NULL`,
    due: `SELECT id, scheduled_by, created_by, datetime(scheduled_for) AS at
            FROM telegram_posts
           WHERE status = 'scheduled'
             AND datetime(scheduled_for) <= datetime(?)`,
  },
  {
    console: 'x',
    stale: `UPDATE x_posts
               SET status = 'failed',
                   send_error = 'The send started at ' || updated_at || ' UTC and never finished. It is not re-sent automatically, because the post may already be live; check the channel, then send it by hand if it is not.',
                   updated_at = datetime('now')
             WHERE status = 'sending' AND datetime(updated_at) <= datetime(?)`,
    unreadable: `UPDATE x_posts
                    SET status = 'failed',
                        send_error = 'The scheduled time ' || COALESCE('"' || scheduled_for || '"', '(none)') || ' could not be read as a time, so it was never due. Set the time again.',
                        updated_at = datetime('now')
                  WHERE status = 'scheduled' AND datetime(scheduled_for) IS NULL`,
    due: `SELECT id, scheduled_by, created_by, datetime(scheduled_for) AS at
            FROM x_posts
           WHERE status = 'scheduled' AND thread_continuation_of IS NULL
             AND datetime(scheduled_for) <= datetime(?)`,
  },
] as const;

export interface SweepResult {
  stale_failed: number;
  unreadable_failed: number;
  due: number;
  sent: number;
  refused_or_failed: number;
  left_for_next_tick: number;
  errors: string[];
}

export async function sweepScheduledPosts(env: Env, now: Date): Promise<SweepResult> {
  const out: SweepResult = {
    stale_failed: 0, unreadable_failed: 0, due: 0, sent: 0, refused_or_failed: 0, left_for_next_tick: 0, errors: [],
  };
  await ensureTelegramSchema(env);
  await ensureXSchema(env);
  const dueBy = sqlStamp(now.getTime());
  const staleBefore = sqlStamp(now.getTime() - STALE_SENDING_MINUTES * 60_000);

  // 1 + 2 — the two ways a row is failed without being sent.
  for (const t of TABLES) {
    try {
      const r = await env.DB.prepare(t.stale).bind(staleBefore).run();
      out.stale_failed += Number((r.meta as { changes?: number } | undefined)?.changes ?? 0);
    } catch (e) { out.errors.push(`${t.console} stale: ${(e as Error).message}`); }
    try {
      const r = await env.DB.prepare(t.unreadable).run();
      out.unreadable_failed += Number((r.meta as { changes?: number } | undefined)?.changes ?? 0);
    } catch (e) { out.errors.push(`${t.console} unreadable: ${(e as Error).message}`); }
  }

  // 3 — what is due, oldest first, across both consoles.
  type Due = { console: 'telegram' | 'x'; id: number; scheduled_by: number | null; created_by: number | null; at: string };
  const due: Due[] = [];
  for (const t of TABLES) {
    try {
      const rows = await env.DB.prepare(t.due).bind(dueBy).all<{ id: number; scheduled_by: number | null; created_by: number | null; at: string }>();
      for (const r of rows.results || []) due.push({ console: t.console, ...r });
    } catch (e) { out.errors.push(`${t.console} due: ${(e as Error).message}`); }
  }
  due.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  out.due = due.length;
  out.left_for_next_tick = Math.max(0, due.length - SEND_CAP_PER_TICK);

  // 4 — send, through the console's own function, in mode 'clock'.
  for (const d of due.slice(0, SEND_CAP_PER_TICK)) {
    const actorId = d.scheduled_by ?? d.created_by;
    const who = actorId == null
      ? null
      : await env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(actorId).first<{ id: number; email: string }>().catch(() => null);
    const actor = { id: Number(who?.id ?? actorId ?? 0), email: String(who?.email ?? '') };
    const send = d.console === 'telegram' ? sendTelegramPost : sendXPost;
    try {
      const r = await withDeadline(
        send(env, d.id, { actor, mode: 'clock', dueBy }),
        SEND_DEADLINE_MS,
        `scheduled ${d.console} post ${d.id}`,
      );
      if (r.status === 200) out.sent += 1;
      else if (r.body.error !== 'already_sending_or_sent') out.refused_or_failed += 1;
    } catch (e) {
      // A deadline or a throw: the row stays as the send left it. If it is
      // still 'sending', step 1 fails it on a later tick; it is never re-sent.
      out.refused_or_failed += 1;
      out.errors.push(`${d.console} ${d.id}: ${(e as Error).message}`);
    }
  }
  return out;
}
