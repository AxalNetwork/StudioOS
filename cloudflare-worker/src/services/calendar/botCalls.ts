/**
 * D1486 §a (#3980, source 5a of #3723) — the meeting bot's calls on the
 * member's calendar: each run in `meeting_bots` (migration 531), page only.
 *
 * OWNER ONLY. A run is read for the member who sent the bot (`user_id = ?`,
 * bound), on a live venture, and never for anyone else: no staff scope lists it
 * (`PERSONAL_ONLY_KINDS`), and it is never in an .ics file, a feed or a provider
 * copy (`page_only` in the registry).
 *
 * TIMES are INTEGER epoch milliseconds in `meeting_bots`; the item's are ISO.
 * A run starts when the bot joined (`started_at`), else when it was scheduled;
 * it ends when it left (`ended_at`), else at its limit.
 *
 * WORDS. `status = 'done'` reads **Recorded**. "Transcript ready" is said only
 * when that run's interview session holds its final transcript: the rows
 * `meetingBotAssembly.ts` writes to `interview_transcript_segments` with
 * `source = 'final'` for the run's `session_id`. Without them it is not said.
 *
 * PRIVACY (D886): the meeting link, its title and the participants stay
 * encrypted and are never read here. The item names the interviewee as the
 * interview call does; nothing is logged but a source's outcome code (`gather`).
 */
import type { Env } from '../../types';
import type { CalendarEvent } from '../calendar';

export type BotStatus = 'queued' | 'joining' | 'waiting_room' | 'recording' | 'processing' | 'done' | 'failed' | 'stopped';

/** A run's state in plain words. Only `done` is "Recorded". */
export const BOT_STATE_WORDS: Readonly<Record<BotStatus, string>> = Object.freeze({
  queued: 'Scheduled',
  joining: 'Joining',
  waiting_room: 'In the waiting room',
  recording: 'Recording',
  processing: 'Processing the recording',
  done: 'Recorded',
  failed: 'Did not record',
  stopped: 'Stopped',
});
export const TRANSCRIPT_READY = 'Transcript ready';

export type BotFacts = { state: BotStatus; words: string; transcript_ready: boolean };
export type BotCallEvent = CalendarEvent & { kind: 'bot_call'; all_day: false; bot: BotFacts };

type Row = Record<string, any>;
const iso = (ms: number) => new Date(ms).toISOString();

/** The member's own bot runs that start in [from, to). */
export async function botCallEvents(env: Env, userId: number, from: string, to: string): Promise<BotCallEvent[]> {
  const fromMs = Date.parse(from), toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) throw new Error('calendar_source_unreadable');
  const res = await env.DB.prepare(
    `SELECT b.rowid AS id, b.uid, b.status, b.scheduled_at, b.started_at, b.ended_at, b.limit_minutes, b.project_id,
            i.interviewee_name,
            EXISTS (SELECT 1 FROM interview_transcript_segments t WHERE t.session_id = b.session_id AND t.source = 'final') AS transcript_ready
       FROM meeting_bots b
       JOIN interview_sessions s ON s.id = b.session_id
       JOIN discovery_interviews i ON i.id = s.interview_id
       JOIN projects p ON p.id = b.project_id AND p.deleted_at IS NULL
       JOIN users u ON u.id = b.user_id AND u.is_active = 1 AND u.deletion_requested_at IS NULL
      WHERE b.user_id = ?1
        AND COALESCE(b.started_at, b.scheduled_at) >= ?2 AND COALESCE(b.started_at, b.scheduled_at) < ?3
      ORDER BY COALESCE(b.started_at, b.scheduled_at), b.uid`,
  ).bind(userId, fromMs, toMs).all<Row>();
  if (!Array.isArray(res?.results)) throw new Error('calendar_source_unreadable');
  return res.results.map((r) => {
    const start = Number(r.started_at ?? r.scheduled_at);
    const end = r.ended_at != null ? Number(r.ended_at) : start + Number(r.limit_minutes || 30) * 60_000;
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('calendar_source_unreadable');
    const state = (r.status in BOT_STATE_WORDS ? r.status : 'queued') as BotStatus;
    const transcript = state === 'done' && Number(r.transcript_ready) === 1;
    const words = [BOT_STATE_WORDS[state], transcript ? TRANSCRIPT_READY : null].filter(Boolean).join(' · ');
    return {
      id: `bot_call:${r.uid}`, kind: 'bot_call', source_id: Number(r.id), source_uid: String(r.uid),
      title: `Recorded call · ${r.interviewee_name}`,
      start_at: iso(start), end_at: iso(Math.max(end, start)), status: state, all_day: false,
      location_kind: 'video', location_uri: null, organizer_email: null, attendees: [], notes: null,
      project_id: Number(r.project_id),
      bot: { state, words, transcript_ready: transcript },
    };
  });
}
