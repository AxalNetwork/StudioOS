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
 *                                         requested topic. Optional —
 *                                         returns 503 if ANTHROPIC_API_KEY
 *                                         is not configured.
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
  type Persona,
  type Question,
} from '../services/advisor/questionBank';
import { routeAnswer, hydrateAlreadyAnswered, type WriteResult } from '../services/advisor/writeRouter';

const advisor = new Hono<{ Bindings: Env }>();

// LLM model used for /explain. Per AC-1 we use Sonnet for the explain
// surface so concept walkthroughs match the depth of the broader
// in-app assistant. Override via ANTHROPIC_EXPLAIN_MODEL env var.
const EXPLAIN_MODEL_DEFAULT = 'claude-sonnet-4-5-20250929';
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

// Build the working bank. ROLE_DETECTOR (primary / organization /
// headline — three questions) is always prepended so that a user
// starting from null `users.role` is taken through all three
// detector questions before the conversation pivots to their
// persona bank. Critically, this still holds AFTER the writeRouter
// flips users.role on `role_detect.primary` — the next two detector
// questions remain in the bank ahead of the persona questions and
// nextUnansweredQuestion() picks them up first.
//
// For users whose role + organization + headline are already set on
// the users row (e.g. signup wizard or back-fill), hydration in
// /start pre-marks every detector question as answered, so they
// skip the detector entirely and start in their persona bank.
function workingBankFor(user: User): Question[] {
  const persona = personaFor(user);
  if (persona === 'unknown') return ROLE_DETECTOR;
  return [...ROLE_DETECTOR, ...bankFor(persona)];
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
  return await env.DB.prepare(
    "SELECT * FROM advisor_conversations WHERE user_id = ? AND state = 'active' ORDER BY id DESC LIMIT 1",
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
    prompt: q.prompt,
    hint: q.hint,
    input_kind: q.input_kind,
    options: q.options,
    skip_allowed: q.skip_allowed !== false,
  };
}

async function recordMessage(
  env: Env, conversationId: number, role: 'user' | 'assistant' | 'tool' | 'system',
  content: string, questionId?: string | null, meta?: unknown,
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO advisor_messages (conversation_id, role, question_id, content, meta_json)
         VALUES (?, ?, ?, ?, ?)`,
    ).bind(conversationId, role, questionId || null, content, meta ? JSON.stringify(meta) : null).run();
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

  const bank = workingBankFor(user);
  let conv = await getActiveConversation(c.env, user);
  if (!conv) {
    const firstQ = bank[0] || null;
    conv = await createConversation(c.env, user, bank.length, firstQ?.id || null);
    if (firstQ) await recordMessage(c.env, conv.id, 'assistant', firstQ.prompt, firstQ.id);
  }

  const answered = await effectiveAnsweredSet(c.env, user, conv.id);
  const next = nextUnansweredQuestion(bank, answered);

  // Refresh counts now that hydration may have inserted new rows.
  await refreshCounts(c.env, conv.id, next?.id || null);
  if (conv.total_questions !== bank.length) {
    await c.env.DB.prepare(
      `UPDATE advisor_conversations SET total_questions = ?, persona = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(bank.length, personaFor(user), conv.id).run();
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
  // Destructive verbs are routed to the relevant page rather than
  // executed via the chat. The list mirrors the system-prompt
  // refusal rules so server-side defence-in-depth and the LLM agree.
  // Length cap removed — the regex matches anywhere in the answer.
  if (/\b(delete|remove|drop|truncate|wipe|destroy|void|cancel|disband|deactivate|revoke|terminate|purge|erase|reset)\b/i.test(valueStr)) {
    return c.json({
      error: 'Destructive actions must be performed from the relevant page directly.',
      saved_to: null,
      next_question: null,
      hint: 'Open the page from the side nav and use its dedicated controls for delete / cancel / void.',
    }, 400);
  }

  const q = questionById(body.question_id);
  if (!q) return c.json({ error: 'unknown question_id' }, 400);

  // Persist the user turn first so the audit log is consistent even
  // if a downstream step throws.
  await recordMessage(c.env, conv.id, 'user', valueStr, q.id);

  const result: WriteResult = valueStr
    ? await routeAnswer(c.env, user, q.id, valueStr)
    : { status: 'skipped' };
  await recordAnswer(c.env, conv, user, q.id, valueStr, result);

  // Re-fetch the user if the role-detector just changed persona so
  // the next bank reflects the new role.
  let liveUser = user;
  if (q.id === 'role_detect.primary' && result.status === 'saved') {
    const fresh = await c.env.DB.prepare(
      `SELECT id, email, name, role, founder_id FROM users WHERE id = ?`,
    ).bind(user.id).first<User>();
    if (fresh) liveUser = { ...user, ...fresh };
  }

  const bank = workingBankFor(liveUser);
  const answered = await effectiveAnsweredSet(c.env, liveUser, conv.id);
  const next = nextUnansweredQuestion(bank, answered);
  await refreshCounts(c.env, conv.id, next?.id || null);

  if (!next) {
    await c.env.DB.prepare(
      `UPDATE advisor_conversations SET state = 'complete', updated_at = datetime('now') WHERE id = ?`,
    ).bind(conv.id).run();
  } else {
    await recordMessage(c.env, conv.id, 'assistant', next.prompt, next.id);
  }

  const counts = await c.env.DB.prepare(
    `SELECT answered_count, skipped_count FROM advisor_conversations WHERE id = ?`,
  ).bind(conv.id).first<{ answered_count: number; skipped_count: number }>();
  const ans = Number(counts?.answered_count || 0);
  const skp = Number(counts?.skipped_count || 0);
  const nextPub = publicQuestion(next);

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

  await recordAnswer(c.env, conv, user, q.id, '', { status: 'skipped' });
  await recordMessage(c.env, conv.id, 'user', '(skipped)', q.id);

  const bank = workingBankFor(user);
  const answered = await answeredQuestionIds(c.env, conv.id);
  const next = nextUnansweredQuestion(bank, answered);
  await refreshCounts(c.env, conv.id, next?.id || null);
  if (!next) {
    await c.env.DB.prepare(
      `UPDATE advisor_conversations SET state = 'complete', updated_at = datetime('now') WHERE id = ?`,
    ).bind(conv.id).run();
  } else {
    await recordMessage(c.env, conv.id, 'assistant', next.prompt, next.id);
  }
  return c.json({
    conversation_uid: conv.uid,
    next: publicQuestion(next),
    complete: !next,
  });
});

// ---------------------------------------------------------------------------
// GET /progress  —  cheap polling endpoint for the dashboard widget.
// ---------------------------------------------------------------------------
advisor.get('/progress', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const bank = workingBankFor(user);
  const conv = await getActiveConversation(c.env, user);
  if (!conv) {
    return c.json({
      persona: personaFor(user), conversation_uid: null,
      total: bank.length, answered: 0, skipped: 0, percent: 0, complete: false,
    });
  }
  const total = bank.length;
  const answered = Number(conv.answered_count || 0);
  const skipped = Number(conv.skipped_count || 0);
  return c.json({
    persona: personaFor(user),
    conversation_uid: conv.uid,
    total, answered, skipped,
    percent: total > 0 ? Math.round(((answered + skipped) / total) * 100) : 100,
    complete: conv.state === 'complete',
    current_question_id: conv.current_question_id,
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
//   delta { text }
//   done  {}
//   error { message }
// Returns 503 if ANTHROPIC_API_KEY is not configured. The /explain
// surface is the ONLY LLM-touching endpoint in AC-1; /answer is
// deterministic so we don't burn tokens routing structured data.
// ---------------------------------------------------------------------------
function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

advisor.post('/explain', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'advisor explanations are not configured' }, 503);
  }
  const body = await readJson<{ topic?: string; conversation_id?: string; conversation_uid?: string }>(c);
  const topic = String(body?.topic || '').trim().slice(0, 500);
  if (!topic) return c.json({ error: 'topic is required' }, 400);
  // Per AC-1 the LLM is shown only the topic + persona context — never
  // free-form user-typed answer text. Strip prompt-injection markers
  // (system tags, role overrides) defensively before they reach
  // Anthropic.
  const safeTopic = topic
    .replace(/<\/?(system|assistant|user|tool[^>]*)>/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\b(ignore (all|previous) instructions|disregard the system prompt)\b/gi, '[filtered]')
    .slice(0, 500);

  // Build the prompt. We deliberately do NOT pass any sensitive answer
  // content from advisor_answers (PII, financial data) — the LLM only
  // sees the topic + persona context.
  const persona = personaFor(user);
  const system = [
    {
      type: 'text' as const,
      text: `You are the Axal StudioOS personal advisor explaining a single in-app concept to the current user. Keep replies under 120 words. Use plain language and short bullet lists. NEVER request or repeat sensitive personal data. Refuse destructive actions: explain that the user must perform delete/void/cancel from the relevant page.`,
      cache_control: { type: 'ephemeral' as const },
    },
    { type: 'text' as const, text: `User context: role=${persona}, name=${user.name || 'unknown'}.` },
  ];

  const conversationUid = (body?.conversation_id || body?.conversation_uid) ? String(body?.conversation_id || body?.conversation_uid) : null;
  let conversationId: number | null = null;
  if (conversationUid) {
    const conv = await c.env.DB.prepare(
      `SELECT id FROM advisor_conversations WHERE uid = ? AND user_id = ?`,
    ).bind(conversationUid, user.id).first<{ id: number }>();
    if (conv) conversationId = Number(conv.id);
  }
  if (conversationId) await recordMessage(c.env, conversationId, 'user', `[explain] ${safeTopic}`);

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': c.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: c.env.ANTHROPIC_EXPLAIN_MODEL || EXPLAIN_MODEL_DEFAULT,
      max_tokens: EXPLAIN_MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: safeTopic }],
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const errBody = await upstream.text().catch(() => '');
    return c.json({ error: 'upstream LLM error', detail: errBody.slice(0, 200) }, 502);
  }

  // Pipe Anthropic's SSE stream into our wire format. We translate
  // their `content_block_delta` text events to our `delta` events and
  // collect the full text for persistence in advisor_messages.
  // The reader is hoisted into closure scope so the stream's
  // cancel() hook can release the upstream socket if the client
  // disconnects mid-stream.
  const reader = upstream.body!.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const dec = new TextDecoder();
      let buffer = '';
      let collected = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += dec.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            try {
              const evt = JSON.parse(payload);
              if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
                const t = String(evt.delta.text || '');
                if (t) {
                  collected += t;
                  controller.enqueue(enc.encode(sseEvent('delta', { text: t })));
                }
              }
            } catch {
              // ignore unparseable lines
            }
          }
        }
        controller.enqueue(enc.encode(sseEvent('done', {})));
        if (conversationId && collected) {
          await recordMessage(c.env, conversationId, 'assistant', collected, null, { kind: 'explain', topic: safeTopic });
        }
      } catch (e) {
        controller.enqueue(enc.encode(sseEvent('error', { message: (e as Error).message })));
      } finally {
        try { reader.releaseLock(); } catch {}
        controller.close();
      }
    },
    async cancel() {
      // Client hung up — release the upstream Anthropic socket so we
      // don't leak the read on the worker isolate.
      try { await reader.cancel(); } catch {}
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

export default advisor;
