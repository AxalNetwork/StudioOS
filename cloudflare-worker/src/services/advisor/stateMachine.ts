/**
 * Task #6 (CB) — Personal Advisor conversation state machine.
 *
 * Deterministic question selector that replaces the legacy
 * "first-unanswered + LLM rerank" loop. Goals:
 *
 *   1. Never re-ask a question the user has already answered (we read
 *      `advisor_answers` cross-conversation, not just within one
 *      conversation row).
 *   2. Pick the highest-priority unanswered question for the user's
 *      persona / Spin-Out-Lab week / billing tier / page focus.
 *   3. React to milestone unlocks — questions whose `unlock_required`
 *      gate is *one step away* from being satisfied get a proximity
 *      bonus so they surface before less-urgent peers.
 *   4. Anti-repeat — a question asked in the last 5 minutes (without a
 *      new answer) gets a hard −100 penalty so the same prompt can't
 *      bounce back instantly after a skip.
 *
 * Composite ranking (per `Candidate.score`):
 *
 *   base       = importance score (critical=4, high=3, normal=2, low=1)
 *   focus      = base × 2     when q.page_target === ctx.focusPage
 *   proximity  = +5           when q is one milestone / one week away
 *                              from being unlocked
 *   anti_rep   = −100         when q was asked < 5 min ago
 *
 *   score      = (base [× focus_mul]) + proximity + anti_rep
 *
 * Side-effect hooks (`onAnswered`):
 *
 *   - bumps `advisor_state.answer_count`
 *   - records `last_asked_at` so future `nextTurn` calls see it
 *   - emits a row into `activity_logs` with action='advisor.answered'
 *   - advances `users.spinout_lab_week` when the answered question
 *     carries `unlock_required.advances_week === true`
 *
 * The pure ranking helpers (`scoreCandidate`, `pickNext`, `is*`) are
 * exported individually so the unit tests can drive >80% branch
 * coverage without any D1 round-trips.
 */
import type { Env } from '../../types';
import type { Question, Importance } from './questionBank';

// ---------------------------------------------------------------------------
// Constants — exported so tests can import the same numerics rather
// than redeclaring them and drifting silently.
// ---------------------------------------------------------------------------
export const IMPORTANCE_SCORE: Record<Importance, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};
export const FOCUS_PAGE_MULTIPLIER = 2;
export const UNLOCK_PROXIMITY_BOOST = 5;
export const ANTI_REPEAT_PENALTY = -100;
export const ANTI_REPEAT_WINDOW_MS = 5 * 60 * 1000;
export const DEFAULT_QUEUE_LIMIT = 10;

// ---------------------------------------------------------------------------
// Pure ranking surface.
// ---------------------------------------------------------------------------
export interface RankContext {
  focusPage?: string | null;
  week: number;                                 // 1..4
  completedMilestones: Set<string>;
  recentlyAsked: Map<string, number>;           // qid -> ms timestamp
  now: number;                                  // ms — injected for tests
}

export interface CandidateBreakdown {
  importance: number;
  focus_boost: boolean;
  unlock_proximity: boolean;
  anti_repeat: boolean;
}

export interface Candidate {
  question: Question;
  score: number;
  breakdown: CandidateBreakdown;
}

export interface PickResult {
  next: Question | null;
  queue: Candidate[];
}

export function importanceScore(q: Question): number {
  return IMPORTANCE_SCORE[q.importance ?? 'normal'];
}

export function isFocusMatch(q: Question, focusPage?: string | null): boolean {
  if (!focusPage) return false;
  return !!q.page_target && q.page_target === focusPage;
}

/**
 * "One step away" from being unlocked:
 *   - week-gated: q.unlock_required.week === currentWeek + 1
 *   - milestone-gated: exactly one missing milestone remaining
 *
 * Returns false for already-unlocked or far-out gates so the bonus
 * doesn't bleed into questions the user can answer right now (they
 * already win on importance) nor distantly-locked ones (they'd
 * crowd out actionable work).
 */
export function isUnlockProximate(
  q: Question, week: number, completed: Set<string>,
): boolean {
  const u = q.unlock_required;
  if (!u) return false;
  if (u.week && u.week === week + 1) return true;
  if (u.milestones && u.milestones.length > 0) {
    const missing = u.milestones.filter((m) => !completed.has(m));
    if (missing.length === 1) return true;
  }
  return false;
}

export function isRecentlyAsked(
  qid: string, recentlyAsked: Map<string, number>, now: number,
): boolean {
  const t = recentlyAsked.get(qid);
  if (t == null) return false;
  return now - t < ANTI_REPEAT_WINDOW_MS;
}

/**
 * Score a single question. Pure — no I/O, no Date.now(), no
 * randomness. Deterministic on its inputs so every branch can be
 * unit-tested directly.
 */
export function scoreCandidate(q: Question, ctx: RankContext): Candidate {
  const imp = importanceScore(q);
  const focus = isFocusMatch(q, ctx.focusPage);
  const proximity = isUnlockProximate(q, ctx.week, ctx.completedMilestones);
  const recently = isRecentlyAsked(q.id, ctx.recentlyAsked, ctx.now);

  let score = imp;
  if (focus) score *= FOCUS_PAGE_MULTIPLIER;
  if (proximity) score += UNLOCK_PROXIMITY_BOOST;
  if (recently) score += ANTI_REPEAT_PENALTY;

  return {
    question: q,
    score,
    breakdown: {
      importance: imp,
      focus_boost: focus,
      unlock_proximity: proximity,
      anti_repeat: recently,
    },
  };
}

/**
 * Rank a pre-filtered visible bank, drop already-answered ids, and
 * return the top question + a peek at the next N. Stable secondary
 * sort by id keeps the output deterministic across JS engines.
 */
export function pickNext(
  visible: Question[],
  answered: Set<string>,
  ctx: RankContext,
  queueLimit: number = DEFAULT_QUEUE_LIMIT,
): PickResult {
  const cands: Candidate[] = [];
  for (const q of visible) {
    if (answered.has(q.id)) continue;
    cands.push(scoreCandidate(q, ctx));
  }
  cands.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.question.id.localeCompare(b.question.id);
  });
  return { next: cands[0]?.question ?? null, queue: cands.slice(0, queueLimit) };
}

// ---------------------------------------------------------------------------
// D1-aware helpers. Each one swallows D1 errors and degrades to an
// empty result so the state machine stays available even on a stale
// dev DB without `advisor_state` migrated.
// ---------------------------------------------------------------------------

/**
 * Cross-conversation answered set. We treat both 'saved' AND 'skipped'
 * as "answered" for ranking purposes — a skipped question shouldn't
 * be re-served on the next /turn.
 */
export async function loadAnsweredForUser(env: Env, userId: number): Promise<Set<string>> {
  try {
    const rows = await env.DB.prepare(
      `SELECT DISTINCT question_id FROM advisor_answers
        WHERE user_id = ? AND saved_status IN ('saved', 'skipped')`,
    ).bind(userId).all<{ question_id: string }>();
    return new Set((rows.results || []).map((r) => r.question_id));
  } catch {
    return new Set();
  }
}

/**
 * Last-asked-at timestamps for every question we've shown this user
 * within the anti-repeat window. Returned as ms-since-epoch so the
 * pure scorer can compare against `ctx.now` directly.
 */
export async function loadRecentlyAsked(
  env: Env, userId: number, sinceMs: number,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const rows = await env.DB.prepare(
      `SELECT question_id, last_asked_at FROM advisor_state WHERE user_id = ?`,
    ).bind(userId).all<{ question_id: string; last_asked_at: string }>();
    for (const r of (rows.results || [])) {
      // SQLite datetime('now') returns 'YYYY-MM-DD HH:MM:SS' UTC sans
      // the 'Z' suffix — append it so Date.parse interprets as UTC
      // rather than local time.
      const iso = r.last_asked_at.includes('T')
        ? r.last_asked_at
        : r.last_asked_at.replace(' ', 'T') + 'Z';
      const t = Date.parse(iso);
      if (!Number.isNaN(t) && t >= sinceMs) out.set(r.question_id, t);
    }
  } catch {
    /* table absent on stale dev — empty map is the safe default */
  }
  return out;
}

/**
 * Stamp `advisor_state.last_asked_at` so the next /turn knows we
 * just served this question.
 */
export async function markAsked(env: Env, userId: number, questionId: string): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO advisor_state (user_id, question_id, last_asked_at)
         VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id, question_id) DO UPDATE SET
         last_asked_at = datetime('now')`,
    ).bind(userId, questionId).run();
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Orchestrator. Thin wrapper that wires the DB helpers into pickNext.
// ---------------------------------------------------------------------------
export interface NextTurnContext {
  focusPage?: string | null;
  week: number;
  completedMilestones: Set<string>;
  /** Optional override for the clock — tests inject a fixed value. */
  now?: number;
}

export interface NextTurnResult {
  next_question: Question | null;
  queue: Candidate[];
}

/**
 * Compute the next question for `userId` against an already-filtered
 * `visible` bank. The route layer is responsible for assembling
 * `visible` via `bankFor()` + `filterByContext()` — keeping that
 * concern outside the state machine means the unit tests don't need
 * to mock the question registry.
 */
export async function nextTurn(
  env: Env,
  userId: number,
  visible: Question[],
  ctx: NextTurnContext,
): Promise<NextTurnResult> {
  const now = ctx.now ?? Date.now();
  const answered = await loadAnsweredForUser(env, userId);
  const recentlyAsked = await loadRecentlyAsked(env, userId, now - ANTI_REPEAT_WINDOW_MS);
  const result = pickNext(visible, answered, {
    focusPage: ctx.focusPage ?? null,
    week: ctx.week,
    completedMilestones: ctx.completedMilestones,
    recentlyAsked,
    now,
  });
  if (result.next) {
    // Fire-and-forget — markAsked swallows its own errors. We DO
    // await so the next /turn within the same isolate sees the
    // updated row, but if it throws we don't block the response.
    await markAsked(env, userId, result.next.id);
  }
  return { next_question: result.next, queue: result.queue };
}

// ---------------------------------------------------------------------------
// Side-effect hooks. Called from /answer (and tested independently).
// ---------------------------------------------------------------------------
export interface SideEffectResult {
  counter_bumped: boolean;
  notification_emitted: boolean;
  week_advanced: boolean;
  new_week: number | null;
}

/**
 * Detect whether answering this question should advance the user to
 * the next Spin-Out Lab week. We honour a custom `advances_week`
 * flag on `unlock_required`; the broader milestone catalog drives
 * week advancement on its own (spinout_lab routes), so this is a
 * narrow signal for advisor-driven shortcuts.
 */
function questionAdvancesWeek(q: Question): boolean {
  const u = q.unlock_required as (Question['unlock_required'] & { advances_week?: boolean }) | undefined;
  return u?.advances_week === true;
}

/**
 * Apply post-answer side effects. Best-effort — every step is wrapped
 * so a failure in one doesn't suppress the others.
 */
export async function onAnswered(
  env: Env,
  userId: number,
  question: Question,
  rawValue: string,
  currentWeek: number,
): Promise<SideEffectResult> {
  const out: SideEffectResult = {
    counter_bumped: false,
    notification_emitted: false,
    week_advanced: false,
    new_week: null,
  };

  // 1. Bump the per-question counter on advisor_state.
  try {
    await env.DB.prepare(
      `INSERT INTO advisor_state (user_id, question_id, last_asked_at, answer_count)
         VALUES (?, ?, datetime('now'), 1)
       ON CONFLICT(user_id, question_id) DO UPDATE SET
         answer_count = COALESCE(answer_count, 0) + 1,
         last_asked_at = datetime('now')`,
    ).bind(userId, question.id).run();
    out.counter_bumped = true;
  } catch {
    /* best-effort */
  }

  // 2. Emit advisor.answered into activity_logs. We deliberately keep
  //    the payload tiny — downstream consumers (CC progress widget,
  //    CE MI extractor) read raw_value from advisor_answers directly.
  try {
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, user_id) VALUES (?, ?, ?)`,
    ).bind(
      'advisor.answered',
      JSON.stringify({
        question_id: question.id,
        page: question.page_target || null,
        section: question.section || null,
        value_len: rawValue.length,
      }),
      userId,
    ).run();
    out.notification_emitted = true;
  } catch {
    /* activity_logs may be absent on dev */
  }

  // 3. Advance week if the question is a week-gate milestone marker.
  if (questionAdvancesWeek(question) && currentWeek < 4) {
    try {
      await env.DB.prepare(
        `UPDATE users SET spinout_lab_week = ? WHERE id = ?`,
      ).bind(currentWeek + 1, userId).run();
      out.week_advanced = true;
      out.new_week = currentWeek + 1;
    } catch {
      /* spinout_lab_week column may be absent — ensureAdvisorWeekColumn
         in the route layer handles the lazy-add */
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Public-facing serializer for /turn and /queue. Keeps the wire shape
// stable as we add internal fields to `Candidate`.
// ---------------------------------------------------------------------------
export function publicCandidate(c: Candidate): Record<string, unknown> {
  return {
    id: c.question.id,
    prompt: c.question.prompt,
    section: c.question.section || null,
    page_target: c.question.page_target || null,
    importance: c.question.importance || 'normal',
    score: c.score,
    breakdown: c.breakdown,
  };
}
