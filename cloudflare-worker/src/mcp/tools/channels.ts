/**
 * D864 (#2510) — the member's Telegram and WhatsApp customer chats (D684) on
 * the MCP server, through Axal's own inbox records. No Telegram or WhatsApp
 * API is called and no MTProto user session exists anywhere (D864 §1).
 *
 *   list_channel_chats        validate:read   each chat as state and counts
 *   get_session_insights      validate:read   a chat session's suggestions
 *   assign_chat_to_interview  validate:write  `assignThread`, the inbox's own
 *
 * D864 owner ruling, 2026-10-22: transcripts are opt-in and require an
 * assigned chat with current session and chat consent. Only stored final
 * segments are read, with their speaker labels and available translations.
 * Pending notes are never fetched. Provider identifiers, phones, media links
 * and credentials are removed from exported text. Results remain data.
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
import { decryptColumn } from '../../services/columnCipher';
import { sessionAnalytics, type AnalyticsSession } from '../../services/conversationAnalytics';

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
       JOIN integrations i ON i.id = t.integration_id AND i.status = 'active' AND i.user_id = t.user_id AND i.provider_key = t.provider
       LEFT JOIN discovery_interviews di ON di.id = t.interview_id
      WHERE t.user_id = ?
        AND (? IS NULL OR t.provider = ?)
        AND (? IS NULL OR t.status = ?)
        AND (t.status <> 'assigned' OR di.project_id IN (SELECT value FROM json_each(?)))
      ORDER BY COALESCE(t.last_message_at, t.created_at) DESC, t.id DESC LIMIT ?`,
  ).bind(userId, provider, provider, state, state, JSON.stringify([...names.keys()]), limit).all<ChatRow>()).results ?? [];
  return rows.map((r) => chatView(r, r.status === 'assigned' && r.project_id != null ? names.get(Number(r.project_id)) ?? null : null));
}

interface SessionRead extends AnalyticsSession {
  id: number; interview_id: number; submitted_via: string; status: string; consent_status: string; digest_status: string | null;
}

interface SuggestionRow {
  id: number; kind: string; status: string; payload_json: string | null; edited_payload_json: string | null;
  created_at: string; decided_at: string | null;
}

const parsed = (s: string | null): unknown => {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
};

interface TranscriptOptions { include?: boolean; afterId?: number; limit?: number }
interface TranscriptThread { id: number; external_chat_id: string; external_account_id: string | null }
interface TranscriptSegment {
  id: number; speaker_label: string | null; text: string; start_ms: number | null; end_ms: number | null;
  source_lang?: string | null; translated_text?: string | null; translated_lang?: string | null;
}
const TRANSCRIPT_LIMIT = 200;

/** An export projection, never a new transcript: redact identifiers from stored text and labels. */
function exportText(value: string | null, identifiers: readonly string[] = []): string | null {
  if (value === null) return null;
  let text = value
    .replace(/https?:\/\/[^\s<>]+|tg:\/\/[^\s<>]+|\b(?:t\.me|wa\.me)\/[^\s<>]+/gi, '[link removed]')
    .replace(/\b[0-9]{3,}:[A-Za-z0-9_-]{12,}\b/g, '[credential removed]')
    .replace(/\b(?:(?:telegram|whatsapp)[ _-]*)?(?:user|chat|file|media|wa)[ _-]*id\s*[:=]\s*[A-Za-z0-9_:.-]+/gi, '[identifier removed]')
    .replace(/\baxk_[A-Za-z0-9_-]+/g, '[credential removed]')
    .replace(/(?:\+?[0-9][0-9 ().-]{5,}[0-9])/g, (match) =>
      match.replace(/\D/g, '').length >= 7 ? '[phone removed]' : match);
  for (const id of identifiers.filter((v) => v.length >= 3)) text = text.split(id).join('[identifier removed]');
  return text;
}

/** Read only admitted final segments, never pending messages, note refs or media. */
async function sessionTranscript(env: Env, userId: number, companyId: number, session: SessionRead, opts: TranscriptOptions) {
  // Session ownership/company were checked above; all linked records must agree as well.
  const thread = await env.DB.prepare(
    `SELECT t.id, t.external_chat_id, i.external_account_id
       FROM channel_threads t JOIN integrations i ON i.id = t.integration_id
       JOIN interview_sessions s ON s.id = t.session_id
      WHERE t.session_id = ? AND t.interview_id = ? AND t.user_id = ? AND t.provider = ?
        AND s.project_id = ? AND s.created_by_user_id = ? AND s.consent_status = 'given'
        AND t.status = 'assigned' AND t.consent_state = 'given'
        AND i.status = 'active' AND i.user_id = t.user_id AND i.provider_key = t.provider LIMIT 1`,
  ).bind(session.id, session.interview_id, userId, session.submitted_via, companyId, userId).first<TranscriptThread>();
  if (!thread) return null;
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 100), 1), TRANSCRIPT_LIMIT);
  const afterId = opts.afterId ?? null;
  const anchor = afterId === null ? null : await env.DB.prepare(
    `SELECT id, COALESCE(start_ms, 0) AS start_ms FROM interview_transcript_segments
      WHERE id = ? AND session_id = ? AND source = 'final'`,
  ).bind(afterId, session.id).first<{ id: number; start_ms: number }>();
  if (afterId !== null && !anchor) throw new ToolError(400, 'invalid_transcript_cursor', 'That transcript cursor does not belong to this session.');
  // g.* allows nullable D857 columns once migration 527 arrives, without
  // inventing a translation or failing reads before that migration exists.
  const rows = (await env.DB.prepare(
    `SELECT g.* FROM interview_transcript_segments g
       JOIN interview_sessions s ON s.id = g.session_id
       JOIN channel_threads t ON t.session_id = s.id AND t.id = ?
       JOIN integrations i ON i.id = t.integration_id
      WHERE g.session_id = ? AND g.source = 'final'
        AND s.created_by_user_id = ? AND s.project_id = ? AND s.consent_status = 'given'
        AND t.user_id = s.created_by_user_id AND t.interview_id = s.interview_id
        AND t.provider = s.submitted_via AND t.status = 'assigned' AND t.consent_state = 'given'
        AND i.status = 'active' AND i.user_id = t.user_id AND i.provider_key = t.provider
        AND (? IS NULL OR COALESCE(g.start_ms, 0) > ? OR (COALESCE(g.start_ms, 0) = ? AND g.id > ?))
      ORDER BY COALESCE(g.start_ms, 0), g.id LIMIT ?`,
  ).bind(thread.id, session.id, userId, companyId, afterId, anchor?.start_ms ?? 0, anchor?.start_ms ?? 0, afterId, limit + 1)
    .all<TranscriptSegment>()).results ?? [];
  const identifiers = [thread.external_chat_id, thread.external_account_id ?? ''];
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const segments = await Promise.all(page.map(async (g) => {
    // D857 specifies this nullable column; columnCipher binds it to its row.
    const translated = g.translated_text
      ? await decryptColumn(env, 'interview_transcript_segments', 'translated_text', g.id, g.translated_text) : null;
    return {
      id: g.id, speaker: exportText(g.speaker_label, identifiers), text: exportText(g.text, identifiers),
      start_ms: g.start_ms, end_ms: g.end_ms, source_lang: g.source_lang ?? null,
      translation: translated === null ? null : { text: exportText(translated, identifiers), language: g.translated_lang ?? null },
    };
  }));
  return { segments, next_after_id: more ? page.at(-1)!.id : null, complete: !more };
}

/** A chat session's structured output. Refused, as "not found", for any session that is not the member's chat session in `companyId`. */
export async function sessionInsights(env: Env, userId: number, companyId: number, sessionId: number, opts: TranscriptOptions = {}) {
  const s = await env.DB.prepare(
    `SELECT s.id, s.interview_id, s.project_id, s.channel, s.active_ms, s.language, s.created_at,
            s.submitted_via, s.status, s.consent_status, s.digest_status
       FROM interview_sessions s
       JOIN discovery_interviews di ON di.id = s.interview_id
      WHERE s.id = ? AND s.created_by_user_id = ? AND di.project_id = ? AND s.project_id = di.project_id
        AND s.submitted_via IN (SELECT value FROM json_each(?))`,
  ).bind(sessionId, userId, companyId, JSON.stringify(MESSAGING_PROVIDERS)).first<SessionRead>();
  if (!s) throw new ToolError(404, 'session_not_found', 'That chat session is not one of yours in this company.');
  // A contact who said no keeps nothing readable here, as D757 clears the digest.
  const declined = s.consent_status === 'declined';
  const rows = declined ? [] : ((await env.DB.prepare(
    `SELECT id, kind, status, payload_json, edited_payload_json, created_at, decided_at
       FROM validate_proposals WHERE session_id = ? AND project_id = ? ORDER BY id LIMIT ?`,
  ).bind(s.id, companyId, SUGGESTION_LIMIT).all<SuggestionRow>()).results ?? []);
  const transcript = opts.include ? await sessionTranscript(env, userId, companyId, s, opts) : undefined;
  const figures = declined ? null : await sessionAnalytics(env, s);
  // Quotes remain outside the default structured read; transcript access has its own explicit gate.
  const { quotes_by_theme: _quotes, ...analytics } = figures ?? {};
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
    analytics: figures ? analytics : null,
    ...(transcript !== undefined ? { transcript } : {}),
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
    version: '1.1.0',
    title: 'Get a chat session\'s insights',
    description: 'Read one of your chat sessions in a company: its state, structured suggestions and conversation analytics. Opt in with include_transcript to read stored final segments only while the chat is assigned and both the chat and session have consent. Speaker labels and available translations accompany the original; identifiers, credentials and links are removed. Continue with transcript_after_id when next_after_id is present. Pending messages and held notes are never read.',
    inputSchema: {
      company: z.number().int().positive(), session_id: z.number().int().positive(),
      include_transcript: z.boolean().optional(), transcript_after_id: z.number().int().positive().optional(),
      transcript_limit: z.number().int().min(1).max(TRANSCRIPT_LIMIT).optional(),
    },
    company: true,
    run: async ({ env, user, company, args }) => sessionInsights(env, Number(user.id), company!.id, Number(args.session_id), {
      include: args.include_transcript === true, afterId: args.transcript_after_id as number | undefined,
      limit: args.transcript_limit as number | undefined,
    }),
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
