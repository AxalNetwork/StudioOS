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
import type { Question, Importance } from './questionBank.ts';
// Re-use the canonical Spin-Out Lab milestone catalog so the
// "advance week when all weekly milestones are met" rule (architect
// review item #2) stays in lock-step with /api/spinout-lab. Routes
// don't import stateMachine, so this one-way dep is safe.
import { MILESTONES, weekMet } from '../spinoutLabCatalog.ts';

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
// Recent platform activity bonus (spec — composite ranking item).
// A question whose `page_target` matches a page the user touched in
// the last RECENT_ACTIVITY_WINDOW_MS gets +RECENT_ACTIVITY_BOOST so
// in-context follow-ups float above unrelated work.
export const RECENT_ACTIVITY_BOOST = 2;
export const RECENT_ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
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
  /** Page paths the user has visibly interacted with in the recent
   *  activity window. Empty Set when nothing is known. */
  recentActivityPages?: Set<string>;
  now: number;                                  // ms — injected for tests
}

export interface CandidateBreakdown {
  importance: number;
  focus_boost: boolean;
  unlock_proximity: boolean;
  recent_activity: boolean;
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
 * Recent platform activity match — true when the question's
 * page_target matches a page the user touched recently. Lets a
 * follow-up question for /build/discovery surface above unrelated
 * work right after the user logs an interview on that page.
 */
export function isRecentActivityMatch(
  q: Question, recentPages?: Set<string>,
): boolean {
  if (!recentPages || recentPages.size === 0) return false;
  if (!q.page_target) return false;
  return recentPages.has(q.page_target);
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
  const recentAct = isRecentActivityMatch(q, ctx.recentActivityPages);
  const recently = isRecentlyAsked(q.id, ctx.recentlyAsked, ctx.now);

  let score = imp;
  if (focus) score *= FOCUS_PAGE_MULTIPLIER;
  if (proximity) score += UNLOCK_PROXIMITY_BOOST;
  if (recentAct) score += RECENT_ACTIVITY_BOOST;
  if (recently) score += ANTI_REPEAT_PENALTY;

  return {
    question: q,
    score,
    breakdown: {
      importance: imp,
      focus_boost: focus,
      unlock_proximity: proximity,
      recent_activity: recentAct,
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
 * Distinct page paths the user has touched in the recent-activity
 * window, drawn from `activity_logs.details.page` and
 * `field_sources.page_target`. Used by the ranking's
 * "recent platform activity" boost. Errors degrade to an empty Set
 * so a stale dev DB doesn't break ranking.
 */
export async function loadRecentActivityPages(
  env: Env, userId: number, sinceMs: number,
): Promise<Set<string>> {
  const out = new Set<string>();
  const sinceIso = new Date(sinceMs).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  // 1. activity_logs — every advisor.* / page.view row carries a
  //    JSON `details` blob with an optional `page` field.
  try {
    const rows = await env.DB.prepare(
      `SELECT details FROM activity_logs
        WHERE user_id = ? AND created_at >= ?
        ORDER BY id DESC LIMIT 200`,
    ).bind(userId, sinceIso).all<{ details: string | null }>();
    for (const r of (rows.results || [])) {
      if (!r.details) continue;
      try {
        const j = JSON.parse(r.details) as { page?: unknown };
        if (typeof j.page === 'string' && j.page.startsWith('/')) out.add(j.page);
      } catch { /* malformed details — skip */ }
    }
  } catch { /* activity_logs absent — fine */ }
  // 2. field_sources — every advisor-driven write logs the
  //    page_target the answer belongs to.
  try {
    const rows = await env.DB.prepare(
      `SELECT DISTINCT page_target FROM field_sources
        WHERE user_id = ? AND filled_at >= ?
        LIMIT 100`,
    ).bind(userId, sinceIso).all<{ page_target: string | null }>();
    for (const r of (rows.results || [])) {
      if (r.page_target) out.add(r.page_target);
    }
  } catch { /* field_sources absent — fine */ }
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
  /** Additional answered ids the route layer already knows about
   *  (e.g. from `hydrateAlreadyAnswered` against domain tables). They
   *  are unioned with the cross-conversation set loaded from
   *  `advisor_answers` so questions whose data lives only on a
   *  domain row are NEVER re-asked — architect review item #1. */
  extraAnswered?: Set<string>;
  /** Pre-loaded recent activity pages. When omitted, nextTurn
   *  loads them itself via `loadRecentActivityPages`. */
  recentActivityPages?: Set<string>;
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
  const fromAnswers = await loadAnsweredForUser(env, userId);
  const answered = ctx.extraAnswered
    ? new Set<string>([...fromAnswers, ...ctx.extraAnswered])
    : fromAnswers;
  const recentlyAsked = await loadRecentlyAsked(env, userId, now - ANTI_REPEAT_WINDOW_MS);
  const recentActivityPages = ctx.recentActivityPages
    ?? await loadRecentActivityPages(env, userId, now - RECENT_ACTIVITY_WINDOW_MS);
  const result = pickNext(visible, answered, {
    focusPage: ctx.focusPage ?? null,
    week: ctx.week,
    completedMilestones: ctx.completedMilestones,
    recentlyAsked,
    recentActivityPages,
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
 * flag on `unlock_required` as a narrow advisor-driven shortcut;
 * the broader milestone-catalog-driven advancement (architect
 * review item #2) is computed in `onAnswered` from the live
 * `completedMilestones` set.
 */
function questionAdvancesWeek(q: Question): boolean {
  const u = q.unlock_required as (Question['unlock_required'] & { advances_week?: boolean }) | undefined;
  return u?.advances_week === true;
}

/**
 * Pure milestone-catalog evaluator. Returns the highest week index
 * for which every required milestone is satisfied — i.e. the week
 * the user has earned the right to be on. Exported so the route
 * layer (and unit tests) can reuse the same logic.
 */
export function highestEarnedWeek(completed: Set<string>): number {
  let earned = 1;
  for (const def of MILESTONES) {
    if (weekMet(def.week, completed)) earned = def.week + 1;
  }
  // Cap at week 4 — the lab graduates the user at week 4 completion
  // via a separate `is_incorporated` flip, not by setting week=5.
  return Math.min(4, Math.max(1, earned));
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
  completedMilestones?: Set<string>,
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

  // 3. Advance week — two independent paths, take the larger:
  //    (a) the answered question carries the advisor-driven
  //        `advances_week` flag (legacy shortcut, +1 from current);
  //    (b) the live milestone set already satisfies a higher week
  //        than the user is currently on (architect review item #2 —
  //        spec requires "all weekly milestones met → advance").
  if (currentWeek < 4) {
    let target = currentWeek;
    if (questionAdvancesWeek(question)) target = Math.max(target, currentWeek + 1);
    if (completedMilestones) {
      target = Math.max(target, highestEarnedWeek(completedMilestones));
    }
    if (target > currentWeek) {
      const newWeek = Math.min(4, target);
      try {
        await env.DB.prepare(
          `UPDATE users SET spinout_lab_week = ? WHERE id = ?`,
        ).bind(newWeek, userId).run();
        out.week_advanced = true;
        out.new_week = newWeek;
      } catch {
        /* spinout_lab_week column may be absent — ensureAdvisorWeekColumn
           in the route layer handles the lazy-add */
      }
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

// ---------------------------------------------------------------------------
// Tier-deferred CTA serializer. /turn and /queue surface tier-blocked
// questions as paywall CTAs (not as questions) per the spec's "Done
// looks like" condition. The route layer feeds in the `deferred`
// list from `filterByContext` — we only forward the `reason==='tier'`
// entries since week/persona/unlock blocks are not paywalls.
// ---------------------------------------------------------------------------
export interface DeferredQuestionLike {
  question: Question;
  reason: string;
  detail?: string;
}
export function paywallCtas(
  deferred: DeferredQuestionLike[],
  upgradePath = '/billing/upgrade',
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const d of deferred) {
    if (d.reason !== 'tier') continue;
    const tier = d.question.tier_required || null;
    out.push({
      question_id: d.question.id,
      prompt: d.question.prompt,
      section: d.question.section || null,
      page_target: d.question.page_target || null,
      tier_required: tier,
      reason: 'tier',
      detail: d.detail || (tier ? `Requires ${tier}.` : 'Requires upgrade.'),
      upgrade_link: tier ? `${upgradePath}?feature=advisor&tier=${encodeURIComponent(tier)}` : upgradePath,
    });
  }
  return out;
}
