/**
 * D878 (#2525) — Record a session › Calls: one venture's calls, for the Calls
 * and Retention boards (MC3, MC7).
 *
 * A "call" is what D877 keeps audio for: a session with a Zoom or Google Meet
 * ref (`interview_channel_refs`), an uploaded recording (`submitted_via =
 * 'upload'`, D872) or the meeting bot's (`'meeting_bot'`, D886). Until now a
 * page could read them only one interview at a time
 * (`GET /interviews/:id/meetings`, `/interviews/:id/sessions`); this read lists
 * them across the venture's interviews, newest first, at most `CALL_LIST_MAX`.
 *
 * Each call carries:
 *   · its ref, as `meetingView` draws it for the meetings route (status, the
 *     error's code and sentence, `transcript_source`), or null for an upload;
 *   · the session's own state and its consent method;
 *   · its audio: held (and until when, by its founder's retention, counted
 *     from the newest chunk as the daily sweep counts it), removed (when and
 *     why), or none (a call whose provider sent text only);
 *   · how many proposals wait for the founder.
 *
 * Never a transcript line, a join link's passcode, an attendee or a token.
 * Every value is bound.
 */
import type { Env } from '../../types';
import { retentionFor, type Retention } from '../callAudioRetention';
import { meetingView, type MeetingRef } from './meetings';
import { PROVIDER_LABEL } from './types';

export const CALL_LIST_MAX = 100;

export type CallSource = 'zoom' | 'google_meet' | 'upload' | 'meeting_bot';

export interface CallAudio {
  state: 'held' | 'removed' | 'none';
  /** The day the sweep may take it: the newest chunk plus the founder's days. Null when held until deleted, or not held. */
  kept_until: string | null;
  removed_at: string | null;
  removed_reason: string | null;
}

interface CallRow {
  id: number; interview_id: number; created_by_user_id: number; channel: string; status: string; submitted_via: string | null;
  consent_status: string; consent_method: string | null; created_at: string; stopped_at: string | null;
  processing_stage: string | null; processing_error: string | null; digest_status: string | null;
  audio_removed_at: string | null; audio_removed_reason: string | null;
  interviewee_name: string | null; interviewee_company: string | null; last_chunk_at: string | null; pending_proposals: number;
}

/** The audio a call holds, and until when. `days` null keeps it until the founder deletes it. */
export function callAudio(row: Pick<CallRow, 'audio_removed_at' | 'audio_removed_reason' | 'last_chunk_at'>, retention: Retention): CallAudio {
  if (row.audio_removed_at) return { state: 'removed', kept_until: null, removed_at: row.audio_removed_at, removed_reason: row.audio_removed_reason ?? null };
  const last = row.last_chunk_at ? Date.parse(`${String(row.last_chunk_at).replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/.test(row.last_chunk_at) ? '' : 'Z'}`) : NaN;
  if (!Number.isFinite(last)) return { state: 'none', kept_until: null, removed_at: null, removed_reason: null };
  const keptUntil = retention.days == null ? null : new Date(last + retention.days * 86_400_000).toISOString();
  return { state: 'held', kept_until: keptUntil, removed_at: null, removed_reason: null };
}

/** One venture's calls, newest first. The caller has already been scoped to the venture. */
export async function callList(env: Env, projectId: number) {
  const rows = (await env.DB.prepare(
    `SELECT s.id, s.interview_id, s.created_by_user_id, s.channel, s.status, s.submitted_via, s.consent_status, s.consent_method,
            s.created_at, s.stopped_at, s.processing_stage, s.processing_error, s.digest_status, s.audio_removed_at, s.audio_removed_reason,
            di.interviewee_name, di.interviewee_company,
            (SELECT MAX(c.created_at) FROM interview_session_chunks c WHERE c.session_id = s.id) AS last_chunk_at,
            (SELECT COUNT(*) FROM validate_proposals vp WHERE vp.session_id = s.id AND vp.status = 'pending') AS pending_proposals
       FROM interview_sessions s
       JOIN discovery_interviews di ON di.id = s.interview_id
      WHERE s.project_id = ?
        AND (s.submitted_via IN ('upload', 'meeting_bot') OR EXISTS (SELECT 1 FROM interview_channel_refs r WHERE r.session_id = s.id))
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT ?`,
  ).bind(projectId, CALL_LIST_MAX + 1).all<CallRow>()).results ?? [];
  const truncated = rows.length > CALL_LIST_MAX;
  const calls = rows.slice(0, CALL_LIST_MAX);

  // A call's ref: the first one on its session. A Zoom call ended and restarted
  // keeps its later instances as `<id>:<n>` rows, which the meetings route hides too.
  const refs = new Map<number, MeetingRef>();
  if (calls.length) {
    const found = (await env.DB.prepare(
      `SELECT * FROM interview_channel_refs WHERE session_id IN (SELECT value FROM json_each(?)) ORDER BY id`,
    ).bind(JSON.stringify(calls.map((r) => r.id))).all<MeetingRef>()).results ?? [];
    for (const ref of found) if (!refs.has(Number(ref.session_id))) refs.set(Number(ref.session_id), ref);
  }

  // Each founder's own retention, read once.
  const retentions = new Map<number, Retention>();
  for (const userId of new Set(calls.map((r) => Number(r.created_by_user_id)))) retentions.set(userId, await retentionFor(env, userId));

  return {
    project_id: projectId,
    truncated,
    calls: calls.map((r) => {
      const ref = refs.get(Number(r.id)) ?? null;
      const source: CallSource = ref ? ref.provider as CallSource : r.submitted_via === 'meeting_bot' ? 'meeting_bot' : 'upload';
      return {
        session_id: Number(r.id),
        interview_id: Number(r.interview_id),
        interviewee_name: r.interviewee_name ?? null,
        interviewee_company: r.interviewee_company ?? null,
        source,
        session: {
          status: r.status, channel: r.channel, consent_status: r.consent_status, consent_method: r.consent_method ?? null,
          created_at: r.created_at, stopped_at: r.stopped_at ?? null,
          processing_stage: r.processing_stage ?? null, processing_error: r.processing_error ?? null, digest_status: r.digest_status ?? null,
        },
        meeting: ref ? meetingView(ref, PROVIDER_LABEL[ref.provider]) : null,
        audio: callAudio(r, retentions.get(Number(r.created_by_user_id))!),
        pending_proposals: Number(r.pending_proposals) || 0,
      };
    }),
  };
}
