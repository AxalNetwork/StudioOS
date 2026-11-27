/**
 * D4270 (#4270, D4254 P2c) — Script & rehearsal's views, and the words and
 * figures of Likely questions (ps4b) and Rehearsals (ps4c). No React and no
 * fetch: `ScriptTile.jsx`, `QuestionsTab.jsx` and `RehearsalsTab.jsx` draw it.
 *
 * THE RULES (D4254 §5). Likely questions and their answers are never shown to
 * an investor. Ask proposes and the founder saves: a placed draft reads "Not
 * saved" until Save, and an edit to it is the founder's own words. A figure
 * that cannot be read is "Not recorded", never 0.
 */
import { NOT_RECORDED } from '../../../lib/absence';

export { NOT_RECORDED };

/** The tile's three views, as ps4/ps4b/ps4c's tab list names them; `?view=` picks one. */
export const SCRIPT_VIEWS = Object.freeze([
  { id: 'script', label: 'Script' },
  { id: 'questions', label: 'Likely questions' },
  { id: 'rehearsals', label: 'Rehearsals' },
]);
export const viewOf = (param) => (SCRIPT_VIEWS.some((v) => v.id === param) ? param : 'script');

// ─────────────────────────────────────────────────────────── likely questions

export const NEVER_SHOWN = 'Never shown to investors';
export const ADD_QUESTION = 'Add a question';
export const ASK_FOR_ANSWERS = 'Ask for answers';
/** What Ask costs here: drafts are written from the records the deck links to, in code. */
export const ASK_NOTE = 'No model runs and nothing is charged. Ask drafts answers from the records your deck links to, and places them for you to read. Nothing is saved until you press Save.';
export const ASK_NONE = 'Ask has no draft to place: every question with a record behind it is answered or placed already.';
export const WRITE_YOUR_ANSWER = 'Write your answer.';
export const NOT_SAVED = 'Not saved';
export const ANSWERED = 'Answered';
export const NOT_ANSWERED = 'Not answered yet';
export const QUESTIONS_UNREAD = 'The likely questions could not be read.';
export const WRITTEN_UNREAD = 'Your saved answers could not be read, so none is shown as answered.';
export const NO_DECK_QUESTIONS = 'There is no deck yet, so there are no likely questions.';
export const READER_NOTE = 'Read only: the founder writes the answers.';

/** "Never shown to investors · 6 of 8 answered"; the count is Not recorded when a store could not be read. */
export function questionsLine(read) {
  const total = Number.isFinite(read?.total) ? read.total : null;
  const answered = Number.isFinite(read?.answered_count) ? read.answered_count : null;
  if (total == null) return `${NEVER_SHOWN} · ${NOT_RECORDED}`;
  return answered == null ? `${NEVER_SHOWN} · ${total} ${total === 1 ? 'question' : 'questions'} · answered: ${NOT_RECORDED}` : `${NEVER_SHOWN} · ${answered} of ${total} answered`;
}

/** "Card · Use of funds" from a card kind's slug. */
export function cardPill(card) {
  if (!card) return null;
  const words = String(card).replace(/_/g, ' ');
  return `Card · ${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** The cards a typed question may relate to, as the likely questions name them. */
export const CARD_CHOICES = Object.freeze(['problem', 'solution', 'market', 'competition', 'traction', 'business_model', 'product', 'team', 'round', 'use_of_funds', 'roadmap']);

/**
 * One question's state on screen: 'placed' while a draft Ask placed (or the
 * founder's edit) waits for Save, 'answered' when the store holds an answer,
 * else 'open'. `placed` is the screen's own `{ [key]: { text, from_ask } }`.
 */
export function questionState(q, placed) {
  if (placed && placed[q.key]) return 'placed';
  return q.answered ? 'answered' : 'open';
}
export const STATE_PILL = Object.freeze({ placed: NOT_SAVED, answered: ANSWERED, open: NOT_ANSWERED });

/** The words a question shows: what is placed, else the written answer, else the kept one (D1559), else none. */
export function answerShown(q, placed) {
  if (placed && placed[q.key]) return placed[q.key].text;
  return q.written?.text ?? q.kept?.text ?? null;
}

/**
 * Ask: each question with no answer, nothing placed, and a bound draft gets
 * its draft placed. Typed questions have no draft. Returns the next `placed`.
 */
export function askPlacements(questions, placed = {}) {
  const next = { ...placed };
  for (const q of questions || []) {
    if (next[q.key] || q.answered || q.kind === 'typed') continue;
    const draft = q.answer?.state === 'bound' ? String(q.answer.text || '').trim() : '';
    if (draft) next[q.key] = { text: draft, from_ask: true, draft };
  }
  return next;
}

/** What Save sends: Ask's source only while the placed text is still the draft, word for word. */
export function saveBody(entry) {
  const text = String(entry?.text ?? '').trim();
  return { answer: text, source: entry?.from_ask && text === String(entry.draft ?? '').trim() ? 'ask' : 'typed' };
}

// ─────────────────────────────────────────────────────────── rehearsals

export const REHEARSALS_UNREAD = 'Your rehearsals could not be read.';
export const NO_REHEARSALS = 'No rehearsals of this version yet. Rehearse from Present: each run is listed here with its timing.';
export const BUDGET_TICK = 'The black tick is the card’s budget.';
export const REHEARSAL_COLUMNS = Object.freeze(['Date', 'Duration', 'Words a minute', 'Filler words', 'Cards over budget', 'Notes covered']);
export const PER_CARD_LINE = 'Your time against each card’s budget';

const pad = (n) => String(n).padStart(2, '0');
/** "3:12" from milliseconds; null stays Not recorded. */
export function clockOf(ms) {
  if (!Number.isFinite(ms) || ms < 0) return NOT_RECORDED;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2 Nov · 18:20" from the stored UTC timestamp, read as UTC so every reader sees the same line. */
export function runDate(at) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(at || ''));
  if (!m) return NOT_RECORDED;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} · ${m[4]}:${m[5]}`;
}

const figure = (v) => (Number.isFinite(v) ? String(v) : NOT_RECORDED);
/** One run as ps4c's row draws it. Over its target, the duration is marked. */
export function rehearsalRow(r) {
  const target = Number(r?.pitch_seconds) * 1000;
  const duration = Number(r?.duration_ms);
  return {
    uid: r?.uid,
    date: runDate(r?.created_at),
    duration: `${clockOf(duration)} of ${clockOf(target)}`,
    over: Number.isFinite(duration) && Number.isFinite(target) && duration > target,
    wpm: figure(r?.wpm),
    fillers: figure(r?.fillers),
    cards_over: figure(r?.cards_over),
    notes: Number.isFinite(r?.notes_covered) && Number.isFinite(r?.notes_total) ? `${r.notes_covered} of ${r.notes_total}` : NOT_RECORDED,
    failed: r?.status === 'failed',
  };
}

/**
 * A report's cards as timing bars: each bar is the time spoken, the tick is
 * the card's budget, both against the longest of either across the run.
 */
export function cardBars(report) {
  const cards = Array.isArray(report?.cards) ? report.cards : [];
  const scale = Math.max(1, ...cards.map((c) => Math.max(Number(c.time_ms) || 0, Number(c.budget_ms) || 0)));
  return cards.map((c) => ({
    card: c.card, title: c.title || `Card ${c.card}`,
    line: `${clockOf(Number(c.time_ms))} of ${clockOf(Number(c.budget_ms))}`,
    over: !!c.over,
    bar: Math.round(((Number(c.time_ms) || 0) / scale) * 1000) / 10,
    tick: Math.round(((Number(c.budget_ms) || 0) / scale) * 1000) / 10,
  }));
}
