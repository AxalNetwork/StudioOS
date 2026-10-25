/**
 * D684 (#1575) — the one way an outside channel writes into an interview.
 *
 * Telegram, WhatsApp, Zoom and Google Meet never touch `discovery_interviews`,
 * `interview_sessions` or `interview_transcript_segments` themselves. They call
 * this file, which:
 *   - reloads the member on every write and refuses an inactive, deleted or
 *     signed-out-everywhere account (the rule `mcp/grants.ts` applies);
 *   - re-checks `canWrite(project, member)` on every write, so a member who
 *     lost a venture stops feeding it at once;
 *   - takes the interview only from an id the caller already scoped to the
 *     member (a thread assignment, a meeting ref) — never from a payload;
 *   - stores text exactly where the paste-in Text chat stores it, so Structure
 *     and Ask (and every reader of `discovery_interviews.transcript`) work on a
 *     channel session unchanged.
 *
 * A channel session records its origin in `interview_sessions.submitted_via`
 * (migration 447) — the provider key — and `submitted_via_name`, its label.
 */
import type { Env, User } from '../types';
import { canWrite, type ProjectRef } from '../routes/_founder_validate_helpers';
import { loadSession, replaceWithFinal, type SessionRow, type StoredSegment } from './interviewSessions';
// A static import is safe: nothing sessionSetup.ts loads reaches this file
// (interviewSessions.ts already imports it the same way).
import { CALL_PROVIDERS, markInterviewHeld } from './sessionSetup';
import { PROVIDER_LABEL, type ChannelProvider, type ImportedSegment } from './channels/types';
import { interviewCapRefusal } from '../middleware/requireTier';

export class IntakeError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'IntakeError';
    this.status = status;
    this.code = code;
  }
}

export interface IntakeMember extends Pick<User, 'id' | 'role'> {
  founder_id: number | null;
  spinout_lab_active?: number | null;
  is_active: number | null;
  deletion_requested_at: string | null;
  jwt_min_iat: number | null;
}

export interface ScopedInterview {
  member: IntakeMember;
  project: ProjectRef & { company_id: number | null };
  interview: { id: number; project_id: number; interviewee_name: string };
}

/** The member, or a refusal when the account no longer stands. */
export async function activeMember(env: Env, userId: number): Promise<IntakeMember> {
  const m = await env.DB.prepare(
    'SELECT id, role, founder_id, spinout_lab_active, is_active, deletion_requested_at, jwt_min_iat FROM users WHERE id = ?',
  ).bind(userId).first<IntakeMember>();
  if (!m || m.is_active === 0 || m.deletion_requested_at) {
    throw new IntakeError(403, 'member_inactive', 'The Axal account behind this connection is no longer active.');
  }
  return m;
}

/** An interview the member can write to, scoped through its project. */
export async function writableInterview(env: Env, userId: number, interviewId: number): Promise<ScopedInterview> {
  if (!Number.isInteger(interviewId) || interviewId <= 0) throw new IntakeError(400, 'interview_required', 'Choose an interview.');
  const member = await activeMember(env, userId);
  const interview = await env.DB.prepare('SELECT id, project_id, interviewee_name FROM discovery_interviews WHERE id = ?')
    .bind(interviewId).first<ScopedInterview['interview']>();
  if (!interview) throw new IntakeError(404, 'interview_not_found', 'That interview no longer exists.');
  const project = await env.DB.prepare('SELECT id, founder_id, company_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(interview.project_id).first<ScopedInterview['project']>();
  if (!project || !canWrite(project, member as unknown as User)) {
    // Not "forbidden": an interview the member cannot write is, to them, not there.
    throw new IntakeError(404, 'interview_not_found', 'That interview no longer exists.');
  }
  return { member, project, interview };
}

/**
 * A new interview, made only by an explicit member action ("Create interview
 * from this chat"). Never called because an unknown contact wrote in.
 */
/** The interviewee's company as Who gave it (D685 §5.3): trimmed, at most 160 characters, or NULL. */
const companyOf = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t ? t.slice(0, 160) : null;
};

export async function createInterview(
  env: Env, userId: number, projectId: number, intervieweeName: string, intervieweeCompany: string | null = null,
): Promise<number> {
  const member = await activeMember(env, userId);
  const name = String(intervieweeName ?? '').trim().slice(0, 120);
  if (!name) throw new IntakeError(400, 'interviewee_required', 'Give the interview a name.');
  const project = await env.DB.prepare('SELECT id, founder_id, company_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(projectId).first<ScopedInterview['project']>();
  if (!project || !canWrite(project, member as unknown as User)) {
    throw new IntakeError(404, 'project_not_found', 'That venture is not one you can add interviews to.');
  }
  // D757 (#1898): the free tier's interview cap, the same check and body as POST /sessions.
  const capped = await interviewCapRefusal(env, member.id, project.id);
  if (capped) throw new IntakeError(402, 'tier_required', capped.message);
  const row = await env.DB.prepare(
    `INSERT INTO discovery_interviews (project_id, interviewee_name, interviewee_company, interview_date) VALUES (?, ?, ?, date('now')) RETURNING id`,
  ).bind(project.id, name, companyOf(intervieweeCompany)).first<{ id: number }>();
  if (!row) throw new IntakeError(500, 'not_stored', 'The interview could not be created.');
  return Number(row.id);
}

/**
 * A new session on a scoped interview, marked with its channel of origin.
 * Text channels start empty and become `transcribed` on their first append;
 * a meeting session waits as `draft` until its transcript is imported. A call
 * records the interviewee's consent when it is scheduled (`consent.method`,
 * one of CONSENT_METHODS): without it #1470's rule keeps the AI off the
 * transcript, as it does for a recording.
 *
 * D685 §5.1: the session also records how the call is held, in the setup
 * modal's terms — `call_provider` is the provider's own key (zoom and
 * google_meet on video, telegram and whatsapp on text), and only on a channel
 * that admits it — and the interview takes its channel from this session if
 * it had none. One batch: both land, or neither. `submitted_via` keeps its
 * own meaning (imported from elsewhere). An `in_person` session is a
 * recording a member forwarded to Axal's number (D754 way B, #1938).
 */
export async function openSession(
  env: Env, scoped: ScopedInterview, provider: ChannelProvider, channel: 'text' | 'video' | 'in_person',
  consent: { method: string } | null = null,
): Promise<SessionRow> {
  const uid = crypto.randomUUID();
  const callProvider = (CALL_PROVIDERS[channel] ?? []).includes(provider) ? provider : null;
  const [inserted] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO interview_sessions
         (uid, interview_id, project_id, created_by_user_id, channel, status, consent_status, consent_method, consent_at,
          submitted_via, submitted_via_name, call_provider)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END, ?, ?, ?) RETURNING id`,
    ).bind(uid, scoped.interview.id, scoped.project.id, scoped.member.id, channel,
      consent ? 'given' : 'not_recorded', consent?.method ?? null, consent?.method ?? null, provider, PROVIDER_LABEL[provider],
      callProvider),
    env.DB.prepare('UPDATE discovery_interviews SET channel = COALESCE(channel, ?) WHERE id = ?').bind(channel, scoped.interview.id),
  ]);
  const row = (inserted?.results?.[0] ?? null) as { id: number } | null;
  const session = row ? await loadSession(env, Number(row.id)) : null;
  if (!session) throw new IntakeError(500, 'not_stored', 'The session could not be created.');
  return session;
}

/** The session, re-scoped to the member: its interview must still be theirs to write. */
export async function writableSession(env: Env, userId: number, sessionId: number): Promise<{ scoped: ScopedInterview; session: SessionRow }> {
  const session = await loadSession(env, sessionId);
  if (!session) throw new IntakeError(404, 'session_not_found', 'That session no longer exists.');
  const scoped = await writableInterview(env, userId, Number(session.interview_id));
  if (Number(session.project_id) !== Number(scoped.project.id)) {
    throw new IntakeError(404, 'session_not_found', 'That session no longer exists.');
  }
  return { scoped, session };
}

export const intakeModel = (provider: ChannelProvider) => `channel:${provider}`;

/**
 * The most `discovery_interviews.transcript` grows to by channel appends, in
 * bytes. D1 refuses a string or row over 2,000,000 bytes; a chat that kept
 * appending would reach it, and from then every append to the interview —
 * every later message, and the member's own replies — would fail. Past this
 * bound the mirror stops growing; the segments, which are the session's
 * record and what Structure and Ask read, keep every message.
 */
export const TRANSCRIPT_MIRROR_MAX_BYTES = 1_000_000;

/**
 * Append messages to a channel session, in order, as final segments — the same
 * rows the paste-in Text chat writes. A session that was `draft` (or already
 * `structured`) becomes `transcribed`, so Structure is offered on what is new.
 * The plain text is appended to `discovery_interviews.transcript` for its
 * existing readers, up to TRANSCRIPT_MIRROR_MAX_BYTES. One batch: a reader
 * sees all of it or none. `alongside` joins that batch — the thread store
 * passes the deletion of the pending copies, so a message is never in both
 * places or neither.
 *
 * D685 §5.1.6: the batch that FIRST moves the session to `transcribed` (from
 * `draft`) means the conversation has happened, so the interview is then
 * marked held (stage `done`, its channel filled) — see `markHeld`. The move is
 * decided inside the batch, by a statement that changes a row only while the
 * session is still `draft`, so of two first messages delivered at once only
 * one marks it. A chat that was `structured` (the quiet-chat sweep does that
 * on its own) and gets new text goes back to `transcribed` without a mark, so
 * a stage the member set by hand stays. The mark is best-effort: it never
 * fails the append.
 */
export async function appendSegments(
  env: Env, userId: number, sessionId: number, segments: StoredSegment[], provider: ChannelProvider,
  alongside: D1PreparedStatement[] = [],
  /** A Telegram voice placeholder must still exist inside the append's batch. */
  sourceGuard?: { messageId: number; sourceRef: string },
): Promise<number> {
  const clean = segments
    .map((s) => ({ ...s, text: String(s.text ?? '').trim() }))
    .filter((s) => s.text.length > 0);
  const { session } = await writableSession(env, userId, sessionId);
  if (!clean.length) {
    if (alongside.length) await env.DB.batch(alongside);
    return 0;
  }
  const model = intakeModel(provider);
  const plain = clean.map((s) => s.text).join('\n');
  // The placeholder is removed by `alongside` after these writes, inside
  // the same batch. Both query alternatives use bound identifiers.
  const guardArgs = sourceGuard ? [sourceGuard.messageId, sourceGuard.sourceRef, session.id, userId] : [];
  const results = await env.DB.batch([
    ...clean.map((s) => provider === 'telegram' && /^[a-f0-9]{64}$/.test(s.source_ref ?? '') ? env.DB.prepare(
      sourceGuard ? `INSERT INTO interview_transcript_segments (session_id, source, start_ms, end_ms, speaker_label, speaker_raw, text, model, source_ref)
       SELECT ?, 'final', ?, ?, ?, ?, ?, ?, ? WHERE 1 = 1 AND EXISTS (
          SELECT 1 FROM channel_thread_messages m JOIN channel_threads t ON t.id = m.thread_id
          WHERE m.id = ? AND m.external_message_id = ? AND t.session_id = ? AND t.user_id = ? AND t.provider = 'telegram')` : `INSERT INTO interview_transcript_segments (session_id, source, start_ms, end_ms, speaker_label, speaker_raw, text, model, source_ref)
       SELECT ?, 'final', ?, ?, ?, ?, ?, ?, ? WHERE 1 = 1`,
    ).bind(session.id, s.start_ms, s.end_ms, s.speaker_label, s.speaker_raw, s.text, model, s.source_ref, ...guardArgs) : env.DB.prepare(
      `INSERT INTO interview_transcript_segments (session_id, source, start_ms, end_ms, speaker_label, speaker_raw, text, model)
       VALUES (?, 'final', ?, ?, ?, ?, ?, ?)`,
    ).bind(session.id, s.start_ms, s.end_ms, s.speaker_label, s.speaker_raw, s.text, model)),
    // The first move to transcribed, claimed inside the write: it changes a
    // row only for the one batch that finds the session still a draft.
    env.DB.prepare(
      sourceGuard ? `UPDATE interview_sessions SET status = 'transcribed' WHERE id = ? AND status = 'draft' AND EXISTS (
          SELECT 1 FROM channel_thread_messages m JOIN channel_threads t ON t.id = m.thread_id
          WHERE m.id = ? AND m.external_message_id = ? AND t.session_id = ? AND t.user_id = ? AND t.provider = 'telegram')` : `UPDATE interview_sessions SET status = 'transcribed' WHERE id = ? AND status = 'draft'`,
    ).bind(session.id, ...guardArgs),
    env.DB.prepare(
      sourceGuard ? `UPDATE interview_sessions
          SET status = CASE WHEN status IN ('draft', 'structured') THEN 'transcribed' ELSE status END,
              final_model = ?, updated_at = datetime('now')
        WHERE id = ? AND EXISTS (
          SELECT 1 FROM channel_thread_messages m JOIN channel_threads t ON t.id = m.thread_id
          WHERE m.id = ? AND m.external_message_id = ? AND t.session_id = ? AND t.user_id = ? AND t.provider = 'telegram')` : `UPDATE interview_sessions
          SET status = CASE WHEN status IN ('draft', 'structured') THEN 'transcribed' ELSE status END,
              final_model = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(model, session.id, ...guardArgs),
    env.DB.prepare(
      sourceGuard ? `UPDATE discovery_interviews
          SET transcript = CASE
                WHEN COALESCE(length(CAST(transcript AS BLOB)), 0) + length(CAST(? AS BLOB)) + 1 > ? THEN transcript
                WHEN transcript IS NULL OR transcript = '' THEN ?
                ELSE transcript || char(10) || ? END,
              transcribed_at = datetime('now'), transcribed_by_model = ?, updated_at = datetime('now')
        WHERE id = ? AND EXISTS (
          SELECT 1 FROM channel_thread_messages m JOIN channel_threads t ON t.id = m.thread_id
          WHERE m.id = ? AND m.external_message_id = ? AND t.session_id = ? AND t.user_id = ? AND t.provider = 'telegram')` : `UPDATE discovery_interviews
          SET transcript = CASE
                WHEN COALESCE(length(CAST(transcript AS BLOB)), 0) + length(CAST(? AS BLOB)) + 1 > ? THEN transcript
                WHEN transcript IS NULL OR transcript = '' THEN ?
                ELSE transcript || char(10) || ? END,
              transcribed_at = datetime('now'), transcribed_by_model = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(plain, TRANSCRIPT_MIRROR_MAX_BYTES, plain, plain, model, session.interview_id, ...guardArgs),
    ...alongside,
  ]);
  if (Number(results[clean.length]?.meta?.changes ?? 0) > 0) await markHeld(env, session, userId);
  return results.slice(0, clean.length).reduce((n, result) => n + Number(result.meta?.changes ?? 0), 0);
}

/**
 * The interview marked held through `markInterviewHeld`, which skips one
 * already `done`. An interview with no stage at all is left as it is (its
 * channel still filled): a hand-logged interview, or one made by "Create
 * interview from this chat", has none, and every reader already counts it as
 * held on its `interview_date` (`cycleValidate.ts`'s `interviewsFigure` and
 * `weeklyHeld`, `pipelineOf`). Moving it to `done` would stamp `done_at` today
 * and move it out of the month it was held in. Guarded once more: nothing
 * here may fail the write that called it.
 */
async function markHeld(env: Env, session: SessionRow, userId: number): Promise<void> {
  try {
    const row = await env.DB.prepare('SELECT stage FROM discovery_interviews WHERE id = ?')
      .bind(session.interview_id).first<{ stage: string | null }>();
    if (!row) return;
    if (row.stage != null) {
      await markInterviewHeld(env, session, userId);
      return;
    }
    await env.DB.prepare('UPDATE discovery_interviews SET channel = COALESCE(channel, ?) WHERE id = ?')
      .bind(session.channel, session.interview_id).run();
  } catch (e) {
    console.warn('[intake] marking the interview held failed', (e as Error)?.message);
  }
}

/**
 * A meeting's whole transcript, imported once: it replaces the session's
 * segments (as an audio session's final transcript replaces its live draft).
 * A transcript means the call took place, so once it is stored the interview
 * is marked held, best-effort, as an append does (D685 §5.1.6) — only when
 * this import is the session's first move to `transcribed`. Importing again
 * over a session already transcribed or structured leaves the stage, so a
 * stage the member set by hand stays.
 */
export async function importTranscript(
  env: Env, userId: number, sessionId: number, segments: ImportedSegment[], provider: ChannelProvider,
): Promise<number> {
  const { session } = await writableSession(env, userId, sessionId);
  const stored: StoredSegment[] = segments
    .map((s) => ({
      start_ms: s.startMs == null ? null : Math.max(0, Math.round(s.startMs)),
      end_ms: s.endMs == null ? null : Math.max(0, Math.round(s.endMs)),
      speaker_label: String(s.speaker ?? '').trim().slice(0, 80) || 'Speaker ?',
      speaker_raw: null,
      text: String(s.text ?? '').trim(),
    }))
    .filter((s) => s.text.length > 0);
  if (!stored.length) throw new IntakeError(422, 'transcript_empty', 'The meeting transcript had no text to import.');
  const first = session.status !== 'transcribed' && session.status !== 'structured';
  await replaceWithFinal(env, session, stored, `${provider}_transcript`, null, 'transcribed');
  if (first) await markHeld(env, session, userId);
  return stored.length;
}
