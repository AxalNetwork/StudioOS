/**
 * D858 (#2503) — what a founder's customer conversations show, as data points.
 *
 * For one session, and for a venture's chats over a date range: messages by
 * side, voice notes and their minutes, languages, reply time, how much of a
 * chat reached a suggestion, the pain themes, objections, willingness-to-pay
 * and competitor mentions, and the quotes behind each theme.
 *
 * EVERY FIGURE COMES FROM A RECORD THE PLATFORM ALREADY HOLDS. Nothing here
 * calls a model or writes a row. A figure is `{ value, sources, reason }`:
 *   - `sources` says what it was read from, `Recorded` (a voice note, a
 *     recording) or `Typed` (a chat's text, typed notes), the two labels of
 *     #2431, derived here from the session's channel and its voice-note rows,
 *     since no stored row carries them;
 *   - `value` is null when there is no record, and `reason` then says why. An
 *     unknown is never a 0: a count of zero is a count the records made.
 *
 * WHAT THE STORES DO NOT HOLD, AND SO WHAT READS NULL (filed on #2500):
 *   - a chat message's send time and direction are kept only while the chat is
 *     pending; once it moves into a session each line keeps its speaker and the
 *     time it was moved, so a reply time cannot be measured;
 *   - a WhatsApp voice note arrives without its length, and the note's
 *     placeholder (where Telegram's length sat) goes with the append, so voice
 *     minutes are known for a recording, not for a chat;
 *   - chat text carries no language until W2's translation (#2502) lands; a
 *     voice note's language is the one its speech-to-text detected.
 *
 * WHAT A SUGGESTION COUNTS. The structure pass's proposals
 * (`validate_proposals`, D658) are where a conversation's findings live until
 * the founder accepts them. `suggested` counts the ones not discarded,
 * `accepted` the ones the founder accepted; nothing here accepts anything.
 *
 * QUOTES ONLY WITH CONSENT TO QUOTE (D685 §5.1.4). A session's read shows a
 * theme's quotes only when its interview's `quote_consent` is 1 and the chat's
 * consent was not withdrawn; otherwise `QUOTE_WITHHELD`. A venture's read
 * carries aggregates only: per theme, how many quotes could be shown and how
 * many are withheld, never their words.
 *
 * THE CHANNEL (D866, #2512). Every read names its sessions' channel:
 * `telegram`, `whatsapp`, `zoom`, `google_meet` (the session's `submitted_via`,
 * else the provider of the chat that points at it), `recorder` (a recording
 * made in StudioOS), or the session's own channel (`text`, `manual`); a
 * session with none of these is NULL, never a guess. Both reads take a
 * `channel` filter, and a venture's read also gives its figures per channel
 * (`by_channel`), each the same figures as the whole, quotes aside.
 */
import type { Env } from '../types';
import { QUOTE_WITHHELD } from './cycleValidate';
import { AUDIO_CHANNELS } from './interviewSessions';
import { toSegments, type SegmentRow } from './interviewStructuring';
import { normPhrase } from './painGroups';
import { MESSAGING_PROVIDERS } from './channels/types';

export type SourceLabel = 'Recorded' | 'Typed';

export interface Figure<T> {
  value: T | null;
  sources: SourceLabel[];
  reason: string | null;
}

export const REASONS = {
  replyTime: "Not recorded: a chat message's send time is not kept once the chat moves into a session.",
  replyTimeNotChat: 'Not recorded: reply time is measured on chats only.',
  chatVoiceMinutes: 'Not recorded: WhatsApp and Telegram voice notes are stored without their length.',
  textLanguage: 'Not recorded: chat text carries no language until translation (W2, #2502) lands.',
  recordingLanguage: 'Not recorded: the recorder did not record a language for this session.',
  notChat: 'Not recorded: this session is not a chat, so it has no voice notes.',
  noTranscript: 'Not recorded: this conversation has no transcript yet.',
  unreadable: (store: string) => `Not recorded: the ${store} could not be read.`,
} as const;

/** The most quotes one theme shows in a session's read. */
export const QUOTES_PER_THEME = 5;
/** The most sessions one venture read takes, newest first. */
export const VENTURE_SESSIONS_MAX = 500;
const QUOTE_CHARS = 300;
const WTP_SIGNALS = new Set(['would_pay', 'loi', 'pre_sale']);
const ME = 'Me';

const known = <T>(value: T, sources: SourceLabel[]): Figure<T> => ({ value, sources, reason: null });
const unknown = <T>(reason: string): Figure<T> => ({ value: null, sources: [], reason });

/** A store this build lacks reads as unknown, with its name; any other failure is a real error. */
async function readOr<T>(store: string, read: () => Promise<Figure<T>>): Promise<Figure<T>> {
  try {
    return await read();
  } catch (e) {
    if (/no such (table|column)/i.test(String((e as Error)?.message ?? e))) return unknown<T>(REASONS.unreadable(store));
    throw e;
  }
}

export interface AnalyticsSession {
  id: number;
  interview_id: number;
  project_id: number;
  channel: string;
  submitted_via: string | null;
  consent_status: string;
  active_ms: number | null;
  language: string | null;
  created_at: string;
  /** D866: the provider of the chat that points at this session, when there is one. */
  thread_provider?: string | null;
}

/** D866: what a `channel` filter may name. */
export const CHANNEL_NAME = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * D866 (#2512): a session's channel, the same order as the digest's `source`
 * (`interviewProcessing.ts`): the provider it came in on, else `recorder` for a
 * recording, else the session's own channel. Unknown is null.
 */
export function channelOf(s: Pick<AnalyticsSession, 'channel' | 'submitted_via' | 'thread_provider'>): string | null {
  const via = String(s.submitted_via ?? '').trim() || String(s.thread_provider ?? '').trim();
  if (via) return via;
  if (AUDIO_CHANNELS.has(String(s.channel ?? ''))) return 'recorder';
  return String(s.channel ?? '').trim() || null;
}

const AUDIO_JSON = JSON.stringify([...AUDIO_CHANNELS]);

type Kind = 'chat' | 'recording' | 'typed';
const kindOf = (s: AnalyticsSession): Kind =>
  AUDIO_CHANNELS.has(s.channel) ? 'recording'
    : s.submitted_via && (MESSAGING_PROVIDERS as readonly string[]).includes(s.submitted_via) ? 'chat' : 'typed';

interface SideCounts { typed: number; recorded: number }
export interface MessageCounts { founder: SideCounts; customer: SideCounts; total: number }
export interface Reach { cited: number; of: number; share: number }
export interface ThemeCount { group_id: number | null; title: string | null; suggested: number; accepted: number }
export interface ObjectionCount { about: string; suggested: number; accepted: number }
export interface WtpCount { suggested: number; accepted: number; by_kind: Record<string, number> }
export interface CompetitorCount { name: string; suggested: number; accepted: number }
export interface ThemeQuotes { group_id: number | null; title: string | null; quotes: string[] }
export interface ThemeQuoteCount { group_id: number | null; title: string | null; quotable: number; withheld: number }

interface Proposal {
  session_id: number; kind: string; status: string; payload: string | null;
  cite_from: number | null; cite_to: number | null; citation_json: string | null;
}

const parse = (s: string | null): Record<string, unknown> => {
  try { const v = JSON.parse(String(s ?? '')); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
};
const ids = (rows: readonly { id: number }[]) => JSON.stringify(rows.map((r) => r.id));

/** The sessions' final transcript lines, in the structure pass's own order. */
async function finalSegments(env: Env, sessionIds: string) {
  return (await env.DB.prepare(
    `SELECT id, session_id, start_ms, end_ms, speaker_label, text FROM interview_transcript_segments
      WHERE source = 'final' AND session_id IN (SELECT value FROM json_each(?))
      ORDER BY session_id, COALESCE(start_ms, 0), id`,
  ).bind(sessionIds).all<SegmentRow & { session_id: number }>()).results ?? [];
}

async function voiceNotes(env: Env, sessions: readonly AnalyticsSession[]) {
  const chats = sessions.filter((s) => kindOf(s) === 'chat');
  if (!chats.length) return [];
  return (await env.DB.prepare(
    `SELECT session_id, language, segments_json FROM interview_chunk_transcripts
      WHERE session_id IN (SELECT value FROM json_each(?)) ORDER BY session_id, seq`,
  ).bind(ids(chats)).all<{ session_id: number; language: string | null; segments_json: string | null }>()).results ?? [];
}

async function proposals(env: Env, sessionIds: string): Promise<Proposal[]> {
  return (await env.DB.prepare(
    `SELECT session_id, kind, status, COALESCE(edited_payload_json, payload_json) AS payload,
            cite_from, cite_to, citation_json
       FROM validate_proposals WHERE session_id IN (SELECT value FROM json_each(?)) ORDER BY id`,
  ).bind(sessionIds).all<Proposal>()).results ?? [];
}

/** A voice note's side, from the one segment its transcript appended: `Me`, else the customer. */
function noteSide(segmentsJson: string | null): 'founder' | 'customer' | null {
  let segs: unknown;
  try { segs = JSON.parse(String(segmentsJson ?? '[]')); } catch { return null; }
  const first = Array.isArray(segs) ? segs.find((s) => String((s as { text?: unknown })?.text ?? '').trim()) : null;
  if (!first) return null;
  return (first as { speaker_label?: unknown }).speaker_label === ME ? 'founder' : 'customer';
}

function messageCounts(
  sessions: readonly AnalyticsSession[], segments: readonly (SegmentRow & { session_id: number })[],
  notes: readonly { session_id: number; segments_json: string | null }[],
): Figure<MessageCounts> {
  const counts: MessageCounts = { founder: { typed: 0, recorded: 0 }, customer: { typed: 0, recorded: 0 }, total: 0 };
  const kinds = new Map(sessions.map((s) => [s.id, kindOf(s)]));
  for (const seg of segments) {
    if (!String(seg.text ?? '').trim()) continue;
    const side = seg.speaker_label === ME ? 'founder' : 'customer';
    if (kinds.get(seg.session_id) === 'recording') counts[side].recorded += 1;
    else counts[side].typed += 1;
    counts.total += 1;
  }
  // A chat's voice note appended one segment under its side's label; count it as recorded, not typed.
  for (const note of notes) {
    const side = noteSide(note.segments_json);
    if (!side || counts[side].typed === 0) continue;
    counts[side].typed -= 1;
    counts[side].recorded += 1;
  }
  const sources: SourceLabel[] = [];
  if (counts.founder.recorded + counts.customer.recorded > 0) sources.push('Recorded');
  if (counts.founder.typed + counts.customer.typed > 0) sources.push('Typed');
  return known(counts, sources);
}

/** How much of the transcript a suggestion cites: segments any proposal's span touches, over all segments. */
function reach(segments: readonly (SegmentRow & { session_id: number })[], props: readonly Proposal[], sources: SourceLabel[]): Figure<Reach> {
  const bySession = new Map<number, (SegmentRow & { session_id: number })[]>();
  for (const seg of segments) bySession.set(seg.session_id, [...(bySession.get(seg.session_id) ?? []), seg]);
  let of = 0;
  let cited = 0;
  for (const [sessionId, rows] of bySession) {
    // The same spans the structure pass cited (`toSegments`, `structureSession`'s order).
    const spans = toSegments(rows);
    const cites = props.filter((p) => p.session_id === sessionId && p.cite_from != null && p.cite_to != null);
    of += spans.length;
    // A span's `to` is its last line's end, an exclusive bound, as `quoteSpan` builds it.
    cited += spans.filter((s) => cites.some((p) => (p.cite_from as number) < s.end && (p.cite_to as number) > s.start)).length;
  }
  if (!of) return unknown(REASONS.noTranscript);
  return known({ cited, of, share: Math.round((cited / of) * 1000) / 1000 }, sources);
}

async function themeOf(env: Env, projectId: number) {
  const groups = (await env.DB.prepare('SELECT id, title FROM pain_groups WHERE project_id = ? ORDER BY sort_order, id')
    .bind(projectId).all<{ id: number; title: string }>()).results ?? [];
  const aliases = (await env.DB.prepare('SELECT group_id, phrase_norm FROM pain_group_aliases WHERE project_id = ?')
    .bind(projectId).all<{ group_id: number; phrase_norm: string }>()).results ?? [];
  const title = new Map(groups.map((g) => [g.id, g.title]));
  const alias = new Map(aliases.map((a) => [a.phrase_norm, a.group_id]));
  return (payload: Record<string, unknown>): { group_id: number | null; title: string | null } => {
    const named = Number(payload.pain_group_id);
    const id = Number.isSafeInteger(named) && title.has(named) ? named : alias.get(normPhrase(String(payload.phrase ?? ''))) ?? null;
    return id != null && title.has(id) ? { group_id: id, title: title.get(id) ?? null } : { group_id: null, title: null };
  };
}

const live = (p: Proposal) => p.status !== 'discarded';
const tally = <K>(map: Map<K, { suggested: number; accepted: number }>, key: K, p: Proposal) => {
  const t = map.get(key) ?? { suggested: 0, accepted: 0 };
  t.suggested += 1;
  if (p.status === 'accepted') t.accepted += 1;
  map.set(key, t);
};

function objections(props: readonly Proposal[], sources: SourceLabel[]): Figure<ObjectionCount[]> {
  const by = new Map<string, { suggested: number; accepted: number }>();
  for (const p of props.filter((x) => x.kind === 'objection' && live(x))) {
    tally(by, String(parse(p.payload).about ?? 'other'), p);
  }
  return known([...by].map(([about, t]) => ({ about, ...t })).sort((a, b) => b.suggested - a.suggested || a.about.localeCompare(b.about)), sources);
}

function wtp(props: readonly Proposal[], sources: SourceLabel[]): Figure<WtpCount> {
  const out: WtpCount = { suggested: 0, accepted: 0, by_kind: {} };
  for (const p of props.filter(live)) {
    const kind = p.kind === 'budget' ? 'budget'
      : p.kind === 'demand_signal' && WTP_SIGNALS.has(String(parse(p.payload).signal)) ? String(parse(p.payload).signal) : null;
    if (!kind) continue;
    out.suggested += 1;
    if (p.status === 'accepted') out.accepted += 1;
    out.by_kind[kind] = (out.by_kind[kind] ?? 0) + 1;
  }
  return known(out, sources);
}

function competitors(props: readonly Proposal[], sources: SourceLabel[]): Figure<CompetitorCount[]> {
  const by = new Map<string, { name: string; suggested: number; accepted: number }>();
  for (const p of props.filter((x) => x.kind === 'competitor_mention' && live(x))) {
    const name = String(parse(p.payload).name ?? '').trim().slice(0, 120);
    if (!name) continue;
    const key = name.toLowerCase();
    const t = by.get(key) ?? { name, suggested: 0, accepted: 0 };
    t.suggested += 1;
    if (p.status === 'accepted') t.accepted += 1;
    by.set(key, t);
  }
  return known([...by.values()].sort((a, b) => b.suggested - a.suggested || a.name.localeCompare(b.name)), sources);
}

function painThemes(props: readonly Proposal[], theme: Awaited<ReturnType<typeof themeOf>>, sources: SourceLabel[]): Figure<ThemeCount[]> {
  const by = new Map<string, ThemeCount>();
  for (const p of props.filter((x) => x.kind === 'pain_severity' && live(x))) {
    const t = theme(parse(p.payload));
    const key = String(t.group_id);
    const row = by.get(key) ?? { ...t, suggested: 0, accepted: 0 };
    row.suggested += 1;
    if (p.status === 'accepted') row.accepted += 1;
    by.set(key, row);
  }
  return known([...by.values()].sort((a, b) => b.suggested - a.suggested || (a.group_id ?? Infinity) - (b.group_id ?? Infinity)), sources);
}

/** Whether a session's words may be quoted: the interview's quote consent, and a chat consent not withdrawn. */
async function quotable(env: Env, sessions: readonly AnalyticsSession[]): Promise<Set<number>> {
  const interviews = (await env.DB.prepare(
    'SELECT id, quote_consent FROM discovery_interviews WHERE id IN (SELECT value FROM json_each(?))',
  ).bind(JSON.stringify([...new Set(sessions.map((s) => s.interview_id))])).all<{ id: number; quote_consent: number | null }>()).results ?? [];
  const agreed = new Set(interviews.filter((i) => Number(i.quote_consent) === 1).map((i) => i.id));
  return new Set(sessions.filter((s) => agreed.has(s.interview_id) && s.consent_status !== 'declined').map((s) => s.id));
}

const quoteOf = (p: Proposal): string | null => {
  const q = String(parse(p.citation_json).quote ?? '').trim();
  return q ? q.slice(0, QUOTE_CHARS) : null;
};

/** Each language and its count: a chat's voice notes, as speech-to-text detected it, or the recording itself. */
function languages(sessions: readonly AnalyticsSession[], notes: readonly { language: string | null }[]): Figure<{ language: string; count: number }[]> {
  const kinds = new Set(sessions.map(kindOf));
  if (kinds.has('recording') && sessions.length === 1) {
    const lang = sessions[0].language;
    return lang ? known([{ language: lang, count: 1 }], ['Recorded']) : unknown(REASONS.recordingLanguage);
  }
  if (!kinds.has('chat')) return unknown(REASONS.notChat);
  const by = new Map<string, number>();
  for (const n of notes) if (n.language) by.set(n.language, (by.get(n.language) ?? 0) + 1);
  return known([...by].map(([language, count]) => ({ language, count })).sort((a, b) => b.count - a.count || a.language.localeCompare(b.language)), notes.length ? ['Recorded'] : []);
}

function voice(sessions: readonly AnalyticsSession[], notes: readonly unknown[]) {
  const kinds = new Set(sessions.map(kindOf));
  const notesFig: Figure<number> = kinds.has('chat') ? known(notes.length, notes.length ? ['Recorded'] : []) : unknown(REASONS.notChat);
  let minutes: Figure<number>;
  if (kinds.has('chat')) minutes = unknown(REASONS.chatVoiceMinutes);
  else if (kinds.has('recording')) {
    const ms = sessions.reduce((n, s) => n + Number(s.active_ms || 0), 0);
    minutes = known(Math.round(ms / 6_000) / 10, ['Recorded']);
  } else minutes = known(0, ['Typed']);
  return { notes: notesFig, minutes };
}

export interface SessionAnalytics {
  session: { id: number; kind: Kind; provider: string | null; channel: string | null; created_at: string };
  messages: Figure<MessageCounts>;
  voice_notes: Figure<number>;
  voice_minutes: Figure<number>;
  languages: Figure<{ language: string; count: number }[]>;
  text_languages: Figure<{ language: string; messages: number }[]>;
  median_reply_seconds: Figure<number>;
  suggestion_reach: Figure<Reach>;
  pain_themes: Figure<ThemeCount[]>;
  objections: Figure<ObjectionCount[]>;
  wtp_mentions: Figure<WtpCount>;
  competitor_mentions: Figure<CompetitorCount[]>;
}

/** The figures both reads share, over a set of sessions of one venture. */
async function figures(env: Env, projectId: number, sessions: readonly AnalyticsSession[]) {
  const sessionIds = ids(sessions);
  const segments = await finalSegments(env, sessionIds);
  const notes = await voiceNotes(env, sessions).catch((e) => {
    if (/no such (table|column)/i.test(String(e?.message ?? e))) return null;
    throw e;
  });
  const messages = notes ? messageCounts(sessions, segments, notes) : unknown<MessageCounts>(REASONS.unreadable('voice-note store'));
  const sources = messages.sources;
  const props = await proposals(env, sessionIds).catch((e) => {
    if (/no such (table|column)/i.test(String(e?.message ?? e))) return null;
    throw e;
  });
  const suggestionsMissing = REASONS.unreadable('suggestion store');
  const anyChat = sessions.some((s) => kindOf(s) === 'chat');
  const v = notes ? voice(sessions, notes) : { notes: unknown<number>(REASONS.unreadable('voice-note store')), minutes: unknown<number>(REASONS.unreadable('voice-note store')) };
  return {
    segments, notes, props,
    shared: {
      messages,
      voice_notes: v.notes,
      voice_minutes: v.minutes,
      languages: notes ? languages(sessions, notes) : unknown<{ language: string; count: number }[]>(REASONS.unreadable('voice-note store')),
      text_languages: unknown<{ language: string; messages: number }[]>(REASONS.textLanguage),
      median_reply_seconds: unknown<number>(anyChat ? REASONS.replyTime : REASONS.replyTimeNotChat),
      suggestion_reach: props ? reach(segments, props, sources) : unknown<Reach>(suggestionsMissing),
      pain_themes: props
        ? await readOr('pain-theme store', async () => painThemes(props, await themeOf(env, projectId), sources))
        : unknown<ThemeCount[]>(suggestionsMissing),
      objections: props ? objections(props, sources) : unknown<ObjectionCount[]>(suggestionsMissing),
      wtp_mentions: props ? wtp(props, sources) : unknown<WtpCount>(suggestionsMissing),
      competitor_mentions: props ? competitors(props, sources) : unknown<CompetitorCount[]>(suggestionsMissing),
    },
  };
}

/** One session's analytics, its quotes per theme included where consent allows. */
export async function sessionAnalytics(env: Env, session: AnalyticsSession): Promise<SessionAnalytics & { quotes_by_theme: Figure<ThemeQuotes[]> }> {
  const { props, shared } = await figures(env, session.project_id, [session]);
  let quotes: Figure<ThemeQuotes[]>;
  if (!props) quotes = unknown(REASONS.unreadable('suggestion store'));
  else if (!(await quotable(env, [session])).has(session.id)) quotes = unknown(QUOTE_WITHHELD);
  else {
    quotes = await readOr('pain-theme store', async () => {
      const theme = await themeOf(env, session.project_id);
      const by = new Map<string, ThemeQuotes>();
      for (const p of props.filter((x) => x.kind === 'pain_severity' && live(x))) {
        const q = quoteOf(p);
        if (!q) continue;
        const t = theme(parse(p.payload));
        const row = by.get(String(t.group_id)) ?? { ...t, quotes: [] };
        if (row.quotes.length < QUOTES_PER_THEME && !row.quotes.includes(q)) row.quotes.push(q);
        by.set(String(t.group_id), row);
      }
      return known([...by.values()], shared.messages.sources);
    });
  }
  return {
    session: { id: session.id, kind: kindOf(session), provider: session.submitted_via, channel: channelOf(session), created_at: session.created_at },
    ...shared,
    quotes_by_theme: quotes,
  };
}

/**
 * A venture's sessions in the range, newest first, at most VENTURE_SESSIONS_MAX:
 * its chats (D858) when no channel is named, else the sessions of that channel
 * (D866), recordings and typed notes included.
 */
export async function ventureChatSessions(env: Env, projectId: number, from: string | null, to: string | null, channel: string | null = null) {
  // `channelOf` in SQL, so a named channel narrows the rows before their LIMIT.
  // Literal SQL: the schema guard reads every column it names.
  const rows = (await env.DB.prepare(
    `SELECT s.id, s.interview_id, s.project_id, s.channel, s.submitted_via, s.consent_status, s.active_ms, s.language, s.created_at,
            (SELECT t.provider FROM channel_threads t WHERE t.session_id = s.id ORDER BY t.id LIMIT 1) AS thread_provider
       FROM interview_sessions s
      WHERE s.project_id = ?
        AND CASE WHEN ? IS NULL THEN s.submitted_via IN (SELECT value FROM json_each(?))
                 ELSE COALESCE(NULLIF(TRIM(s.submitted_via), ''),
                        (SELECT NULLIF(TRIM(t.provider), '') FROM channel_threads t WHERE t.session_id = s.id ORDER BY t.id LIMIT 1),
                        CASE WHEN s.channel IN (SELECT value FROM json_each(?)) THEN 'recorder' ELSE NULLIF(TRIM(s.channel), '') END) = ? END
        AND (? IS NULL OR datetime(s.created_at) >= datetime(?))
        AND (? IS NULL OR datetime(s.created_at) < datetime(?, '+1 day'))
      ORDER BY datetime(s.created_at) DESC, s.id DESC LIMIT ?`,
  ).bind(projectId, channel, JSON.stringify(MESSAGING_PROVIDERS), AUDIO_JSON, channel, from, from, to, to, VENTURE_SESSIONS_MAX + 1)
    .all<AnalyticsSession>()).results ?? [];
  return { sessions: rows.slice(0, VENTURE_SESSIONS_MAX), truncated: rows.length > VENTURE_SESSIONS_MAX };
}

type Shared = Awaited<ReturnType<typeof figures>>['shared'];

/** D866: the venture's figures per channel, each group read as a venture of its own. Unknown is the key `unknown`. */
async function perChannel(env: Env, projectId: number, sessions: readonly AnalyticsSession[]) {
  const groups = new Map<string, AnalyticsSession[]>();
  for (const s of sessions) {
    const key = channelOf(s) ?? 'unknown';
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const out: Record<string, { channel: string | null; sessions: number } & Shared> = {};
  for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const { shared } = await figures(env, projectId, group);
    out[key] = { channel: key === 'unknown' ? null : key, sessions: group.length, ...shared };
  }
  return out;
}

/** A venture's chats (or one channel's sessions) over a range: aggregates only, never a quote's words. */
export async function ventureAnalytics(env: Env, projectId: number, range: { from: string | null; to: string | null; channel?: string | null }) {
  const channel = range.channel ?? null;
  const { sessions, truncated } = await ventureChatSessions(env, projectId, range.from, range.to, channel);
  const byProvider: Record<string, number> = {};
  for (const s of sessions) byProvider[String(s.submitted_via)] = (byProvider[String(s.submitted_via)] ?? 0) + 1;
  const byChannel: Record<string, number> = {};
  for (const s of sessions) byChannel[channelOf(s) ?? 'unknown'] = (byChannel[channelOf(s) ?? 'unknown'] ?? 0) + 1;
  const base = {
    project_id: projectId, from: range.from, to: range.to, channel, sessions: sessions.length,
    sessions_by_provider: byProvider, sessions_by_channel: byChannel, truncated,
  };
  if (!sessions.length) {
    const none = REASONS.noTranscript;
    return {
      ...base,
      messages: known<MessageCounts>({ founder: { typed: 0, recorded: 0 }, customer: { typed: 0, recorded: 0 }, total: 0 }, []),
      voice_notes: known(0, []), voice_minutes: unknown<number>(REASONS.chatVoiceMinutes),
      languages: known<{ language: string; count: number }[]>([], []), text_languages: unknown<{ language: string; messages: number }[]>(REASONS.textLanguage),
      median_reply_seconds: unknown<number>(REASONS.replyTime), suggestion_reach: unknown<Reach>(none),
      pain_themes: known<ThemeCount[]>([], []), objections: known<ObjectionCount[]>([], []),
      wtp_mentions: known<WtpCount>({ suggested: 0, accepted: 0, by_kind: {} }, []), competitor_mentions: known<CompetitorCount[]>([], []),
      quotes_by_theme: known<ThemeQuoteCount[]>([], []),
      by_channel: {},
    };
  }
  const { props, shared } = await figures(env, projectId, sessions);
  let quotes: Figure<ThemeQuoteCount[]>;
  if (!props) quotes = unknown(REASONS.unreadable('suggestion store'));
  else {
    quotes = await readOr('pain-theme store', async () => {
      const theme = await themeOf(env, projectId);
      const allowed = await quotable(env, sessions);
      const by = new Map<string, ThemeQuoteCount>();
      for (const p of props.filter((x) => x.kind === 'pain_severity' && live(x) && quoteOf(x))) {
        const t = theme(parse(p.payload));
        const row = by.get(String(t.group_id)) ?? { ...t, quotable: 0, withheld: 0 };
        if (allowed.has(p.session_id)) row.quotable += 1; else row.withheld += 1;
        by.set(String(t.group_id), row);
      }
      return known([...by.values()], shared.messages.sources);
    });
  }
  return { ...base, ...shared, quotes_by_theme: quotes, by_channel: await perChannel(env, projectId, sessions) };
}
