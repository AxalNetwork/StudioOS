/**
 * Learning programs, the pure half (D562 stage 3, on D558's routes). No React
 * and no fetch, so a test reads every rule here directly. `programReads.js`
 * makes the calls; the components draw what these functions return.
 *
 * THE SHAPES ARE THE ROUTES' OWN (`cloudflare-worker/src/services/learningPrograms.ts`):
 *
 *   a program     `programView`: { uid, name, region, description,
 *                 enrolment: 'invite' | 'open', status: 'draft' | 'published' |
 *                 'archived', created_at, updated_at }
 *   its contents  `describeContents`: [{ subject_kind, subject_uid, position,
 *                 title, status, href }], `status` being the subject's own, or
 *                 'missing' when its row is gone
 *   a completion  `completionFor`, one entry per content row: { subject_kind,
 *                 subject_uid, status, … }, where a course adds `required`,
 *                 `completed` and `percent`, an item `percent`, and an exam
 *                 `best_score_percent` and `attempts`
 *
 * NOTHING STARTED IS NOT ZERO (D558). A course never opened says "Not
 * started", an exam never sat has no score, and no cell is ever drawn as 0%.
 */
import { titleCase } from '../../lib/absence';
import { byPosition, moveInOrder } from './learningModel';

/**
 * What each kind of program content is called. A program's `item` is a video
 * or a reading, and the route does not say which (`describeContents` selects
 * the item's kind and does not send it), so it is named as either.
 */
export const SUBJECT_KIND_LABEL = {
  course: 'Course', item: 'Video or reading', exam: 'Exam', exercise: 'Exercise', webinar: 'Webinar',
};
export const subjectKindLabel = (kind) => SUBJECT_KIND_LABEL[kind] || titleCase(kind) || 'Content';

/**
 * The kinds `PUT /programs/:uid/contents` takes. A webinar is refused
 * (`webinar_not_built`) until webinars are a store a program can check, so it
 * is drawn disabled rather than offered and refused.
 */
export const CONTENT_KINDS = ['course', 'item', 'exam', 'exercise'];

/** The status that means "done" for each kind: a course or item completed, an exercise accepted, an exam passed. */
const DONE_STATUS = { course: 'completed', item: 'completed', exercise: 'accepted', exam: 'passed' };

export const isComplete = (entry) => Boolean(entry) && DONE_STATUS[entry.subject_kind] === entry.status;

/** A whole number from the route (a percent, a count), or null when it sent none. Never a 0 for nothing. */
function wholeOf(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

const NOT_RECORDED = { mark: 'Not recorded', tone: 'absent', label: 'Not recorded' };
const dash = (label) => ({ mark: '—', tone: 'none', label });
/** A started subject's mark: its percent once there is one, "Started" before (never a bare 0%). */
const startedMark = (p) => (p ? `${p}%` : 'Started');

/**
 * One learner's standing on one content item, from the route's own entry: a
 * short `mark` for a matrix cell, the `label` in words (the cell's title and
 * its screen-reader text, and the member's own list), and a `tone`.
 */
export function completionCell(entry) {
  if (!entry) return NOT_RECORDED;
  const s = entry.status;
  switch (entry.subject_kind) {
    case 'course': {
      if (s === 'completed') return { mark: '✓', tone: 'ok', label: 'Completed' };
      if (s !== 'in_progress') return dash('Not started');
      const p = wholeOf(entry.percent);
      const required = wholeOf(entry.required);
      const done = wholeOf(entry.completed);
      // Over required lessons, as the route measures it; a course with none has no count.
      const lessons = required && done !== null ? `, ${done} of ${required} required lessons` : '';
      return { mark: startedMark(p), tone: 'neutral', label: `In progress${lessons}` };
    }
    case 'item': {
      if (s === 'completed') return { mark: '✓', tone: 'ok', label: 'Completed' };
      if (s !== 'in_progress') return dash('Not started');
      const p = wholeOf(entry.percent);
      return { mark: startedMark(p), tone: 'neutral', label: p ? `In progress, ${p}%` : 'In progress' };
    }
    case 'exercise':
      if (s === 'accepted') return { mark: 'Accepted', tone: 'ok', label: 'Accepted' };
      if (s === 'needs_work') return { mark: 'Needs work', tone: 'warn', label: 'Needs work' };
      if (s === 'submitted') return { mark: 'Submitted', tone: 'info', label: 'Submitted, not reviewed yet' };
      return dash('Not submitted');
    case 'exam': {
      if (s !== 'passed' && s !== 'not_passed') return dash('Not attempted');
      const best = wholeOf(entry.best_score_percent);
      const n = Number(entry.attempts);
      const tries = Number.isFinite(n) && n > 0 ? ` · ${n} attempt${n === 1 ? '' : 's'}` : '';
      const word = s === 'passed' ? 'Passed' : 'Not passed';
      return {
        mark: best === null ? word : `${best}%`,
        tone: s === 'passed' ? 'ok' : 'warn',
        label: `${word}${best === null ? '' : `, best score ${best}%`}${tries}`,
      };
    }
    default:
      // A kind the route cannot measure yet (`not_built`): said, never guessed.
      return NOT_RECORDED;
  }
}

const keyOf = (row) => `${row?.subject_kind}:${row?.subject_uid}`;

/** The completion entry for one content row, matched by kind and uid rather than by position. */
export function entryFor(completion, content) {
  if (!Array.isArray(completion) || !content) return null;
  return completion.find((e) => keyOf(e) === keyOf(content)) || null;
}

/**
 * How far a member is through a program: the content they have completed, out
 * of the PUBLISHED content the route lists. A draft or archived subject is
 * listed but cannot be opened by a member, so counting it would put the end
 * out of reach. Null when the route sent no completion to count.
 */
export function programProgress(contents, completion) {
  if (!Array.isArray(completion)) return null;
  const open = (contents || []).filter((c) => c?.status === 'published');
  const done = open.filter((c) => isComplete(entryFor(completion, c))).length;
  return { done, total: open.length };
}

/** "2 of 5 complete", without a bare zero for a program nobody has started. */
export function progressLine({ done, total }) {
  if (!total) return 'Nothing in this program is published yet.';
  return done === 0 ? `None of ${total} complete yet` : `${done} of ${total} complete`;
}

/**
 * A read's state as the status a component draws: a read not started yet is
 * loading, and a 404 is "ready, with nothing to show" (the component's own
 * empty state names it), as `LearningWired.jsx` maps them.
 */
export const readStatus = (state) => (state?.status === 'missing' ? 'ready' : !state || state.status === 'idle' ? 'loading' : state.status);

/**
 * The learner read as the record may draw it. Choosing another member renders
 * once before their read starts, so a reply for someone else is "loading"
 * here: one member's record is never drawn under another's name.
 */
export function learnerFor(state, uid) {
  return state?.status === 'ready' && !state.refused && state.learner?.uid !== uid ? { status: 'loading' } : state;
}

/** What a member reads beside a content row that they cannot open. */
export const UNAVAILABLE_LINE = {
  draft: 'Not published yet',
  archived: 'Archived',
  missing: 'No longer exists',
};

// ── The Super Admin's writes: the bodies the routes take ────────────────────

/** A program form as the studio holds it, from a stored program or blank. */
export function programForm(program) {
  return {
    name: program?.name ?? '',
    region: program?.region ?? '',
    description: program?.description ?? '',
    enrolment: program?.enrolment ?? 'invite',
  };
}

/**
 * The body `POST /programs` and `PATCH /programs/:uid` take. Text goes as
 * typed (the route trims it and stores an empty field as null, and refuses a
 * program with no name in its own words). Enrolment is set when the program is
 * created; afterwards the members card's switch changes it on its own.
 */
export function programBody(form, creating) {
  return {
    name: form.name,
    region: form.region,
    description: form.description,
    ...(creating ? { enrolment: form.enrolment === 'open' ? 'open' : 'invite' } : {}),
  };
}

/** Publish, unpublish (back to draft) and archive, as the status `PATCH /programs/:uid` stores. */
export const PROGRAM_STATUS = { publish: 'published', unpublish: 'draft', archive: 'archived' };

/** The full ordered list `PUT /programs/:uid/contents` takes: kind and uid, nothing else. */
export function contentsBody(contents) {
  return byPosition(contents).map((c) => ({ subject_kind: c.subject_kind, subject_uid: c.subject_uid }));
}

/** The list with one subject added at the end. */
export function withContent(contents, kind, uid) {
  return [...contentsBody(contents), { subject_kind: kind, subject_uid: uid }];
}

/** The list without one subject. */
export function withoutContent(contents, kind, uid) {
  return contentsBody(contents).filter((c) => keyOf(c) !== `${kind}:${uid}`);
}

/** The list with one subject moved a step up (-1) or down (+1); null when it is already at that end. */
export function movedContent(contents, kind, uid, step) {
  const list = contentsBody(contents);
  const order = moveInOrder(list.map(keyOf), `${kind}:${uid}`, step);
  if (!order) return null;
  return order.map((k) => list.find((c) => keyOf(c) === k));
}

/**
 * What the content picker offers for one kind: the studio's own list, minus
 * what the program already holds and minus archived rows, each labelled with
 * its status when it is not published. A video or a reading is an `item`.
 */
export function contentChoices(rows, kind, held) {
  const taken = new Set((held || []).filter((c) => c.subject_kind === kind).map((c) => c.subject_uid));
  return (rows || [])
    .filter((r) => r?.uid && r.status !== 'archived' && !taken.has(r.uid))
    .map((r) => {
      const tags = [kind === 'item' ? r.kind : null, r.status && r.status !== 'published' ? r.status : null].filter(Boolean);
      return { uid: r.uid, label: `${r.title || 'Untitled'}${tags.length ? ` (${tags.join(', ')})` : ''}` };
    });
}

/** How many people one search shows; the console's user search serves up to 200. */
export const USER_SEARCH_LIMIT = 20;

/**
 * A user search result as the studio may show it: a name, a role and a uid.
 * `GET /api/admin/users` also sends an email; it is dropped here, because a
 * program's people are named by name and uid (D558).
 */
export function userRow(u) {
  return { uid: String(u?.uid ?? ''), name: u?.name || null, role: u?.role || null, active: u?.is_active === undefined ? true : Boolean(Number(u.is_active)) };
}

/** Members first, then the removed rows the route keeps on file. */
export function splitEnrolments(enrolments) {
  const rows = enrolments || [];
  return { active: rows.filter((e) => e.status === 'active'), removed: rows.filter((e) => e.status === 'removed') };
}

/** Who put a member in: the route answers `self` or `super_admin`. */
export const ENROLLED_BY = { self: 'joined by themselves', super_admin: 'enrolled by a Super Admin' };
