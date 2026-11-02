/**
 * D1580 F1 (#3827) — the words and numbers of Rehearse (pd38) and its report
 * (pd39). Pure: no network, no React. The Worker counts the report
 * (`cloudflare-worker/src/services/decks/rehearsal.ts`); this file only draws
 * it, and times the cards while the founder speaks with the same even split
 * (`cardBudgetsMs`, shared with #3828's timing).
 */
import { aiTokens } from './newDeckModel.js';
import { SEVERITY_LABEL } from './criticModel.js';

export const PITCH_CHOICES = Object.freeze([
  { seconds: 120, label: '2 min' },
  { seconds: 180, label: '3 min' },
  { seconds: 300, label: '5 min' },
]);
export const REHEARSE = 'Rehearse';
export const RETENTION = 'Your audio is turned into text. The audio is deleted afterwards unless you keep it.';
export const KEEP_AUDIO = 'Keep the audio';
export const KEEP_AUDIO_OFF = 'The audio is deleted an hour after this report unless you keep it. The transcript and this report stay.';
export const KEEP_AUDIO_ON = 'The audio is kept with this rehearsal until you turn this off.';
export const AUDIO_GONE = 'The audio has been deleted. The transcript and this report stay.';
export const QUESTIONS_LATER = 'Likely questions are coming later.';
export const NO_FIGURES = 'Every figure you said matches what the deck links to.';
export const NO_MIC = 'Rehearse needs your microphone. Allow it in the browser and try again.';
export const TOO_SHORT = 'That was too short to transcribe. Try again for at least a few seconds.';
/** The recorder's bitrate: the Worker reads the minutes from the bytes at the same 32 kbps. */
export const AUDIO_BITS_PER_SECOND = 32_000;
export const MAX_RECORDING_MS = 600_000;

/** "Transcript · Holds up to $0.0200 · you pay what it uses", or null before the quote is read. */
export function holdLine(quote) {
  const hold = aiTokens(quote?.hold_microusd);
  return hold ? `Transcript · Holds up to ${hold} · you pay what it uses` : null;
}

/** "0:42", "1:05". */
export function clock(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export const budgetLine = (spentMs, budgetMs) => `${clock(spentMs)} of ${clock(budgetMs)}`;

/** The pitch length shared across the cards in whole seconds; the first cards take the leftover seconds. */
export function cardBudgetsMs(pitchSeconds, cardCount) {
  const n = Math.max(0, Math.floor(Number(cardCount) || 0));
  if (!n) return [];
  const base = Math.floor(pitchSeconds / n);
  const extra = pitchSeconds - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) * 1000);
}

/** How long each card (0-based) has been up, from the marks and the time now. */
export function spentByCard(marks, nowMs, cardCount) {
  const out = Array.from({ length: cardCount }, () => 0);
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].at_ms : nowMs;
    if (m.card >= 1 && m.card <= cardCount) out[m.card - 1] += Math.max(0, end - m.at_ms);
  });
  return out;
}

/** The checklist a card's notes make while rehearsing: one item a line or bullet. The report says which were said. */
export function noteItemsOf(notes) {
  if (typeof notes !== 'string' || !notes.trim()) return [];
  return notes.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•–]|\d+[.)])\s*/, '').trim()).filter(Boolean).slice(0, 12);
}

/** A report row as the table draws it. Nothing is ever drawn as 0 when it was not counted. */
export function rowOf(card) {
  return {
    card: card.card,
    title: card.title || `Card ${card.card}`,
    time: card.time_line,
    over: !!card.over,
    wpm: card.wpm == null ? '—' : String(card.wpm),
    fillers: String(card.fillers),
    fillerWords: Object.entries(card.filler_words || {}).map(([w, n]) => `${w} ×${n}`).join(', '),
    pauses: String(card.pauses),
    notes: card.notes_total ? `${card.notes_covered} of ${card.notes_total}` : '—',
  };
}

/** "Linked · Measured": the record's side of a figure line. */
export const figureGrade = (f) => ['Linked', f?.grade].filter(Boolean).join(' · ');

/** The report's one-line summary. */
export function summaryLine(report) {
  if (!report) return null;
  const t = report.totals || {};
  return [report.time_line, t.wpm == null ? null : `${t.wpm} words a minute`, `${t.fillers ?? 0} filler words`, `${t.pauses ?? 0} pauses`].filter(Boolean).join(' · ');
}

// ─────────────────────────────────────────── D1582 F3 (#3829): likely questions and the drill

export const QUESTIONS_TITLE = 'LIKELY QUESTIONS · REAL OBJECTIONS FIRST';
export const PRACTISE = 'Practise answers';
export const EVERY_INVESTOR = 'Every investor';
export const NO_QUESTIONS = 'No likely questions yet: no investor has raised an objection and the deck check found nothing to ask.';
export const OBJECTIONS_UNREAD = 'Investor objections could not be read, so only the deck check\'s questions are listed.';
export const NOT_SAVED = 'What you type here is not saved or sent. It is checked against the records on this screen.';
export const ALL_BOUND = 'Every figure you typed is carried by a record.';

/** "Synthetic Partner · Synthetic Fund"; the firm alone, or "Investor 12", when a name is missing. */
export const prospectLabel = (p) => [p?.name, p?.firm].filter(Boolean).join(' · ') || `Investor ${p?.id ?? ''}`.trim();

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The line under a question: who raised it, or the deck check's severity. Counts only, never a figure of
 * the venture's: the figures are in the answer, and each is a binding's.
 */
export function questionMeta(q, prospect) {
  if (q?.kind === 'finding') return [SEVERITY_LABEL[q.severity] || null, 'from the deck check'].filter(Boolean).join(' · ');
  const h = q?.heard || {};
  const mine = Number(h.from_prospect) || 0;
  return [
    prospect && mine ? `Raised by ${prospectLabel(prospect)}${mine > 1 ? ` ${plural(mine, 'time', 'times')}` : ''}` : null,
    h.count ? `heard ${plural(h.count, 'time', 'times')} from ${plural(h.prospects || 0, 'investor', 'investors')}` : null,
  ].filter(Boolean).join(' · ') || 'An investor objection';
}

/** What the records say to a question, in the Worker's own words: its bound answer, or why there is none. */
export function answerLine(q) {
  const a = q?.answer || {};
  if (a.state === 'bound' && a.text) return a.text;
  if (a.state === 'not_recorded') {
    const fill = (a.fill || []).map((f) => f.label).filter(Boolean);
    return fill.length ? `No record answers this yet. Fill: ${fill.join(', ')}.` : 'No record answers this yet.';
  }
  if (a.state === 'unchecked') return 'The records this draws on could not be read, so it is not checked.';
  return 'No deck record answers this question.';
}

// A figure is a run of digits, read as the Worker reads one (`services/decks/deckQa.ts` `figuresIn`):
// separators and leading zeros set aside.
const DIGITS = /\p{Nd}+(?:[.,]\p{Nd}+)*/gu;
const digitsOf = (raw) => raw.replace(/[^\p{Nd}]/gu, '').replace(/^0+(?=\d)/u, '');
export const figuresIn = (text) => (String(text ?? '').match(DIGITS) ?? []).map(digitsOf);

/** Every figure the question's bindings carry: the answer's and the kept answer's values, second values, dates and labels. */
export function carriedBy(q) {
  const out = new Set();
  for (const b of [...(q?.answer?.bindings || []), ...(q?.kept?.bindings || [])]) {
    for (const t of [b.value, b.of, b.as_of, b.label]) for (const f of figuresIn(t)) out.add(f);
  }
  return out;
}

/** The figures in the founder's practice answer that no binding carries, as typed; empty when every one is carried. */
export function unboundTyped(text, q) {
  const held = carriedBy(q);
  return (String(text ?? '').match(DIGITS) ?? []).filter((raw) => !held.has(digitsOf(raw)));
}

/** The figure check under a practice answer, or null before anything is typed. */
export function figureCheckLine(text, q) {
  if (!String(text ?? '').trim()) return null;
  const loose = unboundTyped(text, q);
  return loose.length ? `Not carried by any record: ${[...new Set(loose)].join(', ')}. Say only what a record holds.` : ALL_BOUND;
}

/** "Question 2 of 7". */
export const drillLine = (at, total) => `Question ${at + 1} of ${total}`;
