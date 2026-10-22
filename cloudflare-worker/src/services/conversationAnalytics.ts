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
 * CALLS (D873, #2520). A Zoom or Google Meet call imported with its provider's
 * transcript, or a recording uploaded (#2519), is a `call`, its `channel`
 * `zoom`, `meet` or `upload` from `submitted_via`. A call can hold more than
 * two people, so a line is the founder's only when its speaker is "Me" or the
 * founder's own name, and the customer's only when it is the interviewee's
 * name; anyone else ("Speaker ?", a colleague, a second customer) is
 * `unattributed`, never the interviewee. A call's length is the recorder's
 * `active_ms` when it kept one (an upload), else its last line's end (an
 * import keeps none), else null. A chat or a typed paste has
 * two parties, the founder's "Me" and the other side, as D858 counts them.
 *
 * THE CHANNEL (D866, #2512). Every read names its sessions' channel
 * (`channelOf`): a call's (`zoom`, `meet`, `upload`, D873); else the
 * provider a chat came in on (`telegram`, `whatsapp`, from `submitted_via`,
 * else from the chat that points at the session); else `recorder` for a
 * recording made in StudioOS; else the session's own channel (`text`,
 * `manual`). A session with none of these is NULL, never a guess. Both reads
 * take a `channel` filter, and a venture's read also gives its figures per
 * channel (`by_channel`), each the same figures as the whole, quotes aside.
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
  callMinutes: "Not recorded: this call's transcript carries no times, so its length is unknown.",
  callLanguage: "Not recorded: the call's transcript did not record a language.",
  transcriptModel: 'Not recorded: this transcript does not say how it was made.',
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
  created_by_user_id: number;
  final_model: string | null;
  /** D866: the provider of the chat that points at this session, when there is one. */
  thread_provider?: string | null;
}

/** A call's channel as the reads name it, by its session's `submitted_via` (D873). */
export const CALL_CHANNELS: ReadonlyMap<string, 'zoom' | 'meet' | 'upload'> = new Map([
  ['zoom', 'zoom'], ['google_meet', 'meet'], ['upload', 'upload'],
]);
const callChannel = (s: Pick<AnalyticsSession, 'submitted_via'>) => (s.submitted_via ? CALL_CHANNELS.get(s.submitted_via) ?? null : null);

/** D866: what a `channel` filter may name. */
export const CHANNEL_NAME = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * D866 (#2512): a session's channel. A call's is D873's name for it; else the
 * provider it came in on, or the provider of the chat that points at it; else
 * `recorder` for a recording; else the session's own channel. Unknown is null.
 * `ventureSessions` says the same in SQL.
 */
export function channelOf(s: Pick<AnalyticsSession, 'channel' | 'submitted_via' | 'thread_provider'>): string | null {
  const call = callChannel(s);
  if (call) return call;
  const via = String(s.submitted_via ?? '').trim() || String(s.thread_provider ?? '').trim();
  if (via) return via;
  if (AUDIO_CHANNELS.has(String(s.channel ?? ''))) return 'recorder';
  return String(s.channel ?? '').trim() || null;
}
const AUDIO_JSON = JSON.stringify([...AUDIO_CHANNELS]);

type Kind = 'chat' | 'call' | 'recording' | 'typed';
const kindOf = (s: AnalyticsSession): Kind =>
  callChannel(s) ? 'call'
    : AUDIO_CHANNELS.has(s.channel) ? 'recording'
      : s.submitted_via && (MESSAGING_PROVIDERS as readonly string[]).includes(s.submitted_via) ? 'chat' : 'typed';
const spoken = (k: Kind | undefined) => k === 'recording' || k === 'call';

type Side = 'founder' | 'customer' | 'unattributed';
interface Names { interviewee: string; founder: string }
const normName = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Whose line it is. A chat or a paste has two parties, so any speaker but "Me"
 * is the customer. A recording or a call may hold more: a line is the
 * founder's or the interviewee's only by their name, and anyone else is
 * unattributed, never the interviewee.
 */
function sideOf(kind: Kind | undefined, label: string | null, names: Names | undefined): Side {
  const l = normName(label);
  if (l === normName(ME)) return 'founder';
  if (!spoken(kind)) return 'customer';
  if (!l) return 'unattributed';
  if (names && l === names.founder) return 'founder';
  if (l === 'interviewee' || (names && l === names.interviewee)) return 'customer';
  return 'unattributed';
}

interface SideCounts { typed: number; recorded: number }
export interface MessageCounts { founder: SideCounts; customer: SideCounts; unattributed: SideCounts; total: number }
export interface SpeakerCount { speaker: string; side: Side; lines: number }
export interface TranscriptSource { source: 'native' | 'speech_to_text' | 'chat' | 'typed'; channel: string | null; model: string | null }
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

/** Each spoken session's interviewee and founder names, to tell a call's sides apart. */
async function namesOf(env: Env, sessions: readonly AnalyticsSession[]): Promise<Map<number, Names>> {
  const spokenOnes = sessions.filter((s) => spoken(kindOf(s)));
  if (!spokenOnes.length) return new Map();
  const rows = (await env.DB.prepare(
    `SELECT s.id, i.interviewee_name, u.name FROM interview_sessions s
       LEFT JOIN discovery_interviews i ON i.id = s.interview_id
       LEFT JOIN users u ON u.id = s.created_by_user_id
      WHERE s.id IN (SELECT value FROM json_each(?))`,
  ).bind(ids(spokenOnes)).all<{ id: number; interviewee_name: string | null; name: string | null }>()).results ?? [];
  return new Map(rows.map((r) => [Number(r.id), { interviewee: normName(r.interviewee_name), founder: normName(r.name) }]));
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

const noMessages = (): MessageCounts => ({
  founder: { typed: 0, recorded: 0 }, customer: { typed: 0, recorded: 0 }, unattributed: { typed: 0, recorded: 0 }, total: 0,
});

function messageCounts(
  sessions: readonly AnalyticsSession[], segments: readonly (SegmentRow & { session_id: number })[],
  notes: readonly { session_id: number; segments_json: string | null }[], names: ReadonlyMap<number, Names>,
): Figure<MessageCounts> {
  const counts = noMessages();
  const kinds = new Map(sessions.map((s) => [s.id, kindOf(s)]));
  for (const seg of segments) {
    if (!String(seg.text ?? '').trim()) continue;
    const kind = kinds.get(seg.session_id);
    const side = sideOf(kind, seg.speaker_label, names.get(seg.session_id));
    if (spoken(kind)) counts[side].recorded += 1;
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
  const sides = [counts.founder, counts.customer, counts.unattributed];
  const sources: SourceLabel[] = [];
  if (sides.some((x) => x.recorded > 0)) sources.push('Recorded');
  if (sides.some((x) => x.typed > 0)) sources.push('Typed');
  return known(counts, sources);
}

/** One session's speakers, in the order they first speak, each with its side and its lines. */
function speakers(session: AnalyticsSession, segments: readonly SegmentRow[], names: ReadonlyMap<number, Names>): Figure<SpeakerCount[]> {
  const kind = kindOf(session);
  const by = new Map<string, SpeakerCount>();
  for (const seg of segments) {
    if (!String(seg.text ?? '').trim()) continue;
    const speaker = String(seg.speaker_label ?? '').trim() || 'Speaker ?';
    const row = by.get(speaker) ?? { speaker, side: sideOf(kind, speaker, names.get(session.id)), lines: 0 };
    row.lines += 1;
    by.set(speaker, row);
  }
  if (!by.size) return unknown(REASONS.noTranscript);
  return known([...by.values()], [spoken(kind) ? 'Recorded' : 'Typed']);
}

/** How the session's text was made: the provider's own transcript, Workers AI speech-to-text, a chat, or typed. */
function transcriptSource(session: AnalyticsSession, segments: readonly SegmentRow[]): Figure<TranscriptSource> {
  if (!segments.length) return unknown(REASONS.noTranscript);
  const kind = kindOf(session);
  const channel = callChannel(session) ?? (kind === 'chat' ? session.submitted_via : null);
  const model = session.final_model ? String(session.final_model) : null;
  if (kind === 'chat') return known({ source: 'chat', channel, model: null }, ['Typed']);
  if (kind === 'typed') return known({ source: 'typed', channel, model: null }, ['Typed']);
  if (!model) return unknown(REASONS.transcriptModel);
  // An import writes `<provider>_transcript` (meetings.ts); anything else is a speech-to-text model.
  const native = kind === 'call' && model === `${session.submitted_via}_transcript`;
  return known({ source: native ? 'native' : 'speech_to_text', channel, model }, ['Recorded']);
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
  if (sessions.length === 1 && spoken(kindOf(sessions[0]))) {
    const lang = sessions[0].language;
    if (lang) return known([{ language: lang, count: 1 }], ['Recorded']);
    return unknown(kinds.has('call') ? REASONS.callLanguage : REASONS.recordingLanguage);
  }
  if (!kinds.has('chat') && !kinds.has('call')) return unknown(REASONS.notChat);
  const by = new Map<string, number>();
  const add = (lang: string | null) => { if (lang) by.set(lang, (by.get(lang) ?? 0) + 1); };
  for (const n of notes) add(n.language);
  const calls = sessions.filter((s) => kindOf(s) === 'call');
  for (const s of calls) add(s.language);
  // Calls with no language among them read unknown; a chat without voice notes has none to count.
  if (!kinds.has('chat') && !by.size) return unknown(REASONS.callLanguage);
  return known([...by].map(([language, count]) => ({ language, count })).sort((a, b) => b.count - a.count || a.language.localeCompare(b.language)),
    notes.length || calls.some((s) => s.language) ? ['Recorded'] : []);
}

/** A call's length: the recorder's active time when it kept one, else its last line's end, else unknown. */
function callMs(session: AnalyticsSession, segments: readonly (SegmentRow & { session_id: number })[]): number | null {
  if (Number(session.active_ms) > 0) return Number(session.active_ms);
  let end: number | null = null;
  for (const seg of segments) {
    if (seg.session_id !== session.id) continue;
    const at = seg.end_ms ?? seg.start_ms;
    if (at != null && Number.isFinite(Number(at))) end = Math.max(end ?? 0, Number(at));
  }
  return end;
}

function voice(sessions: readonly AnalyticsSession[], notes: readonly unknown[], segments: readonly (SegmentRow & { session_id: number })[]) {
  const kinds = new Set(sessions.map(kindOf));
  const notesFig: Figure<number> = kinds.has('chat') ? known(notes.length, notes.length ? ['Recorded'] : []) : unknown(REASONS.notChat);
  let minutes: Figure<number>;
  if (kinds.has('chat')) minutes = unknown(REASONS.chatVoiceMinutes);
  else if (kinds.has('recording') || kinds.has('call')) {
    let ms = 0;
    let missing = false;
    for (const s of sessions) {
      const kind = kindOf(s);
      if (kind === 'recording') ms += Number(s.active_ms || 0);
      else if (kind === 'call') {
        const len = callMs(s, segments);
        if (len == null) missing = true; else ms += len;
      }
    }
    minutes = missing ? unknown(REASONS.callMinutes) : known(Math.round(ms / 6_000) / 10, ['Recorded']);
  } else minutes = known(0, ['Typed']);
  return { notes: notesFig, minutes };
}

export interface SessionAnalytics {
  session: { id: number; kind: Kind; provider: string | null; channel: string | null; created_at: string };
  messages: Figure<MessageCounts>;
  speakers: Figure<SpeakerCount[]>;
  transcript_source: Figure<TranscriptSource>;
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
  const names = await namesOf(env, sessions);
  const messages = notes ? messageCounts(sessions, segments, notes, names) : unknown<MessageCounts>(REASONS.unreadable('voice-note store'));
  const sources = messages.sources;
  const props = await proposals(env, sessionIds).catch((e) => {
    if (/no such (table|column)/i.test(String(e?.message ?? e))) return null;
    throw e;
  });
  const suggestionsMissing = REASONS.unreadable('suggestion store');
  const anyChat = sessions.some((s) => kindOf(s) === 'chat');
  const v = notes ? voice(sessions, notes, segments) : { notes: unknown<number>(REASONS.unreadable('voice-note store')), minutes: unknown<number>(REASONS.unreadable('voice-note store')) };
  return {
    segments, notes, props, names,
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
  const { segments, props, names, shared } = await figures(env, session.project_id, [session]);
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
    session: {
      id: session.id, kind: kindOf(session), provider: session.submitted_via,
      channel: channelOf(session), created_at: session.created_at,
    },
    ...shared,
    speakers: speakers(session, segments, names),
    transcript_source: transcriptSource(session, segments),
    quotes_by_theme: quotes,
  };
}

/** Which of a venture's conversations a venture read takes: its chats (D858's default), its calls (D873), or both. */
export const VENTURE_KINDS = ['chats', 'calls', 'all'] as const;
export type VentureKind = (typeof VENTURE_KINDS)[number];
const sourcesOf = (kind: VentureKind): string[] => [
  ...(kind === 'calls' ? [] : MESSAGING_PROVIDERS),
  ...(kind === 'chats' ? [] : [...CALL_CHANNELS.keys()]),
];

/**
 * A venture's chat or call sessions in the range, newest first, at most
 * VENTURE_SESSIONS_MAX. A named channel (D866) reads that channel's sessions
 * instead, whatever their kind, recordings and typed notes included.
 */
export async function ventureSessions(
  env: Env, projectId: number, from: string | null, to: string | null, kind: VentureKind = 'chats', channel: string | null = null,
) {
  // `channelOf` in SQL, so a named channel narrows the rows before their LIMIT.
  // Literal SQL: the schema guard reads every column it names. 'google_meet'
  // is CALL_CHANNELS' one renamed call.
  const rows = (await env.DB.prepare(
    `SELECT s.id, s.interview_id, s.project_id, s.channel, s.submitted_via, s.consent_status, s.active_ms, s.language, s.created_at,
            s.created_by_user_id, s.final_model,
            (SELECT t.provider FROM channel_threads t WHERE t.session_id = s.id ORDER BY t.id LIMIT 1) AS thread_provider
       FROM interview_sessions s
      WHERE s.project_id = ?
        AND CASE WHEN ? IS NULL THEN s.submitted_via IN (SELECT value FROM json_each(?))
                 ELSE COALESCE(CASE WHEN TRIM(s.submitted_via) = 'google_meet' THEN 'meet' ELSE NULLIF(TRIM(s.submitted_via), '') END,
                        (SELECT NULLIF(TRIM(t.provider), '') FROM channel_threads t WHERE t.session_id = s.id ORDER BY t.id LIMIT 1),
                        CASE WHEN s.channel IN (SELECT value FROM json_each(?)) THEN 'recorder' ELSE NULLIF(TRIM(s.channel), '') END) = ? END
        AND (? IS NULL OR datetime(s.created_at) >= datetime(?))
        AND (? IS NULL OR datetime(s.created_at) < datetime(?, '+1 day'))
      ORDER BY datetime(s.created_at) DESC, s.id DESC LIMIT ?`,
  ).bind(projectId, channel, JSON.stringify(sourcesOf(kind)), AUDIO_JSON, channel, from, from, to, to, VENTURE_SESSIONS_MAX + 1)
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

/** A venture's chats, calls or both (or one channel's sessions, D866) over a range: aggregates only, never a quote's words. */
export async function ventureAnalytics(
  env: Env, projectId: number, range: { from: string | null; to: string | null; kind?: VentureKind; channel?: string | null },
) {
  const kind = range.kind ?? 'chats';
  const channel = range.channel ?? null;
  const { sessions, truncated } = await ventureSessions(env, projectId, range.from, range.to, kind, channel);
  const byProvider: Record<string, number> = {};
  for (const s of sessions) {
    const key = callChannel(s) ?? String(s.submitted_via);
    byProvider[key] = (byProvider[key] ?? 0) + 1;
  }
  const byChannel: Record<string, number> = {};
  for (const s of sessions) byChannel[channelOf(s) ?? 'unknown'] = (byChannel[channelOf(s) ?? 'unknown'] ?? 0) + 1;
  const base = {
    project_id: projectId, kind, channel, from: range.from, to: range.to, sessions: sessions.length,
    sessions_by_provider: byProvider, sessions_by_channel: byChannel, truncated,
  };
  if (!sessions.length) {
    const none = REASONS.noTranscript;
    return {
      ...base,
      messages: known<MessageCounts>(noMessages(), []),
      voice_notes: kind === 'calls' ? unknown<number>(REASONS.notChat) : known(0, []),
      voice_minutes: kind === 'calls' ? known(0, []) : unknown<number>(REASONS.chatVoiceMinutes),
      languages: known<{ language: string; count: number }[]>([], []), text_languages: unknown<{ language: string; messages: number }[]>(REASONS.textLanguage),
      median_reply_seconds: unknown<number>(kind === 'calls' ? REASONS.replyTimeNotChat : REASONS.replyTime), suggestion_reach: unknown<Reach>(none),
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
