/** Selected post-call extraction jobs and pending Validate proposals (D4412, #4412). */
import type { Env } from '../types';
import { run, quoteRun, type RunOptions } from './aiRouter';
import { DIGEST_PAGE, DIGEST_OPTIONS } from './interviewProcessing';
import { AI_SURFACE } from './aiSurfaces';
import { writableSession } from './interviewIntake';
import { loadSession, type SessionRow } from './interviewSessions';
import { enqueueJob } from './queue';
import { finalSegments, loadStructureContext, storePlacements, recordStructureReceipt } from '../routes/founder_validate_structure';
import {
  KIND_LINES, STRUCTURE_RULES, STRUCTURE_TAIL, contextLines, firstJsonObject, parsePlacements,
  transcriptData, type PlacementKind, type StructureContext,
} from './interviewStructuring';

export const CALL_OUTPUTS = {
  'problem-discovery': { label: 'Problem discovery', kinds: ['pain_severity'] },
  'customer-research': { label: 'Customer research', kinds: ['interview_summary', 'firmographic', 'job_to_be_done'] },
  'ideal-customer-profile': { label: 'Ideal customer profile', kinds: ['firmographic', 'segment', 'job_to_be_done', 'icp_fit'] },
  'market-intelligence': { label: 'Market intelligence', kinds: ['competitor_mention', 'alternative', 'market_fact'] },
  'demand-signals': { label: 'Demand and urgency signals', kinds: ['demand_signal', 'budget', 'timing', 'urgency', 'buying_trigger', 'objection'] },
  experiments: { label: 'Experiments and evidence', kinds: ['evidence', 'experiment_idea'] },
  verdict: { label: 'Verdict', kinds: ['verdict_contribution'] },
  'pain-points': { label: 'Pain points', kinds: ['pain_severity'] },
  'icp-fit': { label: 'ICP fit', kinds: ['icp_fit'] },
  'feature-requests-quotes': { label: 'Feature requests & quotes', kinds: ['prototype_ask', 'quotable_line'] },
} as const satisfies Record<string, { label: string; kinds: readonly PlacementKind[] }>;
export type CallOutput = keyof typeof CALL_OUTPUTS;
export const DEFAULT_OUTPUTS: CallOutput[] = ['customer-research', 'pain-points', 'icp-fit'];
export const isCallOutput = (s: unknown): s is CallOutput => typeof s === 'string' && Object.hasOwn(CALL_OUTPUTS, s);
/** Reject unknown choices; an explicit empty selection is different from an old session's NULL. */
export function parseOutputs(raw: unknown): CallOutput[] | null {
  return Array.isArray(raw) && raw.every(isCallOutput) ? [...new Set(raw)] : null;
}
export function sessionOutputs(s: { outputs?: string | null }): CallOutput[] | null {
  if (s.outputs == null) return null;
  try { return parseOutputs(JSON.parse(s.outputs)); } catch { return null; }
}

export async function outputPreferences(env: Env, userId: number, projectId: number) {
  const row = await env.DB.prepare('SELECT outputs FROM interview_output_preferences WHERE user_id = ? AND project_id = ?')
    .bind(userId, projectId).first<{ outputs: string }>();
  return sessionOutputs(row ?? {}) ?? DEFAULT_OUTPUTS;
}
export function preferenceStatement(env: Env, userId: number, projectId: number, outputs: CallOutput[]) {
  return env.DB.prepare(`INSERT INTO interview_output_preferences (user_id, project_id, outputs) VALUES (?, ?, ?)
    ON CONFLICT(user_id, project_id) DO UPDATE SET outputs = excluded.outputs`).bind(userId, projectId, JSON.stringify(outputs));
}

/** First selected output owns a kind; overlapping choices never bill it twice. */
export function outputKinds(outputs: CallOutput[], output: CallOutput): PlacementKind[] {
  const seen = new Set<PlacementKind>();
  for (const selected of outputs) {
    const kinds = CALL_OUTPUTS[selected].kinds.filter((kind) => !seen.has(kind));
    if (selected === output) return kinds;
    for (const kind of kinds) seen.add(kind);
  }
  return [];
}
export const OUTPUT_STALE_MINUTES = 15;
const STALE_WINDOW = `-${OUTPUT_STALE_MINUTES} minutes`;

// Input estimate: 180 spoken words/minute, up to eight characters/word plus
// model instructions/context. Actual final text is quoted again before run().
export const MAX_OUTPUT_TOKENS = 2500;
export function extractionOptions(userId: number, output: CallOutput, text: string, ctx: StructureContext, kinds: readonly PlacementKind[] = CALL_OUTPUTS[output].kinds): RunOptions {
  return {
    task: 'structure_interview', userId, surface: AI_SURFACE.validateInterviews,
    rail: { page: DIGEST_PAGE, option: DIGEST_OPTIONS.structure },
    // The structure option and TASK_TEXT_JOBS both select VA5 through textChoice.
    systemPrompt: [...STRUCTURE_RULES, 'Extract only the finding kinds listed below.',
      ...kinds.map((k) => KIND_LINES[k]), ...STRUCTURE_TAIL, contextLines(ctx)].join('\n'),
    messages: [{ role: 'user', content: text }], maxTokens: MAX_OUTPUT_TOKENS, temperature: 0.2,
  };
}
export async function quoteOutputs(env: Env, userId: number, outputs: CallOutput[], minutes: number) {
  let total = 0;
  for (const output of outputs) {
    const kinds = outputKinds(outputs, output);
    if (!kinds.length) continue;
    const quote = await quoteRun(env, extractionOptions(userId, output, 'x'.repeat(Math.ceil(minutes * 180 * 8) + 12000), { hypotheses: [], painGroups: [] }, kinds));
    if (!quote.ok) return { ok: false as const, message: quote.refusal === 'ai_paused' ? 'AI assistance is off.' : 'The extraction estimate is unavailable.' };
    total += quote.hold_microusd;
  }
  return { ok: true as const, microusd: total };
}

/** Called only after a stopped call has a final transcript, never from live segments. */
export async function enqueueOutputs(env: Env, sessionId: number) {
  const s = await loadSession(env, sessionId);
  if (!s || s.consent_status !== 'given' || ['draft', 'recording', 'paused', 'transcribing'].includes(s.status)) return;
  const outputs = sessionOutputs(s);
  if (outputs === null || !(await finalSegments(env, s.id)).length) return;
  for (const output of outputs) {
    await env.DB.prepare(`INSERT INTO interview_output_jobs (session_id, output, run_id, status) VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id, output) DO NOTHING`).bind(s.id, output, `output:${crypto.randomUUID()}`, outputKinds(outputs, output).length ? 'queued' : 'empty').run();
    if (!outputKinds(outputs, output).length) continue;
    // Always send: a prior send may have failed after INSERT. The job's claim
    // makes duplicate delivery harmless, including successful previous jobs.
    await enqueueJob(env, 'interview_output', { session_id: s.id, user_id: s.created_by_user_id, output }, {
      idempotency_key: `interview_output:${s.id}:${output}:${crypto.randomUUID()}`,
    });
  }
}

export async function outputStates(env: Env, session: SessionRow) {
  const outputs = sessionOutputs(session);
  if (outputs === null) return null;
  const rows = (await env.DB.prepare(`SELECT output, status, failure_reason,
      CASE WHEN status IN ('queued','running') AND datetime(updated_at) <= datetime('now', ?) THEN 1 ELSE 0 END AS stale
      FROM interview_output_jobs WHERE session_id = ?`)
    .bind(STALE_WINDOW, session.id).all<{ output: string; status: string; failure_reason: string | null; stale: number }>()).results ?? [];
  return outputs.map((output) => {
    const row = rows.find((r) => r.output === output);
    return { output, label: CALL_OUTPUTS[output].label, status: row?.status ?? 'waiting',
      retryable: row?.status === 'failed' || !!row?.stale, reason: row?.failure_reason ?? null };
  });
}

/** A press may recover a failed job or one whose queue/claim deadline expired. */
export async function retryOutput(env: Env, sessionId: number, output: CallOutput) {
  await env.DB.prepare(`UPDATE interview_output_jobs SET status = 'queued', failure_reason = NULL, updated_at = datetime('now')
    WHERE session_id = ? AND output = ? AND (status = 'failed' OR
      (status IN ('queued','running') AND datetime(updated_at) <= datetime('now', ?)))`)
    .bind(sessionId, output, STALE_WINDOW).run();
  await enqueueOutputs(env, sessionId);
}

async function endOutput(env: Env, id: number, output: CallOutput, status: 'failed' | 'cancelled', reason: string) {
  await env.DB.prepare(`UPDATE interview_output_jobs SET status = ?, failure_reason = ?, updated_at = datetime('now')
    WHERE session_id = ? AND output = ? AND status IN ('queued','running')`).bind(status, reason, id, output).run();
}

/** One independently retriable job per ticked output. Completed jobs never run twice. */
export async function runOutputJob(env: Env, payload: unknown) {
  const p = payload as { session_id?: unknown; user_id?: unknown; output?: unknown } | null;
  const id = Number(p?.session_id), userId = Number(p?.user_id), output = p?.output;
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(userId) || userId <= 0 || !isCallOutput(output)) return;
  // A malformed/mismatched message cannot cancel another member's real job.
  const source = await loadSession(env, id);
  if (!source || source.created_by_user_id !== userId) return;
  if (source.consent_status !== 'given') {
    await endOutput(env, id, output, source.consent_status === 'declined' ? 'cancelled' : 'failed',
      source.consent_status === 'declined' ? 'consent_withdrawn' : 'consent_not_given'); return;
  }
  let session;
  try { ({ session } = await writableSession(env, userId, id)); }
  catch { await endOutput(env, id, output, 'failed', 'write_access_lost'); return; }
  const outputs = sessionOutputs(session);
  if (!outputs?.includes(output)) { await endOutput(env,id,output,'failed','output_unselected'); return; }
  if (!['transcribed', 'structured', 'reviewed'].includes(session.status)) { await endOutput(env,id,output,'failed','session_not_ready'); return; }
  const segments = await finalSegments(env, id);
  const snapshot = (await env.DB.prepare("SELECT id, text FROM interview_transcript_segments WHERE session_id = ? AND source = 'final' ORDER BY id").bind(id).all<{ id: number; text: string }>()).results ?? [];
  if (!segments.length) { await endOutput(env,id,output,'failed','no_transcript'); return; }
  const kinds = outputKinds(outputs, output);
  if (!kinds.length) {
    await env.DB.prepare("UPDATE interview_output_jobs SET status = 'empty', failure_reason = NULL, updated_at = datetime('now') WHERE session_id = ? AND output = ? AND status = 'queued'").bind(id,output).run(); return;
  }
  const claim = await env.DB.prepare(`UPDATE interview_output_jobs SET status = 'running', failure_reason = NULL, updated_at = datetime('now')
    WHERE session_id = ? AND output = ? AND (status = 'queued' OR (status = 'running' AND datetime(updated_at) <= datetime('now', ?)))`)
    .bind(id, output, STALE_WINDOW).run();
  if (Number(claim.meta?.changes) !== 1) return;
  const job = await env.DB.prepare('SELECT run_id FROM interview_output_jobs WHERE session_id = ? AND output = ?')
    .bind(id, output).first<{ run_id: string }>();
  try {
    // One job and one bounded model call per selected output; a longer source
    // fails visibly rather than silently truncating it or multiplying spend.
    if (new TextEncoder().encode(transcriptData(segments)).length > 100 * 1024) throw new Error('input_too_long');
    const options = extractionOptions(userId, output, transcriptData(segments), await loadStructureContext(env, session.project_id), kinds);
    options.rail = { page: DIGEST_PAGE, option: DIGEST_OPTIONS.structure, record: `session:${id}` };
    const quote = await quoteRun(env, options);
    if (!quote.ok) throw new Error('quote_unavailable');
    await env.DB.prepare('UPDATE interview_output_jobs SET quote_microusd = ? WHERE session_id = ? AND output = ?')
      .bind(quote.hold_microusd, id, output).run();
    const result = await run(env, { ...options, surface: AI_SURFACE.validateInterviews, rail: options.rail, pinMicrousd: quote.hold_microusd });
    await recordStructureReceipt(env, id, job!.run_id, { step: 'structured', model: result.usage.model,
      requested_model: quote.model, fallback_used: !!result.usage.fallback_used, prompt_tokens: result.usage.prompt_tokens,
      completion_tokens: result.usage.completion_tokens, est_cost_usd: result.usage.est_cost_usd }, result.ok ? 'ok' : 'refused', result.refusal ?? null);
    if (!result.ok) throw new Error('extraction_failed');
    // Malformed output is a failure, not a successful empty extraction.
    const parsed = firstJsonObject(result.output || '');
    if (!Array.isArray(parsed?.placements)) throw new Error('invalid_output');
    const { placements, dropped } = parsePlacements(result.output || '', segments, await loadStructureContext(env, session.project_id), kinds);
    if (!placements.length && dropped) throw new Error('invalid_citations');
    const fresh = await writableSession(env, userId, id);
    if (fresh.session.consent_status !== 'given') throw new Error('consent_changed');
    const consent = await env.DB.prepare('SELECT quote_consent FROM discovery_interviews WHERE id = ? AND project_id = ?')
      .bind(session.interview_id, session.project_id).first<{ quote_consent: number | null }>();
    const safe = placements.filter((x) => x.kind !== 'quotable_line' || (consent?.quote_consent === 1 && x.payload.text === x.quote));
    // Re-read the final transcript; a changed source invalidates this result.
    if (JSON.stringify(await finalSegments(env, id)) !== JSON.stringify(segments)) throw new Error('source_changed');
    const { stored } = await storePlacements(env, { projectId: session.project_id, sessionId: id, interviewId: session.interview_id,
      userId, model: result.usage.model, runId: job!.run_id, placements: safe, dedupe: true, requireGivenConsent: true,
      sourceSnapshot: snapshot });
    await env.DB.prepare(`UPDATE interview_output_jobs SET status = ?, model = ?, updated_at = datetime('now') WHERE session_id = ? AND output = ?`)
      .bind(stored ? 'done' : 'empty', result.usage.model, id, output).run();
  } catch {
    // Store only controlled reasons, never source/provider text.
    const current = await loadSession(env, id);
    await endOutput(env,id,output,current?.consent_status === 'declined' ? 'cancelled' : 'failed',
      current?.consent_status === 'declined' ? 'consent_withdrawn' : 'extraction_failed');
  }
}
