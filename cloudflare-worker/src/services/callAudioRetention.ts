/**
 * D877 (#2524) — how long Axal keeps a call's audio, separately from its text.
 *
 * A "call" is a session with a Zoom or Google Meet ref (`interview_channel_refs`)
 * or an uploaded recording (`submitted_via = 'upload'`, D872). Audio from the
 * in-person recorder is not a call and is kept until the founder deletes it,
 * as before.
 *
 *   retentionFor        the member's choice: a number of days, or null for
 *                       "keep until I delete it". No row means the default.
 *   setRetention        the member's own write (`PUT /sessions/audio-retention`).
 *   purgeExpiredCallAudio
 *                       the daily sweep: a call's audio older than its
 *                       founder's retention goes (`deleteSessionAudio`), its
 *                       text stays, and the session says "audio removed".
 *
 * Age is counted from the newest chunk's arrival, so a recording is never cut
 * while it is still arriving. A session whose processing is still moving is
 * left for the next run, so audio is never taken from under a transcription.
 * Every value is bound; each run reads bounded batches.
 */
import type { Env } from '../types';
import { deleteSessionAudio, type SessionRow } from './interviewSessions';

/** D877 owner question 1, answer A (recommended): 30 days, then the audio goes and the text stays. */
export const DEFAULT_CALL_AUDIO_RETENTION_DAYS = 30;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;
const BATCH = 100;
const MAX_BATCHES = 10;

export interface Retention { days: number | null; chosen: boolean }

/** The member's retention: their own choice when they made one, else the default. */
export async function retentionFor(env: Env, userId: number): Promise<Retention> {
  const row = await env.DB.prepare('SELECT call_audio_retention_days AS days FROM member_call_audio_settings WHERE user_id = ?')
    .bind(userId).first<{ days: number | null }>();
  return row ? { days: row.days ?? null, chosen: true } : { days: DEFAULT_CALL_AUDIO_RETENTION_DAYS, chosen: false };
}

/** A retention the member may choose: whole days in range, or null for "keep until I delete it". */
export function validRetention(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= MIN_RETENTION_DAYS && (value as number) <= MAX_RETENTION_DAYS);
}

export async function setRetention(env: Env, userId: number, days: number | null): Promise<Retention> {
  if (!validRetention(days)) throw new Error('invalid_retention');
  await env.DB.prepare(
    `INSERT INTO member_call_audio_settings (user_id, call_audio_retention_days, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET call_audio_retention_days = excluded.call_audio_retention_days, updated_at = excluded.updated_at`,
  ).bind(userId, days).run();
  return { days, chosen: true };
}

/**
 * The call sessions whose audio is past their founder's retention: a call,
 * audio still held, nothing moving, and the newest chunk older than the
 * retention (the member's own, or the default when they chose none; never
 * when they chose to keep it).
 */
async function due(env: Env, now: Date): Promise<SessionRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT s.* FROM interview_sessions s
       LEFT JOIN member_call_audio_settings m ON m.user_id = s.created_by_user_id
      WHERE s.audio_removed_at IS NULL
        AND (s.submitted_via = 'upload' OR EXISTS (SELECT 1 FROM interview_channel_refs r WHERE r.session_id = s.id))
        AND s.status NOT IN ('recording', 'paused', 'transcribing')
        AND (s.processing_stage IS NULL OR s.processing_stage IN ('done', 'failed'))
        AND (m.user_id IS NULL OR m.call_audio_retention_days IS NOT NULL)
        AND julianday(?1) - julianday((SELECT MAX(c.created_at) FROM interview_session_chunks c WHERE c.session_id = s.id))
            >= COALESCE(m.call_audio_retention_days, ?2)
      ORDER BY s.id LIMIT ?3`,
  ).bind(now.toISOString(), DEFAULT_CALL_AUDIO_RETENTION_DAYS, BATCH).all<SessionRow>();
  return results ?? [];
}

/** The daily sweep. Returns how many sessions lost their audio and how many R2 objects went. */
export async function purgeExpiredCallAudio(env: Env, now = new Date()): Promise<{ sessions: number; objects: number }> {
  let sessions = 0;
  let objects = 0;
  for (let b = 0; b < MAX_BATCHES; b += 1) {
    const rows = await due(env, now);
    for (const s of rows) {
      const { keys } = await deleteSessionAudio(env, s, null, 'retention');
      sessions += 1;
      objects += keys.length;
    }
    if (rows.length < BATCH) break;
  }
  return { sessions, objects };
}
