/**
 * D1580 F1 (#3827) — a rehearsal's report, worked out in code from the
 * transcript and the moments the founder moved between cards.
 *
 * PURE. No database, no model, no charge. The route transcribes the audio
 * through the router (one `transcribe` run, quoted and held), then hands the
 * segments here. Every number in the report is counted, never estimated by a
 * model:
 *
 *   time        how long each card was on screen, from the client's card marks
 *               (a card shown twice adds both stretches);
 *   budget      the pitch length shared evenly across the cards
 *               (`cardBudgetsMs`, shared with #3828's timing), amber when a
 *               card ran over: "0:42 of 0:30";
 *   wpm         the words of the segments whose middle falls on the card,
 *               per minute of the card's time;
 *   fillers     exact counts of the words in FILLERS (whole words, any case);
 *   pauses      gaps of PAUSE_MS or longer between two segments on the card;
 *   notes       each line of the card's speaker notes is covered when most of
 *               its content words were said while the card was up;
 *   figures     a figure said on a card that disagrees with the figure the deck
 *               LINKS to the record (`boundFigures`): "You said ‘$2M ARR’. Your
 *               record says $1.4M". Typed and unlinked figures are never read.
 *
 * "Likely questions" (#3829) and coaching (rehearse_coach) are later parts:
 * the report keeps `questions: null` so the slot is drawn, never invented.
 */
import { agrees } from '../raiseCycle';
import { boundFigures, lineFacts, shown, type Metric } from '../deckConsistency';

export const PITCH_SECONDS = [120, 180, 300] as const;
export type PitchSeconds = (typeof PITCH_SECONDS)[number];
/** The longest recording read: twice the longest pitch. */
export const MAX_DURATION_MS = 600_000;
export const PAUSE_MS = 2_000;
const MAX_MARKS = 500;
const MAX_NOTE_ITEMS = 12;

/** Filler words and phrases, counted exactly. "like" and "so" are not: they are words with meanings. */
export const FILLERS = ['um', 'umm', 'uh', 'uhh', 'erm', 'er', 'ah', 'hmm', 'you know', 'i mean', 'basically', 'literally'] as const;
const FILLER_RE = new RegExp(`(?<![\\p{L}\\p{N}'’])(${[...FILLERS].sort((a, b) => b.length - a.length).map((f) => f.replace(/ /g, '\\s+')).join('|')})(?![\\p{L}\\p{N}'’])`, 'giu');

export type Segment = { start_ms: number; end_ms: number; text: string };
export type Mark = { card: number; at_ms: number };

/** "0:42", "1:05", "12:00". */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** "0:42 of 0:30". */
export const budgetLine = (spentMs: number, budgetMs: number) => `${clock(spentMs)} of ${clock(budgetMs)}`;

/** The pitch length shared across the cards, whole seconds each; the first cards take the leftover seconds. */
export function cardBudgetsMs(pitchSeconds: number, cardCount: number): number[] {
  const n = Math.max(0, Math.floor(cardCount));
  if (!n) return [];
  const base = Math.floor(pitchSeconds / n);
  const extra = pitchSeconds - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) * 1000);
}

/** Exact filler counts in one text. */
export function fillersIn(text: string): { total: number; by: Record<string, number> } {
  const by: Record<string, number> = {};
  let total = 0;
  for (const m of String(text || '').matchAll(FILLER_RE)) {
    const k = m[1].toLowerCase().replace(/\s+/g, ' ');
    by[k] = (by[k] ?? 0) + 1;
    total += 1;
  }
  return { total, by };
}

const WORD = /[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu;
export const wordsIn = (text: string): string[] => String(text || '').match(WORD) ?? [];

/**
 * The client's card marks, checked: whole cards 1..cardCount, times within the
 * recording, in time order; a missing mark at 0 means the first card opened it.
 * Null when nothing usable was sent.
 */
export function marksOf(raw: unknown, cardCount: number, durationMs: number): Mark[] | null {
  if (!Array.isArray(raw) || cardCount < 1) return null;
  const out: Mark[] = [];
  for (const m of raw.slice(0, MAX_MARKS)) {
    const card = Number((m as any)?.card);
    const at = Number((m as any)?.at_ms);
    if (!Number.isInteger(card) || card < 1 || card > cardCount) return null;
    if (!Number.isFinite(at) || at < 0 || at > durationMs) return null;
    out.push({ card, at_ms: Math.round(at) });
  }
  out.sort((a, b) => a.at_ms - b.at_ms);
  if (!out.length || out[0].at_ms > 0) out.unshift({ card: 1, at_ms: 0 });
  return out;
}

/** Each stretch a card was on screen. */
export function windowsOf(marks: Mark[], durationMs: number): Array<{ card: number; start: number; end: number }> {
  return marks.map((m, i) => ({ card: m.card, start: m.at_ms, end: i + 1 < marks.length ? marks[i + 1].at_ms : durationMs }))
    .filter((w) => w.end > w.start);
}

const STOP = new Set(['about', 'after', 'again', 'also', 'because', 'been', 'being', 'from', 'have', 'here', 'into', 'just', 'more', 'most', 'only', 'other',
  'over', 'same', 'some', 'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'very', 'what', 'when', 'where', 'which',
  'while', 'will', 'with', 'would', 'your', 'ours', 'were', 'make', 'mention', 'talk', 'say', 'said']);
const stem = (w: string) => w.toLowerCase().replace(/[’']s$/, '').slice(0, 6);
const content = (text: string) => [...new Set(wordsIn(text).map((w) => w.toLowerCase()).filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d/.test(w)).map(stem))];

/** The checklist a card's speaker notes make: one item a line or bullet; a single paragraph is split by sentence. */
export function noteItems(notes: unknown): string[] {
  if (typeof notes !== 'string' || !notes.trim()) return [];
  let items = notes.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•–]|\d+[.)])\s*/, '').trim()).filter(Boolean);
  if (items.length === 1) items = items[0].split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map((s) => s.trim()).filter(Boolean);
  return items.filter((i) => content(i).length > 0).slice(0, MAX_NOTE_ITEMS);
}

/** Whether a notes item was said: at least 60% of its content words (by stem) are in what was said. */
export function itemCovered(item: string, said: string): boolean {
  const need = content(item);
  if (!need.length) return false;
  const have = new Set(wordsIn(said).map(stem));
  return need.filter((w) => have.has(w)).length / need.length >= 0.6;
}

/** A short quote of what was said around the figure. */
function quoteOf(clause: string): string {
  const t = clause.replace(/\s+/g, ' ').trim().replace(/[.,;:!?]+$/, '');
  if (t.length <= 48) return t;
  const at = t.search(/[$\d]/);
  const from = Math.max(0, at - 20);
  return `${from > 0 ? '…' : ''}${t.slice(from, from + 44).trim()}…`;
}

export type FigureFinding = {
  card: number; metric: Metric; said: string; said_value: number; said_shown: string;
  record_value: number; record_shown: string; record_card: number; source_key: string; grade: string | null; message: string;
};

/** Each figure said on a card that disagrees with the deck's linked figure for it (that card's own first). One per card and metric. */
export function figureFindings(spoken: Array<{ card: number; text: string }>, slides: unknown[]): FigureFinding[] {
  const bound = boundFigures(slides);
  if (!bound.length) return [];
  const out: FigureFinding[] = [];
  const seen = new Set<string>();
  for (const { card, text } of spoken) {
    for (const clause of String(text || '').split(/(?<=[.!?;])\s+|,\s+(?=\D)/)) {
      for (const f of lineFacts(clause)) {
        const rec = bound.find((b) => b.metric === f.metric && b.card === card) ?? bound.find((b) => b.metric === f.metric);
        if (!rec || agrees(f.value, rec.value) || seen.has(`${card}:${f.metric}`)) continue;
        seen.add(`${card}:${f.metric}`);
        const said = quoteOf(clause);
        out.push({
          card, metric: f.metric, said, said_value: f.value, said_shown: shown(f.metric, f.value),
          record_value: rec.value, record_shown: shown(f.metric, rec.value), record_card: rec.card, source_key: rec.source_key, grade: rec.grade,
          message: `You said ‘${said}’. Your record says ${shown(f.metric, rec.value)}.`,
        });
      }
    }
  }
  return out;
}

const titleOf = (s: any): string => {
  for (const v of [s?.title, s?.headline, s?.fields?.title]) if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 120);
  for (const b of Array.isArray(s?.blocks) ? s.blocks : []) if (b?.kind === 'text' && typeof b?.text === 'string' && b.text.trim()) return b.text.trim().slice(0, 120);
  return '';
};

export type CardReport = {
  card: number; title: string; time_ms: number; budget_ms: number; over: boolean; time_line: string;
  words: number; wpm: number | null; fillers: number; filler_words: Record<string, number>; pauses: number;
  notes: Array<{ text: string; covered: boolean }>; notes_total: number; notes_covered: number;
};
export type RehearsalReport = {
  pitch_seconds: number; duration_ms: number; over_ms: number; time_line: string;
  cards: CardReport[];
  totals: { words: number; wpm: number | null; fillers: number; pauses: number; notes_total: number; notes_covered: number };
  figures: FigureFinding[];
  questions: null;
};

const wpmOf = (words: number, ms: number) => (ms >= 5_000 ? Math.round(words / (ms / 60_000)) : null);

/** The whole report. */
export function rehearsalReport(input: { pitchSeconds: number; durationMs: number; marks: Mark[]; segments: Segment[]; slides: unknown[] }): RehearsalReport {
  const { pitchSeconds, durationMs, slides } = input;
  const budgets = cardBudgetsMs(pitchSeconds, slides.length);
  const windows = windowsOf(input.marks, durationMs);
  const segs = input.segments.filter((s) => typeof s?.text === 'string' && s.text.trim())
    .map((s) => ({ start_ms: Math.max(0, Number(s.start_ms) || 0), end_ms: Math.max(0, Number(s.end_ms) || 0), text: s.text.trim() }))
    .sort((a, b) => a.start_ms - b.start_ms);
  const cardOfMs = (ms: number) => windows.find((w) => ms >= w.start && ms < w.end)?.card ?? windows.at(-1)?.card ?? 1;
  const byCard = new Map<number, Segment[]>();
  for (const s of segs) {
    const card = cardOfMs((s.start_ms + Math.max(s.start_ms, s.end_ms)) / 2);
    byCard.set(card, [...(byCard.get(card) ?? []), s]);
  }
  const cards: CardReport[] = slides.map((s: any, i) => {
    const card = i + 1;
    const time = windows.filter((w) => w.card === card).reduce((n, w) => n + (w.end - w.start), 0);
    const mine = byCard.get(card) ?? [];
    const said = mine.map((x) => x.text).join(' ');
    const words = wordsIn(said).length;
    const f = fillersIn(said);
    let pauses = 0;
    for (let k = 1; k < mine.length; k += 1) if (mine[k].start_ms - mine[k - 1].end_ms >= PAUSE_MS) pauses += 1;
    const notes = noteItems(s?.notes).map((text) => ({ text, covered: itemCovered(text, said) }));
    const budget = budgets[i] ?? 0;
    return {
      card, title: titleOf(s), time_ms: time, budget_ms: budget, over: time > budget, time_line: budgetLine(time, budget),
      words, wpm: wpmOf(words, time), fillers: f.total, filler_words: f.by, pauses,
      notes, notes_total: notes.length, notes_covered: notes.filter((n) => n.covered).length,
    };
  });
  const sum = (k: 'words' | 'fillers' | 'pauses' | 'notes_total' | 'notes_covered') => cards.reduce((n, c) => n + c[k], 0);
  const spoken = cards.map((c) => ({ card: c.card, text: (byCard.get(c.card) ?? []).map((x) => x.text).join(' ') }));
  return {
    pitch_seconds: pitchSeconds, duration_ms: durationMs, over_ms: Math.max(0, durationMs - pitchSeconds * 1000),
    time_line: budgetLine(durationMs, pitchSeconds * 1000),
    cards,
    totals: { words: sum('words'), wpm: wpmOf(sum('words'), durationMs), fillers: sum('fillers'), pauses: sum('pauses'), notes_total: sum('notes_total'), notes_covered: sum('notes_covered') },
    figures: figureFindings(spoken, slides),
    questions: null,
  };
}
