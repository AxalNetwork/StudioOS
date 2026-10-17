/**
 * D684 (#1577) — a Zoom or Google Meet call an interview scheduled, from the
 * moment it is created to the moment its transcript is in the interview.
 *
 * One `interview_channel_refs` row per call (migration 449). It is the call's
 * tenancy: the member, the interview and the session are the row's, set when
 * the member scheduled it, and nothing a provider sends later can change them.
 * A Zoom webhook finds the row by (provider, meeting id); the Meet sweep reads
 * it directly. Both then hand the row to `importMeetingRef`, which asks the
 * adapter for the transcript with the member's own token and writes normalized final segments after
 * `interviewIntake.writableSession` re-checks the member and the venture — so Structure and Ask work on it as on any other session.
 *
 *   scheduled → ended → transcript_ready → imported
 *                     ↘ no_transcript (the provider made none, with the reason)
 *                     ↘ failed        (with what to do about it)
 *   any but imported → cancelled
 *
 * `last_error` holds a sentence from MEETING_ERRORS — plain words the member
 * can act on, never a provider's text — and `errorCodeOf` gives back its code.
 */
import type { Env } from '../../types';
import { IntakeError, writableSession } from '../interviewIntake';
import { enqueueSessionStructure } from '../sessionAutoStructure';
import { PROVIDER_LABEL } from './types';
import type { ChannelJobPayload } from './jobs';
import type { ImportedSegment, MeetingProvider } from './types';

export type MeetingStatus =
  | 'scheduled' | 'ended' | 'transcript_ready' | 'imported' | 'no_transcript' | 'failed' | 'cancelled';

export interface MeetingRef {
  id: number; uid: string; provider: MeetingProvider; external_ref: string; session_id: number;
  interview_id: number; user_id: number; join_url: string | null; starts_at: string | null; ends_at: string | null;
  status: MeetingStatus; last_error: string | null; created_at: string; updated_at: string;
}

/** How early before its slot a call may start, and how late after it. */
export const SLOT_EARLY_MS = 30 * 60 * 1000;
export const SLOT_LATE_MS = 60 * 60 * 1000;
/** A ref with no end is taken to last this long. */
const SLOT_DEFAULT_MS = 2 * 60 * 60 * 1000;

/**
 * Whether a conference that started at `startedMs` is this interview's call:
 * it started within the scheduled slot, up to SLOT_EARLY_MS before it or
 * SLOT_LATE_MS after it ends. A rejoin or a restart during the call is kept;
 * another use of the same link later that day is someone else's conversation
 * and never lands in the interview. False when either time is unknown.
 */
export function withinCallSlot(startedMs: number, ref: Pick<MeetingRef, 'starts_at' | 'ends_at'>): boolean {
  const start = Date.parse(String(ref.starts_at ?? ''));
  if (!Number.isFinite(startedMs) || !Number.isFinite(start)) return false;
  const parsedEnd = Date.parse(String(ref.ends_at ?? ''));
  const end = Number.isFinite(parsedEnd) && parsedEnd >= start ? parsedEnd : start + SLOT_DEFAULT_MS;
  return startedMs >= start - SLOT_EARLY_MS && startedMs <= end + SLOT_LATE_MS;
}

/**
 * Every reason a call can stop short of an imported transcript, as the member
 * reads it. The codes travel in API responses; the sentences are stored.
 */
export const MEETING_ERRORS = {
  zoom_not_connected: 'Zoom is not connected to your Axal account. Connect it in Account › Connectors, then retry.',
  zoom_reconnect: 'Zoom no longer accepts Axal’s access. Reconnect Zoom in Account › Connectors, then retry.',
  zoom_unreachable: 'Zoom did not answer. Try again in a minute.',
  zoom_create_failed: 'Zoom could not create the call. Try again in a minute.',
  zoom_fetch_failed: 'Zoom refused the request for this call’s transcript. Try again later.',
  zoom_no_transcript: 'Zoom has no transcript for this call. Transcripts need a paid Zoom plan with cloud recording and “Audio transcript” turned on, and the call recorded to the cloud. You can still use the recorder or paste the conversation.',
  meet_not_connected: 'Google is not connected to your Axal account. Connect Google in Account › Connectors, then retry.',
  // No Axal consent asks for Meet's transcript permission yet (#1585), so no
  // reconnect can grant it: the sentence says so, and what to do instead.
  meet_transcripts_unavailable: 'Google Meet transcripts are not available on Axal yet, so this call’s transcript will not be imported. You can still hold the call: use the recorder in Axal during it, or paste the conversation afterwards.',
  meet_reconnect: 'Google no longer accepts Axal’s access. Reconnect Google in Account › Connectors, then retry.',
  meet_api_disabled: 'Reading Google Meet transcripts is not turned on for Axal yet, so this transcript cannot be fetched.',
  meet_unreachable: 'Google Meet did not answer. Try again in a minute.',
  meet_create_failed: 'Google Calendar could not create the call. Try again in a minute.',
  meet_link_unavailable: 'Google Calendar created the event but gave it no Meet link. Check that Google Meet is on for your account, then try again.',
  meet_fetch_failed: 'Google Meet refused the request for this call’s transcript. Try again later.',
  meet_no_record: 'Google Meet has no record of this call, so there is no transcript to import. If it took place, use the recorder or paste the conversation.',
  meet_no_transcript: 'Google Meet made no transcript of this call. Transcripts need a Google Workspace edition that includes Meet transcription, and someone in the call has to turn transcription on.',
  transcript_empty: 'The transcript had no speech in it to import.',
  transcript_too_large: 'The transcript is larger than Axal imports. Paste the part you need instead.',
  interview_gone: 'The interview or its session no longer exists, or is no longer yours, so nothing was imported.',
  member_inactive: 'The Axal account that scheduled this call is no longer active, so nothing was imported.',
  zoom_cancel_confirmed: 'Zoom confirmed cancellation of this call.',
  meet_cancel_confirmed: 'Google confirmed cancellation of this call.',
  zoom_cancel_unconfirmed: 'Axal stopped importing this call, but Zoom did not confirm cancellation. Cancel it in Zoom too.',
  meet_cancel_unconfirmed: 'Axal stopped importing this call, but Google did not confirm cancellation. Cancel it in Google Calendar too.',
  import_failed: 'The transcript could not be imported. Try again in a minute.',
} as const;
export type MeetingErrorCode = keyof typeof MEETING_ERRORS;

/** The code behind a stored sentence, or null (no error, or one from an older wording). */
export function errorCodeOf(lastError: string | null): MeetingErrorCode | null {
  if (!lastError) return null;
  const hit = (Object.keys(MEETING_ERRORS) as MeetingErrorCode[]).find((k) => MEETING_ERRORS[k] === lastError);
  return hit ?? null;
}

/**
 * A provider call that failed. `code` is a MEETING_ERRORS key; `retryable`
 * says whether trying later may succeed (429, 5xx, network). The provider's
 * own text never rides on it.
 */
export class MeetingProviderError extends Error {
  code: MeetingErrorCode;
  retryable: boolean;
  constructor(code: MeetingErrorCode, retryable: boolean) {
    super(code);
    this.name = 'MeetingProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}

export async function loadRef(env: Env, uid: string): Promise<MeetingRef | null> {
  const key = String(uid ?? '').trim();
  if (!key) return null;
  return (await env.DB.prepare('SELECT * FROM interview_channel_refs WHERE uid = ?').bind(key).first<MeetingRef>()) ?? null;
}

/** The member's ref on one of their interviews: anything else is, to them, not there. */
export async function memberRef(env: Env, userId: number, interviewId: number, uid: string): Promise<MeetingRef | null> {
  return (await env.DB.prepare(
    'SELECT * FROM interview_channel_refs WHERE uid = ? AND interview_id = ? AND user_id = ?',
  ).bind(String(uid ?? ''), interviewId, userId).first<MeetingRef>()) ?? null;
}

/** The ref for a provider's meeting id. The only way a webhook reaches a member. */
export async function refByExternal(env: Env, provider: MeetingProvider, externalRef: string): Promise<MeetingRef | null> {
  const key = String(externalRef ?? '').trim().slice(0, 200);
  if (!key) return null;
  return (await env.DB.prepare('SELECT * FROM interview_channel_refs WHERE provider = ? AND external_ref = ?')
    .bind(provider, key).first<MeetingRef>()) ?? null;
}

/**
 * Move a ref, with the reason when there is one. An imported or cancelled call
 * is settled: nothing here moves it again (cancelling has its own path).
 */
export async function setRefStatus(env: Env, refId: number, status: MeetingStatus, code: MeetingErrorCode | null): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE interview_channel_refs SET status = ?, last_error = ?, updated_at = datetime('now')
      WHERE id = ? AND status NOT IN ('imported', 'cancelled')`,
  ).bind(status, code ? MEETING_ERRORS[code] : null, refId).run();
  return Number(res.meta?.changes ?? 0) > 0;
}

/** Zoom said the call ended. Only a call still waiting to happen moves. */
export async function markEnded(env: Env, refId: number): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE interview_channel_refs SET status = 'ended', updated_at = datetime('now') WHERE id = ? AND status = 'scheduled'`,
  ).bind(refId).run();
  return Number(res.meta?.changes ?? 0) > 0;
}

/** Looked at, nothing changed: the sweep waits before looking again. */
export async function touchRef(env: Env, refId: number): Promise<void> {
  await env.DB.prepare(`UPDATE interview_channel_refs SET updated_at = datetime('now') WHERE id = ?`).bind(refId).run();
}

export async function cancelRef(env: Env, refId: number, notice: MeetingErrorCode | null = null): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE interview_channel_refs SET status = 'cancelled', last_error = ?, updated_at = datetime('now')
      WHERE id = ? AND status <> 'imported'`,
  ).bind(notice ? MEETING_ERRORS[notice] : null, refId).run();
  return Number(res.meta?.changes ?? 0) > 0;
}

/** A pasted call link points at the live recording until Stop supplies its end. */
export async function closeAttachedRefs(env: Env, sessionId: number): Promise<number> {
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) return 0;
  const session = await env.DB.prepare(
    'SELECT started_at, stopped_at FROM interview_sessions WHERE id = ?',
  ).bind(sessionId).first<{ started_at: string | null; stopped_at: string | null }>();
  if (!session?.stopped_at) return 0;
  const result = await env.DB.prepare(
    `UPDATE interview_channel_refs SET starts_at = COALESCE(?, starts_at), ends_at = ?,
       status = CASE WHEN status = 'scheduled' THEN 'ended' ELSE status END,
       updated_at = datetime('now')
     WHERE session_id = ? AND ends_at IS NULL AND status <> 'cancelled'`,
  ).bind(session.started_at, session.stopped_at, sessionId).run();
  return Number(result.meta?.changes ?? 0);
}

/**
 * Refs a sweep should look at, oldest-looked-at first, at most `limit`:
 * a call that should have ended by `endedBefore` and is still waiting, or one
 * whose transcript was found but never imported (a lost job). Either only when
 * nothing has touched it since `idleBefore`, so a sweep never hammers a call.
 */
export async function dueRefs(
  env: Env, provider: MeetingProvider, opts: { endedBefore: string; idleBefore: string; limit: number; importedAfter?: string },
): Promise<MeetingRef[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM interview_channel_refs
      WHERE provider = ? AND datetime(updated_at) < datetime(?)
        AND ((status IN ('scheduled', 'ended') AND ends_at IS NOT NULL AND datetime(ends_at) < datetime(?))
             OR status = 'transcript_ready'
             OR (status = 'imported' AND provider = 'zoom' AND instr(external_ref, ':') = 0
                 AND ? IS NOT NULL AND datetime(ends_at) >= datetime(?) AND datetime(ends_at) < datetime(?)))
      ORDER BY datetime(updated_at), id LIMIT ?`,
  ).bind(provider, opts.idleBefore, opts.endedBefore, opts.importedAfter ?? null, opts.importedAfter ?? null, opts.endedBefore, Math.min(Math.max(opts.limit, 1), 100)).all<MeetingRef>();
  return rows.results ?? [];
}

/** What an adapter found when asked for a call's transcript. */
export type TranscriptFetch =
  | { kind: 'segments'; segments: ImportedSegment[] }
  /** The provider is still making it: leave the call waiting. */
  | { kind: 'waiting' }
  /** Settled: there is none, and `code` says why. */
  | { kind: 'none'; code: MeetingErrorCode }
  | { kind: 'error'; code: MeetingErrorCode; retryable: boolean };

/** `hint` is the job's payload (Zoom passes the meeting instance's uuid); {} from a retry or a sweep. */
export type TranscriptFetcher = (env: Env, ref: MeetingRef, hint: Record<string, unknown>) => Promise<TranscriptFetch>;

/**
 * One provider's whole import of a ref: `importMeetingRef` with its fetcher
 * (Meet), or an adapter's own path that ends there (Zoom, whose restarted call
 * has more than one instance — services/channels/zoom.ts).
 */
export type MeetingImporter = (env: Env, ref: MeetingRef, hint: Record<string, unknown>) => Promise<ImportOutcome>;

export interface ImportOutcome {
  status: MeetingStatus | 'skipped' | 'waiting';
  code: MeetingErrorCode | null;
  retryable: boolean;
  segments: number;
}

const unreachable = (p: MeetingProvider): MeetingErrorCode => (p === 'zoom' ? 'zoom_unreachable' : 'meet_unreachable');

const attachedUid = (ref: MeetingRef) => `meeting:${ref.uid}`;

/** The recording is never a provider transcript's destination. */
async function destinationSession(env: Env, ref: MeetingRef): Promise<{ id: number; attached: boolean }> {
  const { session: anchor } = await writableSession(env, Number(ref.user_id), Number(ref.session_id));
  if (Number(anchor.interview_id) !== Number(ref.interview_id) || Number(anchor.created_by_user_id) !== Number(ref.user_id)) {
    throw new IntakeError(404, 'session_not_found', 'That session no longer exists.');
  }
  const meta = await env.DB.prepare('SELECT submitted_via FROM interview_sessions WHERE id = ?')
    .bind(anchor.id).first<{ submitted_via: string | null }>();
  if (meta?.submitted_via) return { id: anchor.id, attached: false };
  if (anchor.consent_status !== 'given' || !anchor.consent_method) {
    throw new IntakeError(403, 'consent_not_recorded', 'Record consent before importing this call.');
  }
  const uid = attachedUid(ref);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO interview_sessions
       (uid, interview_id, project_id, created_by_user_id, channel, status,
        consent_status, consent_method, consent_at, submitted_via, submitted_via_name)
     VALUES (?, ?, ?, ?, 'video', 'draft', 'given', ?, ?, ?, ?)`,
  ).bind(uid, ref.interview_id, anchor.project_id, ref.user_id,
    anchor.consent_method, anchor.consent_at, ref.provider, PROVIDER_LABEL[ref.provider]).run();
  const row = await env.DB.prepare('SELECT id FROM interview_sessions WHERE uid = ? AND interview_id = ? AND created_by_user_id = ?')
    .bind(uid, ref.interview_id, ref.user_id).first<{ id: number }>();
  if (!row) throw new IntakeError(500, 'not_stored', 'The provider transcript session could not be created.');
  return { id: Number(row.id), attached: true };
}

/** Store a provider transcript in its own session while preserving a live recording's interview transcript. */
async function storeWithoutReplacingRecording(env: Env, ref: MeetingRef, sessionId: number, segments: ImportedSegment[], mirror = false): Promise<number> {
  await writableSession(env, Number(ref.user_id), sessionId);
  const clean = segments.map((s) => ({
    text: String(s.text ?? '').trim(), speaker: String(s.speaker ?? '').trim().slice(0, 80) || 'Speaker ?',
    start: s.startMs == null ? null : Math.max(0, Math.round(s.startMs)),
    end: s.endMs == null ? null : Math.max(0, Math.round(s.endMs)),
  })).filter((s) => s.text);
  if (!clean.length) throw new IntakeError(422, 'transcript_empty', 'The meeting transcript had no text to import.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM interview_transcript_segments WHERE session_id = ?').bind(sessionId),
    ...clean.map((s) => env.DB.prepare(
      `INSERT INTO interview_transcript_segments (session_id, source, start_ms, end_ms, speaker_label, speaker_raw, text, model)
       VALUES (?, 'final', ?, ?, ?, NULL, ?, ?)`,
    ).bind(sessionId, s.start, s.end, s.speaker, s.text, `${ref.provider}_transcript`)),
    env.DB.prepare(
      `UPDATE interview_sessions SET status = 'transcribed', final_model = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(`${ref.provider}_transcript`, sessionId),
    ...(mirror ? [env.DB.prepare(
      `UPDATE discovery_interviews SET transcript = (
         SELECT group_concat(text, char(10)) FROM (
           SELECT t.text FROM interview_sessions s JOIN interview_transcript_segments t ON t.session_id = s.id
            WHERE s.interview_id = ? AND s.created_by_user_id = ? AND s.submitted_via IN ('zoom','google_meet')
              AND t.source = 'final' ORDER BY s.created_at, s.id, t.id
         )
       ), transcribed_at = datetime('now'), transcribed_by_model = 'meeting_sessions', updated_at = datetime('now')
       WHERE id = ? AND NOT EXISTS (
         SELECT 1 FROM interview_sessions s JOIN interview_transcript_segments t ON t.session_id = s.id
          WHERE s.interview_id = ? AND s.submitted_via IS NULL AND t.source = 'final'
       )`,
    ).bind(ref.interview_id, ref.user_id, ref.interview_id, ref.interview_id)] : []),
  ]);
  return clean.length;
}

/**
 * Fetch a call's transcript and import it into the call's session. Safe to run
 * twice: an import replaces the session's segments whole, and a settled ref is
 * skipped. Every outcome is written to the ref, so the member sees it.
 */
export async function importMeetingRef(
  env: Env, ref: MeetingRef, fetcher: TranscriptFetcher, hint: Record<string, unknown> = {},
): Promise<ImportOutcome> {
  if (ref.status === 'imported' || ref.status === 'cancelled') {
    return { status: 'skipped', code: null, retryable: false, segments: 0 };
  }
  let got: TranscriptFetch;
  try {
    got = await fetcher(env, ref, hint);
  } catch (e) {
    if (e instanceof MeetingProviderError) got = { kind: 'error', code: e.code, retryable: e.retryable };
    else {
      // Names only: a fetch error can carry a URL, and a transcript is never logged.
      console.error('[meetings] fetch threw provider=%s ref=%s', ref.provider, ref.uid, e instanceof Error ? e.name : 'error');
      got = { kind: 'error', code: unreachable(ref.provider), retryable: true };
    }
  }

  if (got.kind === 'waiting') {
    await setRefStatus(env, ref.id, 'ended', null);
    return { status: 'waiting', code: null, retryable: false, segments: 0 };
  }
  if (got.kind === 'none') {
    await setRefStatus(env, ref.id, 'no_transcript', got.code);
    return { status: 'no_transcript', code: got.code, retryable: false, segments: 0 };
  }
  if (got.kind === 'error') {
    await setRefStatus(env, ref.id, 'failed', got.code);
    return { status: 'failed', code: got.code, retryable: got.retryable, segments: 0 };
  }

  try {
    const destination = await destinationSession(env, ref);
    const recordedElsewhere = destination.attached || !!(await env.DB.prepare(
      `SELECT 1 FROM interview_sessions s WHERE s.interview_id = ? AND s.id <> ? AND s.submitted_via IS NULL
        AND EXISTS (SELECT 1 FROM interview_transcript_segments t WHERE t.session_id = s.id AND t.source = 'final') LIMIT 1`,
    ).bind(ref.interview_id, destination.id).first());
    const n = await storeWithoutReplacingRecording(env, ref, destination.id, got.segments, !recordedElsewhere);
    await setRefStatus(env, ref.id, 'imported', null);
    // The transcript is in: the Worker AI proposes its findings (pain points
    // and the rest) for the founder to review, without waiting for a button.
    await enqueueSessionStructure(env, destination.id, Number(ref.user_id), 'call_imported');
    return { status: 'imported', code: null, retryable: false, segments: n };
  } catch (e) {
    let code: MeetingErrorCode = 'import_failed';
    let status: MeetingStatus = 'failed';
    if (e instanceof IntakeError && e.status === 422) { code = 'transcript_empty'; status = 'no_transcript'; }
    else if (e instanceof IntakeError && e.status === 404) code = 'interview_gone';
    else if (e instanceof IntakeError && e.status === 403) code = 'member_inactive';
    else console.error('[meetings] import failed ref=%s', ref.uid, e instanceof Error ? e.name : 'error');
    await setRefStatus(env, ref.id, status, code);
    return { status, code, retryable: code === 'import_failed', segments: 0 };
  }
}

/**
 * The `meeting_import` job for one provider. A ref that is gone (its session
 * was deleted, which cascades) or belongs to another provider is nothing to
 * do. A failure worth retrying throws — with its code only — so the queue
 * tries again; the ref already says what happened.
 */
export function meetingImportHandler(provider: MeetingProvider, importer: MeetingImporter) {
  return async (env: Env, payload: ChannelJobPayload): Promise<void> => {
    const ref = await loadRef(env, String(payload.refUid ?? ''));
    if (!ref || ref.provider !== provider) return;
    const out = await importer(env, ref, payload);
    if (out.status === 'failed' && out.retryable) throw new Error(`meeting_import_retry:${out.code}`);
  };
}

/** Wire one meeting into the scheduling response: the ref with its reason, never a token or text. */
export function meetingView(ref: MeetingRef, label: string) {
  const code = errorCodeOf(ref.last_error);
  const confirmed = ref.status === 'cancelled' && ['zoom_cancel_confirmed','meet_cancel_confirmed'].includes(code ?? '');
  const unconfirmed = ref.status === 'cancelled' && ['zoom_cancel_unconfirmed','meet_cancel_unconfirmed'].includes(code ?? '');
  return {
    uid: ref.uid, provider: ref.provider, label, join_url: ref.join_url, starts_at: ref.starts_at, ends_at: ref.ends_at,
    status: ref.status, provider_cancelled: confirmed ? true : unconfirmed ? false : null, error: confirmed ? null : ref.last_error, error_code: confirmed ? null : code,
    interview_id: Number(ref.interview_id), session_id: Number(ref.session_id),
    created_at: ref.created_at, updated_at: ref.updated_at,
  };
}
