/**
 * D685 §5.6 (#1584) — the recording that survives navigation, on the Worker:
 * the member's own active sessions, and the sweep that tidies the ones a
 * closed tab left behind.
 *
 *   activeSessionsOf   `GET /sessions/active`: the caller's sessions that are
 *                      recording, paused or transcribing, or still processing,
 *                      newest first. Channel and assistant sessions
 *                      (`submitted_via` set) have no microphone to resume, so
 *                      they are left out.
 *   sweepInterviewSessions
 *                      the minute cron's three rules:
 *                        · a draft never started for 24 hours is deleted, with
 *                          the interview `POST /sessions` made for it when
 *                          nothing else uses that interview;
 *                        · a recording with no chunk for 10 minutes is paused,
 *                          its time counted up to the last chunk's arrival;
 *                        · processing stuck in `uploading` for 30 minutes goes
 *                          on with the chunks that arrived, and names the ones
 *                          that did not.
 *
 * Every value is bound. Every rule works on a bounded batch, so one minute's
 * sweep stays small however many sessions are waiting.
 */
import type { Env } from '../types';
import { callLabel } from './sessionSetup';
import { deleteSession, type SessionRow } from './interviewSessions';
import { enqueueProcess, processingOf } from './interviewProcessing';

export const DRAFT_HOURS = 24;
export const SILENT_MINUTES = 10;
export const UPLOAD_MINUTES = 30;
const BATCH = 50;

/** The caller's active sessions, newest first, with what the pill and the recovery need. */
export async function activeSessionsOf(env: Env, userId: number) {
  const rows = await env.DB.prepare(
    `SELECT s.*, i.interviewee_name, i.interviewee_company
       FROM interview_sessions s JOIN discovery_interviews i ON i.id = s.interview_id
      WHERE s.created_by_user_id = ? AND s.submitted_via IS NULL
        AND (s.status IN ('recording', 'paused', 'transcribing')
             OR (s.processing_stage IS NOT NULL AND s.processing_stage <> 'done'))
      ORDER BY s.id DESC LIMIT 20`,
  ).bind(userId).all<SessionRow & { interviewee_name: string | null; interviewee_company: string | null }>();
  const list = rows.results || [];
  if (!list.length) return [];
  const seqs = await env.DB.prepare(
    `SELECT session_id, seq FROM interview_session_chunks
      WHERE session_id IN (SELECT value FROM json_each(?)) ORDER BY session_id, seq`,
  ).bind(JSON.stringify(list.map((s) => s.id))).all<{ session_id: number; seq: number }>();
  const bySession = new Map<number, number[]>();
  for (const r of seqs.results || []) bySession.set(r.session_id, [...(bySession.get(r.session_id) || []), r.seq]);
  return list.map((s) => ({
    id: s.id,
    uid: s.uid,
    status: s.status,
    interview_id: s.interview_id,
    interviewee_name: s.interviewee_name,
    interviewee_company: s.interviewee_company,
    project_id: s.project_id,
    channel: s.channel,
    call_label: callLabel(s.channel, s.call_provider ?? null),
    active_ms: s.active_ms,
    recording_since: s.recording_since,
    chunk_seqs: bySession.get(s.id) || [],
    processing: processingOf(s),
  }));
}

/** "4, 7 and 9": the missing parts, in words. */
export function missingLine(seqs: number[]): string {
  const parts = seqs.map((n) => String(n + 1));
  const list = parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `${seqs.length === 1 ? 'Part' : 'Parts'} ${list} of the recording never arrived, so the transcript goes on without ${seqs.length === 1 ? 'it' : 'them'}.`;
}

export interface SweepResult { drafts: number; paused: number; resumed: number }

export async function sweepInterviewSessions(env: Env, now = new Date()): Promise<SweepResult> {
  const at = (ms: number) => new Date(now.getTime() - ms).toISOString().slice(0, 19).replace('T', ' ');
  const result: SweepResult = { drafts: 0, paused: 0, resumed: 0 };

  // 1. Drafts never started. The interview goes too, but only when it was
  // made for this session (same moment, nothing recorded on it, no other
  // session): an interview the founder logged by hand is never removed.
  const drafts = await env.DB.prepare(
    `SELECT * FROM interview_sessions
      WHERE status = 'draft' AND started_at IS NULL AND submitted_via IS NULL AND created_at < ?
      ORDER BY id LIMIT ?`,
  ).bind(at(DRAFT_HOURS * 3_600_000), BATCH).all<SessionRow>();
  for (const s of drafts.results || []) {
    await deleteSession(env, s, s.created_by_user_id);
    await env.DB.prepare(
      `DELETE FROM discovery_interviews
        WHERE id = ? AND stage = 'booked' AND transcript IS NULL
          AND ABS(julianday(created_at) - julianday(?)) * 86400 <= 5
          AND NOT EXISTS (SELECT 1 FROM interview_sessions WHERE interview_id = discovery_interviews.id)`,
    ).bind(s.interview_id, s.created_at).run();
    result.drafts++;
  }

  // 2. Recording, but silent. Its time is counted to the last chunk's arrival
  // (or to when it started recording, if no chunk ever came), never to now.
  const silent = await env.DB.prepare(
    `SELECT s.id, s.recording_since,
            (SELECT MAX(created_at) FROM interview_session_chunks WHERE session_id = s.id) AS last_chunk_at
       FROM interview_sessions s
      WHERE s.status = 'recording' AND s.recording_since IS NOT NULL AND s.recording_since < ?
        AND NOT EXISTS (SELECT 1 FROM interview_session_chunks c WHERE c.session_id = s.id AND c.created_at >= ?)
      ORDER BY s.id LIMIT ?`,
  ).bind(at(SILENT_MINUTES * 60_000), at(SILENT_MINUTES * 60_000), BATCH).all<{ id: number; recording_since: string; last_chunk_at: string | null }>();
  for (const s of silent.results || []) {
    const r = await env.DB.prepare(
      `UPDATE interview_sessions
          SET status = 'paused',
              active_ms = active_ms + MAX(0, CAST(ROUND((julianday(MAX(recording_since, COALESCE(?, recording_since))) - julianday(recording_since)) * 86400000) AS INTEGER)),
              recording_since = NULL, updated_at = datetime('now')
        WHERE id = ? AND status = 'recording'`,
    ).bind(s.last_chunk_at, s.id).run();
    if (Number(r.meta?.changes || 0) === 1) result.paused++;
  }

  // 3. Uploads that never finished. Go on with what arrived; say what did not.
  const stuck = await env.DB.prepare(
    `SELECT * FROM interview_sessions
      WHERE processing_stage = 'uploading' AND processing_updated_at < ?
      ORDER BY id LIMIT ?`,
  ).bind(at(UPLOAD_MINUTES * 60_000), BATCH).all<SessionRow>();
  for (const s of stuck.results || []) {
    const last = s.expected_last_seq ?? -1;
    const stored = await env.DB.prepare('SELECT seq FROM interview_session_chunks WHERE session_id = ? AND seq <= ?')
      .bind(s.id, last).all<{ seq: number }>();
    const have = new Set((stored.results || []).map((r) => r.seq));
    if (!have.size) {
      await env.DB.prepare(
        `UPDATE interview_sessions SET processing_stage = 'failed', processing_error = ?, processing_updated_at = datetime('now') WHERE id = ? AND processing_stage = 'uploading'`,
      ).bind('None of the recording arrived, so there is nothing to transcribe.', s.id).run();
      continue;
    }
    const missing: number[] = [];
    for (let seq = 0; seq <= last; seq++) if (!have.has(seq)) missing.push(seq);
    const r = await env.DB.prepare(
      `UPDATE interview_sessions SET processing_stage = 'transcribing', processing_error = ?, processing_updated_at = datetime('now')
        WHERE id = ? AND processing_stage = 'uploading'`,
    ).bind(missing.length ? missingLine(missing) : null, s.id).run();
    if (Number(r.meta?.changes || 0) !== 1) continue;
    await enqueueProcess(env, s.id, s.created_by_user_id, `interview_process:${s.id}:swept`);
    result.resumed++;
  }
  return result;
}
