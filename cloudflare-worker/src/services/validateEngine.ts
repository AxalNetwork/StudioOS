/**
 * D757 (#1898) — the Validate engine: one entry for every conversation.
 *
 * Every source ends here: the in-app recorder (in person, video, phone), a
 * Zoom or Google Meet import, an assigned or quiet WhatsApp or Telegram chat,
 * the pasted text chat and typed notes, and an AI assistant's submission.
 * `digestSession` is the only code that runs the summary (D685 §5.10,
 * `summariseSession`) and the structure pass (D658, `structureSession`) for a
 * session. Sources only connect and fetch.
 *
 * THE INGESTION CONTRACT every source meets:
 *   1. final segments are stored on a session of an interview scoped to the
 *      member (`replaceWithFinal`, `interviewIntake.appendSegments` or
 *      `importTranscript`);
 *   2. then `enqueueDigest` is called, or the recorder's job reaches its
 *      `summarising` stage. No source calls a model itself.
 *
 * WHAT IT HOLDS:
 *   - One transcript, one automatic digest. The final transcript is hashed;
 *     an automatic run over the transcript the last completed automatic run
 *     read is `unchanged` and calls no model. A founder's button (`force`)
 *     always runs, as Compare needs it to (D658).
 *   - Consent (#1470): an audio session needs consent `given`
 *     (`consentBlocks`). A withdrawal (`withdrawDigest`) clears the summary
 *     and the pending suggestions, and keeps what the founder decided.
 *   - The member's own choices (D698): an explicit Manual mode for Validate
 *     skips automatic runs, and the per-task model picks apply to them. A pick
 *     the task no longer offers is dropped, and the default runs.
 *   - Metered: every model call goes through `aiRouter.run` with the member's
 *     id, inside the two steps. This file never imports `run` and never
 *     reaches the Workers AI binding.
 *   - Every outcome is a sentence the Worker wrote (`digest_note`), never
 *     provider, SQLite or transcript text.
 *
 * THE ENGINE WRITES ONLY two kinds of thing: the session's own summary and
 * digest columns (migration 487), and pending `validate_proposals` rows.
 * Nothing reaches a module without the founder's Accept.
 *
 * Logs carry session ids, triggers and outcome codes only.
 */
import type { Env } from '../types';
import { budgetRefusalMessage } from './aiRouter';
import { loadSession, sessionDigestConsentBlocks } from './interviewSessions';
import { presentTables } from './interviewFindings';
import { IntakeError, writableSession } from './interviewIntake';
import { summariseSession, type SummaryResult } from './interviewProcessing';
import { enqueueJob } from './queue';
import { MIN_HOURS_BETWEEN, structureSession, type StructureOutcome, type StructureTrigger } from './sessionAutoStructure';
import type { Segment } from './interviewStructuring';
import { finalSegments, refusedBody } from '../routes/founder_validate_structure';

export type DigestStage = 'summarise' | 'structure';

export type DigestOutcome =
  | { ok: true; status: 'done'; summary: SummaryResult | null; structure: StructureOutcome | null; note: string | null }
  | { ok: true; status: 'unchanged' }
  | { ok: false; status: 'skipped'; reason: 'manual_mode' | 'no_final_transcript' | 'quiet_window'; note: string }
  | {
    ok: false; status: 'refused'; reason: 'consent_not_recorded' | 'transcript_too_large' | 'refused' | 'busy';
    refusal: string | null; note: string;
  }
  | { ok: false; status: 'not_writable' };

/** The rail section the Validate workspace writes (`useAssistMode('Validate')`, lower-cased by `railSection`). */
export const VALIDATE_SECTION = 'validate';
/** A `running` claim older than this is taken over (`STALE_MINUTES`, interviewProcessing.ts). */
export const CLAIM_STALE_MINUTES = 15;
const TASKS = { summarise: 'summarise_interview', structure: 'structure_interview' } as const;
const BUDGET = new Set(['budget_user_day', 'budget_user_month', 'budget_review']);
const TOO_LARGE = new Set(['transcript_too_large', 'structure_call_limit']);

export const NOTES = {
  manual: 'Manual mode is on for Validate, so Axal did not summarise or structure this. Use Summarise and Structure on the session.',
  noTranscript: 'There is no transcript to summarise yet.',
  chatQuiet: 'This conversation has new text. Axal will digest it after the six-hour quiet window.',
  busy: 'This conversation is already being summarised. It will be ready in a minute.',
  noCitation: 'The summary could not be tied to the transcript, so none is stored.',
  modelDropped: 'Your saved model for this is no longer offered, so the default ran.',
  tooLarge: 'This conversation is longer than Axal can summarise in one run yet, so nothing was run and nothing was charged.',
  tooLargeToStructure: 'The summary is ready. This conversation is longer than Axal can propose findings from in one run yet, so none were proposed and nothing more was charged.',
  budgetTail: ' The transcript is kept; summarise it when the allowance allows.',
  withdrawn: 'The interviewee withdrew consent, so the summary and its suggestions were removed. Decisions you already made are kept, without the quote.',
  passB: 'Axal suggested what it heard about the problem, the person and the market, but not yet about demand and evidence:',
} as const;

/** The sentence a refusal code reads as. Never the code itself. */
export function refusalNote(refusal: string | null): string {
  if (refusal && BUDGET.has(refusal)) return `${budgetRefusalMessage(refusal)}${NOTES.budgetTail}`;
  if (refusal && TOO_LARGE.has(refusal)) return NOTES.tooLarge;
  return refusedBody(refusal).message;
}

/** sha256 over each segment's `start|end|speaker|text`, joined by newlines, in the order given. Hex. */
export async function transcriptHash(segments: readonly Segment[]): Promise<string> {
  const text = segments.map((s) => `${s.start ?? ''}|${s.end ?? ''}|${s.speaker ?? ''}|${s.text}`).join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The member's Validate mode and the model each task runs with. `explicit` is
 * a button's pick and wins; otherwise the stored pick, while the task still
 * offers it. Buttons never read the stored pick: the browser sends its own.
 */
async function preferences(env: Env, userId: number, explicit: string | undefined, automatic: boolean) {
  const rows = (await env.DB.prepare(
    'SELECT task, model, mode FROM ai_rail_preferences WHERE user_id = ? AND section = ?',
  ).bind(userId, VALIDATE_SECTION).all<{ task: string; model: string | null; mode: string | null }>()).results ?? [];
  const manual = rows.some((r) => r.task === '' && r.mode === 'manual');
  const models: Record<DigestStage, string | undefined> = { summarise: explicit, structure: explicit };
  let dropped = false;
  if (explicit === undefined && automatic) {
    // Dynamic: routes/ai.ts pulls in admin routes this file has no other use for.
    const { pickableTask } = await import('../routes/ai');
    for (const stage of ['summarise', 'structure'] as DigestStage[]) {
      const pick = rows.find((r) => r.task === TASKS[stage])?.model;
      if (!pick) continue;
      if ((pickableTask(TASKS[stage]) ?? []).includes(pick)) models[stage] = pick;
      else dropped = true;
    }
  }
  return { manual, models, dropped };
}

async function writeOutcome(env: Env, sessionId: number, fields: {
  status: 'queued' | 'done' | 'refused' | 'skipped'; note: string | null; trigger: string; hash?: string; runId?: string;
}) {
  await env.DB.prepare(
    `UPDATE interview_sessions
        SET digest_status = ?, digest_note = ?, digest_trigger = ?,
            digest_hash = COALESCE(?, digest_hash), digest_run_id = COALESCE(?, digest_run_id),
            digest_json = CASE WHEN ? IS NOT NULL AND json_valid(digest_json) THEN json_set(digest_json, '$.run_id', ?) ELSE digest_json END,
            digested_at = datetime('now')
      WHERE id = ? AND consent_status <> 'declined'`,
  ).bind(fields.status, fields.note, fields.trigger, fields.hash ?? null, fields.runId ?? null,
    fields.runId ?? null, fields.runId ?? null, sessionId).run();
}

/**
 * The one entry. Re-scopes the member, checks consent, reads the member's
 * mode and models, hashes the final transcript, claims the session, runs the
 * stages asked for (both by default), and writes the outcome as a sentence.
 */
export async function digestSession(env: Env, opts: {
  sessionId: number; userId: number; trigger: StructureTrigger;
  stages?: DigestStage[]; force?: boolean; model?: string;
}): Promise<DigestOutcome> {
  const stages = opts.stages?.length ? opts.stages : (['summarise', 'structure'] as DigestStage[]);
  const force = opts.force === true;
  let session;
  try {
    ({ session } = await writableSession(env, opts.userId, opts.sessionId));
  } catch (err) {
    if (err instanceof IntakeError) return { ok: false, status: 'not_writable' };
    throw err;
  }

  const blocked = await sessionDigestConsentBlocks(env, session);
  if (blocked) {
    // A withdrawal's own sentence stays: it says more than the consent rule does.
    if (!(session.consent_status === 'declined' && session.digest_status === 'skipped')) {
      await writeOutcome(env, session.id, { status: 'refused', note: blocked.message, trigger: opts.trigger });
    }
    return { ok: false, status: 'refused', reason: 'consent_not_recorded', refusal: null, note: blocked.message };
  }

  const prefs = await preferences(env, opts.userId, opts.model, !force);
  // The recorder's own `processing_auto` already decided for its session (interviewProcessing.ts).
  if (!force && opts.trigger !== 'recording_processed' && prefs.manual) {
    await writeOutcome(env, session.id, { status: 'skipped', note: NOTES.manual, trigger: opts.trigger });
    return { ok: false, status: 'skipped', reason: 'manual_mode', note: NOTES.manual };
  }

  const segments = await finalSegments(env, session.id);
  if (!segments.length) {
    await writeOutcome(env, session.id, { status: 'skipped', note: NOTES.noTranscript, trigger: opts.trigger });
    return { ok: false, status: 'skipped', reason: 'no_final_transcript', note: NOTES.noTranscript };
  }

  // The hash is written only by a completed automatic run, so it alone says
  // "this transcript was digested". The status is not compared: `enqueueDigest`
  // marks the row `queued` before the job reads it.
  const hash = await transcriptHash(segments);
  if (!force && session.digest_hash === hash) {
    await env.DB.batch([
      env.DB.prepare("UPDATE interview_sessions SET digest_status = 'done' WHERE id = ? AND digest_status = 'queued'").bind(session.id),
      // A re-import sets `transcribed`; the quiet sweep must not pick it again.
      ...(session.digest_run_id ? [env.DB.prepare(
        "UPDATE interview_sessions SET status = 'structured', updated_at = datetime('now') WHERE id = ? AND status = 'transcribed'",
      ).bind(session.id)] : []),
    ]);
    console.log('[validateEngine] unchanged', session.id, opts.trigger);
    return { ok: true, status: 'unchanged' };
  }

  // A job queued before an earlier run started may arrive after more text.
  // Re-check the bound at execution too; the unchanged hash above remains free.
  if (!force && opts.trigger === 'chat_text_added') {
    const recent = await env.DB.prepare(
      `SELECT 1 AS hit FROM interview_sessions WHERE id = ? AND datetime(digested_at) > datetime('now', ?)`,
    ).bind(session.id, `-${MIN_HOURS_BETWEEN} hours`).first();
    if (recent) {
      await env.DB.prepare(
        "UPDATE interview_sessions SET digest_status = 'queued', digest_note = ? WHERE id = ? AND digest_status IS NOT 'running' AND consent_status <> 'declined'",
      ).bind(NOTES.chatQuiet, session.id).run();
      return { ok: false, status: 'skipped', reason: 'quiet_window', note: NOTES.chatQuiet };
    }
  }

  // The chat quiet bound belongs in this atomic claim too: another job may
  // finish after the SELECT above and before this UPDATE.
  // Two triggers (an import and a button) never bill the same transcript twice
  // at once. An automatic run also claims only while the stored hash differs
  // from its own: a run that finished between the check above and this claim
  // has already digested this transcript.
  const claim = await env.DB.prepare(
    `UPDATE interview_sessions SET digest_status = 'running', digest_trigger = ?, digested_at = datetime('now')
      WHERE id = ? AND consent_status <> 'declined' AND (digest_status IS NOT 'running' OR datetime(digested_at) < datetime('now', ?))
        AND (? = 1 OR digest_hash IS NOT ?)
        AND (? = 1 OR ? <> 'chat_text_added' OR digested_at IS NULL OR datetime(digested_at) <= datetime('now', ?))`,
  ).bind(opts.trigger, session.id, `-${CLAIM_STALE_MINUTES} minutes`, force ? 1 : 0, hash,
    force ? 1 : 0, opts.trigger, `-${MIN_HOURS_BETWEEN} hours`).run();
  if (Number(claim.meta?.changes || 0) !== 1) {
    const now = await loadSession(env, session.id);
    if (!force && now?.digest_hash === hash) return { ok: true, status: 'unchanged' };
    if (!force && opts.trigger === 'chat_text_added' && now?.digest_status !== 'running' && await env.DB.prepare(
      `SELECT 1 AS hit FROM interview_sessions WHERE id = ? AND datetime(digested_at) > datetime('now', ?)`,
    ).bind(session.id, `-${MIN_HOURS_BETWEEN} hours`).first()) {
      return { ok: false, status: 'skipped', reason: 'quiet_window', note: NOTES.chatQuiet };
    }
    return { ok: false, status: 'refused', reason: 'busy', refusal: null, note: NOTES.busy };
  }

  let summary: SummaryResult | null = null;
  let structure: StructureOutcome | null = null;
  let refusal: string | null | undefined;
  const notes: string[] = [];
  try {
    if (stages.includes('summarise')) {
      // A refusal or `no_citation` is recorded; the structure stage still runs, as the recorder always has.
      summary = await summariseSession(env, (await loadSession(env, session.id))!, opts.userId, prefs.models.summarise);
      if (!summary.ok && summary.reason === 'refused') refusal = summary.refusal;
      if (!summary.ok && summary.reason === 'no_citation') notes.push(NOTES.noCitation);
    }
    if (stages.includes('structure')) {
      structure = await structureSession(env, {
        sessionId: session.id, userId: opts.userId, trigger: opts.trigger, model: prefs.models.structure, dedupe: !force,
      });
      if (!structure.ok && refusal === undefined) refusal = structure.reason === 'refused' ? structure.refusal ?? null : null;
      // D757 (#1923): pass B refused keeps pass A's suggestions; the note says what is missing and why.
      if (structure.ok && structure.passBRefusal !== undefined) notes.push(`${NOTES.passB} ${refusalNote(structure.passBRefusal)}`);
    }
  } catch (err) {
    // Release the claim so a retry is not told it is busy; the error is the caller's.
    await writeOutcome(env, session.id, { status: 'refused', note: refusalNote(null), trigger: opts.trigger });
    throw err;
  }
  // Consent may change while a provider/model call is in flight. Its late
  // result cannot restore the withdrawn digest, suggestions or engine state.
  if ((await loadSession(env, session.id))?.consent_status === 'declined') {
    await withdrawDigest(env, session.id, opts.userId, { onlyDeclined: true });
    return { ok: false, status: 'refused', reason: 'consent_not_recorded', refusal: null, note: NOTES.withdrawn };
  }
  if (prefs.dropped) notes.push(NOTES.modelDropped);
  const runId = structure?.ok ? structure.runId : undefined;

  if (refusal !== undefined) {
    // The digest (#1924) summarises in parts; a transcript too long only for the structure pass has its summary.
    const note = summary?.ok && refusal && TOO_LARGE.has(refusal) ? NOTES.tooLargeToStructure : refusalNote(refusal);
    await writeOutcome(env, session.id, { status: 'refused', note, trigger: opts.trigger, runId });
    console.log('[validateEngine] refused', session.id, opts.trigger, refusal ?? 'unavailable');
    return {
      ok: false, status: 'refused', reason: refusal && TOO_LARGE.has(refusal) ? 'transcript_too_large' : 'refused', refusal, note,
    };
  }
  // The recorder calls each stage on its own; its summarise call leaves the placing stage due.
  const laterStageDue = opts.trigger === 'recording_processed' && !stages.includes('structure');
  const note = notes.length ? notes.join(' ') : null;
  await writeOutcome(env, session.id, {
    status: laterStageDue ? 'queued' : 'done', note, trigger: opts.trigger, runId,
    // Only a completed automatic run records what it read.
    ...(!force && !laterStageDue ? { hash } : {}),
  });
  console.log('[validateEngine] done', session.id, opts.trigger, stages.join('+'));
  return { ok: true, status: 'done', summary, structure, note };
}

/** Queue a digest (`session_structure`). One per session and trigger moment. */
export async function enqueueDigest(env: Env, sessionId: number, userId: number, trigger: StructureTrigger) {
  // D757 (#1930): frequent chat messages must not bypass the quiet sweep's
  // six-hour bound. Do not slide digested_at or overwrite a withdrawal's state.
  if (trigger === 'chat_text_added') {
    const session = await env.DB.prepare(
      `SELECT consent_status, datetime(digested_at) > datetime('now', ?) AS recent
         FROM interview_sessions WHERE id = ? AND created_by_user_id = ?`,
    ).bind(`-${MIN_HOURS_BETWEEN} hours`, sessionId, userId).first<{ consent_status: string; recent: number | null }>();
    if (!session || session.consent_status === 'declined' || session.recent) return null;
  }
  await env.DB.prepare(
    "UPDATE interview_sessions SET digest_status = 'queued', digest_trigger = ? WHERE id = ? AND digest_status IS NOT 'running' AND consent_status <> 'declined'",
  ).bind(trigger, sessionId).run();
  return enqueueJob(env, 'session_structure', { session_id: sessionId, user_id: userId, trigger }, {
    idempotency_key: `session_structure:${sessionId}:${trigger}:${Math.floor(Date.now() / 60_000)}`,
  });
}

/**
 * The interviewee withdrew consent: the summary and the digest go, with the
 * session's pending suggestions; a decided suggestion stays as the founder's
 * record, without its quote (as `deleteSession` does). Rows the founder already
 * accepted into a module are the founder's own. The transcript stays until the
 * founder deletes the session. One batch, and one log row of counts only.
 */
export async function withdrawDigest(env: Env, sessionId: number, actorUserId: number, opts: {
  /** D757 #1930: consent and its cleanup commit in one D1 batch. */
  before?: D1PreparedStatement[]; otherSessionIds?: number[]; onlyDeclined?: boolean;
} = {}): Promise<{ pending_deleted: number; decided_unquoted: number; claim_changed?: number }> {
  const out = { pending_deleted: 0, decided_unquoted: 0 };
  const statements: D1PreparedStatement[] = [...(opts.before ?? [])];
  const hasFindings = (await presentTables(env, ['interview_findings'])).has('interview_findings');
  const onlyDeclined = opts.onlyDeclined ? 1 : 0;
  for (const id of new Set([sessionId, ...(opts.otherSessionIds ?? [])])) {
    const session = await loadSession(env, id);
    if (!session) continue;
    const counts = await env.DB.prepare(
      `SELECT SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN status <> 'pending' THEN 1 ELSE 0 END) AS decided
         FROM validate_proposals WHERE session_id = ?`,
    ).bind(id).first<{ pending: number | null; decided: number | null }>();
    const removed = { pending_deleted: Number(counts?.pending || 0), decided_unquoted: Number(counts?.decided || 0) };
    out.pending_deleted += removed.pending_deleted; out.decided_unquoted += removed.decided_unquoted;
    statements.push(env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id, project_id)
       SELECT ?, ?, ?, ?, ? FROM interview_sessions s
        WHERE s.id = ? AND (? = 0 OR s.consent_status = 'declined') AND (s.digest_status IS NOT 'skipped' OR s.digest_note IS NOT ?)`,
    ).bind('interview_consent_withdrawn', JSON.stringify({ session_uid: session.uid, ...removed }),
      `user:${actorUserId}`, actorUserId, session.project_id, id, onlyDeclined, NOTES.withdrawn));
    // A consent claim that lost its race cannot wipe an unrevoked session.
    // This condition is evaluated inside the batch, after the consent update.
    if (hasFindings) statements.push(env.DB.prepare(
      `UPDATE interview_findings SET quote = NULL, cite_from = NULL, cite_to = NULL WHERE session_id = ?
         AND (? = 0 OR EXISTS (SELECT 1 FROM interview_sessions s WHERE s.id = ? AND s.consent_status = 'declined'))`,
    ).bind(id, onlyDeclined, id));
    statements.push(
      env.DB.prepare(
        `UPDATE interview_sessions
            SET summary = NULL, summary_model = NULL, summarised_at = NULL, summary_citations_json = NULL,
                digest_json = NULL, digest_hash = NULL, digest_status = 'skipped', digest_note = ?,
                digested_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ? AND (? = 0 OR consent_status = 'declined')
            AND (digest_status IS NOT 'skipped' OR digest_note IS NOT ? OR summary IS NOT NULL OR digest_json IS NOT NULL OR digest_hash IS NOT NULL)`,
      ).bind(NOTES.withdrawn, id, onlyDeclined, NOTES.withdrawn),
      env.DB.prepare(
        `DELETE FROM validate_proposals WHERE session_id = ? AND status = 'pending'
           AND (? = 0 OR EXISTS (SELECT 1 FROM interview_sessions s WHERE s.id = ? AND s.consent_status = 'declined'))`,
      ).bind(id, onlyDeclined, id),
      env.DB.prepare(
        `UPDATE validate_proposals SET citation_json = NULL WHERE session_id = ?
           AND (? = 0 OR EXISTS (SELECT 1 FROM interview_sessions s WHERE s.id = ? AND s.consent_status = 'declined'))`,
      ).bind(id, onlyDeclined, id),
    );
  }
  if (!statements.length) return out;
  const result = await env.DB.batch(statements);
  return { ...out, ...(opts.before?.length ? { claim_changed: Number(result[0]?.meta?.changes ?? 0) } : {}) };
}
