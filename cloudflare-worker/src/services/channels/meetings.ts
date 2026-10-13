/**
 * D684 (#1577) — a Zoom or Google Meet call an interview scheduled, from the
 * moment it is created to the moment its transcript is in the interview.
 *
 * One `interview_channel_refs` row per call (migration 449). It is the call's
 * tenancy: the member, the interview and the session are the row's, set when
 * the member scheduled it, and nothing a provider sends later can change them.
 * A Zoom webhook finds the row by (provider, meeting id); the Meet sweep reads
 * it directly. Both then hand the row to `importMeetingRef`, which asks the
 * adapter for the transcript with the member's own token and writes it through
 * `interviewIntake.importTranscript` — which re-checks the member and the
 * venture — so Structure and Ask work on it as on any other session.
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
import { IntakeError, importTranscript } from '../interviewIntake';
import { enqueueSessionStructure } from '../sessionAutoStructure';
import type { ChannelJobPayload } from './jobs';
import type { ImportedSegment, MeetingProvider } from './types';

export type MeetingStatus =
  | 'scheduled' | 'ended' | 'transcript_ready' | 'imported' | 'no_transcript' | 'failed' | 'cancelled';

export interface MeetingRef {
  id: number; uid: string; provider: MeetingProvider; external_ref: string; session_id: number;
  interview_id: number; user_id: number; join_url: string | null; starts_at: string | null; ends_at: string | null;
  status: MeetingStatus; last_error: string | null; created_at: string; updated_at: string;
}

/**
 * Every reason a call can stop short of an imported transcript, as the member
 * reads it. The codes travel in API responses; the sentences are stored.
 */
export const MEETING_ERRORS = {
  zoom_not_connected: 'Zoom is not connected to your Axal account. Connect it in Account › Connectors, then retry.',
  zoom_reconnect: 'Zoom no longer accepts Axal’s access. Reconnect Zoom in Account › Connectors, then retry.',
  zoom_unreachable: 'Zoom did not answer. Axal will try again; you can also retry now.',
  zoom_create_failed: 'Zoom could not create the call. Try again in a minute.',
  zoom_fetch_failed: 'Zoom refused the request for this call’s transcript. Try again later.',
  zoom_no_transcript: 'Zoom has no transcript for this call. Transcripts need a paid Zoom plan with cloud recording and “Audio transcript” turned on, and the call recorded to the cloud. You can still use the recorder or paste the conversation.',
  meet_not_connected: 'Google is not connected to your Axal account. Connect Google in Account › Connectors, then retry.',
  meet_scope_missing: 'Google needs to be reconnected to allow transcripts: reconnect Google in Account › Connectors and allow Axal to read your Meet transcripts, then retry.',
  meet_reconnect: 'Google no longer accepts Axal’s access. Reconnect Google in Account › Connectors, then retry.',
  meet_api_disabled: 'Reading Google Meet transcripts is not turned on for Axal yet, so this transcript cannot be fetched.',
  meet_unreachable: 'Google Meet did not answer. Axal will try again; you can also retry now.',
  meet_create_failed: 'Google Calendar could not create the call. Try again in a minute.',
  meet_link_unavailable: 'Google Calendar created the event but gave it no Meet link. Check that Google Meet is on for your account, then try again.',
  meet_fetch_failed: 'Google Meet refused the request for this call’s transcript. Try again later.',
  meet_no_record: 'Google Meet has no record of this call, so there is no transcript to import. If it took place, use the recorder or paste the conversation.',
  meet_no_transcript: 'Google Meet made no transcript of this call. Transcripts need a Google Workspace edition that includes Meet transcription, and someone in the call has to turn transcription on.',
  transcript_empty: 'The transcript had no speech in it to import.',
  transcript_too_large: 'The transcript is larger than Axal imports. Paste the part you need instead.',
  interview_gone: 'The interview or its session no longer exists, or is no longer yours, so nothing was imported.',
  member_inactive: 'The Axal account that scheduled this call is no longer active, so nothing was imported.',
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

export async function cancelRef(env: Env, refId: number): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE interview_channel_refs SET status = 'cancelled', last_error = NULL, updated_at = datetime('now')
      WHERE id = ? AND status <> 'imported'`,
  ).bind(refId).run();
  return Number(res.meta?.changes ?? 0) > 0;
}

/**
 * Refs a sweep should look at, oldest-looked-at first, at most `limit`:
 * a call that should have ended by `endedBefore` and is still waiting, or one
 * whose transcript was found but never imported (a lost job). Either only when
 * nothing has touched it since `idleBefore`, so a sweep never hammers a call.
 */
export async function dueRefs(
  env: Env, provider: MeetingProvider, opts: { endedBefore: string; idleBefore: string; limit: number },
): Promise<MeetingRef[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM interview_channel_refs
      WHERE provider = ? AND datetime(updated_at) < datetime(?)
        AND ((status IN ('scheduled', 'ended') AND ends_at IS NOT NULL AND datetime(ends_at) < datetime(?))
             OR status = 'transcript_ready')
      ORDER BY datetime(updated_at), id LIMIT ?`,
  ).bind(provider, opts.idleBefore, opts.endedBefore, Math.min(Math.max(opts.limit, 1), 100)).all<MeetingRef>();
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

export interface ImportOutcome {
  status: MeetingStatus | 'skipped' | 'waiting';
  code: MeetingErrorCode | null;
  retryable: boolean;
  segments: number;
}

const unreachable = (p: MeetingProvider): MeetingErrorCode => (p === 'zoom' ? 'zoom_unreachable' : 'meet_unreachable');

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
      console.error(`[meetings] fetch threw provider=${ref.provider} ref=${ref.uid}`, e instanceof Error ? e.name : 'error');
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
    const n = await importTranscript(env, Number(ref.user_id), Number(ref.session_id), got.segments, ref.provider);
    await setRefStatus(env, ref.id, 'imported', null);
    // The transcript is in: the Worker AI proposes its findings (pain points
    // and the rest) for the founder to review, without waiting for a button.
    await enqueueSessionStructure(env, Number(ref.session_id), Number(ref.user_id), 'call_imported');
    return { status: 'imported', code: null, retryable: false, segments: n };
  } catch (e) {
    let code: MeetingErrorCode = 'import_failed';
    let status: MeetingStatus = 'failed';
    if (e instanceof IntakeError && e.status === 422) { code = 'transcript_empty'; status = 'no_transcript'; }
    else if (e instanceof IntakeError && e.status === 404) code = 'interview_gone';
    else if (e instanceof IntakeError && e.status === 403) code = 'member_inactive';
    else console.error(`[meetings] import failed ref=${ref.uid}`, e instanceof Error ? e.name : 'error');
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
export function meetingImportHandler(provider: MeetingProvider, fetcher: TranscriptFetcher) {
  return async (env: Env, payload: ChannelJobPayload): Promise<void> => {
    const ref = await loadRef(env, String(payload.refUid ?? ''));
    if (!ref || ref.provider !== provider) return;
    const out = await importMeetingRef(env, ref, fetcher, payload);
    if (out.status === 'failed' && out.retryable) throw new Error(`meeting_import_retry:${out.code}`);
  };
}

/** Wire one meeting into the scheduling response: the ref with its reason, never a token or text. */
export function meetingView(ref: MeetingRef, label: string) {
  return {
    uid: ref.uid, provider: ref.provider, label, join_url: ref.join_url, starts_at: ref.starts_at, ends_at: ref.ends_at,
    status: ref.status, error: ref.last_error, error_code: errorCodeOf(ref.last_error),
    interview_id: Number(ref.interview_id), session_id: Number(ref.session_id),
    created_at: ref.created_at, updated_at: ref.updated_at,
  };
}
