/**
 * D684 — from a transcript to Validate, without a button. Since D757 (#1898)
 * every run goes through the Validate engine (`validateEngine.ts`), which runs
 * the summary as well as this file's structure pass.
 *
 * The goal is the owner's: a call or a customer chat is transcribed, the
 * Worker AI finds the pain points, and the other Validate modules fill in. The
 * finding step already exists — D658's Structure, which proposes seven kinds of
 * placement (pain severity → Problem discovery, ICP fit, segments, demand
 * signals, evidence, competitor mentions, market facts) — but until now only a
 * press of "Structure the transcript" ran it. This file runs the same pass on
 * its own when a transcript arrives (`StructureTrigger`):
 *
 *   call_imported        a Zoom or Meet transcript was imported (meetings.ts)
 *   chat_assigned        legacy queued assignments
 *   chat_text_added      final chat text arrived or moved at assignment (#1930)
 *   chat_quiet           an assigned chat gained messages and then went quiet
 *                        for QUIET_MINUTES (the five-minute channel sweep)
 *   recording_processed  the recorder's job reached summarising and placing
 *   consent_given        consent was recorded after an imported call (D757)
 *   chat_pasted          a pasted text chat or typed notes (openOn, D757)
 *   assistant_submitted  an AI assistant's submission: the summary only (D757)
 *   voice_note_added     reserved for D754's and D756's voice notes
 *   manual               a founder's button, run inline, never queued
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
 * structure receipts, summary receipts and the engine's own last attempt
 * (`digested_at`, refused runs included), and only when it has new text since
 * its last run (its status is back to `transcribed`). Automatic runs never
 * propose a finding already proposed on the interview (D757 dedupe).
 *
 * `structureSession` is the structure stage the engine calls; the Structure
 * button, the assistant's `structure_with_studioos` and the recorder's job all
 * reach it through `digestSession`.
 */
import type { Env } from '../types';
import { sessionDigestConsentBlocks } from './interviewSessions';
import { IntakeError, writableSession } from './interviewIntake';
import { structureTranscript, toSegments, type ReceiptLine, type SegmentRow } from './interviewStructuring';
import { MESSAGING_PROVIDERS, consentRequiredProviders } from './channels/types';
import { loadStructureContext, recordStructureReceipt, storePlacements } from '../routes/founder_validate_structure';

export type StructureTrigger =
  | 'call_imported' | 'chat_assigned' | 'chat_text_added' | 'chat_quiet' | 'recording_processed'
  | 'consent_given' | 'chat_pasted' | 'assistant_submitted' | 'voice_note_added' | 'manual';

/** What a queued `session_structure` job may carry: every trigger but `manual`, which only a route passes inline. */
export const JOB_TRIGGERS: readonly StructureTrigger[] = [
  'call_imported', 'chat_assigned', 'chat_text_added', 'chat_quiet', 'recording_processed',
  'consent_given', 'chat_pasted', 'assistant_submitted', 'voice_note_added',
];

/** An assigned chat is structured again once it has been quiet this long. */
export const QUIET_MINUTES = 30;
/** And never more often than this, refused runs included. */
export const MIN_HOURS_BETWEEN = 6;

export type StructureOutcome =
  | { ok: true; runId: string; step: 'structured' | 're_structured'; stored: number; dropped: number; parts: number; receipt: ReceiptLine[];
      /** Pass B was refused (D757): pass A's suggestions are stored, and this is why demand and evidence are missing. */
      passBRefusal?: string | null }
  | { ok: false; reason: 'consent_not_recorded' | 'no_final_transcript' | 'not_writable' | 'refused'; refusal?: string | null };

function newRunId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * One structuring run over a session's final transcript, as the member. The
 * member and the venture are re-checked first (`writableSession`), so a member
 * who lost the venture, or whose account closed, runs nothing. `model` is the
 * pick to run (the task's default when absent); `dedupe` drops a placement
 * already proposed on the interview (automatic runs, D757).
 */
export async function structureSession(
  env: Env, opts: { sessionId: number; userId: number; trigger: StructureTrigger; model?: string; dedupe?: boolean },
): Promise<StructureOutcome> {
  let session;
  try {
    ({ session } = await writableSession(env, opts.userId, opts.sessionId));
  } catch (err) {
    if (err instanceof IntakeError) return { ok: false, reason: 'not_writable' };
    throw err;
  }
  if (await sessionDigestConsentBlocks(env, session)) return { ok: false, reason: 'consent_not_recorded' };

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
    userId: opts.userId, model: opts.model, segments, context: await loadStructureContext(env, session.project_id), step,
  });
  // The last receipt line is the refused call: the run's, or pass B's (D757: pass A's placements stand).
  const lastRefusal = !out.ok ? out.refusal ?? null : out.passBRefusal !== undefined ? out.passBRefusal ?? null : undefined;
  for (let i = 0; i < out.receipt.length; i += 1) {
    const refusedHere = lastRefusal !== undefined && i === out.receipt.length - 1;
    await recordStructureReceipt(env, session.id, runId, out.receipt[i], refusedHere ? 'refused' : 'ok',
      refusedHere ? lastRefusal : null);
  }
  if (!out.ok) return { ok: false, reason: 'refused', refusal: out.refusal ?? null };

  const { stored } = await storePlacements(env, {
    projectId: session.project_id, sessionId: session.id, interviewId: session.interview_id, runId,
    userId: opts.userId, model: out.receipt[out.receipt.length - 1]?.model || '', placements: out.placements,
    dedupe: opts.dedupe === true,
  });
  await env.DB.prepare(
    "UPDATE interview_sessions SET status = 'structured', updated_at = datetime('now') WHERE id = ? AND status = 'transcribed'",
  ).bind(session.id).run();
  return {
    ok: true, runId, step, stored, dropped: out.dropped, parts: out.parts, receipt: out.receipt,
    ...(out.passBRefusal !== undefined ? { passBRefusal: out.passBRefusal ?? null } : {}),
  };
}

/**
 * Queue a digest (`session_structure`), through the engine. One per session
 * and trigger moment. Dynamic: `validateEngine.ts` imports this file.
 */
export async function enqueueSessionStructure(env: Env, sessionId: number, userId: number, trigger: StructureTrigger) {
  const { enqueueDigest } = await import('./validateEngine');
  return enqueueDigest(env, sessionId, userId, trigger);
}

/**
 * The `session_structure` job: the engine's digest. A refusal or a missing
 * transcript is an outcome, not a failure to retry. An assistant's submission
 * gets StudioOS's summary only: the assistant proposes its own placements.
 */
export async function runSessionStructureJob(env: Env, payload: unknown) {
  const p = (payload ?? {}) as { session_id?: unknown; user_id?: unknown; trigger?: unknown };
  const sessionId = Number(p.session_id);
  const userId = Number(p.user_id);
  const trigger = String(p.trigger ?? '') as StructureTrigger;
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0 || !Number.isSafeInteger(userId) || userId <= 0) return null;
  if (!JOB_TRIGGERS.includes(trigger)) return null;
  const { digestSession } = await import('./validateEngine');
  return digestSession(env, {
    sessionId, userId, trigger, stages: trigger === 'assistant_submitted' ? ['summarise'] : ['summarise', 'structure'],
  });
}

/**
 * The quiet-chat sweep: assigned chat sessions with new text since their last
 * run, quiet for QUIET_MINUTES, and not structured, summarised or attempted
 * (refused runs included, `digested_at`) in the last MIN_HOURS_BETWEEN. A
 * bounded batch per tick. A chat whose provider waits for consent is skipped
 * until its consent is `given` (D754): the gate would refuse the run.
 */
export async function sweepQuietChats(env: Env, now: Date): Promise<number> {
  const quietBefore = new Date(now.getTime() - QUIET_MINUTES * 60_000).toISOString();
  const lastRunBefore = new Date(now.getTime() - MIN_HOURS_BETWEEN * 3_600_000).toISOString();
  const due = (await env.DB.prepare(
    `SELECT s.id, s.created_by_user_id AS user_id FROM interview_sessions s
      WHERE s.submitted_via IN (SELECT value FROM json_each(?)) AND s.status = 'transcribed' AND s.consent_status <> 'declined'
        AND (s.submitted_via NOT IN (SELECT value FROM json_each(?)) OR s.consent_status = 'given')
        AND datetime(s.updated_at) < datetime(?)
        AND NOT EXISTS (SELECT 1 FROM interview_structure_receipts r
                         WHERE r.session_id = s.id AND datetime(r.created_at) >= datetime(?))
        AND NOT EXISTS (SELECT 1 FROM interview_summary_receipts r2
                         WHERE r2.session_id = s.id AND datetime(r2.created_at) >= datetime(?))
        AND (s.digested_at IS NULL OR datetime(s.digested_at) < datetime(?))
      ORDER BY s.updated_at LIMIT 20`,
  ).bind(JSON.stringify(MESSAGING_PROVIDERS), JSON.stringify(consentRequiredProviders()), quietBefore, lastRunBefore, lastRunBefore, lastRunBefore)
    .all<{ id: number; user_id: number }>()).results ?? [];
  for (const row of due) await enqueueSessionStructure(env, Number(row.id), Number(row.user_id), 'chat_quiet');
  return due.length;
}
