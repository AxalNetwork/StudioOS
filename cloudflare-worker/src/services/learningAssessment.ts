/**
 * D559 (#1160) — exercises and exams: the parsing, the grading and the one
 * function that decides what of a question a member may see.
 *
 * NO ANSWER LEAKS. `memberQuestion` builds the member's copy of a question
 * field by field from an allow-list, so a column added to the table later is
 * not served by accident. The correct answers leave the server only through
 * `revealed`, and only for a submitted attempt of an exam whose `reveal` is
 * `score_and_answers`.
 *
 * GRADING IS EXACT. A single-choice question is right when the one option
 * chosen is the right one; a multiple-choice question is right only when the
 * set chosen equals the set that is right, with no partial credit. An
 * unanswered question is wrong. The score is the share right, rounded.
 */

/** Seconds of slack on a timed exam for the request to arrive after the clock runs out. */
export const SUBMIT_GRACE_SECONDS = 30;

export const MAX_OPTIONS = 10;

/** Two to ten option strings, each 1–300 characters; null when invalid. */
export function parseOptions(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_OPTIONS) return null;
  const out: string[] = [];
  for (const o of raw) {
    if (typeof o !== 'string') return null;
    const t = o.trim();
    if (!t || t.length > 300) return null;
    out.push(t);
  }
  return out;
}

/** Sorted, distinct option indexes within range; null when any is invalid. */
export function indexSet(raw: unknown, optionCount: number): number[] | null {
  if (!Array.isArray(raw)) return null;
  const set = new Set<number>();
  for (const v of raw) {
    if (!Number.isInteger(v) || v < 0 || v >= optionCount) return null;
    set.add(v as number);
  }
  return [...set].sort((a, b) => a - b);
}

/** The correct answer a Super Admin may set: exactly one for single, one or more for multiple. */
export function parseCorrect(kind: string, raw: unknown, optionCount: number): number[] | null {
  const set = indexSet(raw, optionCount);
  if (!set || set.length === 0) return null;
  if (kind === 'single' && set.length !== 1) return null;
  return set;
}

export type StoredQuestion = { uid: string; prompt: string; kind: string; options_json: string; correct_json: string; position?: number };

/** What a member is shown of a question. Built from an allow-list: never `correct_json`. */
export function memberQuestion(q: StoredQuestion): { uid: string; prompt: string; kind: string; options: string[] } {
  let options: string[] = [];
  try { options = JSON.parse(q.options_json); } catch { options = []; }
  return { uid: q.uid, prompt: q.prompt, kind: q.kind, options };
}

/**
 * A member's answers, normalised against the questions they were shown.
 * Unknown question uids are dropped; an invalid selection for a known
 * question makes the whole submission invalid (null), so a malformed request
 * is refused rather than graded as blanks.
 */
export function normaliseAnswers(raw: unknown, questions: StoredQuestion[]): Record<string, number[]> | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, number[]> = {};
  for (const q of questions) {
    const v = (raw as Record<string, unknown>)[q.uid];
    if (v === undefined || v === null) continue;
    const count = memberQuestion(q).options.length;
    const set = indexSet(v, count);
    if (!set) return null;
    if (q.kind === 'single' && set.length > 1) return null;
    out[q.uid] = set;
  }
  return out;
}

export function grade(questions: StoredQuestion[], answers: Record<string, number[]>): { correct: number; total: number; score_percent: number } {
  let correct = 0;
  for (const q of questions) {
    let right: number[] = [];
    try { right = JSON.parse(q.correct_json); } catch { right = []; }
    const chosen = answers[q.uid] || [];
    // `right` is never empty (parseCorrect), so an unanswered question cannot match it.
    if (chosen.length === right.length && chosen.every((v, i) => v === right[i])) correct += 1;
  }
  const total = questions.length;
  return { correct, total, score_percent: total ? Math.round((100 * correct) / total) : 0 };
}

/** The correct answers, per question uid, for a reveal the exam allows. */
export function revealed(questions: StoredQuestion[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const q of questions) {
    try { out[q.uid] = JSON.parse(q.correct_json); } catch { out[q.uid] = []; }
  }
  return out;
}

/** The moment a timed attempt's clock runs out, in ms, or null when untimed. */
export function deadlineMs(startedAtIso: string, limitMinutes: number | null | undefined): number | null {
  if (!limitMinutes) return null;
  const t = Date.parse(startedAtIso);
  return Number.isFinite(t) ? t + limitMinutes * 60_000 : null;
}

/** Fisher–Yates over a copy, from the platform's CSPRNG. */
export function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const r = new Uint32Array(1);
    crypto.getRandomValues(r);
    const j = r[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
