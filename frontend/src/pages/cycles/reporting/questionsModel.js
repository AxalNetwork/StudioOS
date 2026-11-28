/**
 * D6225 (#6225) — the rules of a report's questions, for both sides, over
 * `GET /api/report-questions/reports/:uid` (routes/report_questions.ts).
 * Canvas: D6096 (GRQ22–GRQ27).
 *
 * The Worker gives each question one state: `sent` (the founders have not
 * read it), `read`, `answered` or `withdrawn`. The investor reads them as
 * "Sent · not yet read", "Read", "Answered" and "Withdrawn"; the founders as
 * "Unread", "Open", "Answered" and "Withdrawn". A figure's question count
 * counts live questions only (D6096 part 2): never a withdrawn one.
 */

export const QUESTION_MAX = 600;
export const REPLY_MAX = 1200;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (iso) => {
  const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(iso || ''));
  return m ? { y: m[1], mon: MONTHS[Number(m[2]) - 1], d: String(Number(m[3])) } : null;
};
/** "14 Nov 2026" from a stored timestamp; null when there is none. */
export function questionDay(iso) {
  const p = parts(iso);
  return p && p.mon ? `${p.d} ${p.mon} ${p.y}` : null;
}
/** "14 Nov", for a pill. */
function shortDay(iso) {
  const p = parts(iso);
  return p && p.mon ? `${p.d} ${p.mon}` : null;
}

const TONES = {
  sent: 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300',
  violet: 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-200',
  answered: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  withdrawn: 'border-gray-200 bg-gray-50 text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};

const join = (...xs) => xs.filter(Boolean).join(' ');

/** A question's pill on one side: `{ glyph, text, className }`. `side` is 'investor' or 'team'. */
export function questionPill(q, side = 'investor') {
  const state = q?.state;
  if (state === 'answered') return { glyph: '✓', text: join('Answered', shortDay(q.answer?.at)), className: TONES.answered };
  if (state === 'withdrawn') return { glyph: '–', text: join('Withdrawn', shortDay(q.withdrawn_at)), className: TONES.withdrawn };
  if (side === 'team') {
    return state === 'sent'
      ? { glyph: '●', text: 'Unread', className: TONES.violet }
      : { glyph: '◷', text: 'Open', className: TONES.sent };
  }
  return state === 'read'
    ? { glyph: '●', text: join('Read', shortDay(q.read_at)), className: TONES.violet }
    : { glyph: '◷', text: 'Sent · not yet read', className: TONES.sent };
}

/** Whether a question still waits for its answer (Withdraw for the asker, Reply for the founders). */
export const isOpenQuestion = (q) => q?.state === 'sent' || q?.state === 'read';

/**
 * What a question is about: "MRR · Q3 2026 · $48,200" for a figure, "The whole
 * report" for none. `figures` maps a key to `{ label, value }`; a figure the
 * caller cannot see names only its key, and a missing value reads Not recorded.
 */
export function aboutLine(q, figures = {}, period = null) {
  if (!q?.figure_key) return 'The whole report';
  const f = figures[q.figure_key];
  if (!f) return q.figure_key;
  return [f.label || q.figure_key, period, f.value == null || f.value === '' ? 'Not recorded' : String(f.value)].filter(Boolean).join(' · ');
}

/** The founders' summary: "1 unread · 1 open · 1 answered · 1 withdrawn", leaving out a zero. */
export function countsLine(questions = []) {
  const n = { unread: 0, open: 0, answered: 0, withdrawn: 0 };
  for (const q of questions) {
    if (q.state === 'sent') n.unread += 1;
    else if (q.state === 'read') n.open += 1;
    else if (q.state === 'answered') n.answered += 1;
    else if (q.state === 'withdrawn') n.withdrawn += 1;
  }
  return Object.entries(n).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(' · ');
}

/** Live questions about one figure ("1 question", "2 questions"), or null; a withdrawn question is not counted. */
export function figureChip(questions = [], key) {
  const n = questions.filter((q) => q.figure_key === key && q.state !== 'withdrawn').length;
  return n ? `${n} question${n === 1 ? '' : 's'}` : null;
}

/** "n / 600": what the counter under a box says. */
export const counter = (text, max) => `${String(text || '').length.toLocaleString('en-US')} / ${max.toLocaleString('en-US')}`;

/** The text a box may send: trimmed, 1 to `max` characters; otherwise null. */
export function sendable(text, max) {
  const t = String(text || '').trim();
  return t.length >= 1 && t.length <= max ? t : null;
}
