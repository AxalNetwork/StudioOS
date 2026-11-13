/**
 * D878 (#2525) — Record a session › Calls: the member's own calls in one read,
 * for the Calls tab (MC3) and Retention (MC7).
 *
 *   calls     each Zoom and Google Meet call (`interview_channel_refs`), as
 *             D874's `listMeetings` reads it for the MCP server: state,
 *             source, provider, times, company, interview and session; and
 *             `transcript_source` (D870): `native`, `whisper`, or null.
 *   uploads   each recording the member uploaded (`submitted_via 'upload'`, D872).
 *   audio     for each session either list names, whether its audio is held,
 *             when it was removed and why, and when D877's sweep removes it.
 *
 * TENANCY. Only the member's own refs and sessions, and only on an interview
 * in a company the member may still write (`canWrite`). A company they have
 * lost drops out, as D874's grant check drops it. Every value is bound.
 *
 * AUDIO EXPIRY. D877 counts age from the newest chunk's arrival and removes
 * the audio once it is older than the member's retention; "keep until I
 * delete it" (`days: null`) never expires. The date here is that rule's,
 * computed from the same columns; the sweep, not this read, removes anything.
 */
import type { Env, User } from '../../types';
import { canWrite, type ProjectRef } from '../../routes/_founder_validate_helpers';
import { listMeetings } from './meetingList';
import { retentionFor } from '../callAudioRetention';

const UPLOAD_LIMIT = 100;
const DAY_MS = 86_400_000;

interface CompanyRow extends ProjectRef { name: string | null }

interface UploadRow {
  id: number; interview_id: number; project_id: number; interviewee_name: string | null;
  created_at: string | null; status: string | null; processing_stage: string | null;
}

interface AudioRow {
  id: number; audio_removed_at: string | null; audio_removed_reason: string | null;
  chunks: number; last_chunk_at: string | null;
}

/** The companies the member's calls and uploads sit in that they may still write. */
async function writableCompanies(env: Env, user: User): Promise<Array<{ id: number; name: string }>> {
  const rows = (await env.DB.prepare(
    `SELECT p.id, p.name, p.founder_id FROM projects p
      WHERE p.id IN (
        SELECT di.project_id FROM interview_channel_refs r JOIN discovery_interviews di ON di.id = r.interview_id WHERE r.user_id = ?1
        UNION
        SELECT di.project_id FROM interview_sessions s JOIN discovery_interviews di ON di.id = s.interview_id
         WHERE s.created_by_user_id = ?1 AND s.submitted_via = 'upload')`,
  ).bind(user.id).all<CompanyRow>()).results ?? [];
  return rows
    .filter((p) => canWrite({ id: Number(p.id), founder_id: p.founder_id == null ? null : Number(p.founder_id) }, user))
    .map((p) => ({ id: Number(p.id), name: String(p.name ?? '') }));
}

/** When D877's sweep removes this audio, or null when it never will. */
export function audioExpiresAt(lastChunkAt: string | null, days: number | null): string | null {
  if (days == null || !lastChunkAt) return null;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(lastChunkAt) ? lastChunkAt : `${lastChunkAt.replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? new Date(t + days * DAY_MS).toISOString() : null;
}

/** The member's calls, uploads and each session's audio state. */
export async function callsOf(env: Env, user: User) {
  const companies = await writableCompanies(env, user);
  const ids = JSON.stringify(companies.map((c) => c.id));
  const names = new Map(companies.map((c) => [c.id, c.name]));
  const [calls, uploads, retention] = await Promise.all([
    companies.length ? listMeetings(env, Number(user.id), companies, { limit: 200 }) : Promise.resolve([]),
    env.DB.prepare(
      `SELECT s.id, s.interview_id, di.project_id, di.interviewee_name, s.created_at, s.status, s.processing_stage
         FROM interview_sessions s JOIN discovery_interviews di ON di.id = s.interview_id
        WHERE s.created_by_user_id = ? AND s.submitted_via = 'upload'
          AND di.project_id IN (SELECT value FROM json_each(?))
        ORDER BY s.id DESC LIMIT ?`,
    ).bind(user.id, ids, UPLOAD_LIMIT).all<UploadRow>().then((r) => r.results ?? []),
    retentionFor(env, Number(user.id)),
  ]);
  const sessionIds = [...new Set([
    ...calls.map((c) => c.session_id).filter((v): v is number => v != null),
    ...uploads.map((u) => Number(u.id)),
  ])];
  const audioRows = sessionIds.length ? (await env.DB.prepare(
    `SELECT s.id, s.audio_removed_at, s.audio_removed_reason,
            (SELECT COUNT(*) FROM interview_session_chunks c WHERE c.session_id = s.id) AS chunks,
            (SELECT MAX(c.created_at) FROM interview_session_chunks c WHERE c.session_id = s.id) AS last_chunk_at
       FROM interview_sessions s
      WHERE s.created_by_user_id = ? AND s.id IN (SELECT value FROM json_each(?))`,
  ).bind(user.id, JSON.stringify(sessionIds)).all<AudioRow>()).results ?? [] : [];
  // How each imported call's text was made (D870, migration 529): the provider's own transcript, or Whisper over its audio.
  const sources = calls.length ? new Map(((await env.DB.prepare(
    `SELECT uid, transcript_source FROM interview_channel_refs WHERE user_id = ? AND uid IN (SELECT value FROM json_each(?))`,
  ).bind(user.id, JSON.stringify(calls.map((c) => c.id))).all<{ uid: string; transcript_source: string | null }>()).results ?? [])
    .map((r) => [r.uid, r.transcript_source ?? null])) : new Map<string, string | null>();
  const audio = audioRows.map((a) => {
    const held = !a.audio_removed_at && Number(a.chunks) > 0;
    return {
      session_id: Number(a.id),
      held,
      removed_at: a.audio_removed_at ?? null,
      removed_reason: a.audio_removed_reason ?? null,
      expires_at: held ? audioExpiresAt(a.last_chunk_at, retention.days) : null,
    };
  });
  return {
    calls: calls.map((c) => ({ ...c, transcript_source: sources.get(c.id) ?? null })),
    uploads: uploads.map((u) => ({
      session_id: Number(u.id),
      interview_id: Number(u.interview_id),
      company: { id: Number(u.project_id), name: names.get(Number(u.project_id)) ?? null },
      interviewee: u.interviewee_name ?? null,
      created_at: u.created_at ?? null,
      status: u.status ?? null,
      processing_stage: u.processing_stage ?? null,
    })),
    audio,
    retention,
  };
}
