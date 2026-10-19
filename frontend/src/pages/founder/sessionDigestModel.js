// D757 §2.5, §2.7 and §2.12 (#1927) — the rules of the session page's summary
// and suggestions, kept apart from React so a Node test reads them: where the
// session came from, what the engine's state says, which passage a citation
// points at (chat lines included), "Heard in …", and the seven Validate
// modules a suggestion is grouped under.
//
// EVERY SENTENCE ABOUT THE ENGINE IS THE WORKER'S (`digest_note`). The page
// adds a status word in front of it and, for a budget refusal, the Add
// tokens link (D755); it never writes its own reason.

import { ADD_TOKENS_PATH } from '../../lib/aiTokens.js';

/** The seven Validate modules, by the cycle slug the Worker sends, in the canvas's order. */
export const VALIDATE_MODULES = [
  ['problem-discovery', 'Problem discovery'],
  ['customer-research', 'Customer research'],
  ['ideal-customer-profile', 'Ideal customer profile'],
  ['market-intelligence', 'Market intelligence'],
  ['demand-signals', 'Demand and urgency signals'],
  ['experiments', 'Experiments and evidence'],
  ['verdict', 'Verdict'],
];
export const MODULE_NAME = Object.fromEntries(VALIDATE_MODULES);

/** No kind proposes a verdict (D757 §2.6): the Verdict group says so instead of waiting. */
export const VERDICT_NOTE = 'Axal never suggests a verdict. Accepted evidence is there when you record a decision.';

const CHANNEL_WORDS = { in_person: 'In person', video: 'Video', phone: 'Phone', text: 'Text chat' };
const PROVIDER_WORDS = { zoom: 'Zoom', google_meet: 'Google Meet', whatsapp: 'WhatsApp', telegram: 'Telegram' };
const THREADS = new Set(['whatsapp', 'telegram']);

/**
 * The source badge (§2.12): In person, Video, Phone, Zoom, Google Meet,
 * WhatsApp, Telegram, Text chat or Assistant. A connected channel wins over
 * the channel the session was opened with; an assistant is a session with a
 * submitted name and no channel. Null when the session names none.
 */
export function sourceBadge(session) {
  const via = String(session?.submitted_via || '').trim();
  if (Object.hasOwn(PROVIDER_WORDS, via)) return PROVIDER_WORDS[via];
  if (String(session?.submitted_via_name || '').trim()) return 'Assistant';
  return CHANNEL_WORDS[session?.channel] || null;
}

/** A chat thread's session: its lines are messages, timed by when they arrived. */
export const isThread = (session) => THREADS.has(String(session?.submitted_via || '').trim()) || session?.channel === 'text';

/** The tail every budget refusal's note ends with (`validateEngine.ts`'s `NOTES.budgetTail`). */
export const BUDGET_TAIL = ' The transcript is kept; summarise it when the allowance allows.';

const STATUS_WORD = {
  queued: 'Waiting to summarise',
  running: 'Summarising and finding suggestions',
  done: 'Summary drafted',
  refused: 'Not summarised',
  skipped: 'Not summarised',
};

/**
 * The engine's state (§2.4): `digest_status` as a word, with the Worker's own
 * `digest_note`. A refusal for the AI allowance offers Add tokens. Null when
 * the engine has not touched the session.
 */
export function engineState(session) {
  const status = session?.digest_status;
  if (!Object.hasOwn(STATUS_WORD, status || '')) return null;
  const note = typeof session?.digest_note === 'string' && session.digest_note.trim() ? session.digest_note.trim() : null;
  return {
    status,
    word: STATUS_WORD[status],
    note,
    busy: status === 'queued' || status === 'running',
    addTokens: status === 'refused' && !!note && note.endsWith(BUDGET_TAIL.trim()) ? ADD_TOKENS_PATH : null,
  };
}

/**
 * The summary, as the viewer may see it: none, a writer's draft, or a kept
 * digest. A reader is never shown a draft, even when one is sent.
 */
export function digestState(digest, { writer = false } = {}) {
  if (!digest || typeof digest !== 'object') return { kind: 'none' };
  if (!digest.kept && !writer) return { kind: 'none' };
  return digest.kept
    ? { kind: 'kept', label: 'Kept summary', canEdit: false }
    : { kind: 'draft', label: `Draft · written by ${digest.model || 'a model not recorded'}`, canEdit: writer };
}

/**
 * The spans the Worker cites, rebuilt from the final segments as
 * `toSegments` (`interviewStructuring.ts`) builds them, so a cite on a chat
 * line, which has no recorded time, still finds its line: a missing end is
 * the next start (or the start + 1 s), a missing start is the previous end or
 * the line's position × 1000 ms.
 */
export function spansOf(segments) {
  const rows = (Array.isArray(segments) ? segments : []).filter((s) => s?.source === 'final');
  const safe = (n) => (n === null || n === undefined || n === '' ? null : Number.isSafeInteger(Number(n)) ? Number(n) : null);
  const out = [];
  rows.forEach((r, i) => {
    if (!String(r.text || '').trim()) return;
    const prevEnd = out.length ? out[out.length - 1].end : 0;
    const own = safe(r.start_ms);
    const start = own !== null && own >= 0 ? own : Math.max(prevEnd, i * 1000);
    const nextStart = rows.slice(i + 1).map((n) => safe(n.start_ms)).find((n) => n !== null);
    let end = safe(r.end_ms) ?? (nextStart !== undefined && nextStart > start ? nextStart : start + 1000);
    if (end <= start) end = start + 1;
    out.push({ start, end, segment: r });
  });
  return out;
}

/** The first line a cited span `{ from, to }` overlaps, or null. */
export function lineFor(spans, cite) {
  const from = Number(cite?.from), to = Number(cite?.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return (spans || []).find((x) => x.start < to && x.end > from)?.segment || null;
}

const pad = (v) => String(v).padStart(2, '0');
/** ms → "00:12:31", the hour always shown; null when unknown. */
export function hms(ms) {
  if (ms === null || ms === undefined || ms === '') return null;
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return null;
  const t = Math.floor(n / 1000);
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
}
/** A message's stored time "YYYY-MM-DD HH:MM:SS" → "19 Oct 10:05" (UTC, as stored); null when unreadable. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function messageTime(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(raw ?? ''));
  return m && MONTHS[Number(m[2]) - 1] ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[4]}:${m[5]}` : null;
}

/**
 * "Heard in <name> · 00:12:31 · <speaker>", or for a chat "Heard in <name> ·
 * 19 Oct 10:05 · <speaker>", linking `#seg-<id>`. A part the transcript does
 * not hold is left out; with no line at all, the link is null.
 */
export function heardIn({ cite, spans, name, thread = false }) {
  const line = lineFor(spans, cite);
  const when = line ? (thread ? messageTime(line.created_at) : hms(line.start_ms)) : null;
  const who = String(name || '').trim() || 'this interview';
  const text = ['Heard in ' + who, when, line?.speaker_label || null].filter(Boolean).join(' · ');
  return { text, href: line ? `#seg-${line.id}` : null };
}

/**
 * The suggestions to review, grouped under all seven modules: the latest run
 * of each source (an assistant's and StudioOS's, as `groupByModule` reads
 * them), each placement under the slug the Worker sent. A placement with no
 * known slug is not dropped: it is listed under "Other". Every group has its
 * pending count, which "Accept all" acts on.
 */
export function groupBySlug(read) {
  const runs = Array.isArray(read?.runs) ? read.runs : [];
  const latestOf = (src) => [...runs].reverse().find((r) => (r.source === 'assistant' ? 'assistant' : 'studioos') === src);
  const shown = [latestOf('assistant'), latestOf('studioos')].filter(Boolean).flatMap((r) => r.placements || []);
  const groups = VALIDATE_MODULES.map(([slug, name]) => ({ slug, name, placements: shown.filter((p) => p.slug === slug) }));
  const other = shown.filter((p) => !Object.hasOwn(MODULE_NAME, p.slug || ''));
  if (other.length) groups.push({ slug: 'other', name: 'Other', placements: other });
  return groups.map((g) => ({ ...g, pending: g.placements.filter((p) => p.status === 'pending').length }));
}

/**
 * Accept all's outcome (`{ results, accepted, remaining }`) in words: how
 * many landed, each refusal in the Worker's own sentence, and what remains.
 */
export function acceptAllOutcome(out) {
  const results = Array.isArray(out?.results) ? out.results : [];
  const accepted = results.filter((r) => r.ok).length;
  const refused = results.filter((r) => !r.ok).map((r) => ({ id: r.id, text: r.detail || 'It was not accepted.' }));
  const remaining = Number(out?.remaining) > 0 ? Number(out.remaining) : 0;
  const parts = [`${accepted} accepted`];
  if (refused.length) parts.push(`${refused.length} still to review`);
  if (remaining) parts.push(`${remaining} more waiting: accept all again`);
  return { text: parts.join(' · '), refused, accepted, remaining };
}

/**
 * Edit, as the Worker takes it (`PATCH /sessions/:id/digest`): the overview's
 * sentences and the next steps reworded or removed, and the key quotes kept
 * or removed, never rewritten. Null when the edit would leave no overview.
 */
export function digestEdit(digest, draft) {
  const overview = (draft?.overview || []).filter((o) => o && !o.removed && String(o.text || '').trim())
    .map((o) => ({ index: o.index, text: String(o.text).trim() }));
  if (!overview.length) return null;
  const nextSteps = (draft?.next_steps || []).filter((n) => n && !n.removed && String(n.text || '').trim())
    .map((n) => ({ ...(Number.isInteger(n.index) ? { index: n.index } : {}), text: String(n.text).trim(), who: n.who === 'me' || n.who === 'them' ? n.who : null }));
  const held = new Set((digest?.key_quotes || []).map((k) => k?.quote));
  // A quote is sent as the digest holds it, word for word, or not at all.
  const keyQuotes = (draft?.key_quotes || []).filter((k) => k && !k.removed && held.has(k.quote)).map((k) => k.quote);
  return { overview, next_steps: nextSteps, key_quotes: keyQuotes };
}

/** The draft an Edit starts from: every sentence, step and quote, none removed. */
export function editDraft(digest) {
  return {
    overview: (digest?.overview || []).map((o, index) => ({ index, text: o?.text || '', removed: false })),
    next_steps: (digest?.next_steps || []).map((n, index) => ({ index, text: n?.text || '', who: n?.who ?? null, removed: false })),
    key_quotes: (digest?.key_quotes || []).map((k) => ({ quote: k?.quote, removed: false })),
  };
}

/** The digest's typed sections (§2.5), in the order the page draws them. */
export const DIGEST_SECTIONS = [
  ['pain_points', 'Pain points'],
  ['jobs_to_be_done', 'Jobs to be done'],
  ['objections', 'Objections'],
  ['willingness_to_pay', 'Willingness to pay and budget'],
  ['competitors', 'Competitors and alternatives'],
];
