/**
 * Exercises and exams (D559, #1160), the pure half: what their routes send,
 * as the screens draw it, and the bodies the screens send back. No React and
 * no client, so a test can read every rule here directly.
 *
 * THE SHAPES ARE THE ROUTES' OWN:
 *
 *   member   `routes/learning_assessment.ts`: an exercise and the caller's
 *            submissions, an exam's intro (no question), an attempt with its
 *            deadline and questions (no answer), a graded attempt, and the
 *            caller's attempts with `attempts_left`;
 *   review   the same file's `/review/*`: learners named by name and uid, and
 *            an exam's scores without the answers;
 *   studio   `routes/admin_learning_assessment.ts`: the stored rows, and an
 *            exam's tree with its questions AND their answers, which only the
 *            Super Admin's authoring read carries.
 *
 * NO ANSWER IS DRAWN BEFORE THE ROUTE SENDS IT. `revealedAnswers` is the one
 * place a correct answer becomes something to draw, and it asks both the
 * route's own flag (`answers_revealed`) and the exam's `reveal`.
 */
import { courseLessons, secondsLeft, parseInstant } from './learningModel';

const clean = (value) => String(value ?? '').trim();
const enc = encodeURIComponent;
const LEARNING = { to: '/learning', label: 'Learning' };

// ── Where an exercise or exam opens ───────────────────────────────────────

/**
 * A learner's address for an exercise or exam. The route's `:slug` carries
 * the uid (D559 names them by uid; D562 departure 8). The course it was opened
 * from rides along as `?course=`, so that page can name the course and lead
 * back to it, as the canvas draws.
 */
export function assessmentHref(kind, uid, courseSlug) {
  const ref = clean(uid);
  if (!ref || (kind !== 'exercise' && kind !== 'exam')) return null;
  const slug = clean(courseSlug);
  return `/learning/${kind}s/${enc(ref)}${slug ? `?course=${enc(slug)}` : ''}`;
}

/**
 * The header of an exercise or exam opened from a course: the way back to
 * that course, and "Part of <course> · <module>" once the course is read and
 * holds a lesson naming this one. With no course, the way back is Learning.
 */
export function courseContext(state, kind, uid, slug) {
  const s = clean(slug);
  if (!s) return { back: LEARNING, sub: undefined };
  const back = { to: `/learning/courses/${enc(s)}`, label: 'Course' };
  if (state?.status !== 'ready' || !state.course) return { back, sub: undefined };
  const title = clean(state.course.title) || 'Course';
  const lesson = courseLessons(state.modules).find((l) => l.kind === kind && l.ref_uid === uid);
  return {
    back: { ...back, label: title },
    sub: lesson ? [`Part of ${title}`, clean(lesson.module?.title)].filter(Boolean).join(' · ') : undefined,
  };
}

// ── Exercises ─────────────────────────────────────────────────────────────

/**
 * The items a checklist submission checked. The route stores a checklist's
 * `body` as the JSON list of indexes (`"[0,2]"`). Null when the body is not
 * such a list, so a text answer is never read as ticks.
 */
export function checkedOf(body, count) {
  let list;
  try { list = JSON.parse(String(body ?? '')); } catch { return null; }
  if (!Array.isArray(list)) return null;
  const n = Number(count);
  const bounded = count !== undefined && count !== null && Number.isFinite(n);
  if (!list.every((i) => Number.isInteger(i) && i >= 0 && (!bounded || i < n))) return null;
  return [...new Set(list)].sort((a, b) => a - b);
}

/** The answer as `POST /exercises/:uid/submissions` takes it: `{ body }` for text, `{ checked }` for a checklist. */
export function exerciseAnswer(kind, { text, checked } = {}) {
  if (kind === 'checklist') return { checked: [...new Set(checked || [])].sort((a, b) => a - b) };
  return { body: clean(text) };
}

// ── Exams ─────────────────────────────────────────────────────────────────

/** An option list as `{ key, label }` rows: the route sends strings, keyed by their index. */
export function optionRows(options) {
  return (options || []).map((o, i) => (typeof o === 'string'
    ? { key: String(i), label: o }
    : { key: String(o?.key ?? i), label: String(o?.label ?? o?.text ?? '') }));
}

/** "A", "B", … for the option at an index, as the canvas's exam builder names them. */
export const optionLetter = (index) => String.fromCharCode(65 + index);

/**
 * Seconds left on an attempt. THE CLOCK IS THE SERVER'S: the start route sends
 * `deadline`, null for an untimed exam, and that is what counts. An attempt
 * read without one falls back to its start plus the limit.
 */
export function attemptSecondsLeft(attempt, exam, now) {
  if (attempt && Object.prototype.hasOwnProperty.call(attempt, 'deadline')) {
    const deadline = parseInstant(attempt.deadline);
    const t = Number(now);
    if (!deadline || !Number.isFinite(t)) return null;
    return Math.max(0, Math.floor((deadline.getTime() - t) / 1000));
  }
  return secondsLeft(attempt, exam, now);
}

/**
 * The choices as `POST …/attempts/:attempt/submit` takes them: each answered
 * question's options as their indexes, in order. An unanswered question is
 * left out, and the route marks it wrong.
 */
export function answerIndexes(questions, chosen) {
  const out = {};
  for (const q of questions || []) {
    const rows = optionRows(q?.options);
    const picked = (chosen?.[q?.uid] || []).map((key) => rows.findIndex((o) => o.key === key)).filter((i) => i >= 0);
    if (picked.length) out[q.uid] = [...new Set(picked)].sort((a, b) => a - b);
  }
  return out;
}

/** The attempt still open (started, never submitted): the one "Resume" picks up. */
export const openAttemptOf = (attempts) => (attempts || []).find((a) => a?.started_at && !a.submitted_at) || null;

const passedOf = (a) => (a?.passed === true || a?.passed === 1 ? true : a?.passed === false || a?.passed === 0 ? false : null);

/** An attempt's outcome, from what the route sends: open, timed out, pass or fail. */
export function attemptOutcome(a) {
  if (!a?.submitted_at) return { label: 'Open', tone: 'info' };
  if (a.timed_out === true || a.timed_out === 1) return { label: 'Timed out', tone: 'danger' };
  const passed = passedOf(a);
  if (passed === true) return { label: 'Pass', tone: 'ok' };
  if (passed === false) return { label: 'Fail', tone: 'danger' };
  return { label: 'Result not recorded', tone: 'neutral' };
}

/** A score as the route sends it, or null when it sends none. Never a zero for a missing value. */
export function scoreOf(a) {
  const n = Number(a?.score_percent);
  return a?.score_percent === null || a?.score_percent === undefined || !Number.isFinite(n) ? null : Math.round(n);
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const x = [...a].sort((m, n) => m - n);
  const y = [...b].sort((m, n) => m - n);
  return x.every((v, i) => v === y[i]);
}

/**
 * The correct answers of a submitted attempt, question by question, with what
 * was chosen. Only when the route says it revealed them (`answers_revealed`)
 * on an exam whose `reveal` is `score_and_answers`, and only for the questions
 * this page showed (`result.questions`). Null otherwise: nothing is drawn.
 */
export function revealedAnswers(exam, result) {
  if (exam?.reveal !== 'score_and_answers' || result?.answers_revealed !== true) return null;
  const correct = result.correct;
  if (!correct || typeof correct !== 'object') return null;
  const answers = result.answers && typeof result.answers === 'object' ? result.answers : {};
  return (result.questions || []).map((q, i) => {
    const rows = optionRows(q.options);
    const label = (list) => (Array.isArray(list) ? list.map((n) => rows[n]?.label).filter(Boolean) : []);
    const chosen = Array.isArray(answers[q.uid]) ? answers[q.uid] : [];
    const right = Array.isArray(correct[q.uid]) ? correct[q.uid] : [];
    return { uid: q.uid, n: i + 1, prompt: q.prompt, chosen: label(chosen), correct: label(right), right: right.length > 0 && sameSet(chosen, right) };
  });
}

// ── The studio ────────────────────────────────────────────────────────────

/** The route's own sentence when an exam's questions are fixed (`exam_has_attempts`). */
export const FROZEN_LINE = 'Someone has started this exam, so its questions are fixed. Make a new exam to change them.';

/** A checklist as stored: `checklist_json` on the studio's rows, `checklist` on the member's. */
export function checklistOf(x) {
  if (Array.isArray(x?.checklist)) return x.checklist.map(String);
  if (!x?.checklist_json) return [];
  try {
    const list = JSON.parse(x.checklist_json);
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

/** An exercise form, from the stored row or blank. */
export function exerciseForm(x) {
  const items = checklistOf(x);
  return {
    title: x?.title ?? '',
    instructions: x?.instructions ?? '',
    submission_kind: x?.submission_kind === 'checklist' ? 'checklist' : 'text',
    checklist: items.length ? items : [''],
    visibility: x?.visibility || 'open',
  };
}

/**
 * The body `POST /exercises` and `PATCH /exercises/:uid` take. The answer's
 * kind goes only with a create: the edit route keeps it. A checklist sends its
 * items, blank rows dropped; a written answer sends none.
 */
export function exerciseBody(form, creating) {
  const kind = form.submission_kind === 'checklist' ? 'checklist' : 'text';
  return {
    title: form.title,
    instructions: form.instructions,
    visibility: form.visibility || 'open',
    ...(creating ? { submission_kind: kind } : {}),
    ...(kind === 'checklist' ? { checklist: (form.checklist || []).map(clean).filter(Boolean) } : {}),
  };
}

/** An exam form, from the authoring tree or blank. Numbers are held as typed; a new exam starts at the route's 70%. */
export function examForm(x) {
  const typed = (v) => (v === null || v === undefined ? '' : String(v));
  return {
    title: x?.title ?? '',
    intro: x?.intro ?? '',
    pass_mark_percent: x ? typed(x.pass_mark_percent) : '70',
    time_limit_minutes: typed(x?.time_limit_minutes),
    max_attempts: typed(x?.max_attempts),
    shuffle: x?.shuffle === true || Number(x?.shuffle) === 1,
    reveal: x?.reveal === 'score_and_answers' ? 'score_and_answers' : 'score',
    visibility: x?.visibility || 'open',
  };
}

const WHOLE = /^\d+$/;

/**
 * The body `POST /exams` and `PATCH /exams/:uid` take. An empty time limit or
 * attempt limit goes as null, which the route stores as "none". What is not a
 * whole number is refused here, before anything is sent: the route would read
 * an empty pass mark as 0. A whole number out of range goes, and the route
 * answers in its own words.
 */
export function examBody(form) {
  const pass = clean(form.pass_mark_percent);
  if (!WHOLE.test(pass)) throw new Error('The pass mark is a whole number from 0 to 100.');
  const limit = clean(form.time_limit_minutes);
  if (limit && !WHOLE.test(limit)) throw new Error('The time limit is a whole number of minutes, or empty for none.');
  const attempts = clean(form.max_attempts);
  if (attempts && !WHOLE.test(attempts)) throw new Error('Attempts is a whole number, or empty for no limit.');
  return {
    title: form.title,
    intro: form.intro,
    pass_mark_percent: Number(pass),
    time_limit_minutes: limit ? Number(limit) : null,
    max_attempts: attempts ? Number(attempts) : null,
    shuffle: Boolean(form.shuffle),
    reveal: form.reveal === 'score_and_answers' ? 'score_and_answers' : 'score',
    visibility: form.visibility || 'open',
  };
}

/** A question form, from the authoring tree's question or blank (two empty options). */
export function questionForm(q) {
  return {
    prompt: q?.prompt ?? '',
    kind: q?.kind === 'multiple' ? 'multiple' : 'single',
    options: Array.isArray(q?.options) && q.options.length ? q.options.map(String) : ['', ''],
    correct: Array.isArray(q?.correct) ? [...q.correct] : [],
  };
}

/** A question form with one option removed, the correct answer moved with the options it points at. */
export function withoutOption(form, index) {
  return {
    ...form,
    options: form.options.filter((_, i) => i !== index),
    correct: form.correct.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i)),
  };
}

/**
 * The body `POST /exams/:uid/questions` and `PATCH /questions/:uid` take, the
 * question restated whole, as the edit route requires whenever the options
 * or the kind change. Blank options are dropped and the correct indexes moved
 * with the options they point at.
 */
export function questionBody(form) {
  const kept = [];
  const moved = new Map();
  (form.options || []).forEach((o, i) => {
    const t = clean(o);
    if (t) { moved.set(i, kept.length); kept.push(t); }
  });
  const correct = [...new Set((form.correct || []).filter((i) => moved.has(i)).map((i) => moved.get(i)))].sort((a, b) => a - b);
  return { prompt: form.prompt, kind: form.kind === 'multiple' ? 'multiple' : 'single', options: kept, correct };
}

/**
 * The studio's content-table rows for exercises and exams, in the shape
 * `StudioContentTable` draws. `programs` is null: neither list says which
 * programs hold a row, so that column stays "Not recorded".
 */
export function assessmentRows(exercises, exams) {
  const row = (kind) => (x) => ({
    kind, uid: x.uid, title: x.title, status: x.status, visibility: x.visibility, programs: null,
    updated_at: x.updated_at, href: `/learning/studio?${kind}=${enc(x.uid)}`,
  });
  return [...(exercises || []).map(row('exercise')), ...(exams || []).map(row('exam'))];
}

/** The studio's rows with exercises and exams merged in, the newest edit first, as `studioRows` orders them. */
export function withAssessmentRows(rows, exercises, exams) {
  return [...(rows || []), ...assessmentRows(exercises, exams)]
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}
