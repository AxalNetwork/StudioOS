/**
 * Task #14 — Watchlist follow-up reminder sweep.
 *
 * Fires a single in-app/email notification for each `watching` watchlist item
 * whose `next_check_at` is due and hasn't been reminded for that checkpoint
 * yet. After delivery the item's `reminded_at` is stamped to `now` so the same
 * checkpoint never fires twice; bumping `next_check_at` to a later date
 * re-arms the reminder (see services/watchlistGrading.ts::reminderDue). Called
 * from the scheduled() cron. Best-effort: a delivery failure logs and moves on.
 */
import type { Env } from '../types';
import { notify } from './notify';
import { reminderDue } from './watchlistGrading';

export interface WatchlistReminderResult { candidates: number; sent: number; }

/** SPA route the notification deep-links to (guarded admin/partner/investor). */
const APP_ROUTE = '/watchlist';

type CandidateRow = {
  id: number; uid: string; owner_user_id: number;
  project_id: number | null; external_name: string | null;
  thesis: string | null; next_check_at: string | null; reminded_at: string | null;
};

export async function sweepWatchlistReminders(env: Env, now: Date = new Date()): Promise<WatchlistReminderResult> {
  const result: WatchlistReminderResult = { candidates: 0, sent: 0 };

  let rows: CandidateRow[] = [];
  try {
    const q = await env.DB.prepare(
      `SELECT id, uid, owner_user_id, project_id, external_name, thesis, next_check_at, reminded_at
         FROM watchlist_items
        WHERE next_check_at IS NOT NULL AND status = 'watching'
        LIMIT 1000`
    ).all<CandidateRow>();
    rows = (q.results || []) as CandidateRow[];
  } catch (e) {
    console.error('[watchlistReminders] candidate query failed', e);
    return result;
  }

  for (const item of rows) {
    if (!reminderDue(item.next_check_at, item.reminded_at, now)) continue;
    result.candidates++;

    // Best-effort label: prefer the in-system project name, else external name.
    let label: string | null = item.external_name;
    if (item.project_id != null) {
      try {
        const p = await env.DB.prepare('SELECT name FROM projects WHERE id = ? AND deleted_at IS NULL')
          .bind(item.project_id).first<{ name: string }>();
        if (p?.name) label = p.name;
      } catch { /* fall back to external_name */ }
    }
    label = label || 'a watchlist item';

    try {
      await notify(env, {
        userId: Number(item.owner_user_id),
        type: 'watchlist_followup',
        category: 'deals',
        title: `Follow-up due: ${label}`,
        body: item.thesis ? String(item.thesis).slice(0, 200) : `Time to check back in on ${label}.`,
        link: APP_ROUTE,
        payload: { watchlist_uid: item.uid, next_check_at: item.next_check_at },
      });
      await env.DB.prepare('UPDATE watchlist_items SET reminded_at = ? WHERE id = ?')
        .bind(now.toISOString(), item.id).run();
      result.sent++;
    } catch (e) {
      console.warn('[watchlistReminders] deliver failed', (e as Error).message);
    }
  }

  return result;
}
