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

// LLM model used for /explain. Mirrors the assistant.ts default so we
// share Anthropic prompt-cache pages where possible.
const MODEL_DEFAULT = 'claude-haiku-4-5-20251001';
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

// Build the working bank for the conversation: when role is unknown
// the role-detector triplet is asked first; once role is set the
// detector is suppressed so users with an existing role aren't
// re-asked. Hydration in /start additionally pre-marks
// role_detect.* questions as answered when the underlying users.role
// / organization / headline columns are already populated.
function workingBankFor(user: User): Question[] {
  const persona = personaFor(user);
  if (persona === 'unknown') return ROLE_DETECTOR;
  return bankFor(persona);
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

  return c.json({
    conversation_uid: conv.uid,
    persona: personaFor(user),
    progress: {
      total: bank.length, answered: ans, skipped: skp,
      percent: bank.length > 0 ? Math.round(((ans + skp) / bank.length) * 100) : 100,
    },
    // `next_question` is the AC-1 spec name; `next` is kept as an
    // alias for older clients that already shipped against it.
    next_question: publicQuestion(next),
    next: publicQuestion(next),
    hint: next?.hint || null,
    complete: !next,
  });
});

// ---------------------------------------------------------------------------
// Body parsers.
// ---------------------------------------------------------------------------
async function readJson<T>(c: Context<{ Bindings: Env }>): Promise<T | null> {
  try { return await c.req.json() as T; } catch { return null; }
}

interface AnswerBody { conversation_uid?: string; question_id?: string; value?: unknown }

// ---------------------------------------------------------------------------
// POST /answer  —  persist an answer, route it through the
// write-router, and stream the result + next question over SSE.
//
// Wire format (one event per line):
//   tool_call    { name: 'writeAnswer', input: { question_id, value } }
//   tool_result  { name: 'writeAnswer', saved_to, status, hint?, upgrade_link?, error? }
//   next         { question }            — null when complete
//   done         { conversation_uid, persona, complete, progress, saved_to, hint?, next_question }
//   error        { message }
//
// The "tool_call/tool_result" shape mirrors the assistant.ts agentic
// loop so the AC-3 client code can reuse the same SSE parser. /answer
// itself does NOT call Anthropic — the routing is deterministic — so
// the "tool" here is the in-process writeAnswer fn rather than an
// LLM-driven tool_use.
// ---------------------------------------------------------------------------
advisor.post('/answer', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const body = await readJson<AnswerBody>(c);
  if (!body?.conversation_uid || !body.question_id) {
    return c.json({ error: 'conversation_uid and question_id are required' }, 400);
  }
  const conv = await c.env.DB.prepare(
    `SELECT * FROM advisor_conversations WHERE uid = ? AND user_id = ?`,
  ).bind(body.conversation_uid, user.id).first<ConversationRow>();
  if (!conv) return c.json({ error: 'conversation not found' }, 404);

  // Refuse to write a destructive-sounding answer. The frontend chat
  // also rejects these but we defend in depth — the model never sees
  // user-typed strings until we route them.
  const valueStr = String(body.value ?? '').trim();
  if (/\b(delete|drop|truncate|wipe|destroy)\b/i.test(valueStr) && valueStr.length < 60) {
    return c.json({
      error: 'Destructive actions must be performed from the relevant page directly.',
    }, 400);
  }

  const q = questionById(body.question_id);
  if (!q) return c.json({ error: 'unknown question_id' }, 400);

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Persist the user turn first so the audit log is consistent
        // even if a downstream step throws.
        await recordMessage(c.env, conv.id, 'user', valueStr, q.id);

        controller.enqueue(enc.encode(sseEvent('tool_call', {
          name: 'writeAnswer', input: { question_id: q.id, value: valueStr },
        })));

        const result: WriteResult = valueStr
          ? await routeAnswer(c.env, user, q.id, valueStr)
          : { status: 'skipped' };
        await recordAnswer(c.env, conv, user, q.id, valueStr, result);

        controller.enqueue(enc.encode(sseEvent('tool_result', {
          name: 'writeAnswer',
          status: result.status,
          saved_to: result.saved_to || null,
          hint: result.hint || null,
          upgrade_link: result.upgrade_link || null,
          error: result.error || null,
        })));

        // Re-fetch the user if the role-detector just changed persona.
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
        controller.enqueue(enc.encode(sseEvent('next', { question: nextPub })));
        controller.enqueue(enc.encode(sseEvent('done', {
          conversation_uid: conv.uid,
          persona: personaFor(liveUser),
          complete: !next,
          saved_to: result.saved_to || null,
          hint: result.hint || (nextPub?.hint as string | null | undefined) || null,
          next_question: nextPub,
          progress: {
            total: bank.length, answered: ans, skipped: skp,
            percent: bank.length > 0 ? Math.round(((ans + skp) / bank.length) * 100) : 100,
          },
        })));
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
// POST /skip  —  record a skip and advance.
// ---------------------------------------------------------------------------
advisor.post('/skip', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const body = await readJson<{ conversation_uid?: string; question_id?: string }>(c);
  if (!body?.conversation_uid || !body.question_id) {
    return c.json({ error: 'conversation_uid and question_id are required' }, 400);
  }
  const conv = await c.env.DB.prepare(
    `SELECT * FROM advisor_conversations WHERE uid = ? AND user_id = ?`,
  ).bind(body.conversation_uid, user.id).first<ConversationRow>();
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
advisor.get('/conversations/:uid', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const uid = c.req.param('uid');
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
});

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
  const body = await readJson<{ topic?: string; conversation_uid?: string }>(c);
  const topic = String(body?.topic || '').trim().slice(0, 500);
  if (!topic) return c.json({ error: 'topic is required' }, 400);

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

  const conversationUid = body?.conversation_uid ? String(body.conversation_uid) : null;
  let conversationId: number | null = null;
  if (conversationUid) {
    const conv = await c.env.DB.prepare(
      `SELECT id FROM advisor_conversations WHERE uid = ? AND user_id = ?`,
    ).bind(conversationUid, user.id).first<{ id: number }>();
    if (conv) conversationId = Number(conv.id);
  }
  if (conversationId) await recordMessage(c.env, conversationId, 'user', `[explain] ${topic}`);

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': c.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL_DEFAULT,
      max_tokens: EXPLAIN_MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: topic }],
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
          await recordMessage(c.env, conversationId, 'assistant', collected, null, { kind: 'explain', topic });
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
