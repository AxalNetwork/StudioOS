/**
 * Fit v2 — admin review & calibration API (`/api/admin/fit`).
 *
 * The reviewer layer of the methodology: evidence ratings per question,
 * outcome overrides with a recorded reason, requires-follow-up markers, and
 * the (MVP read-only) calibration snapshot. Admin sees the full question
 * spec — including option loads, validation pairs, and reviewer signal
 * notes — that the subject-facing /api/fit/config strips.
 *
 * Mounted BEFORE the `/api/admin` catch-all in index.ts (house rule for
 * admin sub-routers).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import {
  fitV2BankFor,
  type Question,
} from '../services/advisor/questionBank';
import {
  FIT_ROLE_TEMPLATES,
  isFitRoleContext,
  type FitRoleContext,
} from '../services/fitRoles';
import {
  FIT_OUTCOME_LABEL,
  FIT_V2_THRESHOLDS,
  computeFitDecision,
  decisionFromRow,
  loadFitDecisionHistory,
  loadFitV2Answers,
  type FitOutcome,
} from '../services/fitDecision';
import { ensureFitV2Schema } from '../services/fitV2Schema';

const adminFit = new Hono<{ Bindings: Env }>();
adminFit.use('*', async (c, next) => {
  await requireAdmin(c);
  await next();
});

const OUTCOMES = Object.keys(FIT_OUTCOME_LABEL) as FitOutcome[];

/** Reviewer-facing question payload — full spec, loads and notes included. */
function adminFitQuestion(q: Question) {
  const v2 = q.fit_v2!;
  return {
    id: q.id,
    stage: v2.stage,
    module: v2.module,
    kind: v2.kind,
    prompt: q.prompt,
    hint: q.hint || null,
    mvp_core: !!v2.mvp_core,
    chat_core: !!v2.chat_core,
    value_key: v2.value_key || null,
    trait: v2.trait || null,
    skill_v2: v2.skill_v2 || null,
    rubric_v2: v2.rubric_v2 || null,
    options: v2.options_v2 || null,
    validation_pair: v2.validation_pair || null,
    reverse_scored: !!v2.reverse_scored,
    evidence: v2.evidence || null,
    signal_notes: v2.signal_notes || null,
    followup_prompts: v2.followup_prompts || null,
    measures: q.measures || null,
  };
}

// ---------------------------------------------------------------------------
// GET /queue?outcome=&limit= — latest decision per (user, role) + review state.
// ---------------------------------------------------------------------------
adminFit.get('/queue', async (c) => {
  await ensureFitV2Schema(c.env);
  const outcome = c.req.query('outcome');
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50));
  const filterSql = outcome && OUTCOMES.includes(outcome as FitOutcome) ? 'AND d.outcome = ?' : '';
  const binds: unknown[] = [];
  if (filterSql) binds.push(outcome);
  binds.push(limit);
  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.uid, d.user_id, d.role_context, d.outcome, d.culture_score, d.role_score,
            d.confidence, d.flags_json, d.computed_at,
            u.email AS user_email, u.name AS user_name,
            (SELECT COUNT(*) FROM fit_reviews r WHERE r.decision_id = d.id) AS review_count,
            (SELECT r.override_outcome FROM fit_reviews r WHERE r.decision_id = d.id ORDER BY r.updated_at DESC LIMIT 1) AS override_outcome,
            (SELECT MAX(r.requires_followup) FROM fit_reviews r WHERE r.decision_id = d.id) AS requires_followup
       FROM fit_decisions d
       JOIN users u ON u.id = d.user_id
      WHERE d.id IN (SELECT MAX(id) FROM fit_decisions GROUP BY user_id, role_context)
        ${filterSql}
      ORDER BY d.computed_at DESC, d.id DESC
      LIMIT ?`,
  ).bind(...binds).all();
  const items = (rows.results || []).map((r) => {
    const rec = r as Record<string, unknown>;
    let flags: string[] = [];
    try { flags = rec.flags_json ? JSON.parse(String(rec.flags_json)) : []; } catch { flags = []; }
    return {
      decision_id: rec.id,
      decision_uid: rec.uid,
      user_id: rec.user_id,
      user_email: rec.user_email,
      user_name: rec.user_name,
      role_context: rec.role_context,
      outcome: rec.outcome,
      outcome_label: FIT_OUTCOME_LABEL[rec.outcome as FitOutcome] || rec.outcome,
      culture_score: rec.culture_score,
      role_score: rec.role_score,
      confidence: rec.confidence,
      flags,
      computed_at: rec.computed_at,
      review_count: Number(rec.review_count) || 0,
      override_outcome: rec.override_outcome || null,
      requires_followup: !!Number(rec.requires_followup || 0),
    };
  });
  return c.json({ items });
});

// ---------------------------------------------------------------------------
// GET /users/:userId/decisions — full history for a subject.
// ---------------------------------------------------------------------------
adminFit.get('/users/:userId/decisions', async (c) => {
  const userId = Number(c.req.param('userId'));
  if (!Number.isFinite(userId) || userId <= 0) return c.json({ error: 'bad user id' }, 400);
  await ensureFitV2Schema(c.env);
  const history = await loadFitDecisionHistory(c.env, userId, undefined, 25);
  const sessions = await c.env.DB.prepare(
    'SELECT uid, role_context, status, current_stage, core_only, started_at, updated_at, submitted_at FROM fit_sessions WHERE user_id = ? ORDER BY id DESC LIMIT 25',
  ).bind(userId).all();
  return c.json({
    decisions: history.map((d) => ({
      id: d.id,
      uid: d.uid,
      role_context: d.role_context,
      outcome: d.outcome,
      culture_score: d.culture_score,
      role_score: d.role_score,
      confidence: d.confidence,
      flags: d.flags,
      computed_at: d.computed_at,
      computed_by: d.computed_by,
    })),
    sessions: sessions.results || [],
  });
});

// ---------------------------------------------------------------------------
// GET /decisions/:id — decision detail incl. per-question responses + reviews.
// ---------------------------------------------------------------------------
adminFit.get('/decisions/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'bad decision id' }, 400);
  await ensureFitV2Schema(c.env);
  const row = await c.env.DB.prepare('SELECT * FROM fit_decisions WHERE id = ?').bind(id).first();
  if (!row) return c.json({ error: 'not found' }, 404);
  const decision = decisionFromRow(row as never);

  const subject = await c.env.DB.prepare(
    'SELECT id, email, name, role FROM users WHERE id = ?',
  ).bind(decision.user_id).first();

  const bank = fitV2BankFor(decision.role_context, { coreOnly: false });
  const answers = await loadFitV2Answers(c.env, decision.user_id, bank);
  const answerByQid = new Map(answers.map((a) => [a.question_id, a.raw] as const));
  const responses = bank
    .filter((q) => answerByQid.has(q.id))
    .map((q) => ({ question: adminFitQuestion(q), raw: answerByQid.get(q.id) }));

  const reviews = await c.env.DB.prepare(
    `SELECT r.*, u.email AS reviewer_email, u.name AS reviewer_name
       FROM fit_reviews r JOIN users u ON u.id = r.reviewer_id
      WHERE r.decision_id = ? ORDER BY r.updated_at DESC`,
  ).bind(id).all();

  return c.json({
    decision: { ...decision, outcome_label: FIT_OUTCOME_LABEL[decision.outcome] },
    subject,
    responses,
    reviews: reviews.results || [],
    thresholds: FIT_V2_THRESHOLDS,
  });
});

// ---------------------------------------------------------------------------
// POST /decisions/:id/review — upsert this reviewer's review.
// ---------------------------------------------------------------------------
adminFit.post('/decisions/:id/review', async (c) => {
  const admin = await requireAdmin(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'bad decision id' }, 400);
  await ensureFitV2Schema(c.env);
  const decision = await c.env.DB.prepare(
    'SELECT id, user_id FROM fit_decisions WHERE id = ?',
  ).bind(id).first<{ id: number; user_id: number }>();
  if (!decision) return c.json({ error: 'not found' }, 404);

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const overrideOutcome = typeof body.override_outcome === 'string' && body.override_outcome ? body.override_outcome : null;
  if (overrideOutcome && !OUTCOMES.includes(overrideOutcome as FitOutcome)) {
    return c.json({ error: 'invalid override_outcome' }, 400);
  }
  const overrideReason = typeof body.override_reason === 'string' ? body.override_reason.trim() : '';
  if (overrideOutcome && !overrideReason) {
    return c.json({ error: 'override_reason is required when overriding the outcome' }, 400);
  }
  const evidenceRatings = body.evidence_ratings && typeof body.evidence_ratings === 'object'
    ? body.evidence_ratings as Record<string, number>
    : null;
  if (evidenceRatings) {
    for (const [qid, rating] of Object.entries(evidenceRatings)) {
      if (!Number.isInteger(rating) || rating < 0 || rating > 3) {
        return c.json({ error: `evidence rating for ${qid} must be an integer 0..3` }, 400);
      }
    }
  }
  const requiresFollowup = body.requires_followup ? 1 : 0;
  const followup = Array.isArray(body.followup) ? body.followup : null;
  const notes = typeof body.notes === 'string' ? body.notes : null;
  const status = body.status === 'resolved' ? 'resolved' : 'open';

  await c.env.DB.prepare(
    `INSERT INTO fit_reviews
       (decision_id, subject_user_id, reviewer_id, evidence_ratings_json, override_outcome,
        override_reason, requires_followup, followup_json, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(decision_id, reviewer_id) DO UPDATE SET
       evidence_ratings_json = excluded.evidence_ratings_json,
       override_outcome = excluded.override_outcome,
       override_reason = excluded.override_reason,
       requires_followup = excluded.requires_followup,
       followup_json = excluded.followup_json,
       notes = excluded.notes,
       status = excluded.status,
       updated_at = datetime('now')`,
  ).bind(
    id, decision.user_id, admin.id,
    evidenceRatings ? JSON.stringify(evidenceRatings) : null,
    overrideOutcome, overrideOutcome ? overrideReason : null,
    requiresFollowup,
    followup ? JSON.stringify(followup) : null,
    notes, status,
  ).run();

  const saved = await c.env.DB.prepare(
    'SELECT * FROM fit_reviews WHERE decision_id = ? AND reviewer_id = ?',
  ).bind(id, admin.id).first();
  return c.json({ review: saved });
});

// ---------------------------------------------------------------------------
// GET /decisions/:id/reviews — all reviews for a decision.
// ---------------------------------------------------------------------------
adminFit.get('/decisions/:id/reviews', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'bad decision id' }, 400);
  await ensureFitV2Schema(c.env);
  const rows = await c.env.DB.prepare(
    `SELECT r.*, u.email AS reviewer_email, u.name AS reviewer_name
       FROM fit_reviews r JOIN users u ON u.id = r.reviewer_id
      WHERE r.decision_id = ? ORDER BY r.updated_at DESC`,
  ).bind(id).all();
  return c.json({ reviews: rows.results || [] });
});

// ---------------------------------------------------------------------------
// POST /users/:userId/recompute { role_context } — admin-triggered recompute.
// ---------------------------------------------------------------------------
adminFit.post('/users/:userId/recompute', async (c) => {
  const admin = await requireAdmin(c);
  const userId = Number(c.req.param('userId'));
  if (!Number.isFinite(userId) || userId <= 0) return c.json({ error: 'bad user id' }, 400);
  const body = await c.req.json().catch(() => ({} as { role_context?: unknown }));
  const role = typeof body.role_context === 'string' && isFitRoleContext(body.role_context)
    ? body.role_context as FitRoleContext
    : null;
  if (!role) return c.json({ error: 'role_context required' }, 400);
  const subject = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
  if (!subject) return c.json({ error: 'user not found' }, 404);
  const decision = await computeFitDecision(c.env, userId, role, { persist: true, computedBy: admin.id });
  return c.json({
    decision: {
      id: decision.id,
      uid: decision.uid,
      role_context: decision.role_context,
      outcome: decision.outcome,
      outcome_label: FIT_OUTCOME_LABEL[decision.outcome],
      culture_score: decision.culture_score,
      role_score: decision.role_score,
      confidence: decision.confidence,
      flags: decision.flags,
      gaps: decision.gaps,
      narrative: decision.narrative,
      computed_at: decision.computed_at,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /calibration — MVP snapshot: outcome distribution, per-question answer
// counts, thresholds (read-only; editing is Phase 2).
// ---------------------------------------------------------------------------
adminFit.get('/calibration', async (c) => {
  await ensureFitV2Schema(c.env);
  const outcomes = await c.env.DB.prepare(
    'SELECT outcome, COUNT(*) AS n FROM fit_decisions GROUP BY outcome ORDER BY n DESC',
  ).all();
  const questions = await c.env.DB.prepare(
    "SELECT question_id, COUNT(*) AS n FROM field_sources WHERE question_id LIKE 'fit.%.v2\\_%' ESCAPE '\\' GROUP BY question_id ORDER BY n DESC LIMIT 250",
  ).all();
  const roleTemplates = Object.values(FIT_ROLE_TEMPLATES).map((t) => ({
    key: t.key,
    label: t.label,
    must_have_skills: t.mustHaveSkills,
    skill_weights: t.skillWeights,
    rubric_weights: t.rubricWeights,
  }));
  return c.json({
    outcomes: outcomes.results || [],
    question_counts: questions.results || [],
    thresholds: FIT_V2_THRESHOLDS,
    role_templates: roleTemplates,
  });
});

export default adminFit;
