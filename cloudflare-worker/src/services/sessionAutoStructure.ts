/**
 * D684 — from a transcript to Validate, without a button.
 *
 * The goal is the owner's: a call or a customer chat is transcribed, the
 * Worker AI finds the pain points, and the other Validate modules fill in. The
 * finding step already exists — D658's Structure, which proposes seven kinds of
 * placement (pain severity → Problem discovery, ICP fit, segments, demand
 * signals, evidence, competitor mentions, market facts) — but until now only a
 * press of "Structure the transcript" ran it. This file runs the same pass on
 * its own when a transcript arrives:
 *
 *   call_imported  a Zoom or Meet transcript was imported (meetings.ts)
 *   chat_assigned  a customer chat was assigned to an interview (threads.ts)
 *   chat_quiet     an assigned chat gained messages and then went quiet for
 *                  QUIET_MINUTES (the five-minute channel sweep)
 *
 * What it does NOT change:
 *   - Placements stay proposals. The founder accepts, edits or discards each
 *     one in the review; nothing reaches a module on its own (D658).
 *   - The consent rule (#1470): an audio or video session without consent
 *     "given" is not structured, here as by hand.
 *   - The D640 budget: every run reserves and settles the member's budget and
 *     leaves its receipt lines, as a manual run does. A refused run is recorded
 *     and the session stays `transcribed`, so the founder can still press
 *     Structure.
 *
 * Re-runs are bounded so a chatty customer cannot spend the member's budget:
 * a session is auto-structured at most once per MIN_HOURS_BETWEEN, counting
 * refused runs, and only when it has new text since its last run (its status
 * is back to `transcribed`).
 *
 * The run itself is the sequence `POST /sessions/:id/structure` and the
 * assistant path (`assistantInterviews.ts`) already share, through the route's
 * exported helpers. S03's processing pipeline (Record a session: upload →
 * transcribe → summarise → place findings) calls `structureSession` for its
 * last step.
 */
import type { Env } from '../types';
import { sessionConsentBlocks } from './interviewSessions';
import { consentRequiredProviders } from './channels/types';
import { IntakeError, writableSession } from './interviewIntake';
import { structureTranscript, toSegments, type SegmentRow } from './interviewStructuring';
import { enqueueJob } from './queue';
import { loadStructureContext, recordStructureReceipt, storePlacements } from '../routes/founder_validate_structure';

export type StructureTrigger = 'call_imported' | 'chat_assigned' | 'chat_quiet' | 'recording_processed';

/** An assigned chat is structured again once it has been quiet this long. */
export const QUIET_MINUTES = 30;
/** And never more often than this, refused runs included. */
export const MIN_HOURS_BETWEEN = 6;

export type StructureOutcome =
  | { ok: true; runId: string; stored: number; dropped: number }
  | { ok: false; reason: 'consent_not_recorded' | 'no_final_transcript' | 'not_writable' | 'refused'; refusal?: string | null };

function newRunId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * One structuring run over a session's final transcript, as the member. The
 * member and the venture are re-checked first (`writableSession`), so a member
 * who lost the venture, or whose account closed, runs nothing.
 */
export async function structureSession(
  env: Env, opts: { sessionId: number; userId: number; trigger: StructureTrigger },
): Promise<StructureOutcome> {
  let session;
  try {
    ({ session } = await writableSession(env, opts.userId, opts.sessionId));
  } catch (err) {
    if (err instanceof IntakeError) return { ok: false, reason: 'not_writable' };
    throw err;
  }
  if (await sessionConsentBlocks(env, session)) return { ok: false, reason: 'consent_not_recorded' };

  const rows = await env.DB.prepare(
    `SELECT start_ms, end_ms, speaker_label, text FROM interview_transcript_segments
      WHERE session_id = ? AND source = 'final' ORDER BY COALESCE(start_ms, 0), id`,
  ).bind(session.id).all<SegmentRow>();
  const segments = toSegments(rows.results ?? []);
  if (!segments.length) return { ok: false, reason: 'no_final_transcript' };

  const prior = await env.DB.prepare('SELECT COUNT(DISTINCT run_id) AS n FROM validate_proposals WHERE session_id = ?')
    .bind(session.id).first<{ n: number }>();
  const step = Number(prior?.n || 0) > 0 ? 're_structured' : 'structured';
  const runId = newRunId();
  const out = await structureTranscript(env, {
    userId: opts.userId, segments, context: await loadStructureContext(env, session.project_id), step,
  });
  for (let i = 0; i < out.receipt.length; i += 1) {
    const refusedHere = !out.ok && i === out.receipt.length - 1;
    await recordStructureReceipt(env, session.id, runId, out.receipt[i], refusedHere ? 'refused' : 'ok',
      refusedHere ? (out as { refusal?: string | null }).refusal ?? null : null);
  }
  if (!out.ok) return { ok: false, reason: 'refused', refusal: (out as { refusal?: string | null }).refusal ?? null };

  await storePlacements(env, {
    projectId: session.project_id, sessionId: session.id, interviewId: session.interview_id, runId,
    userId: opts.userId, model: out.receipt[out.receipt.length - 1]?.model || '', placements: out.placements,
  });
  await env.DB.prepare(
    "UPDATE interview_sessions SET status = 'structured', updated_at = datetime('now') WHERE id = ? AND status = 'transcribed'",
  ).bind(session.id).run();
  return { ok: true, runId, stored: out.placements.length, dropped: out.dropped };
}

/** Queue a run (`session_structure`). One per session and trigger moment. */
export function enqueueSessionStructure(env: Env, sessionId: number, userId: number, trigger: StructureTrigger) {
  return enqueueJob(env, 'session_structure', { session_id: sessionId, user_id: userId, trigger }, {
    idempotency_key: `session_structure:${sessionId}:${trigger}:${Math.floor(Date.now() / 60_000)}`,
  });
}

/** The `session_structure` job. A refusal or a missing transcript is an outcome, not a failure to retry. */
export async function runSessionStructureJob(env: Env, payload: unknown): Promise<StructureOutcome | null> {
  const p = (payload ?? {}) as { session_id?: unknown; user_id?: unknown; trigger?: unknown };
  const sessionId = Number(p.session_id);
  const userId = Number(p.user_id);
  const trigger = String(p.trigger ?? '') as StructureTrigger;
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0 || !Number.isSafeInteger(userId) || userId <= 0) return null;
  if (!['call_imported', 'chat_assigned', 'chat_quiet', 'recording_processed'].includes(trigger)) return null;
  return structureSession(env, { sessionId, userId, trigger });
}

/**
 * The quiet-chat sweep: assigned chat sessions with new text since their last
 * run, quiet for QUIET_MINUTES, and not structured (or refused) in the last
 * MIN_HOURS_BETWEEN. A bounded batch per tick. A chat whose provider waits for
 * consent is skipped until its consent is `given` (D754): the gate would
 * refuse the run, and a refusal leaves no receipt, so it would be queued again
 * on every tick.
 */
export async function sweepQuietChats(env: Env, now: Date): Promise<number> {
  const quietBefore = new Date(now.getTime() - QUIET_MINUTES * 60_000).toISOString();
  const lastRunBefore = new Date(now.getTime() - MIN_HOURS_BETWEEN * 3_600_000).toISOString();
  const due = (await env.DB.prepare(
    `SELECT s.id, s.created_by_user_id AS user_id FROM interview_sessions s
      WHERE s.submitted_via IN ('telegram', 'whatsapp') AND s.status = 'transcribed'
        AND (s.submitted_via NOT IN (SELECT value FROM json_each(?)) OR s.consent_status = 'given')
        AND datetime(s.updated_at) < datetime(?)
        AND NOT EXISTS (SELECT 1 FROM interview_structure_receipts r
                         WHERE r.session_id = s.id AND datetime(r.created_at) >= datetime(?))
      ORDER BY s.updated_at LIMIT 20`,
  ).bind(JSON.stringify(consentRequiredProviders()), quietBefore, lastRunBefore).all<{ id: number; user_id: number }>()).results ?? [];
  for (const row of due) await enqueueSessionStructure(env, Number(row.id), Number(row.user_id), 'chat_quiet');
  return due.length;
}
