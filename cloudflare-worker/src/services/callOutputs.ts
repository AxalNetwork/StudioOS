/** Selected post-call extraction jobs and pending Validate proposals (D4412, #4412). */
import type { Env } from '../types';
import { run, quoteRun, type RunOptions } from './aiRouter';
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

// Input estimate: 180 spoken words/minute, up to eight characters/word plus
// model instructions/context. Actual final text is quoted again before run().
export const MAX_OUTPUT_TOKENS = 2500;
export function extractionOptions(userId: number, output: CallOutput, text: string, ctx: StructureContext): RunOptions {
  return {
    task: 'structure_interview', userId, surface: AI_SURFACE.validateInterviews,
    // No page matrix overrides: TASK_TEXT_JOBS selects VA5 through textChoice.
    systemPrompt: [...STRUCTURE_RULES, `Extract only ${CALL_OUTPUTS[output].label}.`,
      ...CALL_OUTPUTS[output].kinds.map((k) => KIND_LINES[k]), ...STRUCTURE_TAIL, contextLines(ctx)].join('\n'),
    messages: [{ role: 'user', content: text }], maxTokens: MAX_OUTPUT_TOKENS, temperature: 0.2,
  };
}
export async function quoteOutputs(env: Env, userId: number, outputs: CallOutput[], minutes: number) {
  let total = 0;
  for (const output of outputs) {
    const quote = await quoteRun(env, extractionOptions(userId, output, 'x'.repeat(Math.ceil(minutes * 180 * 8) + 12000), { hypotheses: [], painGroups: [] }));
    if (!quote.ok) return { ok: false as const, message: 'The extraction estimate is unavailable. Try again before starting.' };
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
    await env.DB.prepare(`INSERT INTO interview_output_jobs (session_id, output, run_id) VALUES (?, ?, ?)
      ON CONFLICT(session_id, output) DO NOTHING`).bind(s.id, output, `output:${crypto.randomUUID()}`).run();
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
  const rows = (await env.DB.prepare('SELECT output, status FROM interview_output_jobs WHERE session_id = ?')
    .bind(session.id).all<{ output: string; status: string }>()).results ?? [];
  return outputs.map((output) => ({ output, label: CALL_OUTPUTS[output].label,
    status: rows.find((r) => r.output === output)?.status ?? 'waiting' }));
}

/** One independently retriable job per ticked output. Completed jobs never run twice. */
export async function runOutputJob(env: Env, payload: unknown) {
  const p = payload as { session_id?: unknown; user_id?: unknown; output?: unknown } | null;
  const id = Number(p?.session_id), userId = Number(p?.user_id), output = p?.output;
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(userId) || userId <= 0 || !isCallOutput(output)) return;
  let session;
  try { ({ session } = await writableSession(env, userId, id)); } catch { return; }
  if (session.created_by_user_id !== userId || session.consent_status !== 'given' || !sessionOutputs(session)?.includes(output)
    || !['transcribed', 'structured', 'reviewed'].includes(session.status)) return;
  const segments = await finalSegments(env, id);
  const snapshot = (await env.DB.prepare("SELECT id, text FROM interview_transcript_segments WHERE session_id = ? AND source = 'final' ORDER BY id").bind(id).all<{ id: number; text: string }>()).results ?? [];
  if (!segments.length) return;
  const claim = await env.DB.prepare(`UPDATE interview_output_jobs SET status = 'running', updated_at = datetime('now')
    WHERE session_id = ? AND output = ? AND (status = 'queued' OR (status = 'running' AND datetime(updated_at) < datetime('now', '-15 minutes')))`)
    .bind(id, output).run();
  if (Number(claim.meta?.changes) !== 1) return;
  const job = await env.DB.prepare('SELECT run_id FROM interview_output_jobs WHERE session_id = ? AND output = ?')
    .bind(id, output).first<{ run_id: string }>();
  try {
    // One job and one bounded model call per selected output; a longer source
    // fails visibly rather than silently truncating it or multiplying spend.
    if (new TextEncoder().encode(transcriptData(segments)).length > 100 * 1024) throw new Error('input_too_long');
    const options = extractionOptions(userId, output, transcriptData(segments), await loadStructureContext(env, session.project_id));
    const quote = await quoteRun(env, options);
    if (!quote.ok) throw new Error('quote_unavailable');
    await env.DB.prepare('UPDATE interview_output_jobs SET quote_microusd = ? WHERE session_id = ? AND output = ?')
      .bind(quote.hold_microusd, id, output).run();
    const result = await run(env, { ...options, pinMicrousd: quote.hold_microusd });
    await recordStructureReceipt(env, id, job!.run_id, { step: 'structured', model: result.usage.model,
      requested_model: quote.model, fallback_used: !!result.usage.fallback_used, prompt_tokens: result.usage.prompt_tokens,
      completion_tokens: result.usage.completion_tokens, est_cost_usd: result.usage.est_cost_usd }, result.ok ? 'ok' : 'refused', result.refusal ?? null);
    if (!result.ok) throw new Error('extraction_failed');
    // Malformed output is a failure, not a successful empty extraction.
    const parsed = firstJsonObject(result.output || '');
    if (!Array.isArray(parsed?.placements)) throw new Error('invalid_output');
    const { placements, dropped } = parsePlacements(result.output || '', segments, await loadStructureContext(env, session.project_id), CALL_OUTPUTS[output].kinds);
    if (!placements.length && dropped) throw new Error('invalid_citations');
    const fresh = await writableSession(env, userId, id);
    if (fresh.session.consent_status !== 'given') throw new Error('consent_changed');
    const consent = await env.DB.prepare('SELECT quote_consent FROM discovery_interviews WHERE id = ? AND project_id = ?')
      .bind(session.interview_id, session.project_id).first<{ quote_consent: number | null }>();
    const safe = placements.filter((x) => x.kind !== 'quotable_line' || (consent?.quote_consent === 1 && x.payload.text === x.quote));
    // Re-read the final transcript; a changed source invalidates this result.
    if (JSON.stringify(await finalSegments(env, id)) !== JSON.stringify(segments)) throw new Error('source_changed');
    await storePlacements(env, { projectId: session.project_id, sessionId: id, interviewId: session.interview_id,
      userId, model: result.usage.model, runId: job!.run_id, placements: safe, dedupe: true, requireGivenConsent: true,
      sourceSnapshot: snapshot });
    await env.DB.prepare(`UPDATE interview_output_jobs SET status = ?, model = ?, updated_at = datetime('now') WHERE session_id = ? AND output = ?`)
      .bind(safe.length ? 'done' : 'empty', result.usage.model, id, output).run();
  } catch {
    // No source/provider text is exposed, and a failed result never counts as empty.
    await env.DB.prepare("UPDATE interview_output_jobs SET status = 'failed', updated_at = datetime('now') WHERE session_id = ? AND output = ?")
      .bind(id, output).run();
  }
}
