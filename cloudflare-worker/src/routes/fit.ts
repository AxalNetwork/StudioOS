/**
 * Fit v2 — staged assessment API (`/api/fit`).
 *
 * The staged flow is a second CLIENT of the same answer pipeline the
 * conversational Personal Advisor uses: every answer goes through
 * writeRouter.routeAnswer (per-resource auth, structured fan-out) and is
 * batched into advisor_answers (on the user's hidden `state='fit_v2'`
 * conversation) + field_sources — so the chat and the staged flow fill ONE
 * shared profile and the v2 engine (services/fitDecision.ts) scores from one
 * raw store.
 *
 * Anti-gaming: the public /config payload strips option scores/loads,
 * red-flag keys, validation pairs, and reviewer signal notes. Admin surfaces
 * (routes/admin_fit.ts) see the full spec.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import {
  FIT_V2_ID_RE,
  fitV2BankFor,
  fitV2Stages,
  questionById,
  type Question,
} from '../services/advisor/questionBank';
import {
  FIT_ROLE_CONTEXTS,
  FIT_ROLE_TEMPLATES,
  isFitRoleContext,
  roleContextForUser,
  type FitRoleContext,
} from '../services/fitRoles';
import {
  AXAL_VALUES_BASELINE,
  FIT_BANK_VERSION,
  FIT_OUTCOME_LABEL,
  FIT_OUTCOME_PLAYBOOK,
  computeFitDecision,
  loadFitDecisionHistory,
  loadFitV2Answers,
  loadLatestFitDecision,
  type FitDecisionResult,
} from '../services/fitDecision';
import { ensureFitV2Schema } from '../services/fitV2Schema';
import { routeAnswer } from '../services/advisor/writeRouter';
import { recomputeUserFit } from '../services/axalFit';
import { recomputeUserArchetype } from '../services/archetypeScoring';

const fit = new Hono<{ Bindings: Env }>();

const MAX_BATCH = 25;

interface SessionRow {
  id: number; uid: string; user_id: number; role_context: string; bank_version: string;
  core_only: number; status: string; current_stage: string; conversation_id: number | null;
  progress_json: string | null; decision_id: number | null; source: string;
  started_at: string; updated_at: string; submitted_at: string | null;
}

function roleFromQuery(user: User, raw: string | undefined): FitRoleContext {
  if (raw && isFitRoleContext(raw)) return raw;
  return roleContextForUser(user.role);
}

/** Subject-facing question payload — scoring internals stripped. */
function publicFitQuestion(q: Question) {
  const v2 = q.fit_v2!;
  return {
    id: q.id,
    stage: v2.stage,
    module: v2.module,
    kind: v2.kind,
    ui: v2.ui || null,
    prompt: q.prompt,
    hint: q.hint || null,
    options: v2.options_v2 ? v2.options_v2.map((o) => ({ key: o.key, label: o.label })) : null,
    min_len: v2.evidence?.min_len ?? null,
    mvp_core: !!v2.mvp_core,
    skip_allowed: q.skip_allowed !== false,
  };
}

function publicSession(row: SessionRow, decisionUid?: string | null) {
  return {
    uid: row.uid,
    role_context: row.role_context,
    bank_version: row.bank_version,
    core_only: row.core_only === 1,
    status: row.status,
    current_stage: row.current_stage,
    source: row.source,
    started_at: row.started_at,
    updated_at: row.updated_at,
    submitted_at: row.submitted_at,
    decision_uid: decisionUid ?? null,
  };
}

function publicDecision(d: FitDecisionResult) {
  return {
    uid: d.uid,
    role_context: d.role_context,
    role_label: FIT_ROLE_TEMPLATES[d.role_context]?.label || d.role_context,
    bank_version: d.bank_version,
    engine_version: d.engine_version,
    outcome: d.outcome,
    outcome_label: FIT_OUTCOME_LABEL[d.outcome],
    playbook: FIT_OUTCOME_PLAYBOOK[d.outcome],
    culture_score: d.culture_score,
    role_score: d.role_score,
    archetype_primary: d.archetype_primary,
    archetype_secondary: d.archetype_secondary,
    archetype_margin: d.archetype_margin,
    confidence: d.confidence,
    evidence_quality: d.evidence_quality,
    coverage: d.coverage,
    values: d.values,
    skills: d.skills,
    rubric: d.rubric,
    gaps: d.gaps,
    flags: d.flags,
    contradictions: d.contradictions.length,
    narrative: d.narrative,
    computed_at: d.computed_at,
  };
}

function stageProgress(bank: Question[], answered: Set<string>) {
  const out: Record<string, { answered: number; total: number }> = {};
  for (const s of fitV2Stages(bank)) {
    out[s.key] = { answered: s.ids.filter((id) => answered.has(id)).length, total: s.ids.length };
  }
  return out;
}

async function answeredMap(env: Env, userId: number, bank: Question[]): Promise<Map<string, string>> {
  const rows = await loadFitV2Answers(env, userId, bank);
  return new Map(rows.map((r) => [r.question_id, r.raw] as const));
}

const PERSONA_BY_ROLE: Record<string, string> = {
  founder: 'founder', investor: 'investor', partner: 'partner', advisor: 'advisor', admin: 'admin',
};

/**
 * The hidden conversation that anchors staged advisor_answers rows
 * (conversation_id is NOT NULL there). One per user, `state='fit_v2'` —
 * excluded from getLatestConversation in routes/advisor.ts so it can never
 * hijack the dashboard /progress or /answered envelopes.
 */
async function getOrCreateFitConversation(env: Env, user: User): Promise<number> {
  const existing = await env.DB.prepare(
    "SELECT id FROM advisor_conversations WHERE user_id = ? AND state = 'fit_v2' ORDER BY id DESC LIMIT 1",
  ).bind(user.id).first<{ id: number }>();
  if (existing) return existing.id;
  const uid = crypto.randomUUID().replace(/-/g, '');
  const persona = PERSONA_BY_ROLE[user.role || ''] || 'unknown';
  await env.DB.prepare(
    `INSERT INTO advisor_conversations (uid, user_id, persona, state, current_question_id, total_questions)
       VALUES (?, ?, ?, 'fit_v2', NULL, 0)`,
  ).bind(uid, user.id, persona).run();
  const row = await env.DB.prepare(
    "SELECT id FROM advisor_conversations WHERE user_id = ? AND state = 'fit_v2' ORDER BY id DESC LIMIT 1",
  ).bind(user.id).first<{ id: number }>();
  if (!row) throw new Error('failed to create fit conversation');
  return row.id;
}

async function loadSessionByUid(env: Env, uid: string): Promise<SessionRow | null> {
  return await env.DB.prepare('SELECT * FROM fit_sessions WHERE uid = ?').bind(uid).first<SessionRow>();
}

function sessionEnvelope(row: SessionRow, bank: Question[], answered: Map<string, string>, decisionUid?: string | null) {
  return {
    session: publicSession(row, decisionUid),
    stages: fitV2Stages(bank).map((s) => ({ key: s.key, label: s.label, question_ids: s.ids })),
    questions: bank.map(publicFitQuestion),
    answered: Object.fromEntries(answered),
    progress: stageProgress(bank, new Set(answered.keys())),
  };
}

// ---------------------------------------------------------------------------
// GET /config?role=<ctx>&full=0|1 — role templates + serialized bank.
// ---------------------------------------------------------------------------
fit.get('/config', async (c) => {
  const user = await requireAuth(c);
  const role = roleFromQuery(user, c.req.query('role'));
  const full = c.req.query('full') === '1';
  const bank = fitV2BankFor(role, { coreOnly: !full });
  return c.json({
    bank_version: FIT_BANK_VERSION,
    role_context: role,
    default_role: roleContextForUser(user.role),
    roles: FIT_ROLE_CONTEXTS.map((k) => ({
      key: k,
      label: FIT_ROLE_TEMPLATES[k].label,
      description: FIT_ROLE_TEMPLATES[k].description,
    })),
    stages: fitV2Stages(bank).map((s) => ({ key: s.key, label: s.label, question_ids: s.ids })),
    questions: bank.map(publicFitQuestion),
    totals: { questions: bank.length },
  });
});

// ---------------------------------------------------------------------------
// POST /sessions { role_context?, core_only? } — start or resume.
// ---------------------------------------------------------------------------
fit.post('/sessions', async (c) => {
  const user = await requireAuth(c);
  await ensureFitV2Schema(c.env);
  const body = await c.req.json().catch(() => ({} as { role_context?: unknown; core_only?: unknown }));
  const role = roleFromQuery(user, typeof body.role_context === 'string' ? body.role_context : undefined);
  const coreOnly = body.core_only == null ? true : Boolean(body.core_only);

  let row = await c.env.DB.prepare(
    "SELECT * FROM fit_sessions WHERE user_id = ? AND role_context = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1",
  ).bind(user.id, role).first<SessionRow>();

  if (!row) {
    const conversationId = await getOrCreateFitConversation(c.env, user);
    await c.env.DB.prepare(
      `INSERT INTO fit_sessions (user_id, role_context, bank_version, core_only, conversation_id)
         VALUES (?, ?, ?, ?, ?)`,
    ).bind(user.id, role, FIT_BANK_VERSION, coreOnly ? 1 : 0, conversationId).run();
    row = await c.env.DB.prepare(
      "SELECT * FROM fit_sessions WHERE user_id = ? AND role_context = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1",
    ).bind(user.id, role).first<SessionRow>();
  }
  if (!row) throw new Error('failed to create fit session');

  const bank = fitV2BankFor(role, { coreOnly: row.core_only === 1 });
  const answered = await answeredMap(c.env, user.id, bank);
  return c.json(sessionEnvelope(row, bank, answered));
});

// ---------------------------------------------------------------------------
// GET /sessions/current?role=<ctx> — resume probe for page load.
// ---------------------------------------------------------------------------
fit.get('/sessions/current', async (c) => {
  const user = await requireAuth(c);
  await ensureFitV2Schema(c.env);
  const role = roleFromQuery(user, c.req.query('role'));
  const row = await c.env.DB.prepare(
    "SELECT * FROM fit_sessions WHERE user_id = ? AND role_context = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1",
  ).bind(user.id, role).first<SessionRow>();
  if (!row) return c.json({ session: null, role_context: role });
  const bank = fitV2BankFor(role, { coreOnly: row.core_only === 1 });
  const answered = await answeredMap(c.env, user.id, bank);
  return c.json(sessionEnvelope(row, bank, answered));
});

// ---------------------------------------------------------------------------
// GET /sessions/:uid — own session (admin may fetch any).
// ---------------------------------------------------------------------------
fit.get('/sessions/:uid', async (c) => {
  const user = await requireAuth(c);
  await ensureFitV2Schema(c.env);
  const row = await loadSessionByUid(c.env, c.req.param('uid'));
  if (!row) return c.json({ error: 'not found' }, 404);
  if (row.user_id !== user.id && user.role !== 'admin') throw new Error('Forbidden');
  const role = row.role_context as FitRoleContext;
  const bank = fitV2BankFor(role, { coreOnly: row.core_only === 1 });
  const answered = await answeredMap(c.env, row.user_id, bank);
  let decisionUid: string | null = null;
  if (row.decision_id != null) {
    const d = await c.env.DB.prepare('SELECT uid FROM fit_decisions WHERE id = ?')
      .bind(row.decision_id).first<{ uid: string }>();
    decisionUid = d?.uid ?? null;
  }
  return c.json(sessionEnvelope(row, bank, answered, decisionUid));
});

// ---------------------------------------------------------------------------
// POST /sessions/:uid/answers { answers: [{question_id, value, evidence?}], stage? }
// Batch upsert through the shared writeRouter pipeline.
// ---------------------------------------------------------------------------
fit.post('/sessions/:uid/answers', async (c) => {
  const user = await requireAuth(c);
  await ensureFitV2Schema(c.env);
  const row = await loadSessionByUid(c.env, c.req.param('uid'));
  if (!row) return c.json({ error: 'not found' }, 404);
  if (row.user_id !== user.id) throw new Error('Forbidden');
  if (row.status !== 'in_progress') return c.json({ error: 'session is not in progress' }, 409);

  const body = await c.req.json().catch(() => ({} as { answers?: unknown; stage?: unknown }));
  const items = Array.isArray(body.answers) ? body.answers : [];
  if (items.length === 0) return c.json({ error: 'answers array required' }, 400);
  if (items.length > MAX_BATCH) return c.json({ error: `at most ${MAX_BATCH} answers per request` }, 400);

  const role = row.role_context as FitRoleContext;
  const fullBank = fitV2BankFor(role, { coreOnly: false });
  const bankIds = new Set(fullBank.map((q) => q.id));

  let conversationId = row.conversation_id;
  if (conversationId == null) {
    conversationId = await getOrCreateFitConversation(c.env, user);
    await c.env.DB.prepare('UPDATE fit_sessions SET conversation_id = ? WHERE id = ?')
      .bind(conversationId, row.id).run();
  }

  const results: Array<{ question_id: string; status: string; hint?: string }> = [];
  const stmts: D1PreparedStatement[] = [];
  let savedCount = 0;

  for (const item of items) {
    const qid = String((item as { question_id?: unknown })?.question_id || '').trim();
    const value = String((item as { value?: unknown })?.value ?? '').trim();
    const evidence = (item as { evidence?: unknown })?.evidence != null
      ? String((item as { evidence?: unknown }).evidence).trim()
      : null;

    if (!qid || !FIT_V2_ID_RE.test(qid) || !bankIds.has(qid)) {
      results.push({ question_id: qid || '(missing)', status: 'invalid', hint: 'unknown fit question id' });
      continue;
    }
    const q = questionById(qid);
    if (!q || !q.fit_v2) {
      results.push({ question_id: qid, status: 'invalid', hint: 'unknown fit question id' });
      continue;
    }
    if (!value) {
      results.push({ question_id: qid, status: 'skipped' });
      continue;
    }

    const result = await routeAnswer(c.env, user, qid, value, evidence);
    results.push({ question_id: qid, status: result.status, hint: result.hint });
    if (result.status !== 'saved') continue;
    savedCount += 1;

    stmts.push(c.env.DB.prepare(
      `INSERT INTO advisor_answers
         (conversation_id, user_id, question_id, raw_value, saved_to_table, saved_to_column, saved_to_id, saved_status, saved_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(conversation_id, question_id) DO UPDATE SET
         raw_value = excluded.raw_value,
         saved_to_table = excluded.saved_to_table,
         saved_to_column = excluded.saved_to_column,
         saved_to_id = excluded.saved_to_id,
         saved_status = excluded.saved_status,
         saved_error = excluded.saved_error`,
    ).bind(
      conversationId, user.id, qid, value,
      result.saved_to?.table || null,
      result.saved_to?.column || null,
      result.saved_to?.id != null ? String(result.saved_to.id) : null,
      result.status,
    ));
    // The raw answer string is the v2 engine's source of truth (mirrors the
    // advisor route's fieldEvidence convention for fit ids).
    stmts.push(c.env.DB.prepare(
      `INSERT INTO field_sources
         (user_id, question_id, page_target, saved_to_table, saved_to_column, saved_to_id, source, evidence_text, filled_at)
         VALUES (?, ?, ?, ?, ?, ?, 'fit_staged', ?, datetime('now'))
       ON CONFLICT(user_id, question_id) DO UPDATE SET
         page_target = excluded.page_target,
         saved_to_table = excluded.saved_to_table,
         saved_to_column = excluded.saved_to_column,
         saved_to_id = excluded.saved_to_id,
         source = excluded.source,
         evidence_text = excluded.evidence_text,
         filled_at = excluded.filled_at`,
    ).bind(
      user.id, qid, q.page_target || '/fit',
      result.saved_to?.table || null,
      result.saved_to?.column || null,
      result.saved_to?.id != null ? String(result.saved_to.id) : null,
      value,
    ));
  }

  if (savedCount > 0) {
    stmts.push(c.env.DB.prepare(
      'INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)',
    ).bind(
      'fit_v2_answered',
      JSON.stringify({ session_uid: row.uid, role_context: role, saved: savedCount }),
      `user:${user.id}`,
      user.id,
    ));
    try {
      await c.env.DB.batch(stmts);
    } catch (e) {
      console.warn('[fit] answer batch failed', (e as Error).message);
    }
  }

  const bank = fitV2BankFor(role, { coreOnly: row.core_only === 1 });
  const answered = await answeredMap(c.env, user.id, bank);
  const stageRaw = typeof body.stage === 'string' ? body.stage : null;
  const validStages = new Set(fitV2Stages(fullBank).map((s) => s.key as string));
  const nextStage = stageRaw && (validStages.has(stageRaw) || stageRaw === 'review') ? stageRaw : row.current_stage;
  const progress = stageProgress(bank, new Set(answered.keys()));
  await c.env.DB.prepare(
    "UPDATE fit_sessions SET progress_json = ?, current_stage = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(JSON.stringify(progress), nextStage, row.id).run();

  return c.json({ results, progress, answered_count: answered.size });
});

// ---------------------------------------------------------------------------
// POST /sessions/:uid/submit — compute + persist the decision.
// ---------------------------------------------------------------------------
fit.post('/sessions/:uid/submit', async (c) => {
  const user = await requireAuth(c);
  await ensureFitV2Schema(c.env);
  const row = await loadSessionByUid(c.env, c.req.param('uid'));
  if (!row) return c.json({ error: 'not found' }, 404);
  if (row.user_id !== user.id) throw new Error('Forbidden');

  const role = row.role_context as FitRoleContext;
  const decision = await computeFitDecision(c.env, user.id, role, {
    persist: true,
    sessionId: row.id,
  });

  // Best-effort v1 refresh: the staged answers also enriched v1 sinks
  // (axal_values / user_skills / numeric field_sources), so keep the v1
  // scorecard + archetype current. Never fails the submit.
  try { await recomputeUserFit(c.env, user.id); } catch (e) {
    console.warn('[fit] recomputeUserFit failed', (e as Error).message);
  }
  try { await recomputeUserArchetype(c.env, user.id); } catch (e) {
    console.warn('[fit] recomputeUserArchetype failed', (e as Error).message);
  }

  await c.env.DB.prepare(
    "UPDATE fit_sessions SET status = 'scored', decision_id = ?, submitted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
  ).bind(decision.id, row.id).run();

  return c.json({ decision: publicDecision(decision) });
});

// ---------------------------------------------------------------------------
// GET /decisions/me?role=<ctx> — latest + history for the caller.
// ---------------------------------------------------------------------------
fit.get('/decisions/me', async (c) => {
  const user = await requireAuth(c);
  const roleRaw = c.req.query('role');
  const role = roleRaw && isFitRoleContext(roleRaw) ? roleRaw : undefined;
  const [latest, history] = await Promise.all([
    loadLatestFitDecision(c.env, user.id, role),
    loadFitDecisionHistory(c.env, user.id, role, 10),
  ]);
  return c.json({
    latest: latest ? publicDecision(latest) : null,
    history: history.map((d) => ({
      uid: d.uid,
      role_context: d.role_context,
      outcome: d.outcome,
      culture_score: d.culture_score,
      role_score: d.role_score,
      confidence: d.confidence,
      computed_at: d.computed_at,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /results/me?role=<ctx> — assembled results-screen payload.
// ---------------------------------------------------------------------------
fit.get('/results/me', async (c) => {
  const user = await requireAuth(c);
  const roleRaw = c.req.query('role');
  const role = roleRaw && isFitRoleContext(roleRaw) ? roleRaw : undefined;
  const decision = await loadLatestFitDecision(c.env, user.id, role);
  if (!decision) return c.json({ decision: null });

  // Reviewer overrides surface as the effective outcome (with provenance);
  // reviewer notes/reasons stay admin-only.
  const review = decision.id != null
    ? await c.env.DB.prepare(
        'SELECT override_outcome, requires_followup, updated_at FROM fit_reviews WHERE decision_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1',
      ).bind(decision.id).first<{ override_outcome: string | null; requires_followup: number; updated_at: string }>()
    : null;
  const effectiveOutcome = (review?.override_outcome as FitDecisionResult['outcome'] | null) || decision.outcome;

  return c.json({
    decision: publicDecision(decision),
    effective_outcome: effectiveOutcome,
    effective_outcome_label: FIT_OUTCOME_LABEL[effectiveOutcome],
    reviewed: !!review?.override_outcome,
    requires_followup: !!review?.requires_followup,
    baseline: AXAL_VALUES_BASELINE,
  });
});

export default fit;
