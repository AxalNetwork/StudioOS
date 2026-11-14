/**
 * D874 (#2521) — the member's Zoom and Google Meet calls (D684's refs), as
 * the MCP server's `list_meetings` returns them and, since D878 (#2525),
 * Record a session › Calls reads them (`callsList.ts`). Moved here from
 * `mcp/tools/meetings.ts` unchanged, so the member's page reads the list
 * without loading the MCP server.
 *
 * TENANCY COMES FROM THE REF (`interview_channel_refs`, migration 449): only
 * the member's own refs, on an interview in a company the caller passes.
 * Never a join URL, a meeting id or a passcode.
 */
import type { Env } from '../../types';
import { errorCodeOf, MEETING_ERRORS, type MeetingRef } from './meetings';

export const LIST_LIMIT = 200;

export interface RefRow extends MeetingRef { project_id: number; transcript_session_id: number | null }

/*
 * `transcript_session_id`, written out here and in `mcp/tools/meetings.ts`'s
 * `memberMeeting` (bound SQL only,
 * never interpolated): the session a call's transcript lands in. That is the
 * scheduled call's own session (opened with the provider), or, for a call
 * attached to a recording, the session `meetings.ts` opened beside it
 * (`meeting:<ref uid>`). At most one matches: an attached call's anchor is
 * the recording, whose `submitted_via` is null.
 */

/** A call that was scheduled from an interview has its slot's end; one attached to a recording has none (founder_validate_meetings.ts). */
const sourceOf = (ref: Pick<MeetingRef, 'ends_at'>) => (ref.ends_at ? 'scheduled' : 'attached');

function meetingItem(row: RefRow, companyName: string | null) {
  const code = errorCodeOf(row.last_error);
  return {
    id: row.uid,
    provider: row.provider,
    state: row.status,
    source: sourceOf(row),
    // Axal's own sentence for the state, by its code; never a provider's text.
    error_code: code,
    error: code ? MEETING_ERRORS[code] ?? null : null,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    company: companyName != null ? { id: Number(row.project_id), name: companyName } : null,
    interview_id: Number(row.interview_id),
    session_id: row.transcript_session_id == null ? null : Number(row.transcript_session_id),
  };
}

export async function listMeetings(
  env: Env, userId: number, companies: Array<{ id: number; name: string }>,
  opts: { provider?: string; state?: string; limit?: number } = {},
) {
  const names = new Map(companies.map((c) => [c.id, c.name]));
  const limit = Math.min(Math.max(Math.trunc(Number(opts.limit) || 50), 1), LIST_LIMIT);
  const provider = opts.provider ?? null;
  const state = opts.state ?? null;
  // A call on an interview outside the grant's readable companies is filtered in SQL, so the limit counts only what this call may see.
  const rows = (await env.DB.prepare(
    `SELECT r.*, di.project_id, (SELECT s.id FROM interview_sessions s
       WHERE s.interview_id = r.interview_id AND s.created_by_user_id = r.user_id AND s.submitted_via = r.provider
       AND (s.id = r.session_id OR s.uid = 'meeting:' || r.uid)
       ORDER BY s.id LIMIT 1) AS transcript_session_id
       FROM interview_channel_refs r
       JOIN discovery_interviews di ON di.id = r.interview_id
      WHERE r.user_id = ?
        AND di.project_id IN (SELECT value FROM json_each(?))
        AND (? IS NULL OR r.provider = ?)
        AND (? IS NULL OR r.status = ?)
      ORDER BY COALESCE(r.starts_at, r.created_at) DESC, r.id DESC LIMIT ?`,
  ).bind(userId, JSON.stringify([...names.keys()]), provider, provider, state, state, limit).all<RefRow>()).results ?? [];
  return rows.map((r) => meetingItem(r, names.get(Number(r.project_id)) ?? null));
}
