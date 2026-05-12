/**
 * Personal Advisor — Workers AI re-ranker on top of the static bank.
 *
 * The deterministic question bank picks the FIRST unanswered question in
 * registry order (`nextUnansweredQuestion`). That's predictable but feels
 * robotic and re-surfaces skipped/select-typed-past questions in tight
 * loops (the "stupid repetitive" UX the user reported).
 *
 * This module wraps the bank with a thin LLM re-rank step:
 *
 *   1. Take the top-K (default 8) deterministic candidates from the
 *      already filterByContext-trimmed bank.
 *   2. Drop any id seen in the last RECENT_TURN_WINDOW (default 3)
 *      assistant turns, so the same prompt can't bounce back instantly
 *      after a skip.
 *   3. Ask qwen2.5-coder-32b (via aiRouter task='rerank') to pick the
 *      most relevant id given the last 6 conversation messages.
 *   4. Validate the model's response is a known candidate id; if not,
 *      OR the router refuses (budget/safety/timeout), fall back to the
 *      deterministic head of the candidate list.
 *
 * The bank is always the source of truth — the LLM only re-orders ≤K
 * options it ALREADY had permission to see, so persona / week / tier /
 * unlock gating is fully preserved.
 *
 * Disabling: set ADVISOR_RERANK_DISABLED=1 in env to short-circuit
 * back to the legacy deterministic order without removing the wiring.
 */

import type { Env } from '../../types';
import type { Question } from './questionBank';
import { run as aiRouterRun } from '../aiRouter';

const TOP_K = 8;
const RECENT_TURN_WINDOW = 3;
const RECENT_MESSAGE_WINDOW = 6;

interface RecentMsg { role: string; content: string; question_id: string | null }

/**
 * Walk the bank in registry order and return the FIRST id not in
 * `answered`. Identical semantics to the legacy
 * `nextUnansweredQuestion` helper in routes/advisor.ts; duplicated
 * here so this module is self-contained for tests.
 */
function deterministicNext(bank: Question[], answered: Set<string>): Question | null {
  for (const q of bank) if (!answered.has(q.id)) return q;
  return null;
}

/**
 * Top-K unanswered candidates (bank-order). Preserves the importance/
 * section sort that selectBank already applied upstream.
 */
function candidates(bank: Question[], answered: Set<string>, limit = TOP_K): Question[] {
  const out: Question[] = [];
  for (const q of bank) {
    if (answered.has(q.id)) continue;
    out.push(q);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Pull the last N advisor_messages for this conversation. Used both
 * for (a) the "don't re-ask the last 3 things" filter and (b) building
 * the model's context window.
 */
async function recentMessages(env: Env, conversationId: number): Promise<RecentMsg[]> {
  try {
    const rows = await env.DB.prepare(
      `SELECT role, content, question_id
         FROM advisor_messages
        WHERE conversation_id = ?
        ORDER BY id DESC
        LIMIT ?`,
    ).bind(conversationId, Math.max(RECENT_MESSAGE_WINDOW, RECENT_TURN_WINDOW * 2)).all<RecentMsg>();
    return (rows.results || []).reverse();
  } catch (e) {
    // Schema not present (fresh dev DB) or transient D1 hiccup — we
    // degrade silently to "no recent context", which still produces a
    // valid re-rank since the candidate list is the only required input.
    console.warn('[advisor.rerank] recentMessages:', (e as Error).message);
    return [];
  }
}

/**
 * Question ids that the advisor has surfaced in the last
 * RECENT_TURN_WINDOW assistant turns. We deliberately scan ASSISTANT
 * messages (those carry `question_id`) rather than user replies.
 */
function recentlyAskedIds(msgs: RecentMsg[]): Set<string> {
  const seen: string[] = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'assistant' || !m.question_id) continue;
    seen.push(m.question_id);
    if (seen.length >= RECENT_TURN_WINDOW) break;
  }
  return new Set(seen);
}

/**
 * Compose the re-rank prompt. We keep it deliberately tight — qwen-
 * coder follows JSON schemas best when the instruction is short and
 * the candidate block is enumerated.
 */
function buildPrompt(cands: Question[], msgs: RecentMsg[]): { system: string; user: string } {
  const system =
    'You are the next-question selector for a venture-studio onboarding advisor. ' +
    'Pick the MOST relevant unanswered question to ask next, given the recent conversation. ' +
    'Output STRICTLY a single JSON object: {"id": "<one of the candidate ids>"}. ' +
    'No prose, no markdown, no explanation. The id MUST exactly match one candidate. ' +
    'Prefer questions that build naturally on what the user just said. ' +
    'Avoid questions whose subject the user already covered in their answers.';

  const ctxBlock = msgs.length === 0
    ? '(no prior turns)'
    : msgs.slice(-RECENT_MESSAGE_WINDOW).map((m) => {
        const who = m.role === 'user' ? 'USER' : m.role === 'assistant' ? 'ADVISOR' : m.role.toUpperCase();
        // Trim to keep token budget bounded — long pasted docs would
        // blow the context window otherwise.
        const content = (m.content || '').replace(/\s+/g, ' ').slice(0, 240);
        return `- ${who}: ${content}`;
      }).join('\n');

  const candBlock = cands.map((q, i) => {
    const sec = q.section ? `[${q.section}] ` : '';
    const imp = q.importance && q.importance !== 'normal' ? ` (importance=${q.importance})` : '';
    return `${i + 1}. id=${q.id}  ${sec}${q.prompt}${imp}`;
  }).join('\n');

  const user =
    `RECENT TURNS:\n${ctxBlock}\n\nCANDIDATES (pick exactly one id):\n${candBlock}\n\n` +
    'Respond with JSON only.';

  return { system, user };
}

/**
 * Strict JSON id extractor. Accepts:
 *   {"id":"foo.bar"}   — canonical
 *   {"id": "foo.bar"}  — whitespace
 *   ```json {"id":…} ``` — markdown-fenced (defensive against models
 *      that ignore "no markdown" instructions; we strip the fence).
 * Returns null on any parse failure or schema mismatch.
 */
function parsePickedId(raw: string | undefined | null, allowed: Set<string>): string | null {
  if (!raw) return null;
  // Strip ``` fences if the model added them despite instructions.
  let body = raw.trim();
  if (body.startsWith('```')) {
    body = body.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  }
  // Some models prepend a sentence — try to grab the first {…} block.
  const brace = body.indexOf('{');
  const close = body.lastIndexOf('}');
  if (brace >= 0 && close > brace) body = body.slice(brace, close + 1);

  try {
    const parsed = JSON.parse(body) as { id?: unknown };
    const id = typeof parsed.id === 'string' ? parsed.id.trim() : null;
    if (id && allowed.has(id)) return id;
    return null;
  } catch {
    return null;
  }
}

function rerankDisabled(env: Env): boolean {
  const e = env as unknown as Record<string, string | undefined>;
  const v = e.ADVISOR_RERANK_DISABLED;
  return v === '1' || v === 'true';
}

/**
 * Public entry point. Drop-in replacement for the legacy
 * `nextUnansweredQuestion(bank, answered)` call in routes/advisor.ts.
 *
 * Contract:
 *   - Returns null iff every bank question is answered (same as legacy).
 *   - Returns the deterministic head when there are 0 or 1 candidates,
 *     when the rerank kill switch is set, when the model output can't
 *     be validated, or when the router refuses.
 *   - On a candidate list of size ≥2 with the LLM available, returns
 *     the model's pick — guaranteed to be a member of the candidate set.
 *
 * Failure mode: NEVER throws. Every error path collapses to the
 * deterministic head so the /next-question endpoint stays available
 * even if Workers AI is fully down.
 */
export interface PickOpts {
  /**
   * If set AND the id matches an unanswered visible bank question,
   * return that question immediately (no recency filter, no LLM call).
   *
   * The /start and /next-question routes pass
   * `conv.current_question_id` here so a refresh / poll / re-open
   * returns the SAME pending question instead of bouncing to a
   * different one just because the prior pick is in recent assistant
   * turns. Without this, the architect's flagged regression would
   * trigger:
   *   - /start records the first question as an assistant message
   *     before rerank, so rerank's recency filter would suppress
   *     that just-recorded id and return a different one;
   *   - /next-question polled before answering would advance even
   *     though no /answer or /skip happened.
   *
   * /answer and /skip deliberately do NOT pass pinnedId — those are
   * post-progression: the previously-pending question is now answered
   * or skipped, and we WANT the rerank to pick a fresh one.
   */
  pinnedId?: string | null;
}

export async function pickNextQuestion(
  env: Env,
  userId: number,
  conversationId: number,
  bank: Question[],
  answered: Set<string>,
  opts: PickOpts = {},
): Promise<Question | null> {
  // Pin path — honour an in-flight current_question_id so the route
  // layer remains idempotent under polling/refresh. Must run BEFORE
  // the rerank-disabled shortcut so the legacy deterministic mode
  // still respects the pin.
  if (opts.pinnedId) {
    const pinned = bank.find((q) => q.id === opts.pinnedId && !answered.has(q.id));
    if (pinned) return pinned;
    // Pinned id was answered/skipped/removed — fall through to
    // normal pick so we advance instead of returning null.
  }

  // Cheap shortcuts — no LLM call needed.
  if (rerankDisabled(env)) return deterministicNext(bank, answered);

  const cands = candidates(bank, answered);
  if (cands.length === 0) return null;
  if (cands.length === 1) return cands[0];

  // Apply the "don't re-ask the last N" filter, but never let the
  // filter empty the candidate list — if it would, fall through to
  // the unfiltered set so the bank still progresses.
  const msgs = await recentMessages(env, conversationId);
  const recentIds = recentlyAskedIds(msgs);
  const filtered = cands.filter((q) => !recentIds.has(q.id));
  const pool = filtered.length > 0 ? filtered : cands;

  // Single survivor after recency filter — no need to spend tokens.
  if (pool.length === 1) return pool[0];

  const allowedIds = new Set(pool.map((q) => q.id));
  const { system, user } = buildPrompt(pool, msgs);

  let picked: string | null = null;
  try {
    const result = await aiRouterRun(env, {
      task: 'rerank',
      userId,
      systemPrompt: system,
      messages: [{ role: 'user', content: user }],
      maxTokens: 64,
      temperature: 0.1,
    });
    if (result.ok) picked = parsePickedId(result.output, allowedIds);
  } catch (e) {
    // aiRouter is defensive but we wrap defensively anyway — a thrown
    // error here MUST NOT break /next-question.
    console.warn('[advisor.rerank] aiRouter throw:', (e as Error).message);
  }

  if (picked) {
    const hit = pool.find((q) => q.id === picked);
    if (hit) return hit;
  }
  // Router refusal, malformed JSON, or id outside candidate set —
  // fall back to deterministic head of the recency-filtered pool so
  // the route still returns a valid next question without bouncing
  // back to a recently-asked id.
  return pool[0];
}
