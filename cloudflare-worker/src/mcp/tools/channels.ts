/**
 * D864 (#2510) — the member's Telegram and WhatsApp customer chats (D684) on
 * the MCP server, through Axal's own inbox records. No Telegram or WhatsApp
 * API is called and no MTProto user session exists anywhere (D864 §1).
 *
 *   list_channel_chats        validate:read   each chat as state and counts
 *   get_session_insights      validate:read   a chat session's suggestions
 *   assign_chat_to_interview  validate:write  `assignThread`, the inbox's own
 *
 * STRUCTURE, NEVER CONVERSATION (D864 §2, until the owner answers #2510's
 * question 1). No message text, no transcript segment, no digest, no
 * citation quote, no contact name. No phone number, Telegram user id,
 * provider chat id or token: a chat is its Axal uid. A suggestion is its
 * kind, state and structured payload.
 *
 * WHO SEES WHAT. A chat is the member's own (`channel_threads.user_id`). A
 * chat assigned to an interview is listed only when that interview's venture
 * is one the call's grant still reaches (the server's `companies`: granted,
 * and readable now). A pending or set-aside chat belongs to no venture yet and
 * is listed as the member's, with `company` null. A session's insights are
 * read only for a chat session the member made in the checked company.
 *
 * Assignment is the inbox route's service call with no consent and no quote
 * consent: a chat that waits for consent (WhatsApp, D754) is linked and keeps
 * waiting, and a Telegram chat's notes still wait for its contact's YES.
 */
import { z } from 'zod';
import type { Env } from '../../types';
import type { McpTool } from '../server';
import { ToolError } from '../../services/assistantInterviews';
import { IntakeError, writableInterview } from '../../services/interviewIntake';
import { assignThread, threadForReply } from '../../services/channels/threads';
import { MESSAGING_PROVIDERS, consentAsked } from '../../services/channels/types';

const STATES = ['pending', 'assigned', 'ignored'] as const;
const LIST_LIMIT = 200;
const SUGGESTION_LIMIT = 100;

interface ChatRow {
  uid: string; provider: string; status: string; consent_state: string | null; message_count: number | null;
  last_message_at: string | null; created_at: string; interview_id: number | null; session_id: number | null;
  project_id: number | null; notes_waiting: number | null;
}

/** One chat as a tool says it: state and counts only. */
function chatView(row: ChatRow, companyName: string | null) {
  return {
    id: row.uid,
    provider: row.provider,
    state: row.status,
    consent: consentAsked(row.provider) ? row.consent_state ?? 'not_asked' : null,
    // D857's detected language once it lands; unknown until then.
    language: null,
    messages: Number(row.message_count) || 0,
    notes_waiting: Number(row.notes_waiting) || 0,
    last_activity_at: row.last_message_at ?? row.created_at,
    company: row.project_id != null && companyName != null ? { id: Number(row.project_id), name: companyName } : null,
    interview_id: row.status === 'assigned' ? row.interview_id : null,
    session_id: row.status === 'assigned' ? row.session_id : null,
  };
}

export async function listChannelChats(
  env: Env, userId: number, companies: Array<{ id: number; name: string }>,
  opts: { provider?: string; state?: string; limit?: number } = {},
) {
  const names = new Map(companies.map((c) => [c.id, c.name]));
  const limit = Math.min(Math.max(Math.trunc(Number(opts.limit) || 50), 1), LIST_LIMIT);
  const provider = opts.provider ?? null;
  const state = opts.state ?? null;
  // An assigned chat outside the grant's readable companies is filtered here,
  // in SQL, so the limit counts only chats this call may see.
  const rows = (await env.DB.prepare(
    `SELECT t.uid, t.provider, t.status, t.consent_state, t.message_count, t.last_message_at, t.created_at,
            t.interview_id, t.session_id, di.project_id,
            (SELECT COUNT(*) FROM channel_thread_messages m WHERE m.thread_id = t.id AND m.voice_ref_enc IS NOT NULL) AS notes_waiting
       FROM channel_threads t
       JOIN integrations i ON i.id = t.integration_id AND i.status = 'active' AND i.user_id = t.user_id
       LEFT JOIN discovery_interviews di ON di.id = t.interview_id
      WHERE t.user_id = ?
        AND (? IS NULL OR t.provider = ?)
        AND (? IS NULL OR t.status = ?)
        AND (t.status <> 'assigned' OR di.project_id IN (SELECT value FROM json_each(?)))
      ORDER BY COALESCE(t.last_message_at, t.created_at) DESC, t.id DESC LIMIT ?`,
  ).bind(userId, provider, provider, state, state, JSON.stringify([...names.keys()]), limit).all<ChatRow>()).results ?? [];
  return rows.map((r) => chatView(r, r.status === 'assigned' && r.project_id != null ? names.get(Number(r.project_id)) ?? null : null));
}

interface SessionRead {
  id: number; interview_id: number; submitted_via: string; status: string; consent_status: string | null; digest_status: string | null;
}

interface SuggestionRow {
  id: number; kind: string; status: string; payload_json: string | null; edited_payload_json: string | null;
  created_at: string; decided_at: string | null;
}

const parsed = (s: string | null): unknown => {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
};

/** A chat session's structured output. Refused, as "not found", for any session that is not the member's chat session in `companyId`. */
export async function sessionInsights(env: Env, userId: number, companyId: number, sessionId: number) {
  const s = await env.DB.prepare(
    `SELECT s.id, s.interview_id, s.submitted_via, s.status, s.consent_status, s.digest_status
       FROM interview_sessions s
       JOIN discovery_interviews di ON di.id = s.interview_id
      WHERE s.id = ? AND s.created_by_user_id = ? AND di.project_id = ?
        AND s.submitted_via IN (SELECT value FROM json_each(?))`,
  ).bind(sessionId, userId, companyId, JSON.stringify(MESSAGING_PROVIDERS)).first<SessionRead>();
  if (!s) throw new ToolError(404, 'session_not_found', 'That chat session is not one of yours in this company.');
  // A contact who said no keeps nothing readable here, as D757 clears the digest.
  const declined = s.consent_status === 'declined';
  const rows = declined ? [] : ((await env.DB.prepare(
    `SELECT id, kind, status, payload_json, edited_payload_json, created_at, decided_at
       FROM validate_proposals WHERE session_id = ? AND project_id = ? ORDER BY id LIMIT ?`,
  ).bind(s.id, companyId, SUGGESTION_LIMIT).all<SuggestionRow>()).results ?? []);
  return {
    session: {
      id: s.id, interview_id: s.interview_id, provider: s.submitted_via, status: s.status,
      consent: s.consent_status, digest: s.digest_status,
    },
    suggestions: rows.map((r) => ({
      id: r.id, kind: r.kind, state: r.status,
      payload: parsed(r.edited_payload_json) ?? parsed(r.payload_json),
      created_at: r.created_at, decided_at: r.decided_at,
    })),
    // D858's conversation analytics once they land; unknown until then.
    analytics: null,
  };
}

/** The inbox's assignment, refused before any work for an interview outside the checked company. */
export async function assignChat(env: Env, userId: number, companyId: number, chat: string, interviewId: number) {
  try {
    const scoped = await writableInterview(env, userId, interviewId);
    // Outside the grant's company, the interview is, to this call, not there: the route's own refusal.
    if (Number(scoped.project.id) !== companyId) throw new IntakeError(404, 'interview_not_found', 'That interview no longer exists.');
    const r = await assignThread(env, userId, chat, { interviewId });
    const thread = await threadForReply(env, userId, chat);
    return {
      chat, interview_id: r.interviewId, session_id: r.sessionId, moved: r.moved, notes_queued: r.queued,
      consent: consentAsked(thread.provider) ? thread.consent_state ?? 'not_asked' : null,
    };
  } catch (e) {
    // The service's own sentence and code: never SQLite or provider text.
    if (e instanceof IntakeError) throw new ToolError(e.status, e.code, e.message);
    throw e;
  }
}

const provider = z.enum(MESSAGING_PROVIDERS as unknown as [string, ...string[]]).optional();

export const CHANNEL_TOOLS: McpTool[] = [
  {
    name: 'list_channel_chats',
    requiredScope: 'validate:read',
    source: 'axal',
    version: '1.0.0',
    title: 'List customer chats',
    description: 'List your Telegram and WhatsApp customer chats in StudioOS: each chat\'s id, provider, state (pending, assigned or ignored), consent, message and waiting voice-note counts, last activity, and the company and interview it is assigned to. A chat assigned to a company this connection does not reach is not listed. Never message text, a contact\'s name, a phone number or a provider id.',
    inputSchema: {
      provider,
      state: z.enum(STATES).optional(),
      limit: z.number().int().min(1).max(LIST_LIMIT).optional(),
    },
    company: false,
    run: async ({ env, user, companies, args }) => ({
      chats: await listChannelChats(env, Number(user.id), companies, {
        provider: args.provider as string | undefined, state: args.state as string | undefined, limit: args.limit as number | undefined,
      }),
    }),
  },
  {
    name: 'get_session_insights',
    requiredScope: 'validate:read',
    source: 'axal',
    version: '1.0.0',
    title: 'Get a chat session\'s insights',
    description: 'Read the structured output of one of your chat sessions in a company: the session\'s state and consent, and the suggestions StudioOS made from it (kind, state and structured content). Never the conversation, a transcript or a quote.',
    inputSchema: { company: z.number().int().positive(), session_id: z.number().int().positive() },
    company: true,
    run: async ({ env, user, company, args }) => sessionInsights(env, Number(user.id), company!.id, Number(args.session_id)),
  },
  {
    name: 'assign_chat_to_interview',
    requiredScope: 'validate:write',
    source: 'axal',
    version: '1.0.0',
    title: 'Assign a chat to an interview',
    description: 'Put one of your pending customer chats into an interview in a company, as the StudioOS inbox does: its waiting text becomes a Text session on that interview. Consent is not changed: a chat that waits for its contact\'s consent keeps waiting.',
    inputSchema: { company: z.number().int().positive(), chat: z.string().min(1).max(64), interview_id: z.number().int().positive() },
    company: true,
    readOnly: false,
    run: async ({ env, user, company, args }) => assignChat(env, Number(user.id), company!.id, String(args.chat), Number(args.interview_id)),
  },
];
