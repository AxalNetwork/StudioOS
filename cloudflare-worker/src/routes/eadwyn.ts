/**
 * /api/eadwyn — the Worker AI rail's conversations, and the connectors in
 * them (D652, #1464, part of D649).
 *
 * The rail's "Read this page back" (`POST /api/ai/workspace/explain`) stays
 * where it is. This adds what the canvas's `rail` and `railList` screens
 * draw: a conversation the member types into, its connector switches, answers
 * that name the connector they read, and the "Ready to send" card.
 *
 *   GET    /connectors                 the member's connections, for the "+" menu
 *   GET    /conversations?workspace=   the member's conversations on that workspace
 *   GET    /conversations/mine         every conversation the member has, for Studio's phone list (D701)
 *   POST   /conversations              start one (every switch off)
 *   GET    /conversations/:uid         its messages and actions
 *   DELETE /conversations/:uid         delete it, with its messages and actions
 *   PUT    /conversations/:uid/connectors   the switches, as a whole set
 *   POST   /conversations/:uid/ask     one run
 *   POST   /actions/:uid/confirm       the member's Send: the only write
 *   POST   /actions/:uid/cancel        the member's Cancel
 *
 * Everything is the caller's own: every read is `WHERE user_id = ?`, and a
 * uid that is someone else's answers 404, the same as one that does not exist.
 *
 * A conversation belongs to the company that was active when it started. A
 * run, and a Send, happen only while that company is still the member's
 * active one (`company_changed` otherwise), and every reader re-reads the
 * member's link to it.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { activeCompanyFor } from '../middleware/activeCompany';
import { ensureTier } from '../middleware/requireTier';
import { canAccessProject } from '../services/projectAccess';
import { projectInActiveCompany } from '../services/tenancyScope';
import { run as aiRun } from '../services/aiRouter';
import { refuse } from '../util/refusal';
import {
  ensureIntegrationsSchema,
  getDescriptor,
  getProviderImpl,
  type IntegrationRow,
  type PushPreview,
} from '../integrations/registry';
import { ensureRole, logEvent, pushScopeRefusal } from './integrations';
import { CONNECTOR_READERS } from '../services/eadwynReaders';
import {
  SEND_TARGETS,
  actionEnvelope,
  attentionReason,
  canonicalContent,
  isExpired,
  normaliseConnectorKeys,
  parseConnectorKeys,
  parseEnvelope,
  parseModelReply,
  payloadHash,
  readableConnectors,
  sourceFor,
  validateSend,
  type ConnectorSource,
  type SendProposal,
} from '../services/eadwynConnectors';

const eadwyn = new Hono<{ Bindings: Env }>();

const UID_RE = /^[0-9a-f]{32}$/;
const MAX_QUESTION = 2000;
const MAX_FILE_TEXT = 8000;
const HISTORY_TURNS = 10;
/** A row still `sending` this long after its claim stopped part-way; see `releaseStranded`. */
const STRANDED_MINUTES = 10;

function newUid(): string {
  const buf = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeJson<T>(s: string | null | undefined, def: T): T {
  if (!s) return def;
  try { return JSON.parse(s) as T; } catch { return def; }
}

interface ConversationRow {
  id: number; uid: string; user_id: number; company_id: number | null;
  workspace: string; title: string; connectors_json: string;
  created_at: string; updated_at: string;
}

interface ActionRow {
  id: number; uid: string; conversation_id: number; user_id: number; company_id: number | null;
  integration_id: number; provider_key: string; target_label: string; summary: string;
  payload_json: string; payload_hash: string; status: string; result_summary: string | null;
  created_at: string; decided_at: string | null;
}

async function loadConversation(env: Env, uid: string, userId: number): Promise<ConversationRow | null> {
  if (!UID_RE.test(uid)) return null;
  return (await env.DB.prepare('SELECT * FROM eadwyn_conversations WHERE uid = ? AND user_id = ?')
    .bind(uid, userId).first<ConversationRow>()) || null;
}

async function loadAction(env: Env, uid: string, userId: number): Promise<ActionRow | null> {
  if (!UID_RE.test(uid)) return null;
  return (await env.DB.prepare('SELECT * FROM eadwyn_pending_actions WHERE uid = ? AND user_id = ?')
    .bind(uid, userId).first<ActionRow>()) || null;
}

/** The member's connections, newest first, one per provider. */
async function loadConnections(env: Env, userId: number): Promise<IntegrationRow[]> {
  const rows = await env.DB.prepare('SELECT * FROM integrations WHERE user_id = ? ORDER BY id DESC')
    .bind(userId).all<IntegrationRow>();
  return rows.results ?? [];
}

function publicConversation(row: ConversationRow) {
  return {
    uid: row.uid,
    workspace: row.workspace,
    title: row.title,
    connectors: parseConnectorKeys(row.connectors_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * What the card shows. `content` is what Send sends, as the provider's
 * preview resolved it: the record and every field with its value. `payload`
 * is the push payload itself. `summary` is the model's line, which the card
 * labels as Eadwyn's words. A row stored before content existed has
 * `content: null` and cannot be sent (confirm answers `content_changed`).
 */
function publicAction(row: ActionRow) {
  const envelope = parseEnvelope(row.payload_json);
  return {
    uid: row.uid,
    connector: row.provider_key,
    connector_name: getDescriptor(row.provider_key)?.display_name || row.provider_key,
    target: row.target_label,
    summary: row.summary,
    content: envelope?.content ?? null,
    payload: envelope?.send ?? safeJson<Record<string, unknown>>(row.payload_json, {}),
    status: row.status,
    result_summary: row.result_summary,
    created_at: row.created_at,
    decided_at: row.decided_at,
  };
}

// ──────────────────────────────────────────────────────────────── connectors

/**
 * GET /connectors — the "Connectors ›" list: the member's connections, one
 * per provider, each with the reason it cannot be used ('' when it can). A
 * row with a reason is drawn greyed with that reason, as `railList` draws
 * "Sign-in expired".
 */
eadwyn.get('/connectors', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  const seen = new Set<string>();
  const out: { key: string; name: string; reason: string }[] = [];
  for (const row of await loadConnections(c.env, user.id)) {
    if (seen.has(row.provider_key) || !getDescriptor(row.provider_key)) continue;
    seen.add(row.provider_key);
    out.push({
      key: row.provider_key,
      name: getDescriptor(row.provider_key)!.display_name,
      reason: attentionReason(row),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return c.json({ connectors: out });
});

// ────────────────────────────────────────────────────────────── conversations

eadwyn.get('/conversations', async (c) => {
  const user = await requireAuth(c);
  const workspace = String(c.req.query('workspace') || '').trim().slice(0, 60);
  if (!workspace) return c.json({ error: 'workspace is required' }, 400);
  const rows = await c.env.DB.prepare(
    'SELECT * FROM eadwyn_conversations WHERE user_id = ? AND workspace = ? ORDER BY updated_at DESC, id DESC LIMIT 20',
  ).bind(user.id, workspace).all<ConversationRow>();
  return c.json({ conversations: (rows.results ?? []).map(publicConversation) });
});

/**
 * D701 — the caller's conversations across both stores, for the Conversations
 * list on Studio's phone page (#1663). It is registered BEFORE
 * `/conversations/:uid`: after it, "mine" would reach `loadConversation`,
 * fail `UID_RE` and answer 404.
 *
 * - The rail's: the caller's 20 newest `eadwyn_conversations`, each with its
 *   message count. An empty title reads "<workspace> conversation".
 * - Profiling: ONE `advisor_conversations` row, the one `/api/advisor/start`
 *   resumes (the newest active row) or, with none active, the newest of any
 *   state, which `/progress` reads. Listing every row would repeat "Profiling
 *   questions" once per restart. Its count is its user and assistant messages.
 *
 * Every query is `WHERE user_id = ?` with the caller from `requireAuth`; the
 * read takes no id and no parameter, and writes nothing (`releaseStranded` is
 * not called). Each half is read on its own: one that throws is left out and
 * named in `unreadable`, so the page says that half could not be read rather
 * than "no conversations".
 */
interface MineRow {
  id: string;
  kind: 'eadwyn' | 'profiling';
  title: string;
  workspace: string | null;
  updated_at: string;
  messages: number;
  answered: number | null;
  total: number | null;
  active: boolean;
}

/** A stored time as milliseconds; SQLite's 'YYYY-MM-DD HH:MM:SS' is UTC. */
function storedMs(at: string): number {
  const s = String(at ?? '').trim();
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

eadwyn.get('/conversations/mine', async (c) => {
  const user = await requireAuth(c);
  const unreadable: Array<'eadwyn' | 'profiling'> = [];
  const rows: Array<MineRow & { _id: number }> = [];

  try {
    const rail = await c.env.DB.prepare(
      `SELECT c.id, c.uid, c.workspace, c.title, c.updated_at,
              (SELECT COUNT(*) FROM eadwyn_messages m WHERE m.conversation_id = c.id) AS messages
         FROM eadwyn_conversations c
        WHERE c.user_id = ?
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT 20`,
    ).bind(user.id).all<{ id: number; uid: string; workspace: string; title: string; updated_at: string; messages: number }>();
    for (const r of rail.results ?? []) {
      const title = String(r.title ?? '').trim();
      rows.push({
        _id: Number(r.id),
        id: r.uid,
        kind: 'eadwyn',
        title: title || `${r.workspace} conversation`,
        workspace: r.workspace,
        updated_at: r.updated_at,
        messages: Number(r.messages),
        answered: null,
        total: null,
        active: false,
      });
    }
  } catch {
    unreadable.push('eadwyn');
  }

  try {
    type P = { id: number; uid: string; state: string; answered_count: number; total_questions: number; updated_at: string; messages: number };
    const active = await c.env.DB.prepare(
      `SELECT a.id, a.uid, a.state, a.answered_count, a.total_questions, a.updated_at,
              (SELECT COUNT(*) FROM advisor_messages m WHERE m.conversation_id = a.id AND m.role IN ('user', 'assistant')) AS messages
         FROM advisor_conversations a
        WHERE a.user_id = ? AND a.state = 'active'
        ORDER BY a.id DESC
        LIMIT 1`,
    ).bind(user.id).first<P>();
    const row = active ?? await c.env.DB.prepare(
      `SELECT a.id, a.uid, a.state, a.answered_count, a.total_questions, a.updated_at,
              (SELECT COUNT(*) FROM advisor_messages m WHERE m.conversation_id = a.id AND m.role IN ('user', 'assistant')) AS messages
         FROM advisor_conversations a
        WHERE a.user_id = ?
        ORDER BY a.id DESC
        LIMIT 1`,
    ).bind(user.id).first<P>();
    if (row) {
      rows.push({
        _id: Number(row.id),
        id: row.uid,
        kind: 'profiling',
        title: 'Profiling questions',
        workspace: null,
        updated_at: row.updated_at,
        messages: Number(row.messages),
        answered: Number(row.answered_count),
        total: Number(row.total_questions),
        active: row.state === 'active',
      });
    }
  } catch {
    unreadable.push('profiling');
  }

  // Newest first; on a tie the rail row first, then the higher id.
  rows.sort((a, b) => storedMs(b.updated_at) - storedMs(a.updated_at)
    || (a.kind === b.kind ? 0 : a.kind === 'eadwyn' ? -1 : 1)
    || b._id - a._id);
  return c.json({ conversations: rows.map(({ _id, ...r }) => r), unreadable });
});

eadwyn.post('/conversations', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json<{ workspace?: string }>().catch(() => null);
  const workspace = String(body?.workspace || '').trim().slice(0, 60);
  if (!workspace) return c.json({ error: 'workspace is required' }, 400);
  const companyId = await activeCompanyFor(c, user);
  const uid = newUid();
  // Every switch starts off: `connectors_json` takes its default, '[]'.
  await c.env.DB.prepare(
    'INSERT INTO eadwyn_conversations (uid, user_id, company_id, workspace) VALUES (?, ?, ?, ?)',
  ).bind(uid, user.id, companyId, workspace).run();
  const row = await loadConversation(c.env, uid, user.id);
  return c.json({ conversation: row ? publicConversation(row) : null }, 201);
});

/**
 * The way out of `sending`. Confirm claims a row (`sending`, with the claim's
 * time in `decided_at`) before it calls the provider and settles it after. A
 * Worker that dies between the two leaves the row claimed for good, so a row
 * still `sending` STRANDED_MINUTES after its claim is closed as `failed`, with
 * the one thing known about it: nobody knows whether it arrived. It is never
 * re-sent: that could send twice.
 */
async function releaseStranded(env: Env, conversationId: number): Promise<void> {
  await env.DB.prepare(
    'UPDATE eadwyn_pending_actions SET status = \'failed\', result_summary = ?, decided_at = CURRENT_TIMESTAMP ' +
    'WHERE conversation_id = ? AND status = \'sending\' AND (decided_at IS NULL OR decided_at < datetime(\'now\', ?))',
  ).bind(
    'The send stopped part-way, so it is not known whether this arrived. Check the connected account before asking again.',
    conversationId, `-${STRANDED_MINUTES} minutes`,
  ).run();
}

eadwyn.get('/conversations/:uid', async (c) => {
  const user = await requireAuth(c);
  const conv = await loadConversation(c.env, c.req.param('uid'), user.id);
  if (!conv) return c.json({ error: 'not_found' }, 404);
  await releaseStranded(c.env, conv.id);
  const [messages, actions] = await Promise.all([
    c.env.DB.prepare('SELECT id, role, content, sources_json, action_uid, created_at FROM eadwyn_messages WHERE conversation_id = ? ORDER BY id')
      .bind(conv.id).all<{ id: number; role: string; content: string; sources_json: string; action_uid: string | null; created_at: string }>(),
    c.env.DB.prepare('SELECT * FROM eadwyn_pending_actions WHERE conversation_id = ? ORDER BY id')
      .bind(conv.id).all<ActionRow>(),
  ]);
  return c.json({
    conversation: publicConversation(conv),
    messages: (messages.results ?? []).map((m) => ({
      id: m.id, role: m.role, content: m.content,
      sources: safeJson<ConnectorSource[]>(m.sources_json, []),
      action_uid: m.action_uid, created_at: m.created_at,
    })),
    actions: (actions.results ?? []).map(publicAction),
  });
});

eadwyn.delete('/conversations/:uid', async (c) => {
  const user = await requireAuth(c);
  const conv = await loadConversation(c.env, c.req.param('uid'), user.id);
  if (!conv) return c.json({ error: 'not_found' }, 404);
  // Children first, explicitly: D1 enforces the cascade, but a fixture or a
  // copy with foreign keys off would otherwise keep orphans.
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM eadwyn_pending_actions WHERE conversation_id = ?').bind(conv.id),
    c.env.DB.prepare('DELETE FROM eadwyn_messages WHERE conversation_id = ?').bind(conv.id),
    c.env.DB.prepare('DELETE FROM eadwyn_conversations WHERE id = ?').bind(conv.id),
  ]);
  return c.json({ ok: true });
});

eadwyn.put('/conversations/:uid/connectors', async (c) => {
  const user = await requireAuth(c);
  const conv = await loadConversation(c.env, c.req.param('uid'), user.id);
  if (!conv) return c.json({ error: 'not_found' }, 404);
  const body = await c.req.json<{ keys?: unknown }>().catch(() => null);
  const keys = normaliseConnectorKeys(body?.keys);
  await c.env.DB.prepare(
    'UPDATE eadwyn_conversations SET connectors_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  ).bind(JSON.stringify(keys), conv.id).run();
  return c.json({ connectors: keys });
});

// ───────────────────────────────────────────────────────────────────── ask

const ASK_PROMPT = [
  'You are Eadwyn, answering a question from the person using this workspace.',
  '',
  'You are given the conversation so far, and, under "Connector data", what each',
  'connector the person switched on returned. Those lines and the conversation',
  'are everything you know about their business.',
  '',
  'Rules:',
  '- Never state a figure that is not in the lines you were given.',
  '- If nothing given answers the question, say what is missing.',
  '- No advice about raising money, investing, taxes, or legal structure.',
  '- Plain sentences, at most six. No markdown.',
  '',
  'You never send, save or change anything. If the person asks for something to',
  'be sent to a connector listed under "Can propose", you may PROPOSE it; the',
  'person decides. Reply with ONE JSON object and nothing else:',
  '{"answer": "<your answer>", "send": null}',
  'or, to propose a send:',
  '{"answer": "<your answer>", "send": {"connector": "<key>", "payload": {"<field>": <id>}, "summary": "<one line>"}}',
].join('\n');

interface AskedRead { key: string; source: ConnectorSource; facts: string[] }

/**
 * RULE 1 in the route: the readers are called for `readableConnectors(...)`
 * and nothing else. Exported for the test that a disabled connector is never
 * read.
 */
export async function readForRun(
  env: Env,
  user: User,
  enabledKeys: readonly string[],
  connections: readonly IntegrationRow[],
  companyId: number | null,
  readers = CONNECTOR_READERS,
): Promise<{ readable: IntegrationRow[]; reads: AskedRead[] }> {
  const readable = readableConnectors(enabledKeys, connections);
  const reads: AskedRead[] = [];
  for (const row of readable) {
    const reader = readers[row.provider_key];
    if (!reader) continue;
    try {
      const out = await reader(env, user, row, companyId);
      reads.push({
        key: row.provider_key,
        source: sourceFor(row.provider_key, out.as_of ?? row.last_synced_at ?? null),
        facts: out.facts.slice(0, 20).map((f) => String(f).slice(0, 300)),
      });
    } catch (e) {
      console.warn('[eadwyn] read failed', row.provider_key, (e as Error).message);
    }
  }
  return { readable, reads };
}

function companyChanged(c: Context<{ Bindings: Env }>) {
  return refuse(c, 409, {
    code: 'company_changed',
    message: 'This conversation belongs to a company that is not your active one now. Switch back to it, or start a new conversation.',
  });
}

/** The target must be the member's to write and in the conversation's company. */
async function targetAllowed(env: Env, user: User, companyId: number | null, p: SendProposal): Promise<boolean> {
  const project = p.field === 'project_id'
    ? await env.DB.prepare('SELECT id, founder_id, company_id FROM projects WHERE id = ?')
      .bind(p.target_id).first<{ id: number; founder_id: number | null; company_id: number | null }>()
    : await env.DB.prepare('SELECT p.id, p.founder_id, p.company_id FROM deals d JOIN projects p ON p.id = d.project_id WHERE d.id = ?')
      .bind(p.target_id).first<{ id: number; founder_id: number | null; company_id: number | null }>();
  if (!project) return false;
  if (!projectInActiveCompany(companyId, project)) return false;
  return canAccessProject(env, user, project, { write: true });
}

/** The provider's preview of this proposal's push, or null when it cannot say. */
async function previewFor(env: Env, row: IntegrationRow, p: SendProposal): Promise<PushPreview | null> {
  const preview = getProviderImpl(row.provider_key)?.preview;
  if (!preview) return null;
  try {
    return await preview(env, row, { [p.field]: p.target_id });
  } catch (e) {
    console.warn('[eadwyn] preview refused', row.provider_key, (e as Error).message);
    return null;
  }
}

eadwyn.post('/conversations/:uid/ask', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  const conv = await loadConversation(c.env, c.req.param('uid'), user.id);
  if (!conv) return c.json({ error: 'not_found' }, 404);

  const body = await c.req.json<{ question?: string; model?: string; page?: string; file?: { name?: string; text?: string } }>()
    .catch(() => null);
  const question = String(body?.question || '').trim().slice(0, MAX_QUESTION);
  if (!question) return c.json({ error: 'question is required' }, 400);
  // Membership, re-read on every run: the active company is resolved against
  // the member's company links now, not when the conversation started.
  if ((await activeCompanyFor(c, user)) !== conv.company_id) return companyChanged(c);
  const model = String(body?.model || '').trim().slice(0, 120) || undefined;
  const page = typeof body?.page === 'string' ? body.page.slice(0, 200) : undefined;
  const fileName = String(body?.file?.name || '').trim().slice(0, 120);
  const fileText = String(body?.file?.text || '').slice(0, MAX_FILE_TEXT);

  const enabled = parseConnectorKeys(conv.connectors_json);
  const connections = await loadConnections(c.env, user.id);
  const { readable, reads } = await readForRun(c.env, user, enabled, connections, conv.company_id);

  const history = await c.env.DB.prepare(
    'SELECT role, content FROM eadwyn_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?',
  ).bind(conv.id, HISTORY_TURNS).all<{ role: 'user' | 'assistant'; content: string }>();
  const turns = (history.results ?? []).reverse();

  const sendable = readable.filter((r) => SEND_TARGETS[r.provider_key] && getProviderImpl(r.provider_key)?.push && getProviderImpl(r.provider_key)?.preview);
  const context = [
    reads.length
      ? `Connector data:\n${reads.map((r) => `[${r.source.name}]\n${r.facts.map((f) => `- ${f}`).join('\n')}`).join('\n\n')}`
      : 'Connector data: none. No connector is switched on, or none returned anything.',
    sendable.length
      ? `Can propose:\n${sendable.map((r) => `- ${r.provider_key}: payload field ${SEND_TARGETS[r.provider_key].map((t) => `${t.field} (${t.label})`).join(' or ')}`).join('\n')}`
      : 'Can propose: nothing.',
    fileText ? `Attached file "${fileName || 'file'}":\n${fileText}` : '',
  ].filter(Boolean).join('\n\n');

  const r = await aiRun(c.env, {
    task: 'workspace_explain',
    userId: user.id,
    model,
    surface: page,
    systemPrompt: `${ASK_PROMPT}\n\n${context}`,
    messages: [...turns.map((t) => ({ role: t.role, content: t.content })), { role: 'user' as const, content: question }],
    maxTokens: 600,
    temperature: 0.2,
    // D763: the guard checks what the member typed and attached, once, before
    // the model runs; the connector data and the earlier turns are not theirs
    // to be checked again.
    guardText: fileText ? `${question}\n\n${fileText}` : question,
    role: user.role,
  });

  if (r.refusal === 'guard_blocked') {
    return c.json({ error: 'safety_block', message: 'That question could not be sent.', category: r.guard?.codes[0]?.toLowerCase() ?? 'unsafe' }, 422);
  }
  if (!r.ok) {
    return c.json({
      ok: false,
      refusal: r.refusal ?? null,
      message: r.refusal === 'model_not_offered'
        ? 'That model is no longer offered for this page. Nothing was run.'
        : r.refusal === 'budget_user_month' || r.refusal === 'budget_user_day'
          ? 'This month’s AI budget is spent. Nothing was run.'
          // D763: the guard withheld the answer, or could not check it; its own words.
          : r.refusal === 'guard_blocked_output' || r.refusal === 'guard_unavailable'
            ? r.error
            : 'The model could not be reached. Nothing was run, and nothing was charged.',
      ...(r.guard?.refusal?.link ? { link: r.guard.refusal.link } : {}),
      usage: { model: r.usage.model, est_cost_usd: 0 },
    }, 503);
  }

  const reply = parseModelReply(r.output || '');
  const answer = reply.answer || 'No answer came back.';
  const sources = reads.map((x) => x.source);

  // RULE 2 in the route: a proposed write becomes a ROW, never a call. The
  // provider's `push` is not reachable from this handler.
  let action: ActionRow | null = null;
  const proposal = validateSend(reply.send, sendable.map((s) => s.provider_key));
  const integration = proposal ? sendable.find((s) => s.provider_key === proposal.connector) : undefined;
  // RULE 3: the content is resolved now, by the provider's own builder, and
  // stored with the payload. A target the provider cannot preview (gone, or
  // in a company switched off for it) gives no card.
  const content = proposal && integration && await targetAllowed(c.env, user, conv.company_id, proposal)
    ? await previewFor(c.env, integration, proposal)
    : null;
  if (proposal && integration && content) {
    const payloadJson = actionEnvelope(proposal, content);
    const actionUid = newUid();
    await c.env.DB.prepare(
      'INSERT INTO eadwyn_pending_actions (uid, conversation_id, user_id, company_id, integration_id, provider_key, target_label, summary, payload_json, payload_hash) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      actionUid, conv.id, user.id, conv.company_id, integration.id, proposal.connector,
      content.target.slice(0, 200), proposal.summary, payloadJson, await payloadHash(payloadJson),
    ).run();
    action = await loadAction(c.env, actionUid, user.id);
  }

  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO eadwyn_messages (conversation_id, role, content) VALUES (?, \'user\', ?)')
      .bind(conv.id, fileName ? `${question}\n\n[Attached: ${fileName}]` : question),
    c.env.DB.prepare('INSERT INTO eadwyn_messages (conversation_id, role, content, sources_json, action_uid) VALUES (?, \'assistant\', ?, ?, ?)')
      .bind(conv.id, answer, JSON.stringify(sources), action?.uid ?? null),
    c.env.DB.prepare(
      'UPDATE eadwyn_conversations SET updated_at = CURRENT_TIMESTAMP, title = CASE WHEN title = \'\' THEN ? ELSE title END WHERE id = ?',
    ).bind(question.slice(0, 80), conv.id),
  ]);

  return c.json({
    ok: true,
    answer,
    sources,
    action: action ? publicAction(action) : null,
    // The run's receipt: what it cost, and which connectors it read.
    usage: {
      model: r.usage.model,
      est_cost_usd: r.usage.est_cost_usd,
      cached: r.usage.cached,
      fallback_used: r.usage.fallback_used,
      prompt_tokens: r.usage.prompt_tokens,
      completion_tokens: r.usage.completion_tokens,
      connectors_read: sources.map((s) => s.key),
    },
  });
});

// ─────────────────────────────────────────────────────────────────── actions

/**
 * POST /actions/:uid/confirm — the member's Send, and the ONLY place a
 * connector is written from a conversation.
 *
 * The request body is never read. Before anything is sent, in this order:
 *   - the row is the member's, still `pending`, under a day old;
 *   - its stored envelope re-hashes to `payload_hash` (`action_changed`), and
 *     has content (a row from before content was stored has none);
 *   - the connection is still active, the provider can push and preview;
 *   - the conversation's company is still the member's active one
 *     (`company_changed`);
 *   - the same company-and-project guard `/api/integrations/:uid/push` runs
 *     (`pushScopeRefusal`: `company_not_enabled`, `project_not_enabled`);
 *   - the target is still the member's to write, in that company
 *     (`target_not_allowed`): `targetAllowed`, run again, not trusted from
 *     the proposal;
 *   - the provider's preview, rebuilt now, is byte-for-byte the content the
 *     card showed (`content_changed`).
 * Then the row is claimed (`pending` → `sending`, under a day old) in one
 * conditional UPDATE, so a double click sends once, and only then is `push`
 * called with the stored payload.
 */
eadwyn.post('/actions/:uid/confirm', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  ensureRole(c, user);
  const action = await loadAction(c.env, c.req.param('uid'), user.id);
  if (!action) return c.json({ error: 'not_found' }, 404);
  if (action.status !== 'pending') {
    return refuse(c, 409, { code: 'action_not_pending', message: 'This action was already sent or cancelled.' });
  }
  if (isExpired(action.created_at)) {
    await c.env.DB.prepare('UPDATE eadwyn_pending_actions SET status = \'expired\', decided_at = CURRENT_TIMESTAMP WHERE id = ? AND status = \'pending\'')
      .bind(action.id).run();
    return refuse(c, 409, { code: 'action_expired', message: 'This action is more than a day old. Ask again to get a fresh one.' });
  }
  if (await payloadHash(action.payload_json) !== action.payload_hash) {
    return refuse(c, 409, { code: 'action_changed', message: 'This action changed after it was shown, so it was not sent.' });
  }
  const envelope = parseEnvelope(action.payload_json);
  if (!envelope) return contentChanged(c);

  const row = await c.env.DB.prepare('SELECT * FROM integrations WHERE id = ? AND user_id = ?')
    .bind(action.integration_id, user.id).first<IntegrationRow>();
  if (!row || row.status !== 'active' || row.provider_key !== action.provider_key) {
    return refuse(c, 409, { code: 'connector_unavailable', message: 'That connector is not connected any more. Reconnect it, then ask again.' });
  }
  const desc = getDescriptor(row.provider_key);
  if (desc && desc.tier !== 'free') ensureTier(user, desc.tier as 'growth' | 'studio');
  const impl = getProviderImpl(row.provider_key);
  if (!impl?.push || !impl.preview) {
    return refuse(c, 422, { code: 'push_not_supported', message: 'This connector cannot receive updates.' });
  }

  if ((await activeCompanyFor(c, user)) !== action.company_id) return companyChanged(c);
  const scope = await pushScopeRefusal(c, user, row, envelope.send);
  if (scope) {
    return refuse(c, 403, {
      code: scope,
      message: scope === 'company_not_enabled'
        ? 'This connector is switched off for your active company, so nothing was sent.'
        : 'That project is not in a company this connector is switched on for, so nothing was sent.',
    });
  }
  const proposal = validateSend({ connector: row.provider_key, payload: envelope.send }, [row.provider_key]);
  if (!proposal || !(await targetAllowed(c.env, user, action.company_id, proposal))) {
    return refuse(c, 403, { code: 'target_not_allowed', message: 'That record is no longer yours to update in this company, so nothing was sent.' });
  }
  const now = await previewFor(c.env, row, proposal);
  if (!now || canonicalContent(now) !== canonicalContent(envelope.content)) return contentChanged(c);

  const claim = await c.env.DB.prepare(
    'UPDATE eadwyn_pending_actions SET status = \'sending\', decided_at = CURRENT_TIMESTAMP ' +
    'WHERE id = ? AND status = \'pending\' AND created_at > datetime(\'now\', \'-1 day\')',
  ).bind(action.id).run();
  if (!claim.meta?.changes) {
    return refuse(c, 409, { code: 'action_not_pending', message: 'This action was already sent, cancelled, or is more than a day old.' });
  }

  const payload = envelope.send;
  let out;
  try {
    out = await impl.push(c as Context<{ Bindings: Env }>, user, row, payload);
  } catch (e) {
    const msg = (e as Error).message || 'push failed';
    await c.env.DB.prepare(
      'UPDATE eadwyn_pending_actions SET status = \'failed\', result_summary = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).bind('Not sent: the connector refused the update.', action.id).run();
    await logEvent(c.env, {
      integration_id: row.id, user_id: user.id, provider_key: row.provider_key,
      direction: 'outbound', event_type: 'eadwyn_send', status: 'error',
      request_summary: `Sent from Eadwyn: ${action.target_label}`, response_summary: msg, payload,
    });
    return refuse(c, 502, { code: 'push_failed', message: 'The update could not be sent to the connected account. Check the connection and try again.', raw: msg, audience: 'owner' });
  }
  // The push happened. Nothing below may record it as failed: a write that
  // throws here leaves the row `sending`, which `releaseStranded` closes as
  // "not known", never as "not sent".
  await c.env.DB.prepare(
    'UPDATE eadwyn_pending_actions SET status = \'sent\', result_summary = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?',
  ).bind(String(out.summary || '').slice(0, 500), action.id).run();
  await logEvent(c.env, {
    integration_id: row.id, user_id: user.id, provider_key: row.provider_key,
    direction: 'outbound', event_type: 'eadwyn_send', status: 'ok',
    http_status: out.http_status, request_summary: `Sent from Eadwyn: ${action.target_label}`,
    response_summary: out.summary, external_id: out.external_id ?? null, payload,
  });
  const done = await loadAction(c.env, action.uid, user.id);
  return c.json({ ok: true, action: done ? publicAction(done) : null });
});

function contentChanged(c: Context<{ Bindings: Env }>) {
  return refuse(c, 409, {
    code: 'content_changed',
    message: 'What this would send is no longer what the card showed, so nothing was sent. Ask again for a fresh card.',
  });
}

/** POST /actions/:uid/cancel — the member's Cancel. Nothing is sent; the row and the log say so. */
eadwyn.post('/actions/:uid/cancel', async (c) => {
  await ensureIntegrationsSchema(c.env);
  const user = await requireAuth(c);
  const action = await loadAction(c.env, c.req.param('uid'), user.id);
  if (!action) return c.json({ error: 'not_found' }, 404);
  const res = await c.env.DB.prepare(
    'UPDATE eadwyn_pending_actions SET status = \'cancelled\', decided_at = CURRENT_TIMESTAMP WHERE id = ? AND status = \'pending\'',
  ).bind(action.id).run();
  if (!res.meta?.changes) {
    return refuse(c, 409, { code: 'action_not_pending', message: 'This action was already sent or cancelled.' });
  }
  await logEvent(c.env, {
    integration_id: action.integration_id, user_id: user.id, provider_key: action.provider_key,
    direction: 'internal', event_type: 'eadwyn_cancel', status: 'ok',
    request_summary: `Cancelled in Eadwyn: ${action.target_label}`,
    payload: parseEnvelope(action.payload_json)?.send ?? safeJson<Record<string, unknown>>(action.payload_json, {}),
  });
  const done = await loadAction(c.env, action.uid, user.id);
  return c.json({ ok: true, action: done ? publicAction(done) : null });
});

export default eadwyn;
