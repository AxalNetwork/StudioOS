/**
 * D1580 F1 (#3827) — the words and numbers of Rehearse (pd38) and its report
 * (pd39). Pure: no network, no React. The Worker counts the report
 * (`cloudflare-worker/src/services/decks/rehearsal.ts`); this file only draws
 * it, and times the cards while the founder speaks with the same even split
 * (`cardBudgetsMs`, shared with #3828's timing).
 */
import { aiTokens } from './newDeckModel.js';

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
