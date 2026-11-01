/**
 * D1580 F1 (#3827) — how long a rehearsal's audio is kept.
 *
 * "Your audio is turned into text. The audio is deleted afterwards unless you
 * keep it." The owner's answer U = A: the audio goes once the coaching is done.
 * The report is the coaching in this part, so the audio is held for
 * AUDIO_GRACE_MINUTES after the report is written, long enough for the founder
 * to turn "Keep the audio" on (off by default), and then deleted by the sweep.
 * Turning the switch off deletes it at once. The transcript and the report
 * stay either way.
 *
 * `purgeRehearsalAudio` runs every five minutes from the cron; each run reads
 * one bounded batch. Every value is bound.
 */
import type { Env } from '../../types';

export const AUDIO_GRACE_MINUTES = 60;
const BATCH = 100;

const sqlTime = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);

/** When the audio of a report written at `now` is deleted, unless kept. */
export const audioDeleteAfter = (now: Date) => sqlTime(new Date(now.getTime() + AUDIO_GRACE_MINUTES * 60_000));

/** Delete one rehearsal's audio object and record that it is gone. A missing object is already gone. */
export async function deleteRehearsalAudio(env: Env, row: { id: number; audio_r2_key: string | null }, now = new Date()): Promise<boolean> {
  if (!row.audio_r2_key) return false;
  if (env.FILES) await env.FILES.delete(row.audio_r2_key);
  await env.DB.prepare('UPDATE deck_rehearsals SET audio_r2_key = NULL, audio_deleted_at = ? WHERE id = ? AND audio_r2_key = ?')
    .bind(sqlTime(now), row.id, row.audio_r2_key).run();
  return true;
}

/** The sweep: every unkept audio past its time. */
export async function purgeRehearsalAudio(env: Env, now = new Date()): Promise<{ deleted: number }> {
  if (!env.FILES) return { deleted: 0 };
  const due = await env.DB.prepare(
    `SELECT id, audio_r2_key FROM deck_rehearsals
      WHERE audio_r2_key IS NOT NULL AND keep_audio = 0 AND audio_delete_after IS NOT NULL AND audio_delete_after <= ?
      ORDER BY audio_delete_after LIMIT ?`,
  ).bind(sqlTime(now), BATCH).all<{ id: number; audio_r2_key: string }>();
  let deleted = 0;
  for (const row of due.results || []) if (await deleteRehearsalAudio(env, row, now)) deleted += 1;
  return { deleted };
}
