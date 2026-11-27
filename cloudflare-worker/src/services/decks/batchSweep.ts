/**
 * D4374 (#4374) — the stuck-run sweep: a deck generation run whose driver died
 * is stopped, and its one hold is settled, by the daily cleanup.
 *
 * WHAT IS STUCK. A run still `queued`, `running` or `cancelling` with no step
 * started or ended (and, before its first step, not admitted or started) for
 * `STUCK_AFTER_MS`. Nothing else moves a run: its driver (the `DeckGenRoom`
 * alarm, or a `deck_gen_slice` on the queue) claims and ends steps, so a run
 * with no step activity for that long has no driver left (DECK_GRID.md §3).
 *
 * WHAT THE SWEEP DOES, for each stuck run, in this order:
 *   1. A step left `running` is `done` when its usage row exists under the
 *      run's hold (the charge happened), at what that row charged, clamped to
 *      its line of the quote; otherwise `stopped`, and it charged nothing. A
 *      `waiting` step is `stopped`. This is `D1GenRuntime.rebuild`'s rule, so
 *      a charge is never lost and never invented.
 *   2. The run is closed `cancelled` (its "Stopped" state) with
 *      `stop_reason = 'timed_out'`, in one compare-and-set on its state: of
 *      two sweeps, or a sweep and a late driver, only one closes it.
 *   3. Only the sweep that closed it settles the hold, once, at what the
 *      steps charged (`settleAiReservation`, the one path that settles
 *      right); the rest of the hold is released. A hold no longer pending (it
 *      expired, and a budget read released it) settles nothing, and the count
 *      says so.
 *
 * One `activity_logs` row per sweep, actor `system`, with its counts.
 */
import type { Env } from '../../types';
import { settleAiReservation } from '../aiBudget';
import { stepRecordRef, type BatchRow, type StepRow } from './genRuntime';

/**
 * 30 minutes with no step started or ended. Longer than anything a live run
 * waits through between two step events: a step's attempts (an image's 60 s
 * limit, three busy retries with back-off and a same-tier fallback), the
 * AiGovernor's wait for a slot (at most 10 minutes, `waitForSlot`), and a
 * `DeckGenRoom` slice (10 minutes) with its re-arm. It is DECK_GRID.md §3's
 * "find stuck runs" window, now one constant.
 */
export const STUCK_AFTER_MS = 30 * 60_000;
/** At most this many runs a sweep; the rest wait for the next one. */
export const SWEEP_MAX = 200;
export const STOP_REASON = 'timed_out';

const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

export type SweepCounts = { found: number; swept: number; settled: number; already_released: number; charged_microusd: number; steps_done: number; steps_stopped: number };

/** The runs still active with no step event since `cutoff` (oldest first). */
async function stuckRuns(env: Env, cutoff: string): Promise<BatchRow[]> {
  const r = await env.DB.prepare(
    `SELECT b.* FROM deck_area_batches b
      WHERE b.state IN ('queued', 'running', 'cancelling')
        AND datetime(COALESCE(b.started_at, b.created_at)) < datetime(?1)
        AND NOT EXISTS (
          SELECT 1 FROM deck_area_batch_steps s WHERE s.batch_uid = b.uid
             AND (datetime(s.started_at) >= datetime(?1) OR datetime(s.ended_at) >= datetime(?1)))
      ORDER BY b.created_at LIMIT ?2`,
  ).bind(cutoff, SWEEP_MAX).all<BatchRow>();
  return (r.results || []) as BatchRow[];
}

/** Sweep once. `now` is passed in, so the tests own the clock. */
export async function sweepStuckBatches(env: Env, now = new Date()): Promise<SweepCounts> {
  const out: SweepCounts = { found: 0, swept: 0, settled: 0, already_released: 0, charged_microusd: 0, steps_done: 0, steps_stopped: 0 };
  const at = sqlTime(now.getTime());
  const runs = await stuckRuns(env, sqlTime(now.getTime() - STUCK_AFTER_MS));
  out.found = runs.length;
  for (const b of runs) {
    // 1. Each step's end, by rebuild's rule: a usage row under the hold is a charge that happened.
    const steps = ((await env.DB.prepare(`SELECT * FROM deck_area_batch_steps WHERE batch_uid = ?1 AND state IN ('waiting', 'running') ORDER BY seq`).bind(b.uid).all<StepRow>()).results || []) as StepRow[];
    for (const s of steps) {
      const row = s.state === 'running' && b.reservation_uid
        ? await env.DB.prepare(
          'SELECT id, model, (SELECT COALESCE(SUM(charged_microusd), 0) FROM ai_usage_logs WHERE reservation_uid = ?1 AND record_ref = ?2) AS charged FROM ai_usage_logs WHERE reservation_uid = ?1 AND record_ref = ?2 AND refusal IS NULL ORDER BY id DESC LIMIT 1',
        ).bind(b.reservation_uid, stepRecordRef(b.uid, s.seq)).first<{ id: number; model: string | null; charged: number }>()
        : null;
      if (row) {
        const r = await env.DB.prepare(`UPDATE deck_area_batch_steps SET state = 'done', charged_microusd = ?3, model_used = ?4, usage_log_id = ?5, ended_at = ?6 WHERE batch_uid = ?1 AND seq = ?2 AND state = 'running'`)
          .bind(b.uid, s.seq, Math.min(Number(row.charged || 0), Number(s.quote_microusd)), row.model ?? s.model, Number(row.id), at).run();
        out.steps_done += Number(r.meta?.changes ?? 0);
      } else {
        const r = await env.DB.prepare(`UPDATE deck_area_batch_steps SET state = 'stopped', error_code = ?3, ended_at = ?4 WHERE batch_uid = ?1 AND seq = ?2 AND state IN ('waiting', 'running')`)
          .bind(b.uid, s.seq, STOP_REASON, at).run();
        out.steps_stopped += Number(r.meta?.changes ?? 0);
      }
    }
    const sum = await env.DB.prepare('SELECT COALESCE(SUM(charged_microusd), 0) AS n FROM deck_area_batch_steps WHERE batch_uid = ?1').bind(b.uid).first<{ n: number }>();
    // Never more than the quote: the run's one hold is its ceiling.
    const charged = Math.min(Math.max(0, Number(sum?.n || 0)), Number(b.quote_microusd));
    // 2. Close it, once: only a run still active is closed, so a second sweep closes nothing.
    const closed = await env.DB.prepare(
      `UPDATE deck_area_batches SET state = 'cancelled', stop_reason = ?2, charged_microusd = ?3, settled_at = ?4
        WHERE uid = ?1 AND state IN ('queued', 'running', 'cancelling')`,
    ).bind(b.uid, STOP_REASON, charged, at).run();
    if (!Number(closed.meta?.changes)) continue;
    out.swept += 1;
    out.charged_microusd += charged;
    // 3. Settle the hold, from the sweep that closed the run only.
    if (b.reservation_uid) {
      const hold = await env.DB.prepare('SELECT status FROM ai_budget_reservations WHERE uid = ?1').bind(b.reservation_uid).first<{ status: string }>();
      if (hold?.status === 'pending') {
        await settleAiReservation(env, { uid: b.reservation_uid, userId: Number(b.created_by) }, charged, charged === 0);
        out.settled += 1;
      } else {
        out.already_released += 1;
      }
    }
  }
  await env.DB.prepare(`INSERT INTO activity_logs (action, details, actor) VALUES ('deck.batch_sweep', ?1, 'system')`)
    .bind(JSON.stringify({ ...out, stuck_after_minutes: STUCK_AFTER_MS / 60_000, at })).run();
  return out;
}
