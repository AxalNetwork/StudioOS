/**
 * D874 (#2521) — the member's recorded calls (D684's Zoom and Google Meet
 * refs) on the MCP server, through Axal's own records. No Zoom or Google API
 * is called here: an import has already written the transcript.
 *
 *   list_meetings           validate:read   each call as state, source, provider, time and interview
 *   get_meeting_transcript  validate:read   a call's stored transcript, paged
 *   summarize_meeting       validate:write  the engine's summary, read or run (AI tokens)
 *
 * `extract_action_items` follows with M4's extraction (#2520 PR 2), which it
 * runs; until then it is not registered (D874 §3).
 *
 * TENANCY COMES FROM THE REF (`interview_channel_refs`, migration 449): its
 * member, interview and session were set when the member scheduled or
 * attached the call. A call is read only when the ref is the member's, on an
 * interview in a company the grant still reaches. Anything else is
 * `404 meeting_not_found`, never a hint that it exists.
 *
 * THE TRANSCRIPT (the owner's ruling on #2510, Q1 B, which #2521 follows):
 * the full stored transcript of a consented call may leave, as data in the
 * result. Only the call's stored final segments, with speaker labels, times
 * and D857's translation beside the original when one is stored. Only once
 * the ref is imported and while the session's consent is `given`, both
 * checked again inside the segment query, so a withdrawal mid-read exports
 * nothing. A join URL, a meeting id or code, a passcode, a phone number, a
 * credential or a link never appears: not as a field, and not in the text.
 */
import { z } from 'zod';
import type { Env } from '../../types';
import type { McpTool } from '../server';
import { ToolError } from '../../services/assistantInterviews';
import { decryptColumn } from '../../services/columnCipher';
import { errorCodeOf, MEETING_ERRORS, type MeetingRef } from '../../services/channels/meetings';
import { meetingCodeOf } from '../../services/channels/googleMeet';
import { loadSession } from '../../services/interviewSessions';
import { summaryOf } from '../../services/interviewProcessing';
import { digestSession } from '../../services/validateEngine';
import { REFUSAL_WORDS, refusalFor } from '../../services/metering';
import { sessionDigest } from '../../routes/founder_validate_sessions';

const PROVIDERS = ['zoom', 'google_meet'] as const;
const STATES = ['scheduled', 'ended', 'transcript_ready', 'imported', 'no_transcript', 'failed', 'cancelled'] as const;
const LIST_LIMIT = 200;
const TRANSCRIPT_LIMIT = 200;

/** A call's uid as a tool takes it: Axal's own, never a provider's id. */
const MEETING = z.string().min(1).max(64);

// ── Redaction ────────────────────────────────────────────────────────────────

/**
 * A call's text as it may leave: links, credential-shaped values, phone
 * numbers and the call's own identifiers (its meeting id, its Meet code, a
 * passcode) removed. D864's rule for chats, with a call's identifiers.
 */
export function exportText(value: string | null, identifiers: readonly string[] = []): string | null {
  if (value === null || value === undefined) return null;
  let text = String(value);
  // The call's own identifiers first, so a bare meeting id reads as one, not as a phone number.
  for (const id of identifiers.filter((v) => v && v.length >= 3)) text = text.split(id).join('[identifier removed]');
  text = text
    .replace(/https?:\/\/[^\s<>]+|\b(?:[a-z0-9-]+\.)*(?:zoom\.us|meet\.google\.com)\/[^\s<>]+/gi, '[link removed]')
    .replace(/\b(?:meeting|webinar)[ _-]*id\s*[:=#]?\s*[0-9][0-9 ]{7,}[0-9]/gi, '[identifier removed]')
    .replace(/\b(?:passcode|password|pwd)\s*[:=]?\s*\S+/gi, '[credential removed]')
    .replace(/\b[0-9]{3,}:[A-Za-z0-9_-]{12,}\b/g, '[credential removed]')
    .replace(/\baxk_[A-Za-z0-9_-]+/g, '[credential removed]')
    .replace(/(?:\+?[0-9][0-9 ().-]{5,}[0-9])/g, (m) => (m.replace(/\D/g, '').length >= 7 ? '[phone removed]' : m));
  return text;
}

/** Every string inside `value`, redacted; the shape is kept. */
function exportDeep<T>(value: T, identifiers: readonly string[]): T {
  if (typeof value === 'string') return exportText(value, identifiers) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => exportDeep(v, identifiers)) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, exportDeep(v, identifiers)])) as T;
  }
  return value;
}

/** The identifiers a call's text must not carry: the provider's meeting id and, for Meet, the code in its link. */
function identifiersOf(ref: Pick<MeetingRef, 'external_ref' | 'join_url'>): string[] {
  const out = [String(ref.external_ref ?? '')];
  const code = meetingCodeOf(ref.join_url);
  if (code) out.push(code);
  const zoomId = /\/j\/(\d+)/.exec(String(ref.join_url ?? ''))?.[1];
  if (zoomId) out.push(zoomId);
  return out;
}

// ── The member's calls ───────────────────────────────────────────────────────

interface RefRow extends MeetingRef { project_id: number; transcript_session_id: number | null }

/*
 * `transcript_session_id`, written out in both queries below (bound SQL only,
 * never interpolated): the session a call's transcript lands in. That is the
 * scheduled call's own session (opened with the provider), or, for a call
 * attached to a recording, the session `meetings.ts` opened beside it
 * (`meeting:<ref uid>`). At most one matches: an attached call's anchor is
 * the recording, whose `submitted_via` is null.
 */

/** A call that was scheduled from an interview has its slot's end; one attached to a recording has none (founder_validate_meetings.ts). */
const sourceOf = (ref: Pick<MeetingRef, 'ends_at'>) => (ref.ends_at ? 'scheduled' : 'attached');

function meetingItem(row: RefRow, companyName: string | null) {
  const code = errorCodeOf(row.last_error);
  return {
    id: row.uid,
    provider: row.provider,
    state: row.status,
    source: sourceOf(row),
    // Axal's own sentence for the state, by its code; never a provider's text.
    error_code: code,
    error: code ? MEETING_ERRORS[code] ?? null : null,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    company: companyName != null ? { id: Number(row.project_id), name: companyName } : null,
    interview_id: Number(row.interview_id),
    session_id: row.transcript_session_id == null ? null : Number(row.transcript_session_id),
  };
}

export async function listMeetings(
  env: Env, userId: number, companies: Array<{ id: number; name: string }>,
  opts: { provider?: string; state?: string; limit?: number } = {},
) {
  const names = new Map(companies.map((c) => [c.id, c.name]));
  const limit = Math.min(Math.max(Math.trunc(Number(opts.limit) || 50), 1), LIST_LIMIT);
  const provider = opts.provider ?? null;
  const state = opts.state ?? null;
  // A call on an interview outside the grant's readable companies is filtered in SQL, so the limit counts only what this call may see.
  const rows = (await env.DB.prepare(
    `SELECT r.*, di.project_id, (SELECT s.id FROM interview_sessions s
       WHERE s.interview_id = r.interview_id AND s.created_by_user_id = r.user_id AND s.submitted_via = r.provider
       AND (s.id = r.session_id OR s.uid = 'meeting:' || r.uid)
       ORDER BY s.id LIMIT 1) AS transcript_session_id
       FROM interview_channel_refs r
       JOIN discovery_interviews di ON di.id = r.interview_id
      WHERE r.user_id = ?
        AND di.project_id IN (SELECT value FROM json_each(?))
        AND (? IS NULL OR r.provider = ?)
        AND (? IS NULL OR r.status = ?)
      ORDER BY COALESCE(r.starts_at, r.created_at) DESC, r.id DESC LIMIT ?`,
  ).bind(userId, JSON.stringify([...names.keys()]), provider, provider, state, state, limit).all<RefRow>()).results ?? [];
  return rows.map((r) => meetingItem(r, names.get(Number(r.project_id)) ?? null));
}

/** The member's call in `companyId`, with its transcript session; anything else is not found. */
async function memberMeeting(env: Env, userId: number, companyId: number, uid: string): Promise<RefRow> {
  const row = await env.DB.prepare(
    `SELECT r.*, di.project_id, (SELECT s.id FROM interview_sessions s
       WHERE s.interview_id = r.interview_id AND s.created_by_user_id = r.user_id AND s.submitted_via = r.provider
       AND (s.id = r.session_id OR s.uid = 'meeting:' || r.uid)
       ORDER BY s.id LIMIT 1) AS transcript_session_id
       FROM interview_channel_refs r
       JOIN discovery_interviews di ON di.id = r.interview_id
      WHERE r.uid = ? AND r.user_id = ? AND di.project_id = ?`,
  ).bind(uid, userId, companyId).first<RefRow>();
  if (!row) throw new ToolError(404, 'meeting_not_found', 'That call is not one of yours in this company.');
  return row;
}

// ── The transcript ───────────────────────────────────────────────────────────

interface SegmentRow {
  id: number; speaker_label: string | null; text: string; start_ms: number | null; end_ms: number | null;
  source_lang?: string | null; translated_text?: string | null; translated_lang?: string | null;
}

/** Why a call's transcript is not given: the state a member can act on. */
const NOT_READABLE = {
  not_imported: "This call's transcript is not in StudioOS yet.",
  no_consent: 'This call has no recorded consent, so its transcript is not shared.',
} as const;

export async function meetingTranscript(
  env: Env, userId: number, companyId: number, uid: string, opts: { afterId?: number; limit?: number } = {},
) {
  const ref = await memberMeeting(env, userId, companyId, uid);
  const meeting = { id: ref.uid, provider: ref.provider, state: ref.status, session_id: ref.transcript_session_id };
  if (ref.status !== 'imported' || ref.transcript_session_id == null) {
    return { meeting, transcript: null, reason: NOT_READABLE.not_imported };
  }
  const sessionId = Number(ref.transcript_session_id);
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 100), 1), TRANSCRIPT_LIMIT);
  const afterId = opts.afterId ?? null;
  const anchor = afterId === null ? null : await env.DB.prepare(
    `SELECT id, COALESCE(start_ms, 0) AS start_ms FROM interview_transcript_segments WHERE id = ? AND session_id = ? AND source = 'final'`,
  ).bind(afterId, sessionId).first<{ id: number; start_ms: number }>();
  if (afterId !== null && !anchor) throw new ToolError(400, 'invalid_transcript_cursor', 'That transcript cursor does not belong to this call.');
  // The gate again, in the read itself: the ref still the member's and
  // imported, the session still theirs in this company with consent given.
  // `g.*` reads D857's nullable translation columns once they exist.
  const rows = (await env.DB.prepare(
    `SELECT g.* FROM interview_transcript_segments g
       JOIN interview_sessions s ON s.id = g.session_id
       JOIN interview_channel_refs r ON r.uid = ? AND r.user_id = s.created_by_user_id AND r.interview_id = s.interview_id
      WHERE g.session_id = ? AND g.source = 'final'
        AND s.created_by_user_id = ? AND s.project_id = ? AND s.consent_status = 'given'
        AND r.status = 'imported' AND s.submitted_via = r.provider
        AND (? IS NULL OR COALESCE(g.start_ms, 0) > ? OR (COALESCE(g.start_ms, 0) = ? AND g.id > ?))
      ORDER BY COALESCE(g.start_ms, 0), g.id LIMIT ?`,
  ).bind(ref.uid, sessionId, userId, companyId, afterId, anchor?.start_ms ?? 0, anchor?.start_ms ?? 0, afterId, limit + 1)
    .all<SegmentRow>()).results ?? [];
  if (!rows.length && afterId === null) {
    const consented = await env.DB.prepare("SELECT 1 FROM interview_sessions WHERE id = ? AND consent_status = 'given'").bind(sessionId).first();
    if (!consented) return { meeting, transcript: null, reason: NOT_READABLE.no_consent };
  }
  const ids = identifiersOf(ref);
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const segments = await Promise.all(page.map(async (g) => {
    // D857 stores the translation encrypted, bound to its segment; unreadable is null, never ciphertext.
    const translated = g.translated_text
      ? await decryptColumn(env, 'interview_transcript_segments', 'translated_text', g.id, g.translated_text) : null;
    return {
      id: g.id, speaker: exportText(g.speaker_label, ids), text: exportText(g.text, ids),
      start_ms: g.start_ms, end_ms: g.end_ms, source_lang: g.source_lang ?? null,
      translation: translated === null ? null : { text: exportText(translated, ids), language: g.translated_lang ?? null },
    };
  }));
  return { meeting, transcript: { segments, next_after_id: more ? page.at(-1)!.id : null, complete: !more }, reason: null };
}

// ── The summary ──────────────────────────────────────────────────────────────

/**
 * The engine's summary of a call: the stored one, or, when there is none or
 * `rerun` asks, one run now through `digestSession` exactly as the session
 * page's Summarise button runs it. That run holds and settles its own AI
 * tokens through `aiRouter` (D640); the tool adds no fee of its own (D844's
 * composite rule), so a call is charged once.
 */
export async function summarizeMeeting(env: Env, userId: number, companyId: number, uid: string, rerun = false) {
  const ref = await memberMeeting(env, userId, companyId, uid);
  if (ref.status !== 'imported' || ref.transcript_session_id == null) {
    throw new ToolError(409, 'no_transcript', "This call's transcript is not in StudioOS yet, so there is nothing to summarise.");
  }
  const sessionId = Number(ref.transcript_session_id);
  let session = await loadSession(env, sessionId);
  if (!session || Number(session.project_id) !== companyId) throw new ToolError(404, 'meeting_not_found', 'That call is not one of yours in this company.');
  // Consent is the engine's to check (`sessionDigestConsentBlocks`), as for the button; a declined call records nothing.
  let ran = false;
  if (rerun || !session.digest_json) {
    const out = await digestSession(env, { sessionId, userId, trigger: 'manual', stages: ['summarise'], force: true });
    if (out.status === 'not_writable') throw new ToolError(404, 'meeting_not_found', 'That call is not one of yours in this company.');
    if (out.status === 'skipped') throw new ToolError(409, 'no_final_transcript', 'This call has no final transcript to summarise yet.');
    if (out.status === 'refused') {
      if (out.reason === 'busy') throw new ToolError(409, 'digest_running', out.note);
      if (out.reason === 'consent_not_recorded') throw new ToolError(409, 'consent_not_recorded', out.note);
      // The ledger's own refusal (no AI tokens, a limit, a pause): its words, never an amount.
      if (out.refusal && Object.prototype.hasOwnProperty.call(REFUSAL_WORDS, out.refusal)) throw refusalFor(out.refusal);
      throw new ToolError(409, 'refused', out.note);
    }
    if (out.status === 'done' && out.summary && !out.summary.ok && out.summary.reason === 'no_citation') {
      throw new ToolError(422, 'no_citation', 'The summary could not be tied to the transcript, so none is stored.');
    }
    ran = true;
    session = (await loadSession(env, sessionId))!;
  }
  const ids = identifiersOf(ref);
  return {
    meeting: { id: ref.uid, provider: ref.provider, session_id: sessionId },
    ran,
    summary: exportDeep(summaryOf(session), ids),
    digest: exportDeep(await sessionDigest(env, session, { writer: true, quoteConsent: false }), ids),
  };
}

// ── The tools ────────────────────────────────────────────────────────────────

export const MEETING_TOOLS: McpTool[] = [
  {
    name: 'list_meetings',
    requiredScope: 'validate:read',
    source: 'axal',
    version: '1.0.0',
    title: 'List recorded calls',
    description: 'List your Zoom and Google Meet calls in StudioOS: each call\'s id, provider, state (scheduled, ended, transcript_ready, imported, no_transcript, failed or cancelled), whether it was scheduled from an interview or attached to a recording, its times, and its company, interview and session. A call in a company this connection does not reach is not listed. Never a transcript, a join link, a meeting id or a passcode.',
    inputSchema: {
      provider: z.enum(PROVIDERS).optional(),
      state: z.enum(STATES).optional(),
      limit: z.number().int().min(1).max(LIST_LIMIT).optional(),
    },
    company: false,
    run: async ({ env, user, companies, args }) => ({
      meetings: await listMeetings(env, Number(user.id), companies, {
        provider: args.provider as string | undefined, state: args.state as string | undefined, limit: args.limit as number | undefined,
      }),
    }),
  },
  {
    name: 'get_meeting_transcript',
    requiredScope: 'validate:read',
    source: 'axal',
    version: '1.0.0',
    title: 'Get a call\'s transcript',
    description: 'Read the stored transcript of one of your imported calls in a company, while its consent is recorded: each line\'s speaker, text and times, with a stored translation beside the original. Pages of up to 200 lines; continue with after_id while next_after_id is set. Links, phone numbers, meeting ids and passcodes are removed from the text.',
    inputSchema: {
      company: z.number().int().positive(), meeting: MEETING,
      after_id: z.number().int().positive().optional(), limit: z.number().int().min(1).max(TRANSCRIPT_LIMIT).optional(),
    },
    company: true,
    run: async ({ env, user, company, args }) => meetingTranscript(env, Number(user.id), company!.id, String(args.meeting), {
      afterId: args.after_id as number | undefined, limit: args.limit as number | undefined,
    }),
  },
  {
    name: 'summarize_meeting',
    requiredScope: 'validate:write',
    source: 'axal',
    version: '1.0.0',
    title: 'Summarise a call',
    description: 'Get the StudioOS summary of one of your imported calls in a company: its overview, key quotes, decisions and next steps, each tied to the transcript. When the call has no summary yet, or rerun is true, StudioOS writes one now, which uses AI tokens. The summary is a draft for you to keep or edit in StudioOS.',
    inputSchema: { company: z.number().int().positive(), meeting: MEETING, rerun: z.boolean().optional() },
    company: true,
    readOnly: false,
    run: async ({ env, user, company, args }) => summarizeMeeting(env, Number(user.id), company!.id, String(args.meeting), args.rerun === true),
  },
];
