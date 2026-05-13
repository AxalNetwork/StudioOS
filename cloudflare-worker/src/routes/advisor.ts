/**
 * Task #10 (AC-1) — Personal Advisor backend.
 *
 * Persistent dashboard chatbot that profiles every persona via Q&A
 * and writes the answers back into the right pages via the
 * `services/advisor/writeRouter.ts` mapping. Replaces the standalone
 * "Tell us about yourself" panel.
 *
 * Endpoints (mounted at /api/advisor):
 *   POST   /start                       — get-or-create the user's
 *                                         active conversation + first
 *                                         unanswered question.
 *   POST   /answer                      — { conversation_uid, question_id, value }
 *                                         Routes the answer to its
 *                                         persistence target, returns
 *                                         { saved_to, hint, next, paywall }.
 *   POST   /skip                        — same shape; records a 'skipped'
 *                                         row and advances.
 *   POST   /explain                     — SSE stream; LLM-generated
 *                                         explanation of the current /
 *                                         requested topic. Routed via
 *                                         aiRouter task='advisor_explain'
 *                                         (Workers AI primary; Anthropic
 *                                         narrow fallback). Provider can
 *                                         be flipped via the
 *                                         ADVISOR_EXPLAIN_PROVIDER env.
 *   GET    /progress                    — { persona, total, answered, skipped, percent }
 *   GET    /conversations/:uid          — full Q&A history (most recent first).
 *
 * Persona detector:
 *   When `users.role` is null we walk the `ROLE_DETECTOR` triplet first.
 *   The primary answer is mapped via questionBank.mapRoleAnswer() into
 *   the canonical role enum and persisted to users.role through the
 *   write-router.
 *
 * Auth:
 *   Every endpoint requires a logged-in user (requireAuth). The
 *   write-router enforces per-resource auth on top of that — founders
 *   can only update their own project, investors their own profile
 *   etc. — so a user with the wrong role can't write to another
 *   persona's bank even by guessing question_ids.
 *
 * Out of scope (handled by AC-2 / AC-3):
 *   - Production-grade question banks (this file ships seed banks
 *     sufficient for the round-trip; questionBank.ts will be expanded
 *     in AC-2).
 *   - Frontend chat UI (AC-3).
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import {
  ROLE_DETECTOR,
  bankFor,
  questionById,
  filterByContext,
  groupByPage,
  groupBySection,
  sortByImportance,
  type BankName,
  type Persona,
  type Question,
} from '../services/advisor/questionBank';
import { routeAnswer, hydrateAlreadyAnswered, recordFieldSource, type WriteResult } from '../services/advisor/writeRouter';
import { hashEmail } from '../util/hashEmail';
// Task #4 (AW) — 7-layer advisor guardrails.
import {
  ADVISOR_SYSTEM_PROMPT,
  REFUSAL,
  promptHash,
  stripVerbatimLeak,
  classifyInput,
  gateToolCall,
  checkKillSwitch,
  ensureGuardrailColumns,
  bumpAnomalyAndCheck,
  bumpExplainsWithoutCommit,
  writeTurnAudit,
} from '../services/advisor/guardrails';
// Task #5 (AV) — Find & deep-link tool registry.
import {
  isToolName,
  executeTool,
  TOOL_SCHEMAS,
  type ToolEnvelope,
} from '../services/advisor/tools';
import { run as aiRouterRun } from '../services/aiRouter';
import { pickNextQuestion } from '../services/advisor/rerank';
import {
  nextTurn as smNextTurn,
  onAnswered as smOnAnswered,
  publicCandidate as smPublicCandidate,
  loadAnsweredForUser as smLoadAnsweredForUser,
  paywallCtas as smPaywallCtas,
} from '../services/advisor/stateMachine';
import { enqueueJob } from '../services/queue';
import { notifyAdvisorPageFill, notifyAdvisorProgress } from '../services/realtime';

const advisor = new Hono<{ Bindings: Env }>();

// Per-call output cap for /explain. AC-1 caps replies to ≤120 words so
// the buffered stripVerbatimLeak post-processing stays cheap; 512 tokens
// is a generous ceiling that fits that bound for both Workers AI llama
// models and Anthropic claude-sonnet-4-6 (Task #16 fallback).
const EXPLAIN_MAX_TOKENS = 512;

// ---------------------------------------------------------------------------
// Schema. Mirrors sql/migrations/029_advisor.sql; idempotent so an
// uninitialised dev D1 still works.
// ---------------------------------------------------------------------------
let _schemaReady = false;
async function ensureSchema(env: Env): Promise<void> {
  if (_schemaReady) return;
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS advisor_conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL, persona TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active', current_question_id TEXT, total_questions INTEGER NOT NULL DEFAULT 0, answered_count INTEGER NOT NULL DEFAULT 0, skipped_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))"
    );
    await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_advisor_conv_user ON advisor_conversations(user_id, updated_at DESC)");
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS advisor_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL REFERENCES advisor_conversations(id) ON DELETE CASCADE, role TEXT NOT NULL, question_id TEXT, content TEXT NOT NULL, meta_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))"
    );
    await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_advisor_msg_conv ON advisor_messages(conversation_id, id)");
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS advisor_answers (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL REFERENCES advisor_conversations(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, question_id TEXT NOT NULL, raw_value TEXT, saved_to_table TEXT, saved_to_column TEXT, saved_to_id TEXT, saved_status TEXT NOT NULL, saved_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(conversation_id, question_id))"
    );
    await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_advisor_answers_user_q ON advisor_answers(user_id, question_id)");
    // Task #3 (AS) — field_sources audit table for the per-page
    // <AdvisorFilledBanner> + sparkle attribution icons. Mirrors
    // sql/migrations/042_advisor_field_sources.sql so a dev D1
    // without that migration applied still serves /sources.
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS field_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, question_id TEXT NOT NULL, page_target TEXT, saved_to_table TEXT, saved_to_column TEXT, saved_to_id TEXT, source TEXT NOT NULL DEFAULT 'advisor', evidence_text TEXT, filled_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, question_id))"
    );
    await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_field_sources_user_page ON field_sources(user_id, page_target)");
    _schemaReady = true;
  } catch (e) {
    console.error('[advisor] schema:', (e as Error).message);
  }
}

function newUid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function personaFor(user: User): Persona {
  const role = (user.role || '').toLowerCase();
  if (role === 'founder' || role === 'investor' || role === 'mentor' || role === 'partner' || role === 'admin') {
    return role as Persona;
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Task #2 (AR) — lazy column ensure for users.spinout_lab_week.
// Mirrors the migration 041 pattern so dev/SQLite works without
// running the migration. Idempotent: PRAGMA table_info short-circuits
// when the column is already present (production case).
// ---------------------------------------------------------------------------
let _userColsReady = false;
async function ensureAdvisorWeekColumn(env: Env): Promise<void> {
  if (_userColsReady) return;
  try {
    const cols = await env.DB.prepare(`PRAGMA table_info(users)`).all<{ name: string }>();
    const have = new Set((cols.results || []).map((r) => r.name));
    if (!have.has('spinout_lab_week')) {
      try { await env.DB.exec(`ALTER TABLE users ADD COLUMN spinout_lab_week INTEGER`); }
      catch (e) { /* duplicate-column race; ignore */ void e; }
    }
    _userColsReady = true;
  } catch (e) {
    console.error('[advisor] ensureAdvisorWeekColumn:', (e as Error).message);
  }
}

// Pull the spin-out lab gating context for a founder. Returns
// `{ active:false }` for any non-founder or any user that hasn't
// opted into the lab. Also computes the active billing-tier set
// used by `tier_required` filtering.
interface AdvisorGate {
  spinoutLabActive: boolean;
  week: number;                       // 1..4 (defaults to 1)
  completedMilestones: Set<string>;
  tiers: Set<string>;
}
async function loadAdvisorGate(env: Env, user: User): Promise<AdvisorGate> {
  const tiers = new Set<string>();
  const persona = personaFor(user);

  // Tier — investor_pro / generic active subscription.
  try {
    const sub = await env.DB.prepare(
      `SELECT investor_subscription_status, subscription_status FROM users WHERE id = ?`,
    ).bind(user.id).first<{ investor_subscription_status: string | null; subscription_status: string | null }>();
    if (sub?.investor_subscription_status === 'active') tiers.add('investor_pro');
    if (sub?.subscription_status === 'active') tiers.add('subscriber');
  } catch { /* columns may be missing on older dev DBs */ }

  if (persona !== 'founder') {
    return { spinoutLabActive: false, week: 1, completedMilestones: new Set(), tiers };
  }

  let active = false;
  let week = 1;
  try {
    const row = await env.DB.prepare(
      `SELECT spinout_lab_active, spinout_lab_week FROM users WHERE id = ?`,
    ).bind(user.id).first<{ spinout_lab_active: number | null; spinout_lab_week: number | null }>();
    active = Number(row?.spinout_lab_active ?? 0) === 1;
    week = Math.max(1, Math.min(4, Number(row?.spinout_lab_week ?? 1)));
  } catch { /* schema not migrated yet — treat as inactive */ }

  const completed = new Set<string>();
  try {
    const rows = await env.DB.prepare(
      `SELECT milestone_key FROM spinout_lab_milestones WHERE user_id = ?`,
    ).bind(user.id).all<{ milestone_key: string }>();
    for (const r of (rows.results || [])) completed.add(r.milestone_key);
  } catch { /* spinout_lab_milestones absent in dev */ }

  return { spinoutLabActive: active, week, completedMilestones: completed, tiers };
}

// Build the working bank.
//
// AC-1 contract: "persona detection runs first if `users.role` is
// null". So:
//   - role unknown → bank = ROLE_DETECTOR (3 questions; the
//     writeRouter saves primary→users.role, organization→
//     users.organization, headline→users.headline as they land).
//   - role known   → bank = persona bank (organization/headline are
//     optional profile niceties handled by /settings; the advisor
//     does not gate the persona pivot on them).
//
// Once `role_detect.primary` is saved during onboarding, the next
// /answer call re-reads the user, sees the flipped role, and pivots
// straight into the persona bank for the next question. Existing
// role-known users start directly in the persona bank from /start.
function workingBankFor(user: User, gate?: AdvisorGate): Question[] {
  const persona = personaFor(user);
  if (persona === 'unknown') return ROLE_DETECTOR;
  return bankFor(persona, { spinoutLabActive: !!gate?.spinoutLabActive });
}

// IDs of the three detector questions. Used to keep the detector
// active mid-onboarding even after writeRouter flips users.role.
const DETECTOR_IDS: string[] = ROLE_DETECTOR.map((q) => q.id);

// Shared bank-selection logic used by /start, /answer, and /skip
// so detector-pending behaviour is consistent everywhere.
//
// Task #2 (AR) extends AC-1 selectBank with persona-aware splitting
// (founder → newFounderSpinout vs existingFounder via the gate)
// and unlock/week/tier filtering applied via filterByContext. The
// detector-pending behaviour is preserved so a partial role detection
// never lets the user jump into a persona bank prematurely.
function selectBank(
  user: User,
  answered: Set<string>,
  gate: AdvisorGate,
  focus?: string,
): { visible: Question[]; deferred: ReturnType<typeof filterByContext>['deferred'] } {
  const persona = personaFor(user);
  const detectorAnswered = DETECTOR_IDS.filter((id) => answered.has(id)).length;
  const detectorPending = detectorAnswered > 0 && detectorAnswered < DETECTOR_IDS.length;
  if (persona === 'unknown') return { visible: ROLE_DETECTOR, deferred: [] };

  const personaBank = bankFor(persona, { spinoutLabActive: gate.spinoutLabActive });
  // `focus` accepts either a section label (BUILD/CAPITAL/LEGAL/…)
  // or a page_target path (e.g. `/build/discovery`). Section labels
  // are uppercase ASCII; anything else is treated as a page.
  const isPageFocus = !!focus && (focus.startsWith('/') || focus.includes('/'));
  const filtered = filterByContext(personaBank, {
    persona,
    week: gate.week,
    tiers: gate.tiers,
    completedMilestones: gate.completedMilestones,
    focusSection: focus && !isPageFocus ? focus : undefined,
    focusPage: focus && isPageFocus ? focus : undefined,
  });
  // Authored bank order is the canonical sequencing for each
  // persona (investor: identity → sectors/stages → ticket → thesis →
  // pipeline; operating partner: demand → supply; mentor onboarding;
  // new-founder weekly flow). We only re-rank critical-first INSIDE
  // a single focused section — when the user pins one section we
  // want their critical questions for that section to surface first.
  // Without a focus we preserve authored order verbatim.
  const ranked = focus && !isPageFocus
    ? sortByImportance(filtered.visible)
    : filtered.visible;
  if (detectorPending) {
    return { visible: [...ROLE_DETECTOR, ...ranked], deferred: filtered.deferred };
  }
  return { visible: ranked, deferred: filtered.deferred };
}

// ---------------------------------------------------------------------------
// Conversation helpers.
// ---------------------------------------------------------------------------
interface ConversationRow {
  id: number; uid: string; user_id: number; persona: string; state: string;
  current_question_id: string | null;
  total_questions: number; answered_count: number; skipped_count: number;
  created_at: string; updated_at: string;
}

async function getActiveConversation(env: Env, user: User): Promise<ConversationRow | null> {
  // Active = currently in-progress conversation. /start re-uses an
  // active row; if all are complete it kicks off a new one.
  return await env.DB.prepare(
    "SELECT * FROM advisor_conversations WHERE user_id = ? AND state = 'active' ORDER BY id DESC LIMIT 1",
  ).bind(user.id).first<ConversationRow>();
}

async function getLatestConversation(env: Env, user: User): Promise<ConversationRow | null> {
  // Latest of any state — used by /progress so completed users still
  // see 100% on the dashboard ring instead of falling back to zero.
  return await env.DB.prepare(
    "SELECT * FROM advisor_conversations WHERE user_id = ? ORDER BY id DESC LIMIT 1",
  ).bind(user.id).first<ConversationRow>();
}

async function createConversation(env: Env, user: User, totalQs: number, firstQid: string | null): Promise<ConversationRow> {
  const uid = newUid();
  const persona = personaFor(user);
  await env.DB.prepare(
    `INSERT INTO advisor_conversations (uid, user_id, persona, state, current_question_id, total_questions)
       VALUES (?, ?, ?, 'active', ?, ?)`,
  ).bind(uid, user.id, persona, firstQid, totalQs).run();
  const row = await env.DB.prepare(`SELECT * FROM advisor_conversations WHERE uid = ?`).bind(uid).first<ConversationRow>();
  if (!row) throw new Error('failed to create advisor conversation');
  return row;
}

async function answeredQuestionIds(env: Env, conversationId: number): Promise<Set<string>> {
  const rows = await env.DB.prepare(
    `SELECT question_id FROM advisor_answers WHERE conversation_id = ?`,
  ).bind(conversationId).all<{ question_id: string }>();
  return new Set((rows.results || []).map(r => r.question_id));
}

/**
 * Combine in-conversation answers with hydration from existing
 * domain tables so questions whose data is already present aren't
 * re-asked. Hydrated questions get a synthetic `advisor_answers` row
 * with saved_status='saved' on first /start so subsequent visits
 * remain consistent.
 */
async function effectiveAnsweredSet(
  env: Env, user: User, conversationId: number,
): Promise<Set<string>> {
  const fromConv = await answeredQuestionIds(env, conversationId);
  const fromDomain = await hydrateAlreadyAnswered(env, user);
  for (const id of fromDomain) {
    if (fromConv.has(id)) continue;
    try {
      await env.DB.prepare(
        `INSERT INTO advisor_answers
           (conversation_id, user_id, question_id, raw_value, saved_status)
           VALUES (?, ?, ?, '', 'saved')
         ON CONFLICT(conversation_id, question_id) DO NOTHING`,
      ).bind(conversationId, user.id, id).run();
      fromConv.add(id);
    } catch { /* race on the unique index — safe to ignore */ }
  }
  return fromConv;
}

function nextUnansweredQuestion(bank: Question[], answered: Set<string>): Question | null {
  for (const q of bank) if (!answered.has(q.id)) return q;
  return null;
}

function publicQuestion(q: Question | null): Record<string, unknown> | null {
  if (!q) return null;
  return {
    id: q.id,
    persona: q.persona,
    section: q.section || null,
    prompt: q.prompt,
    hint: q.hint,
    input_kind: q.input_kind,
    options: q.options,
    skip_allowed: q.skip_allowed !== false,
    importance: q.importance || 'normal',
    page_target: q.page_target || null,
    doc_anchor: q.doc_anchor || null,
    tier_required: q.tier_required || null,
    persona_filter: q.persona_filter || null,
    unlock_required: q.unlock_required || null,
    followups: Array.isArray(q.followups) ? q.followups : null,
    validate: q.validate || null,
    // Task #3 (AS) — surface evidence requirement to the chat UI
    // so it can prompt for a citation before submitting.
    requires_evidence: q.requires_evidence === true,
  };
}

async function recordMessage(
  env: Env, conversationId: number, role: 'user' | 'assistant' | 'tool' | 'system',
  content: string, questionId?: string | null, meta?: unknown,
  extras?: { safety_score?: number | null; sanitisation_actions?: string[] | null },
): Promise<void> {
  try {
    // Task #4 (AW) — extended row includes safety_score (L0) +
    // sanitisation_actions_json (L3). Falls back to the legacy 5-column
    // INSERT if the new columns aren't yet present (un-migrated dev DB).
    try {
      await env.DB.prepare(
        `INSERT INTO advisor_messages (conversation_id, role, question_id, content, meta_json, safety_score, sanitisation_actions_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        conversationId, role, questionId || null, content,
        meta ? JSON.stringify(meta) : null,
        extras?.safety_score ?? null,
        extras?.sanitisation_actions ? JSON.stringify(extras.sanitisation_actions) : null,
      ).run();
    } catch (e) {
      // Likely "no such column: safety_score" on a stale dev DB — retry
      // with the legacy schema so the conversation history still lands.
      void e;
      await env.DB.prepare(
        `INSERT INTO advisor_messages (conversation_id, role, question_id, content, meta_json)
           VALUES (?, ?, ?, ?, ?)`,
      ).bind(conversationId, role, questionId || null, content, meta ? JSON.stringify(meta) : null).run();
    }
  } catch (e) {
    console.error('[advisor] recordMessage:', (e as Error).message);
  }
}

async function recordAnswer(
  env: Env, conversation: ConversationRow, user: User, questionId: string,
  rawValue: string, result: WriteResult,
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO advisor_answers
         (conversation_id, user_id, question_id, raw_value, saved_to_table, saved_to_column, saved_to_id, saved_status, saved_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(conversation_id, question_id) DO UPDATE SET
         raw_value = excluded.raw_value,
         saved_to_table = excluded.saved_to_table,
         saved_to_column = excluded.saved_to_column,
         saved_to_id = excluded.saved_to_id,
         saved_status = excluded.saved_status,
         saved_error = excluded.saved_error`,
    ).bind(
      conversation.id, user.id, questionId, rawValue,
      result.saved_to?.table || null,
      result.saved_to?.column || null,
      result.saved_to?.id != null ? String(result.saved_to.id) : null,
      result.status,
      result.error || null,
    ).run();
  } catch (e) {
    console.error('[advisor] recordAnswer:', (e as Error).message);
  }
}

// Update total_questions on the conversation row when the working
// bank size changes. Called from /answer and /skip after the
// detector → persona pivot, otherwise total_questions stays at the
// initial value (3, for null-role onboarding) and /progress reports
// percentages > 100 once the user enters the persona bank.
async function syncBankTotal(env: Env, conv: ConversationRow, bankLen: number, persona: string): Promise<void> {
  if (conv.total_questions === bankLen) return;
  await env.DB.prepare(
    `UPDATE advisor_conversations SET total_questions = ?, persona = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(bankLen, persona, conv.id).run();
  conv.total_questions = bankLen;
  conv.persona = persona;
}

async function refreshCounts(env: Env, conversationId: number, currentQid: string | null): Promise<void> {
  try {
    const counts = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN saved_status = 'saved'    THEN 1 ELSE 0 END) AS answered,
         SUM(CASE WHEN saved_status = 'skipped'  THEN 1 ELSE 0 END) AS skipped
       FROM advisor_answers WHERE conversation_id = ?`,
    ).bind(conversationId).first<{ answered: number | null; skipped: number | null }>();
    await env.DB.prepare(
      `UPDATE advisor_conversations
          SET answered_count = ?, skipped_count = ?, current_question_id = ?, updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(
      Number(counts?.answered || 0),
      Number(counts?.skipped || 0),
      currentQid,
      conversationId,
    ).run();
  } catch (e) {
    console.error('[advisor] refreshCounts:', (e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// POST /start  —  open or resume the user's active conversation.
// ---------------------------------------------------------------------------
advisor.post('/start', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  await ensureAdvisorWeekColumn(c.env);
  // Task #4 (AW) L7 — kill switch (env + per-user advisor_locked).
  await ensureGuardrailColumns(c.env);
  const ks = await checkKillSwitch(c.env, user);
  if (ks.blocked) {
    await writeTurnAudit(c.env, {
      userId: user.id, conversationId: null, model: null,
      promptHash: await promptHash(), toolCalls: [], aiSpendUsd: 0,
      safetyScore: null, sanitisationActions: [],
      refusalReason: ks.reason || 'kill_switch', shadowFlagged: false,
    });
    return c.json({ error: ks.message, status: 'refused', reason: ks.reason }, 423);
  }
  // Task #4 (AW) L5 — shadow-flag degradation. Surface the templated
  // refusal across the WHOLE advisor surface, not just /explain, so a
  // flagged user can't sneak in answer writes.
  if (ks.shadow) {
    await writeTurnAudit(c.env, {
      userId: user.id, conversationId: null, model: null,
      promptHash: await promptHash(), toolCalls: [], aiSpendUsd: 0,
      safetyScore: null, sanitisationActions: [],
      refusalReason: 'shadow_flag', shadowFlagged: true,
    });
    return c.json({ error: ks.message, status: 'refused', reason: 'shadow_flag' }, 423);
  }
  const gate = await loadAdvisorGate(c.env, user);

  let conv = await getActiveConversation(c.env, user);
  if (!conv) {
    // For a brand-new conversation there are no prior answers, so
    // selectBank reduces to the workingBankFor result for sizing.
    const initialBank = workingBankFor(user, gate);
    const firstQ = initialBank[0] || null;
    conv = await createConversation(c.env, user, initialBank.length, firstQ?.id || null);
    if (firstQ) await recordMessage(c.env, conv.id, 'assistant', firstQ.prompt, firstQ.id);
  }

  // Resume path: derive the answered set from the conversation
  // first, then pick the bank — this guarantees that if the user
  // answered `role_detect.primary`, closed the tab, and came back,
  // the detector triplet is still served before the persona bank.
  const answered = await effectiveAnsweredSet(c.env, user, conv.id);
  const { visible: bank } = selectBank(user, answered, gate);
  // Workers AI re-ranker (advisor/rerank.ts) on top of the deterministic
  // bank — picks the most contextually relevant unanswered question and
  // suppresses re-asking ids surfaced in the last few turns. Falls back
  // to the legacy first-in-bank order on any failure.
  // pinnedId honours conv.current_question_id so the re-open/refresh
  // path returns the SAME pending question. Without this the rerank
  // recency filter would suppress the just-recorded firstQ assistant
  // message and return a different question (architect-flagged regression).
  const next = await pickNextQuestion(c.env, user.id, conv.id, bank, answered, {
    pinnedId: conv.current_question_id,
  });

  // Refresh counts now that hydration may have inserted new rows.
  await syncBankTotal(c.env, conv, bank.length, personaFor(user));
  await refreshCounts(c.env, conv.id, next?.id || null);
  // If hydration left no remaining questions on the very first
  // open, mark the conversation complete so /progress reflects it.
  if (!next && conv.state !== 'complete') {
    await c.env.DB.prepare(
      `UPDATE advisor_conversations SET state = 'complete', updated_at = datetime('now') WHERE id = ?`,
    ).bind(conv.id).run();
    conv.state = 'complete';
  }
  const refreshed = await c.env.DB.prepare(
    `SELECT answered_count, skipped_count FROM advisor_conversations WHERE id = ?`,
  ).bind(conv.id).first<{ answered_count: number; skipped_count: number }>();
  const ans = Number(refreshed?.answered_count || 0);
  const skp = Number(refreshed?.skipped_count || 0);

  const nextPub = publicQuestion(next);
  return c.json({
    // `conversation_id` is the AC-1 spec field; `conversation_uid`
    // remains as an alias for clients that already shipped against
    // the earlier draft. `next_question` likewise aliases `next`.
    conversation_id: conv.uid,
    conversation_uid: conv.uid,
    persona: personaFor(user),
    progress: {
      total: bank.length, answered: ans, skipped: skp,
      percent: bank.length > 0 ? Math.round(((ans + skp) / bank.length) * 100) : 100,
    },
    next_question: nextPub,
    next: nextPub,
    hint: (nextPub?.hint as string | null | undefined) || null,
    complete: !next,
  });
});

// ---------------------------------------------------------------------------
// Body parsers.
// ---------------------------------------------------------------------------
async function readJson<T>(c: Context<{ Bindings: Env }>): Promise<T | null> {
  try { return await c.req.json() as T; } catch { return null; }
}

interface AnswerBody {
  // AC-1 spec uses `conversation_id`. We also accept `conversation_uid`
  // as a backward-compatible alias for clients that already shipped
  // against the earlier draft. Both fields carry the public uid.
  conversation_id?: string;
  conversation_uid?: string;
  question_id?: string;
  value?: unknown;
  // Task #3 (AS) — optional citation/justification supplied by the
  // LLM `writeAnswer` tool when auto-filling high-risk fields
  // (anything with `requires_evidence: true` on the bank). Direct
  // UI submissions can omit this — the writeRouter falls back to
  // the user-typed value when no question requires evidence.
  evidence?: unknown;
}

// ---------------------------------------------------------------------------
// POST /answer  —  persist an answer and return either:
//   1. JSON (default) — the AC-1 contract envelope
//   2. SSE stream — when the request carries `Accept: text/event-stream`
//      the same payload is emitted as a tool_call → tool_result →
//      next → done sequence (mirrors assistant.ts wire format) so
//      LLM-driven clients can consume it incrementally.
//
// JSON envelope:
//   {
//     conversation_id, conversation_uid, persona,
//     saved_to: { table, column, id, page_url } | null,
//     next_question: { id, prompt, input_kind, options?, hint? } | null,
//     hint: string | null,
//     complete: boolean,
//     progress: { total, answered, skipped, percent },
//     status: 'saved' | 'skipped' | 'paywalled' | 'failed' | 'noop',
//     upgrade_link?: string,
//     error?: string
//   }
//
// Routing is deterministic — the LLM surface is /explain, where
// Anthropic tool-use orchestration belongs (read-only assistant.ts
// pattern; the writeAnswer/explainTopic/openPage tool-use loop
// itself lives in AC-3's chat client which calls these JSON/SSE
// endpoints directly). /answer never burns tokens.
// ---------------------------------------------------------------------------
interface AnswerEnvelope {
  conversation_id: string;
  conversation_uid: string;
  persona: Persona;
  status: WriteResult['status'];
  saved_to: WriteResult['saved_to'] | null;
  next_question: ReturnType<typeof publicQuestion>;
  next: ReturnType<typeof publicQuestion>;
  hint: string | null;
  upgrade_link: string | null;
  error: string | null;
  complete: boolean;
  progress: { total: number; answered: number; skipped: number; percent: number };
}
advisor.post('/answer', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  await ensureGuardrailColumns(c.env);
  // Task #4 (AW) L7 — kill switch first.
  const ks = await checkKillSwitch(c.env, user);
  if (ks.blocked) {
    await writeTurnAudit(c.env, {
      userId: user.id, conversationId: null, model: null,
      promptHash: await promptHash(), toolCalls: [], aiSpendUsd: 0,
      safetyScore: null, sanitisationActions: [],
      refusalReason: ks.reason || 'kill_switch', shadowFlagged: false,
    });
    return c.json({ error: ks.message, status: 'refused', reason: ks.reason }, 423);
  }
  // Task #4 (AW) L5 — shadow-flag degradation. /answer writes user data,
  // so a flagged user must NOT be able to commit answers until an admin
  // clears the flag via /api/admin/advisor-audit/clear-shadow.
  if (ks.shadow) {
    await writeTurnAudit(c.env, {
      userId: user.id, conversationId: null, model: null,
      promptHash: await promptHash(), toolCalls: [], aiSpendUsd: 0,
      safetyScore: null, sanitisationActions: [],
      refusalReason: 'shadow_flag', shadowFlagged: true,
    });
    return c.json({ error: ks.message, status: 'refused', reason: 'shadow_flag' }, 423);
  }
  const body = await readJson<AnswerBody>(c);
  const convUid = body?.conversation_id || body?.conversation_uid;
  if (!convUid || !body.question_id) {
    return c.json({ error: 'conversation_id and question_id are required' }, 400);
  }
  const conv = await c.env.DB.prepare(
    `SELECT * FROM advisor_conversations WHERE uid = ? AND user_id = ?`,
  ).bind(convUid, user.id).first<ConversationRow>();
  if (!conv) return c.json({ error: 'conversation not found' }, 404);

  // Refuse to write a destructive-sounding answer. The frontend chat
  // also rejects these but we defend in depth — the model never sees
  // user-typed strings until we route them.
  const valueStr = String(body.value ?? '').trim();
  // Destructive intent gate. We match imperative phrases ("delete
  // my project", "wipe everything", "cancel the deal") rather than
  // bare verbs so benign mentions like "I want to reset my pricing
  // strategy" or "we cancelled an event last week" pass through.
  // Server-side defence-in-depth — mirrors the system-prompt refusal
  // rules; the dedicated page on the side nav owns these actions.
  const destructiveIntent =
    /\b(delete|remove|drop|truncate|wipe|destroy|void|disband|deactivate|revoke|terminate|purge|erase)\s+(?:the\s+|my\s+|our\s+|this\s+|that\s+|all\s+|every\s+|everything|account|project|deal|company|entity|user|row|record|data|profile|portfolio|fund)\b/i;
  const cancelIntent =
    /\b(cancel|reset)\s+(?:the\s+|my\s+|our\s+|this\s+|that\s+|all\s+|every\s+)?(account|subscription|membership|deal|contract|incorporation|filing|payment|invoice|payout|transfer|password|profile|project|entity|fund|allocation|portfolio)\b/i;
  if (destructiveIntent.test(valueStr) || cancelIntent.test(valueStr)) {
    // Task #4 (AW) L6 — audit destructive refusal so /admin/advisor-audit
    // surfaces the attempt alongside the safety_block / shadow_flag rows.
    await writeTurnAudit(c.env, {
      userId: user.id, conversationId: conv.id, model: null,
      promptHash: await promptHash(), toolCalls: [], aiSpendUsd: 0,
      safetyScore: null, sanitisationActions: [],
      refusalReason: 'destructive', shadowFlagged: false,
    });
    return c.json({
      error: REFUSAL.destructive,
      saved_to: null,
      next_question: null,
      hint: 'Open the page from the side nav and use its dedicated controls for delete / cancel / void.',
    }, 400);
  }

  const q = questionById(body.question_id);
  if (!q) return c.json({ error: 'unknown question_id' }, 400);

  // Task #4 (AW) L0 — input safety classifier (llama-guard-3-8b via
  // aiRouter). Runs on every user-typed value before it touches the
  // write-router or the LLM. A block returns 422 with the canonical
  // jailbreak refusal; the routed write does NOT happen.
  const safety = await classifyInput(c.env, user.id, valueStr);
  if (safety.blocked) {
    await writeTurnAudit(c.env, {
      userId: user.id, conversationId: conv.id,
      model: '@cf/meta/llama-guard-3-8b',
      promptHash: await promptHash(), toolCalls: [],
      aiSpendUsd: 0, safetyScore: safety.score,
      sanitisationActions: [], refusalReason: 'safety_block',
      shadowFlagged: false,
    });
    return c.json({
      error: REFUSAL.jailbreak,
      status: 'refused',
      reason: 'safety_block',
      category: safety.category,
    }, 422);
  }

  // Task #2 (AR) — server-side eligibility check. The client must
  // only submit questions that are currently in the VISIBLE bank
  // (post week/tier/unlock filtering). Detector questions and
  // already-answered IDs are always allowed (re-answer is permitted
  // as an idempotent overwrite). This closes the access-control
  // gap that let a curl client answer a Week-3 question while
  // still on Week-1.
  {
    await ensureAdvisorWeekColumn(c.env);
    const gateNow = await loadAdvisorGate(c.env, user);
    const answeredNow = await effectiveAnsweredSet(c.env, user, conv.id);
    const { visible: visibleNow } = selectBank(user, answeredNow, gateNow);
    const isVisible = visibleNow.some((vq) => vq.id === q.id);
    const isDetector = DETECTOR_IDS.includes(q.id);
    const isReAnswer = answeredNow.has(q.id);
    if (!isVisible && !isDetector && !isReAnswer) {
      return c.json({
        error: 'question_not_available',
        message: 'This question isn\'t available yet — finish earlier milestones first.',
      }, 409);
    }
  }

  // Persist the user turn first so the audit log is consistent even
  // if a downstream step throws. Carries the L0 safety_score so the
  // /admin/advisor-audit page can correlate per-message risk back to
  // the user's chat history.
  await recordMessage(c.env, conv.id, 'user', valueStr, q.id, undefined, {
    safety_score: safety.score,
  });

  // Task #4 (AW) L2 — gate the writeAnswer "tool" call. Persona/tier/
  // rate/cost/arg-shape checks fire before the deterministic write so
  // the same envelope governs scripted (curl) callers as the future
  // LLM-driven AC-3 chat client. L3 sanitiseToolOutput is intentionally
  // NOT wired here — the deterministic /answer flow has no tool output
  // that loops back into a model context; that wrap is exercised by
  // the AV chat client when tool results are fed to Anthropic.
  const gateCtx = {
    user,
    persona: personaFor(user),
    tiers: (await loadAdvisorGate(c.env, user)).tiers,
    conversationId: conv.id,
  };
  const toolGate = await gateToolCall(c.env, gateCtx, 'writeAnswer', {
    question_id: q.id, value: valueStr,
  });
  if (!toolGate.ok) {
    await writeTurnAudit(c.env, {
      userId: user.id, conversationId: conv.id, model: null,
      promptHash: await promptHash(),
      toolCalls: [{ name: 'writeAnswer', gate_result: toolGate.reason }],
      aiSpendUsd: 0, safetyScore: safety.score,
      sanitisationActions: [], refusalReason: `gate_${toolGate.reason}`,
      shadowFlagged: false,
    });
    return c.json({
      error: toolGate.detail || 'tool call rejected',
      status: 'refused',
      reason: toolGate.reason,
    }, toolGate.reason === 'rate_limited' || toolGate.reason === 'cost_exceeded' ? 429 : 403);
  }

  // Task #3 (AS) — pass evidence through verbatim. We deliberately
  // do NOT auto-derive evidence from the answer value, otherwise the
  // gate becomes a no-op for direct UI submissions. When the client
  // omits evidence on a `requires_evidence` question the router
  // returns `status:'needs_evidence'` and we surface a 422 below so
  // the chat UI can render a follow-up prompt.
  const evidenceStr = body.evidence != null ? String(body.evidence).trim() : null;
  const result: WriteResult = valueStr
    ? await routeAnswer(c.env, user, q.id, valueStr, evidenceStr)
    : { status: 'skipped' };

  // Surface evidence-gate / schema-invalid as 4xx so the frontend
  // can run optimistic-rollback + inline retry instead of treating
  // it as a successful turn. We still record the user message above
  // for the audit trail; we do NOT call recordAnswer/advance here.
  if (result.status === 'needs_evidence' || result.status === 'invalid') {
    return c.json({
      conversation_id: conv.uid,
      conversation_uid: conv.uid,
      status: result.status,
      error: result.error,
      hint: result.hint,
      evidence_kind: result.evidence_kind,
      field: result.field || q.id,
      open_url: result.open_url || q.page_target || null,
      saved_to: null,
      next_question: publicQuestion(q),
      next: publicQuestion(q),
    }, 422);
  }

  // Task #3 (AS) — atomic post-write batch. D1 doesn't expose
  // BEGIN/COMMIT for raw SQL but `env.DB.batch([...])` runs the
  // statements in a single implicit transaction (all-or-nothing
  // commit). We batch advisor_answers + (on saved) field_sources
  // + activity_logs so a partial-write can't leave the audit
  // tables out of sync with the routed write above. The routed
  // write itself already happened inside routeAnswer; if any of
  // these fail we log but don't roll the routed write back, since
  // re-trying the user's chat turn would otherwise duplicate it.
  try {
    const stmts: D1PreparedStatement[] = [];
    stmts.push(c.env.DB.prepare(
      `INSERT INTO advisor_answers
         (conversation_id, user_id, question_id, raw_value, saved_to_table, saved_to_column, saved_to_id, saved_status, saved_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(conversation_id, question_id) DO UPDATE SET
         raw_value = excluded.raw_value,
         saved_to_table = excluded.saved_to_table,
         saved_to_column = excluded.saved_to_column,
         saved_to_id = excluded.saved_to_id,
         saved_status = excluded.saved_status,
         saved_error = excluded.saved_error`,
    ).bind(
      conv.id, user.id, q.id, valueStr,
      result.saved_to?.table || null,
      result.saved_to?.column || null,
      result.saved_to?.id != null ? String(result.saved_to.id) : null,
      result.status,
      result.error || null,
    ));
    if (result.status === 'saved') {
      stmts.push(c.env.DB.prepare(
        `INSERT INTO field_sources
           (user_id, question_id, page_target, saved_to_table, saved_to_column, saved_to_id, source, evidence_text, filled_at)
           VALUES (?, ?, ?, ?, ?, ?, 'advisor', ?, datetime('now'))
         ON CONFLICT(user_id, question_id) DO UPDATE SET
           page_target = excluded.page_target,
           saved_to_table = excluded.saved_to_table,
           saved_to_column = excluded.saved_to_column,
           saved_to_id = excluded.saved_to_id,
           source = excluded.source,
           evidence_text = excluded.evidence_text,
           filled_at = excluded.filled_at`,
      ).bind(
        user.id, q.id, q.page_target || null,
        result.saved_to?.table || null,
        result.saved_to?.column || null,
        result.saved_to?.id != null ? String(result.saved_to.id) : null,
        evidenceStr,
      ));
      const actorHash = await hashEmail(user.email || '');
      stmts.push(c.env.DB.prepare(
        `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
      ).bind(
        'advisor_field_filled',
        JSON.stringify({
          question_id: q.id,
          page: q.page_target || null,
          saved_to: result.saved_to || null,
          conversation_uid: conv.uid,
        }),
        actorHash,
        user.id,
      ));
    }
    await c.env.DB.batch(stmts);
  } catch (e) {
    // Best-effort fallback: if the batch failed (e.g. legacy DB
    // without field_sources before ensureSchema ran), retry the
    // bare advisor_answers write so the conversation history is
    // still persisted.
    console.warn('[advisor] post-answer batch failed', (e as Error).message);
    await recordAnswer(c.env, conv, user, q.id, valueStr, result);
    if (result.status === 'saved') {
      await recordFieldSource(
        c.env, user.id, q.id, q.page_target || null,
        result.saved_to || null, 'advisor', evidenceStr,
      );
    }
  }

  // Task #6 (CB) — state-machine side effects (counter bump,
  // advisor.answered activity_log emit, optional week advancement).
  // Best-effort: failures here MUST NOT break the user's chat turn.
  if (result.status === 'saved') {
    try {
      const gateForSE = await loadAdvisorGate(c.env, user);
      // Pass completedMilestones so the catalog-based week-advance
      // path (architect review item #2) can fire when this answer
      // satisfies the last milestone of the user's current week.
      await smOnAnswered(c.env, user.id, q, valueStr, gateForSE.week, gateForSE.completedMilestones);
    } catch (e) {
      console.warn('[advisor] smOnAnswered failed', (e as Error).message);
    }
  }

  // Task #6 (AT-1) — fan-out the MI extractors over this answer.
  // Best-effort: opt-out is honored inside the worker, queue failures
  // never block the user's chat turn. Only enqueue on `saved` writes
  // so we don't aggregate paywalled / failed entries.
  if (result.status === 'saved' && valueStr) {
    try {
      let answerId: number | null = null;
      try {
        const r = await c.env.DB.prepare(
          `SELECT id FROM advisor_answers WHERE conversation_id = ? AND question_id = ?`,
        ).bind(conv.id, q.id).first<{ id: number }>();
        answerId = r?.id ?? null;
      } catch { /* best-effort */ }
      await enqueueJob(c.env, 'mi_extract', {
        user_id: user.id,
        persona: conv.persona || (user.role || 'unknown'),
        question_id: q.id,
        raw_value: valueStr,
        advisor_answer_id: answerId,
      });
    } catch (e) {
      console.warn('[advisor] mi_extract enqueue failed', (e as Error).message);
    }
  }

  // Re-fetch the user if the role-detector just changed persona so
  // the next bank reflects the new role.
  let liveUser = user;
  if (q.id === 'role_detect.primary' && result.status === 'saved') {
    const fresh = await c.env.DB.prepare(
      `SELECT id, email, name, role, founder_id FROM users WHERE id = ?`,
    ).bind(user.id).first<User>();
    if (fresh) liveUser = { ...user, ...fresh };
  }

  await ensureAdvisorWeekColumn(c.env);
  const gate = await loadAdvisorGate(c.env, liveUser);
  const answered = await effectiveAnsweredSet(c.env, liveUser, conv.id);
  const { visible: bank } = selectBank(liveUser, answered, gate);
  // Task #6 (CB) — deterministic next-question selection via the
  // state machine. Replaces the legacy AI re-rank (pickNextQuestion)
  // so /answer obeys the same composite ranking + anti-repeat rules
  // as /turn. We pass `extraAnswered: answered` so the just-saved
  // (and any hydrated) ids are honoured even before the cross-conv
  // read inside nextTurn sees them.
  const turn = await smNextTurn(c.env, liveUser.id, bank, {
    week: gate.week,
    completedMilestones: gate.completedMilestones,
    extraAnswered: answered,
  });
  const next = turn.next_question;
  await syncBankTotal(c.env, conv, bank.length, personaFor(liveUser));
  await refreshCounts(c.env, conv.id, next?.id || null);

  if (!next) {
    await c.env.DB.prepare(
      `UPDATE advisor_conversations SET state = 'complete', updated_at = datetime('now') WHERE id = ?`,
    ).bind(conv.id).run();
  } else {
    await recordMessage(c.env, conv.id, 'assistant', next.prompt, next.id);
  }

  // Task #4 (AW) L5 — a successful commit resets the per-day
  // "explains without commit" counter so heavy legitimate explain
  // usage doesn't trip the shadow flag.
  if (result.status === 'saved') {
    try {
      const store = (c.env as unknown as { TOKENS?: KVNamespace }).TOKENS;
      if (store) {
        const k = `advisor:ewc:${user.id}:${new Date().toISOString().slice(0, 10)}`;
        await store.delete(k);
      }
    } catch { /* best-effort */ }
  }

  // Task #4 (AW) L6 — every successful turn writes one audit row so
  // /admin/advisor-audit can show the full conversation timeline (not
  // just refusals).
  await writeTurnAudit(c.env, {
    userId: user.id, conversationId: conv.id, model: null,
    promptHash: await promptHash(),
    toolCalls: [{ name: 'writeAnswer', status: result.status }],
    aiSpendUsd: 0, safetyScore: safety.score,
    sanitisationActions: [], refusalReason: null,
    shadowFlagged: false,
  });

  const counts = await c.env.DB.prepare(
    `SELECT answered_count, skipped_count FROM advisor_conversations WHERE id = ?`,
  ).bind(conv.id).first<{ answered_count: number; skipped_count: number }>();
  const ans = Number(counts?.answered_count || 0);
  const skp = Number(counts?.skipped_count || 0);
  const nextPub = publicQuestion(next);

  // Task #1 (CD) — fan out page-fill + advisor-progress events to the
  // OnboardingChat DO (per-user room) so any page subscribed via
  // /api/onboarding/ws/:user_id can re-hydrate its sparkle indicators
  // and the dashboard progress ring updates without polling. Best-effort
  // — failures are swallowed inside notify*.
  if (result.status === 'saved') {
    const total = conv.total_questions || bank.length || 0;
    const percent = total > 0 ? Math.round(((ans + skp) / total) * 100) : 0;
    // Both notify* swallow their own errors and Promise.allSettled
    // never rejects, so no outer try/catch is needed here.
    await Promise.allSettled([
      notifyAdvisorPageFill(c.env, user.id, q.page_target || null, {
        question_id: q.id,
        saved_to: result.saved_to || null,
      }),
      notifyAdvisorProgress(c.env, user.id, {
        total, answered: ans, skipped: skp, percent,
      }),
    ]);
  }

  const envelope: AnswerEnvelope = {
    conversation_id: conv.uid,
    conversation_uid: conv.uid,
    persona: personaFor(liveUser),
    status: result.status,
    saved_to: result.saved_to || null,
    next_question: nextPub,
    next: nextPub,
    hint: result.hint || (nextPub?.hint as string | null | undefined) || null,
    upgrade_link: result.upgrade_link || null,
    error: result.error || null,
    complete: !next,
    progress: {
      total: bank.length, answered: ans, skipped: skp,
      percent: bank.length > 0 ? Math.round(((ans + skp) / bank.length) * 100) : 100,
    },
  };

  // SSE branch — clients that prefer streaming get the same payload
  // as a tool_call → tool_result → next → done sequence so the
  // AC-3 chat client can reuse the assistant.ts SSE parser. The
  // deterministic write has already happened above; SSE is purely
  // a wire-format choice.
  const accept = (c.req.header('accept') || '').toLowerCase();
  if (accept.includes('text/event-stream')) {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(sseEvent('tool_call', {
          name: 'writeAnswer', input: { question_id: q.id, value: valueStr },
        })));
        controller.enqueue(enc.encode(sseEvent('tool_result', {
          name: 'writeAnswer',
          status: envelope.status,
          saved_to: envelope.saved_to,
          hint: envelope.hint,
          upgrade_link: envelope.upgrade_link,
          error: envelope.error,
        })));
        controller.enqueue(enc.encode(sseEvent('next', { question: nextPub })));
        controller.enqueue(enc.encode(sseEvent('done', envelope)));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      },
    });
  }
  return c.json(envelope);
});

// ---------------------------------------------------------------------------
// POST /skip  —  record a skip and advance.
// ---------------------------------------------------------------------------
advisor.post('/skip', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const body = await readJson<{ conversation_id?: string; conversation_uid?: string; question_id?: string }>(c);
  const convUidS = body?.conversation_id || body?.conversation_uid;
  if (!convUidS || !body?.question_id) {
    return c.json({ error: 'conversation_id and question_id are required' }, 400);
  }
  const conv = await c.env.DB.prepare(
    `SELECT * FROM advisor_conversations WHERE uid = ? AND user_id = ?`,
  ).bind(convUidS, user.id).first<ConversationRow>();
  if (!conv) return c.json({ error: 'conversation not found' }, 404);

  const q = questionById(body.question_id);
  if (!q) return c.json({ error: 'unknown question_id' }, 400);
  if (q.skip_allowed === false) return c.json({ error: 'this question cannot be skipped' }, 400);

  // Task #2 (AR) — same eligibility gate as /answer.
  await ensureAdvisorWeekColumn(c.env);
  const gate = await loadAdvisorGate(c.env, user);
  {
    const answeredNow = await effectiveAnsweredSet(c.env, user, conv.id);
    const { visible: visibleNow } = selectBank(user, answeredNow, gate);
    const isVisible = visibleNow.some((vq) => vq.id === q.id);
    const isDetector = DETECTOR_IDS.includes(q.id);
    if (!isVisible && !isDetector) {
      return c.json({
        error: 'question_not_available',
        message: 'This question isn\'t available yet — finish earlier milestones first.',
      }, 409);
    }
  }

  await recordAnswer(c.env, conv, user, q.id, '', { status: 'skipped' });
  await recordMessage(c.env, conv.id, 'user', '(skipped)', q.id);

  // Use the shared selectBank helper so skipping detector question
  // 2 does not let the user jump into the persona bank before
  // detector question 3 is served.
  const answered = await effectiveAnsweredSet(c.env, user, conv.id);
  const { visible: bank } = selectBank(user, answered, gate);
  // Task #6 (CB) — deterministic next-question selection via the
  // state machine. /skip writes a `saved_status='skipped'` row, so
  // by the time nextTurn loads cross-conversation answered ids the
  // skipped question is already in `answered` — extraAnswered is a
  // belt-and-braces guard against same-isolate read lag.
  const turn = await smNextTurn(c.env, user.id, bank, {
    week: gate.week,
    completedMilestones: gate.completedMilestones,
    extraAnswered: answered,
  });
  const next = turn.next_question;
  await syncBankTotal(c.env, conv, bank.length, personaFor(user));
  await refreshCounts(c.env, conv.id, next?.id || null);
  if (!next) {
    await c.env.DB.prepare(
      `UPDATE advisor_conversations SET state = 'complete', updated_at = datetime('now') WHERE id = ?`,
    ).bind(conv.id).run();
  } else {
    await recordMessage(c.env, conv.id, 'assistant', next.prompt, next.id);
  }
  // /progress envelope inline so the AC-3 client can refresh
  // per-page rings without a second round-trip after a skip.
  const counts = await c.env.DB.prepare(
    `SELECT answered_count, skipped_count FROM advisor_conversations WHERE id = ?`,
  ).bind(conv.id).first<{ answered_count: number; skipped_count: number }>();
  const ans = Number(counts?.answered_count || 0);
  const skp = Number(counts?.skipped_count || 0);
  return c.json({
    conversation_uid: conv.uid,
    next: publicQuestion(next),
    next_question: publicQuestion(next),
    complete: !next,
    progress: {
      total: bank.length, answered: ans, skipped: skp,
      percent: bank.length > 0 ? Math.round(((ans + skp) / bank.length) * 100) : 100,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /sources  —  Task #3 (AS) field-source attribution for the
// per-page <AdvisorFilledBanner> + sparkle icons. Optional ?page=
// query filters to a single page_target so the dashboard can fan
// out one-call-per-page without overpulling.
// ---------------------------------------------------------------------------
advisor.get('/sources', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const page = (c.req.query('page') || '').trim() || null;
  try {
    const stmt = page
      ? c.env.DB.prepare(
          `SELECT question_id, page_target, saved_to_table, saved_to_column, saved_to_id,
                  source, evidence_text, filled_at
             FROM field_sources WHERE user_id = ? AND page_target = ?
             ORDER BY filled_at DESC LIMIT 200`,
        ).bind(user.id, page)
      : c.env.DB.prepare(
          `SELECT question_id, page_target, saved_to_table, saved_to_column, saved_to_id,
                  source, evidence_text, filled_at
             FROM field_sources WHERE user_id = ?
             ORDER BY filled_at DESC LIMIT 500`,
        ).bind(user.id);
    const rows = await stmt.all<{
      question_id: string; page_target: string | null;
      saved_to_table: string | null; saved_to_column: string | null;
      saved_to_id: string | null; source: string; evidence_text: string | null;
      filled_at: string;
    }>();
    // Decorate with the bank's human-readable prompt so the
    // banner can list field labels without a second round-trip.
    const sources = (rows.results || []).map((r) => {
      const q = questionById(r.question_id);
      return {
        ...r,
        label: q?.prompt || r.question_id,
        section: q?.section || null,
      };
    });
    return c.json({ page, sources });
  } catch (e) {
    console.error('[advisor] /sources:', (e as Error).message);
    return c.json({ page, sources: [] });
  }
});

// ---------------------------------------------------------------------------
// GET /next-question?focus=SECTION  —  return the next visible
// question pinned to a section (BUILD/CAPITAL/LEGAL/NETWORK or any
// persona-defined section). Used by the per-page progress rail's
// "drill in" affordance.
// ---------------------------------------------------------------------------
advisor.get('/next-question', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  await ensureAdvisorWeekColumn(c.env);
  const focus = (c.req.query('focus') || '').trim() || undefined;
  const gate = await loadAdvisorGate(c.env, user);
  const conv = await getActiveConversation(c.env, user);
  if (!conv) {
    return c.json({ next: null, next_question: null, complete: true });
  }
  const answered = await effectiveAnsweredSet(c.env, user, conv.id);
  const { visible: bank } = selectBank(user, answered, gate, focus);
  // Re-rank via Workers AI (see rerank.ts) — focused /next-question path.
  // pinnedId honours conv.current_question_id so a poll/refresh before
  // /answer or /skip returns the SAME pending question (idempotence).
  // When focus is set, only honour the pin if the pinned question is
  // in-focus (selectBank already applied the focus filter to `bank`,
  // so the helper's "pinnedId must be in bank" check handles this).
  const next = await pickNextQuestion(c.env, user.id, conv.id, bank, answered, {
    pinnedId: conv.current_question_id,
  });
  return c.json({
    persona: personaFor(user),
    focus: focus || null,
    next: publicQuestion(next),
    next_question: publicQuestion(next),
    complete: !next,
  });
});

// ---------------------------------------------------------------------------
// GET /progress  —  per-page + per-section + overall completion.
// Task #2 (AR) replaces the earlier flat envelope with a structured
// shape consumed by the right-rail progress bars. Backward-compatible
// flat fields remain on the top level so existing clients keep
// working through one rollout cycle.
// ---------------------------------------------------------------------------
advisor.get('/progress', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  await ensureAdvisorWeekColumn(c.env);
  const gate = await loadAdvisorGate(c.env, user);
  const persona = personaFor(user);
  const personaBank = workingBankFor(user, gate);
  // Match the served advisor flow: rings count against the
  // currently-VISIBLE bank, not locked/deferred questions, so the
  // /progress envelope stays consistent with /next-question and
  // doesn't strand users at <100% behind unmet unlock_required gates.
  const filtered = filterByContext(personaBank, {
    persona,
    week: gate.week,
    tiers: gate.tiers,
    completedMilestones: gate.completedMilestones,
  });
  const visibleBank = filtered.visible;

  // Use the LATEST conversation regardless of state so the dashboard
  // ring keeps showing 100% / complete after the user finishes.
  const conv = await getLatestConversation(c.env, user);
  const answered: Set<string> = conv ? await answeredQuestionIds(c.env, conv.id) : new Set();
  const savedSet: Set<string> = new Set();
  if (conv) {
    const rows = await c.env.DB.prepare(
      `SELECT question_id FROM advisor_answers WHERE conversation_id = ? AND saved_status = 'saved'`,
    ).bind(conv.id).all<{ question_id: string }>();
    for (const r of (rows.results || [])) savedSet.add(r.question_id);
  }

  // Per-page progress.
  const byPage = groupByPage(visibleBank).map((g) => ({
    page: g.page,
    doc_anchor: g.doc_anchor || null,
    total: g.ids.length,
    answered: g.ids.filter((id) => savedSet.has(id)).length,
  })).map((g) => ({
    ...g,
    percent: g.total > 0 ? Math.round((g.answered / g.total) * 100) : 0,
  }));

  // Per-section progress.
  const bySection = groupBySection(visibleBank).map((g) => ({
    section: g.section,
    total: g.ids.length,
    answered: g.ids.filter((id) => savedSet.has(id)).length,
  })).map((g) => ({
    ...g,
    percent: g.total > 0 ? Math.round((g.answered / g.total) * 100) : 0,
  }));

  // Overall — counts include skipped to preserve the AC-1 contract
  // (skipped questions count toward "done" for the dashboard ring).
  // Total tracks the VISIBLE bank so locked questions don't pull
  // the percentage down.
  const total = visibleBank.length;
  const deferredCount = filtered.deferred.length;
  const ans = Number(conv?.answered_count || 0);
  const skp = Number(conv?.skipped_count || 0);
  const overallPct = total > 0 ? Math.round(((ans + skp) / total) * 100) : 100;

  return c.json({
    persona: personaFor(user),
    conversation_id: conv?.uid || null,
    conversation_uid: conv?.uid || null,
    by_page: byPage,
    by_section: bySection,
    overall: {
      total, answered: ans, skipped: skp, percent: overallPct,
      deferred: deferredCount,
      complete: conv?.state === 'complete' || (!!conv && total > 0 && ans + skp >= total),
    },
    spinout_lab: gate.spinoutLabActive
      ? { active: true, week: gate.week }
      : { active: false, week: null },
    // Legacy flat fields — kept for one rollout cycle.
    total, answered: ans, skipped: skp, percent: overallPct,
    complete: conv?.state === 'complete',
    current_question_id: conv?.current_question_id || null,
    // Surface answered count even for users with no /start yet.
    _answered_in_conversation: answered.size,
  });
});

// ---------------------------------------------------------------------------
// GET /manifest  —  question manifest for the current persona.
//
// The frontend right-rail and section picker derive their structure
// from this manifest so the server stays the source of truth.
// Returns the visible bank (post-filter) plus the deferred metadata
// so the UI can show "Unlocks in Week 3" hints without guessing.
// ---------------------------------------------------------------------------
advisor.get('/manifest', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  await ensureAdvisorWeekColumn(c.env);
  const gate = await loadAdvisorGate(c.env, user);
  const persona = personaFor(user);

  const personaBank = workingBankFor(user, gate);
  const filtered = filterByContext(personaBank, {
    persona,
    week: gate.week,
    tiers: gate.tiers,
    completedMilestones: gate.completedMilestones,
  });

  // Include both `visible` and `deferred` so the UI can render
  // greyed-out preview rows for not-yet-unlocked questions.
  const publicQs = filtered.visible.map((q) => publicQuestion(q));
  const deferred = filtered.deferred.map((d) => ({
    question: publicQuestion(d.question),
    reason: d.reason,
    detail: d.detail || null,
  }));

  // Section + page indices.
  const sections = groupBySection(filtered.visible).map((g) => ({
    section: g.section, ids: g.ids,
  }));
  const pages = groupByPage(filtered.visible).map((g) => ({
    page: g.page, doc_anchor: g.doc_anchor || null, ids: g.ids,
  }));

  return c.json({
    persona,
    bank: gate.spinoutLabActive ? 'newFounderSpinout' : (
      persona === 'founder' ? 'existingFounder' :
      persona === 'partner' ? 'operatingPartner' :
      persona
    ) as BankName | string,
    spinout_lab: { active: gate.spinoutLabActive, week: gate.week },
    questions: publicQs,
    deferred,
    sections,
    pages,
  });
});

// ---------------------------------------------------------------------------
// GET /conversations/:uid  —  full Q&A trail for a conversation.
// ---------------------------------------------------------------------------
// AC-1 spec uses `/conversations/:id`; older clients hit
// `/conversations/:uid`. Both routes share a single handler that
// looks the conversation up by its public uid (the only ID we expose
// outside the worker).
async function conversationDetailHandler(c: Context<{ Bindings: Env }>): Promise<Response> {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const uid = c.req.param('id') || c.req.param('uid');
  if (!uid) return c.json({ error: 'conversation id required' }, 400);
  const conv = await c.env.DB.prepare(
    `SELECT * FROM advisor_conversations WHERE uid = ? AND user_id = ?`,
  ).bind(uid, user.id).first<ConversationRow>();
  if (!conv) return c.json({ error: 'conversation not found' }, 404);
  const messages = await c.env.DB.prepare(
    `SELECT role, question_id, content, meta_json, created_at FROM advisor_messages WHERE conversation_id = ? ORDER BY id ASC`,
  ).bind(conv.id).all<{ role: string; question_id: string | null; content: string; meta_json: string | null; created_at: string }>();
  const answers = await c.env.DB.prepare(
    `SELECT question_id, raw_value, saved_to_table, saved_to_column, saved_to_id, saved_status, saved_error, created_at
       FROM advisor_answers WHERE conversation_id = ? ORDER BY id ASC`,
  ).bind(conv.id).all<{ question_id: string; raw_value: string | null; saved_to_table: string | null; saved_to_column: string | null; saved_to_id: string | null; saved_status: string; saved_error: string | null; created_at: string }>();
  return c.json({
    conversation_id: conv.uid,
    conversation_uid: conv.uid,
    persona: conv.persona,
    state: conv.state,
    progress: {
      total: conv.total_questions,
      answered: conv.answered_count,
      skipped: conv.skipped_count,
    },
    messages: messages.results || [],
    answers: answers.results || [],
  });
}
advisor.get('/conversations/:id', conversationDetailHandler);

// ---------------------------------------------------------------------------
// POST /explain  —  SSE stream of a free-form LLM explanation.
//
// Body: { topic: string, conversation_uid?: string }
// Stream events:
//   provider { model, provider, fallback_used, cached }   (Task #16)
//   delta    { text }
//   done     { leaked }
//   error    { message }
// Routed via aiRouter task='advisor_explain'. Workers AI is the always-on
// primary; Anthropic claude-sonnet-4-6 is the narrow last-resort fallback
// (also retried when stripVerbatimLeak detects an unsafe Workers AI
// completion and ANTHROPIC_API_KEY is configured). Provider can be
// flipped via the ADVISOR_EXPLAIN_PROVIDER env (workers-ai|auto|anthropic).
// /explain is still the ONLY free-form LLM surface in AC-1; /answer is
// deterministic so we don't burn tokens routing structured data.
// ---------------------------------------------------------------------------
function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

advisor.post('/explain', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  await ensureGuardrailColumns(c.env);
  // Task #4 (AW) L7 — kill switch (env-wide + per-user lock).
  const ks = await checkKillSwitch(c.env, user);
  if (ks.blocked) {
    await writeTurnAudit(c.env, {
      userId: user.id, conversationId: null, model: null,
      promptHash: await promptHash(), toolCalls: [], aiSpendUsd: 0,
      safetyScore: null, sanitisationActions: [],
      refusalReason: ks.reason || 'kill_switch', shadowFlagged: false,
    });
    return c.json({ error: ks.message, status: 'refused', reason: ks.reason }, 423);
  }
  // Task #16 — Workers AI primary; the legacy 503-when-no-Anthropic-key
  // guard is gone because env.AI is universally bound on the worker.
  // The aiRouter still gracefully refuses (with budget/refusal usage
  // rows) if every model in the chain fails.
  const body = await readJson<{ topic?: string; question_id?: string; conversation_id?: string; conversation_uid?: string }>(c);
  const topic = String(body?.topic || '').trim().slice(0, 500);
  if (!topic) return c.json({ error: 'topic is required' }, 400);

  // Task #4 (AW) L0 — input safety classifier on the topic.
  const safety = await classifyInput(c.env, user.id, topic);
  if (safety.blocked) {
    await writeTurnAudit(c.env, {
      userId: user.id, conversationId: null,
      model: '@cf/meta/llama-guard-3-8b',
      promptHash: await promptHash(), toolCalls: [],
      aiSpendUsd: 0, safetyScore: safety.score,
      sanitisationActions: [], refusalReason: 'safety_block',
      shadowFlagged: false,
    });
    return c.json({
      error: REFUSAL.jailbreak,
      status: 'refused',
      reason: 'safety_block',
      category: safety.category,
    }, 422);
  }
  // Task #4 (AW) L5 — bump the explains-without-commit counter now;
  // the full anomaly check (which needs conversationId for the
  // distinct-tools-this-session signal) runs once we've resolved the
  // conversation row below.
  await bumpExplainsWithoutCommit(c.env, user.id);
  // Task #2 (AR) — when an explicit `question_id` is supplied, the
  // explanation must be constrained to a question the user can
  // currently see (persona/week/tier/unlock filtered). Topic-only
  // requests remain free-form for backward compatibility (e.g.
  // explaining a doc anchor or page concept), but if a caller
  // names a specific question we refuse to explain hidden ones —
  // otherwise the LLM would leak the existence of upgrade-gated
  // or future-week content.
  const requestedQid = body?.question_id ? String(body.question_id).trim() : '';
  if (requestedQid) {
    const answeredRows = await c.env.DB.prepare(
      `SELECT question_id FROM advisor_answers WHERE user_id = ?`,
    ).bind(user.id).all<{ question_id: string }>();
    const answered = new Set<string>((answeredRows.results || []).map((r) => r.question_id));
    const gate = await loadAdvisorGate(c.env, user);
    const { visible } = selectBank(user, answered, gate, undefined);
    if (!visible.some((q) => q.id === requestedQid)) {
      return c.json({ error: 'question_not_available' }, 409);
    }
  }
  // Per AC-1 the LLM is shown only the topic + persona context — never
  // free-form user-typed answer text. Strip prompt-injection markers
  // (system tags, role overrides) defensively before they reach the
  // model (Workers AI primary, Anthropic fallback).
  const safeTopic = topic
    .replace(/<\/?(system|assistant|user|tool[^>]*)>/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\b(ignore (all|previous) instructions|disregard the system prompt)\b/gi, '[filtered]')
    .slice(0, 500);

  // Build the prompt. We deliberately do NOT pass any sensitive answer
  // content from advisor_answers (PII, financial data) — the LLM only
  // sees the topic + persona context.
  // Task #4 (AW) L1 — single source of truth for the system prompt
  // lives in services/advisor/guardrails.ts (ADVISOR_SYSTEM_PROMPT).
  // Hashed via promptHash() into advisor_turn_audit so prompt revisions
  // can be correlated across the audit log.
  const persona = personaFor(user);
  const systemPromptText = `${ADVISOR_SYSTEM_PROMPT}\n\nUser context: role=${persona}, name=${user.name || 'unknown'}.`;

  const conversationUid = (body?.conversation_id || body?.conversation_uid) ? String(body?.conversation_id || body?.conversation_uid) : null;
  let conversationId: number | null = null;
  if (conversationUid) {
    const conv = await c.env.DB.prepare(
      `SELECT id FROM advisor_conversations WHERE uid = ? AND user_id = ?`,
    ).bind(conversationUid, user.id).first<{ id: number }>();
    if (conv) conversationId = Number(conv.id);
  }
  if (conversationId) {
    await recordMessage(c.env, conversationId, 'user', `[explain] ${safeTopic}`, null, undefined, {
      safety_score: safety.score,
    });
  }

  // Task #4 (AW) L5 — full anomaly check now that conversationId is known.
  const anomaly = await bumpAnomalyAndCheck(c.env, user.id, topic, conversationId);

  // Task #4 (AW) L5 — when the per-user shadow flag is set we degrade
  // to a templated SSE reply instead of calling Anthropic. The audit
  // row records the soft-block so admins can see the activity in
  // /admin/advisor-audit?flagged=1.
  if (ks.shadow || anomaly.shadow) {
    await writeTurnAudit(c.env, {
      userId: user.id, conversationId, model: null,
      promptHash: await promptHash(), toolCalls: [], aiSpendUsd: 0,
      safetyScore: safety.score, sanitisationActions: [],
      refusalReason: 'shadow_flag', shadowFlagged: true,
    });
    if (conversationId) {
      await recordMessage(c.env, conversationId, 'assistant', REFUSAL.shadow, null, { kind: 'explain', topic: safeTopic, shadow: true });
    }
    const enc = new TextEncoder();
    const body = enc.encode(sseEvent('delta', { text: REFUSAL.shadow }) + sseEvent('done', { reason: 'shadow_flag' }));
    return new Response(body, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      },
    });
  }

  // Task #16 — Route through aiRouter. Workers AI is the always-on
  // primary; Anthropic claude-sonnet-4-6 is the narrow last-resort
  // fallback (or primary if ADVISOR_EXPLAIN_PROVIDER='anthropic'). We
  // intentionally do NOT request a streaming response: Task #4 (AW) L1
  // requires the full text be buffered before stripVerbatimLeak runs,
  // and explanations are capped at ~120 words so the wall-clock cost
  // of buffering is negligible (sub-second on llama-3.3-70b-fp8-fast).
  // The output below is then re-emitted as a single SSE delta event so
  // the React consumer's wire format is unchanged.
  const ai = await aiRouterRun(c.env, {
    task: 'advisor_explain',
    userId: user.id,
    systemPrompt: systemPromptText,
    messages: [{ role: 'user', content: safeTopic }],
    maxTokens: EXPLAIN_MAX_TOKENS,
  });

  if (!ai.ok) {
    // Task #4 (AW) L6 — even upstream failures get one audit row so
    // admins can correlate model outages / budget refusals with
    // user-visible 502s.
    await writeTurnAudit(c.env, {
      userId: user.id, conversationId,
      model: ai.usage?.model || null,
      promptHash: await promptHash(), toolCalls: [],
      aiSpendUsd: ai.usage?.est_cost_usd || 0,
      safetyScore: safety.score,
      sanitisationActions: [],
      refusalReason: ai.refusal || 'upstream_error',
      shadowFlagged: false,
    });
    const status = ai.refusal && ai.refusal.startsWith('budget_') ? 429
      : ai.refusal === 'kill_switch' ? 423
      : 502;
    return c.json({
      error: ai.refusal === 'kill_switch'
        ? 'AI budget exhausted — try again later.'
        : (ai.error || 'upstream LLM error'),
      reason: ai.refusal || 'upstream_error',
    }, status);
  }

  let collected = String(ai.output || '');
  let { text: safeOut, leaked } = stripVerbatimLeak(collected);
  let usage = ai.usage;
  let unsafeRetryUsed = false;
  // Task #16 — unsafe-completion fallback. When stripVerbatimLeak
  // flags the primary response AND we used a Workers AI model AND an
  // Anthropic key is configured, retry once via Anthropic. Anthropic
  // claude-sonnet-4-6 has stronger instruction-following on the
  // "stay-on-StudioOS-scope" guardrail, so it's likely to produce a
  // clean answer where the smaller llama leaked. If Anthropic is
  // unavailable or also leaks we keep the original templated refusal.
  if (
    leaked
    && (usage?.model || '').startsWith('@cf/')
    && !!(c.env as unknown as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY
  ) {
    const retry = await aiRouterRun(c.env, {
      task: 'advisor_explain',
      userId: user.id,
      systemPrompt: systemPromptText,
      messages: [{ role: 'user', content: safeTopic }],
      maxTokens: EXPLAIN_MAX_TOKENS,
      forceProvider: 'anthropic',
    });
    if (retry.ok) {
      const retryCollected = String(retry.output || '');
      const retryScan = stripVerbatimLeak(retryCollected);
      if (!retryScan.leaked) {
        collected = retryCollected;
        safeOut = retryScan.text;
        leaked = false;
        usage = retry.usage;
        unsafeRetryUsed = true;
      }
    }
  }
  // Single delta + done — the client sees a "typing finished"
  // beat instead of incremental tokens, in exchange for a hard
  // guarantee that no leaked text ever crossed the wire.
  const finalText = leaked
    ? 'I can only discuss your StudioOS data and your current advisor questions. Want me to help with one of those?'
    : safeOut;
  const modelUsed = usage?.model || 'unknown';
  // Task #16 — surface which model actually answered so the React UI
  // can render a small "(fallback)" badge when the Workers AI primary
  // hop missed and Anthropic (or a smaller llama sibling) was used.
  // Cached responses (cached:true) come back without fallback_used so
  // the badge stays accurate.
  const providerEvent = {
    model: modelUsed,
    provider: modelUsed.startsWith('@cf/') ? 'workers-ai' as const : 'anthropic' as const,
    fallback_used: !!usage?.fallback_used || unsafeRetryUsed,
    cached: !!usage?.cached,
  };

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(enc.encode(sseEvent('provider', providerEvent)));
        if (finalText) {
          controller.enqueue(enc.encode(sseEvent('delta', { text: finalText })));
        }
        controller.enqueue(enc.encode(sseEvent('done', { leaked })));
        if (conversationId && finalText) {
          await recordMessage(
            c.env, conversationId, 'assistant', finalText, null,
            { kind: 'explain', topic: safeTopic, leaked, model: modelUsed, provider: providerEvent.provider },
          );
        }
        await writeTurnAudit(c.env, {
          userId: user.id, conversationId,
          model: modelUsed,
          promptHash: await promptHash(), toolCalls: [],
          aiSpendUsd: usage?.est_cost_usd || 0,
          safetyScore: safety.score,
          sanitisationActions: [
            ...(leaked ? ['verbatim_leak_stripped'] : []),
            ...(unsafeRetryUsed ? ['unsafe_completion_anthropic_retry'] : []),
          ],
          refusalReason: leaked ? 'verbatim_leak' : null,
          shadowFlagged: false,
        });
      } catch (e) {
        controller.enqueue(enc.encode(sseEvent('error', { message: (e as Error).message })));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
});

// ---------------------------------------------------------------------------
// Task #5 (AV) — Find & deep-link tool registry.
// ---------------------------------------------------------------------------
//
// POST /api/advisor/tool — { name, args } body. Runs gateToolCall (persona
// /tier/rate/cost/arg shape), executes the tool from the registry, audit-logs
// to advisor_messages (role='tool') + activity_logs, and returns the tool's
// {result, cta} envelope. Tier-failures redirect to surfacePaywall so the
// chatbot always returns a routable CTA instead of a hard refusal.
//
// GET /api/advisor/tools — returns the JSON-schema list the LLM uses.
// ---------------------------------------------------------------------------

advisor.get('/tools', async (c) => {
  await requireAuth(c);
  return c.json({ tools: TOOL_SCHEMAS });
});

advisor.post('/tool', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  await ensureGuardrailColumns(c.env);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body?.name || '').trim();
  const rawArgs = body?.args;
  const args: Record<string, unknown> = (rawArgs && typeof rawArgs === 'object') ? rawArgs as Record<string, unknown> : {};

  if (!isToolName(name)) {
    return c.json({ error: 'unknown tool', status: 'refused', reason: 'unknown_tool' }, 400);
  }

  // Re-use the active conversation so distinct-tools-per-session counters
  // (L5 anomaly detector) are conversation-scoped. /tool can be called
  // before /start so we lazily mint a conversation if none exists.
  let conv = await getActiveConversation(c.env, user);
  if (!conv) {
    conv = await createConversation(c.env, user, 0, null);
  }

  const gate = await loadAdvisorGate(c.env, user);
  const persona = personaFor(user);
  const gateCtx = {
    user,
    persona,
    tiers: gate.tiers,
    conversationId: conv.id,
  };
  const toolCtx = { ...gateCtx, env: c.env };

  // Persist the request as a user-role message so the audit trail captures
  // intent even when the gate refuses below.
  const reqContent = `tool:${name} ${JSON.stringify(args).slice(0, 400)}`;
  await recordMessage(c.env, conv.id, 'user', reqContent, undefined, { tool_name: name });

  const gateResult = await gateToolCall(c.env, gateCtx, name, args);

  let envelope: ToolEnvelope;
  let effectiveTool: string = name;
  let degradedToPaywall = false;

  if (!gateResult.ok) {
    // Tier-failure → surface upgrade CTA instead of a raw refusal so the
    // chatbot can always render a routable action.
    if (gateResult.reason === 'tier_required' && persona !== 'admin') {
      effectiveTool = 'surfacePaywall';
      degradedToPaywall = true;
      // Map the internal tier label (`subscriber`) back to the
      // user-facing upgrade flow name (`studio`) so the CTA route
      // points at /billing/upgrade?feature=…&tier=studio.
      const internalTier = gateResult.detail || 'subscriber';
      const userFacingTier = internalTier === 'subscriber' ? 'studio' : internalTier;
      envelope = await executeTool(toolCtx, 'surfacePaywall', {
        feature: name,
        required_tier: userFacingTier,
      });
    } else {
      const status = gateResult.reason === 'rate_limited' || gateResult.reason === 'cost_exceeded' ? 429
        : gateResult.reason === 'no_conversation' ? 409
        : 403;
      await writeTurnAudit(c.env, {
        userId: user.id, conversationId: conv.id, model: null,
        promptHash: await promptHash(),
        toolCalls: [{ name, gate_result: gateResult.reason }],
        aiSpendUsd: 0, safetyScore: null,
        sanitisationActions: [], refusalReason: `gate_${gateResult.reason}`,
        shadowFlagged: false,
      });
      await recordMessage(c.env, conv.id, 'tool', `refused:${gateResult.reason}`, undefined, {
        tool_name: name, gate_reason: gateResult.reason,
      });
      return c.json({
        error: gateResult.detail || 'tool call rejected',
        status: 'refused',
        reason: gateResult.reason,
      }, status);
    }
  } else {
    try {
      envelope = await executeTool(toolCtx, name, args);
    } catch (e) {
      console.error('[advisor.tool] execute failed', name, (e as Error).message);
      await writeTurnAudit(c.env, {
        userId: user.id, conversationId: conv.id, model: null,
        promptHash: await promptHash(),
        toolCalls: [{ name, error: (e as Error).message }],
        aiSpendUsd: 0, safetyScore: null,
        sanitisationActions: [], refusalReason: 'tool_error',
        shadowFlagged: false,
      });
      return c.json({ error: 'tool execution failed', status: 'error' }, 500);
    }
  }

  // Append a role='tool' message with the JSON envelope so /conversations/:id
  // can render the CTA again after a reload.
  await recordMessage(
    c.env, conv.id, 'tool',
    JSON.stringify(envelope).slice(0, 4000),
    undefined,
    { tool_name: effectiveTool, degraded: degradedToPaywall ? 1 : 0 },
  );

  // activity_logs row — actor is the email_hash per Task T22.1 (never plaintext).
  try {
    const actorHash = await hashEmail((user as User).email || '');
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind(
      'advisor.tool',
      JSON.stringify({ tool: effectiveTool, requested: name, route: envelope.cta?.route }).slice(0, 500),
      actorHash, user.id,
    ).run();
  } catch { /* activity_logs may not exist on dev DB */ }

  await writeTurnAudit(c.env, {
    userId: user.id, conversationId: conv.id, model: null,
    promptHash: await promptHash(),
    toolCalls: [{ name: effectiveTool, requested: name, route: envelope.cta?.route, degraded: degradedToPaywall }],
    aiSpendUsd: 0, safetyScore: null,
    sanitisationActions: [], refusalReason: null,
    shadowFlagged: false,
  });

  return c.json({
    status: 'ok',
    tool: effectiveTool,
    requested_tool: name,
    degraded_to_paywall: degradedToPaywall,
    conversation_uid: conv.uid,
    result: envelope.result,
    cta: envelope.cta,
  });
});

// ---------------------------------------------------------------------------
// POST /api/advisor/tool/auto — LLM tool-binding entry point.
//
// Body: { message: string }
// The router calls aiRouter.run({ task: 'tool_call', … }) with TOOL_SCHEMAS
// in the system prompt; the model returns a strict JSON {name, args}
// envelope which we validate, then dispatch through the same gated
// pipeline as POST /tool. On parse / validation failure we degrade to
// `openPage` with the user's text as the search topic so the chatbot still
// produces a routable CTA. This is the wired entry point that satisfies
// the Task #5 (AV) requirement for aiRouter.run('tool_call') tool-binding.
// ---------------------------------------------------------------------------
const TOOL_CALL_SYSTEM_PROMPT = [
  'You are the Axal StudioOS routing layer. The user types a free-form request;',
  'you choose ONE tool from the registry that best satisfies it. Reply with',
  'STRICT JSON only — no prose, no code fences — of the form',
  '{"name":"<toolName>","args":{...}}. The args object MUST conform to the',
  'tool\'s JSON schema. If nothing fits, return',
  '{"name":"openPage","args":{"route":"/dashboard"}}.',
  '',
  'Available tools:',
  TOOL_SCHEMAS.map((t) => `- ${t.name}: ${t.description}\n  args schema: ${JSON.stringify(t.parameters)}`).join('\n'),
].join('\n');

advisor.post('/tool/auto', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  await ensureGuardrailColumns(c.env);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const message = String(body?.message || '').trim();
  if (!message || message.length > 2000) {
    return c.json({ error: 'message required (1..2000 chars)' }, 400);
  }

  // Step 1 — let the LLM pick the tool.
  let pickedName: import('../services/advisor/tools').ToolName = 'openPage';
  let pickedArgs: Record<string, unknown> = { route: '/dashboard' };
  let llmRefusal: string | null = null;
  try {
    const r = await aiRouterRun(c.env, {
      task: 'tool_call',
      userId: user.id,
      systemPrompt: TOOL_CALL_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: message }],
      maxTokens: 256,
      temperature: 0,
    });
    if (!r.ok) {
      llmRefusal = r.refusal || 'router_failed';
    } else {
      const raw = (r.output || '').trim();
      // Strip ``` fences if the model added them despite the system prompt.
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === 'object' && typeof parsed.name === 'string' && isToolName(parsed.name)) {
        pickedName = parsed.name;
        pickedArgs = (parsed.args && typeof parsed.args === 'object') ? parsed.args : {};
      } else {
        llmRefusal = 'invalid_tool_envelope';
      }
    }
  } catch (e) {
    llmRefusal = `parse_failed:${(e as Error).message.slice(0, 80)}`;
  }

  // Step 2 — dispatch through the same gated pipeline as POST /tool.
  let conv = await getActiveConversation(c.env, user);
  if (!conv) conv = await createConversation(c.env, user, 0, null);

  const gate = await loadAdvisorGate(c.env, user);
  const persona = personaFor(user);
  const gateCtx = { user, persona, tiers: gate.tiers, conversationId: conv.id };
  const toolCtx = { ...gateCtx, env: c.env };

  await recordMessage(c.env, conv.id, 'user', message, undefined, {
    via: 'tool_auto',
    llm_picked: pickedName,
    llm_refusal: llmRefusal,
  });

  const gateResult = await gateToolCall(c.env, gateCtx, pickedName, pickedArgs);
  let envelope: ToolEnvelope;
  let effectiveTool = pickedName;
  let degradedToPaywall = false;

  if (!gateResult.ok) {
    if (gateResult.reason === 'tier_required' && persona !== 'admin') {
      effectiveTool = 'surfacePaywall';
      degradedToPaywall = true;
      const internalTier = gateResult.detail || 'subscriber';
      const userFacingTier = internalTier === 'subscriber' ? 'studio' : internalTier;
      envelope = await executeTool(toolCtx, 'surfacePaywall', {
        feature: pickedName,
        required_tier: userFacingTier,
      });
    } else {
      const status = gateResult.reason === 'rate_limited' || gateResult.reason === 'cost_exceeded' ? 429
        : gateResult.reason === 'no_conversation' ? 409 : 403;
      await recordMessage(c.env, conv.id, 'tool', `refused:${gateResult.reason}`, undefined, {
        tool_name: pickedName, gate_reason: gateResult.reason, via: 'tool_auto',
      });
      return c.json({
        error: gateResult.detail || 'tool call rejected',
        status: 'refused', reason: gateResult.reason,
        requested_tool: pickedName, llm_refusal: llmRefusal,
      }, status);
    }
  } else {
    try {
      envelope = await executeTool(toolCtx, pickedName, pickedArgs);
    } catch (e) {
      console.error('[advisor.tool/auto] execute failed', pickedName, (e as Error).message);
      return c.json({ error: 'tool execution failed', status: 'error', requested_tool: pickedName }, 500);
    }
  }

  await recordMessage(
    c.env, conv.id, 'tool',
    JSON.stringify(envelope).slice(0, 4000),
    undefined,
    { tool_name: effectiveTool, degraded: degradedToPaywall ? 1 : 0, via: 'tool_auto' },
  );

  // Mirror /tool's observability: activity_logs (email_hash per T22.1)
  // + writeTurnAudit so the LLM-bound entry point shows up in the same
  // dashboards / audit trails as the deterministic /tool path.
  try {
    const actorHash = await hashEmail((user as User).email || '');
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind(
      'advisor.tool.auto',
      JSON.stringify({
        tool: effectiveTool, requested: pickedName,
        route: envelope.cta?.route, llm_refusal: llmRefusal,
      }).slice(0, 500),
      actorHash, user.id,
    ).run();
  } catch { /* activity_logs may not exist on dev DB */ }

  await writeTurnAudit(c.env, {
    userId: user.id, conversationId: conv.id, model: '@cf/qwen/qwen2.5-coder-32b-instruct',
    promptHash: await promptHash(),
    toolCalls: [{
      name: effectiveTool, requested: pickedName,
      route: envelope.cta?.route, degraded: degradedToPaywall,
      via: 'tool_auto',
    }],
    aiSpendUsd: 0, safetyScore: null,
    sanitisationActions: [], refusalReason: llmRefusal,
    shadowFlagged: false,
  });

  return c.json({
    status: 'ok',
    tool: effectiveTool,
    requested_tool: pickedName,
    degraded_to_paywall: degradedToPaywall,
    llm_refusal: llmRefusal,
    conversation_uid: conv.uid,
    result: envelope.result,
    cta: envelope.cta,
  });
});

// ---------------------------------------------------------------------------
// Task #6 (CB) — Personal Advisor conversation state machine endpoints.
//
// These two routes wrap the deterministic selector in
// `services/advisor/stateMachine.ts`. They co-exist with the legacy
// `/start`, `/next-question`, `/progress` endpoints (which the AC-3
// chat client still polls) so the rollout is additive — no client
// breakage. New clients call /turn for the next question + a queue
// preview; /queue returns the same ranking without registering an
// "asked" timestamp (purely a peek).
// ---------------------------------------------------------------------------
async function buildVisibleBank(c: Context<{ Bindings: Env }>, focus: string | null) {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  await ensureAdvisorWeekColumn(c.env);
  const gate = await loadAdvisorGate(c.env, user);
  // Build the answered set from BOTH (a) advisor_answers across every
  // conversation this user has had and (b) hydration of existing
  // domain-table values. Architect flagged that the prior call to
  // effectiveAnsweredSet(..., -1) silently dropped hydrated answers
  // when the user had no active conversation — /turn would then
  // re-surface questions whose data already lives on a domain row.
  // We deliberately bypass the synthetic advisor_answers write that
  // effectiveAnsweredSet does (it requires a real conversation FK);
  // /turn is read-only on its hydration path.
  const conv = await getActiveConversation(c.env, user);
  const fromAnswers = conv
    ? await effectiveAnsweredSet(c.env, user, conv.id).catch(() => new Set<string>())
    : await smLoadAnsweredForUser(c.env, user.id);
  // Hydrate domain-table answers regardless of whether a conversation
  // exists. effectiveAnsweredSet already does this for the
  // active-conv path, but the hydrated row write requires a real
  // conversation FK; we still want those ids in the answered set so
  // ranking never re-asks them — architect review item #1.
  const fromDomain = await hydrateAlreadyAnswered(c.env, user).catch(() => new Set<string>());
  const answered = new Set<string>([...fromAnswers, ...fromDomain]);
  const { visible, deferred } = selectBank(user, answered, gate, focus || undefined);
  // Treat focus as a page only when it looks page-shaped (starts with
  // `/`) — otherwise the state machine's focus_boost would never fire
  // (it compares against page_target). Section-pinned flows already
  // got their critical-first ordering inside selectBank().
  const focusPage = focus && (focus.startsWith('/') || focus.includes('/')) ? focus : null;
  return { user, visible, deferred, answered, gate, focusPage };
}

advisor.post('/turn', async (c) => {
  const focus = (c.req.query('focus') || '').trim() || null;
  const { user, visible, deferred, answered, gate, focusPage } = await buildVisibleBank(c, focus);
  const result = await smNextTurn(c.env, user.id, visible, {
    focusPage,
    week: gate.week,
    completedMilestones: gate.completedMilestones,
    extraAnswered: answered,
  });
  return c.json({
    persona: personaFor(user),
    focus: focus || null,
    next_question: publicQuestion(result.next_question),
    queue: result.queue.map(smPublicCandidate),
    // Tier-blocked questions surface as paywall CTAs, not as
    // questions — spec "Done looks like" condition.
    paywall_ctas: smPaywallCtas(deferred),
    complete: !result.next_question,
  });
});

advisor.get('/queue', async (c) => {
  const focus = (c.req.query('focus') || '').trim() || null;
  const { user, visible, deferred, answered, gate, focusPage } = await buildVisibleBank(c, focus);
  // /queue is a read-only peek — we want the ranking but NOT to
  // register an asked-at timestamp (that would spuriously suppress
  // the same questions on the next /turn). So we replicate nextTurn's
  // pure path without calling markAsked.
  const {
    pickNext, loadAnsweredForUser, loadRecentlyAsked, loadRecentActivityPages,
    ANTI_REPEAT_WINDOW_MS, RECENT_ACTIVITY_WINDOW_MS,
  } = await import('../services/advisor/stateMachine');
  const now = Date.now();
  const fromAnswers = await loadAnsweredForUser(c.env, user.id);
  const mergedAnswered = new Set<string>([...fromAnswers, ...answered]);
  const recentlyAsked = await loadRecentlyAsked(c.env, user.id, now - ANTI_REPEAT_WINDOW_MS);
  const recentActivityPages = await loadRecentActivityPages(c.env, user.id, now - RECENT_ACTIVITY_WINDOW_MS);
  const result = pickNext(visible, mergedAnswered, {
    focusPage,
    week: gate.week,
    completedMilestones: gate.completedMilestones,
    recentlyAsked,
    recentActivityPages,
    now,
  });
  return c.json({
    persona: personaFor(user),
    focus: focus || null,
    next_question: publicQuestion(result.next),
    queue: result.queue.map(smPublicCandidate),
    paywall_ctas: smPaywallCtas(deferred),
    complete: !result.next,
  });
});

// Re-export for tests / debug.
export { smNextTurn, smOnAnswered };

export default advisor;
