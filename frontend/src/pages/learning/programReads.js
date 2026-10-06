/**
 * Learning programs: every call the program pages make (D562 stage 3, on
 * D558's routes). One of the five files in this folder that touch the
 * client (the README names them), and like the others it calls only methods
 * the client already declares.
 *
 *   A member (`routes/learning_programs.ts`, /api/learning):
 *     learningApi.myEnrolledPrograms → GET  /programs/enrolled
 *     learningApi.program            → GET  /programs/:uid        (contents and my completion)
 *     learningApi.programs           → GET  /programs             (open to self-enrolment)
 *     learningApi.enrolInProgram     → POST /programs/:uid/enrol
 *   An assigned admin, read-only (same file):
 *     learningApi.assignedPrograms   → GET  /programs/mine
 *     learningApi.programLearners    → GET  /programs/:uid/learners
 *     learningApi.programLearner     → GET  /programs/:uid/learners/:userUid
 *   The Super Admin (`routes/admin_learning_programs.ts`, /api/admin/learning):
 *     adminLearningApi.listPrograms, getProgram, createProgram, updateProgram,
 *     setProgramContents, assignProgramAdmin, unassignProgramAdmin,
 *     enrolInProgram, unenrolFromProgram; and, to choose content and people,
 *     listCourses, listItems, listExams, listExercises and the console's own
 *     user search, `api.adminListUsers` (GET /api/admin/users?q=).
 *
 * A REPLY IN THE WRONG SHAPE IS A FAILED READ, NOT AN EMPTY ONE, as in
 * `learningReads.js`. A REFUSAL IS NOT A FAILED READ EITHER: a 403 comes back
 * as `{ refused: { code, message } }`, so the page says the route's own
 * sentence ("You can follow the learners of programs assigned to you.")
 * rather than "could not be read". A 404 still throws, with its status, for
 * `useLearningRead` to call "missing". A write's refusal is never caught here:
 * the error `request()` throws carries the route's sentence, and the page
 * shows it as it came.
 */
import { api } from '../../lib/api';
// D527: each Learning client from its own module, as `learningReads.js` imports them.
import { learningApi } from '../../lib/api/learning.js';
import { adminLearningApi } from '../../lib/api/adminLearning.js';
import { reportError } from '../../lib/log';
import { PROGRAM_STATUS, USER_SEARCH_LIMIT, programBody, userRow } from './programModel';

function listOf(reply, key, what) {
  const list = reply?.[key];
  if (!Array.isArray(list)) throw new Error(`${what} came back in a shape this page cannot read.`);
  return list;
}

/** A 403 as the route's own refusal, for the page to say; anything else is thrown on. */
async function refusedOr(read) {
  try {
    return await read();
  } catch (err) {
    if (err?.status === 403) return { refused: { code: err.code || null, message: err.message || '' } };
    throw err;
  }
}

// ── A member ─────────────────────────────────────────────────────────────────

/**
 * The member's own programs, each with its contents and their completion.
 * `GET /programs/enrolled` sends neither, so each program is read on its own
 * (`GET /programs/:uid`), and one that fails is that program's "unreadable",
 * never the section's and never a zero.
 */
export async function readMyPrograms() {
  const programs = listOf(await learningApi.myEnrolledPrograms(), 'programs', 'Your programs');
  const rows = await Promise.all(programs.map(async (program) => {
    try {
      const reply = await learningApi.program(program.uid);
      if (!Array.isArray(reply?.contents)) throw new Error('The program came back in a shape this page cannot read.');
      return {
        program,
        detail: { status: 'ready', contents: reply.contents, completion: Array.isArray(reply.my_completion) ? reply.my_completion : null },
      };
    } catch (err) {
      if (err?.status === 404) return { program, detail: { status: 'missing', message: err.message || '' } };
      reportError('Learning:my-program', err);
      return { program, detail: { status: 'unreadable', message: err?.message || '' } };
    }
  }));
  return { rows };
}

/** Published programs open to self-enrolment, each with whether the member is already in it. */
export async function readOpenPrograms() {
  return { programs: listOf(await learningApi.programs(), 'programs', 'The open programs') };
}

/** Self-enrolment. The route refuses an invite-only program and a member a Super Admin removed, in its own words. */
export async function enrolSelf(uid) {
  return (await learningApi.enrolInProgram(uid))?.enrolment || null;
}

// ── An assigned admin, read-only ─────────────────────────────────────────────

/** The programs assigned to the caller (the Super Admin: every program), with their counts. */
export function readAssignedPrograms() {
  return refusedOr(async () => ({ programs: listOf(await learningApi.assignedPrograms(), 'programs', 'Your programs') }));
}

/** One program's enrolled learners, each with their completion of each content item. */
export function readProgramLearners(uid) {
  return refusedOr(async () => {
    const reply = await learningApi.programLearners(uid);
    if (!reply?.program) throw new Error('The program came back in a shape this page cannot read.');
    return { program: reply.program, contents: listOf(reply, 'contents', 'The program'), learners: listOf(reply, 'learners', 'The program') };
  });
}

/** One learner's record in the program. A learner not in it is a 404, in the route's words. */
export function readProgramLearner(uid, userUid) {
  return refusedOr(async () => {
    const reply = await learningApi.programLearner(uid, userUid);
    if (!reply?.learner || !Array.isArray(reply.learner.completion)) throw new Error('The learner came back in a shape this page cannot read.');
    return { contents: listOf(reply, 'contents', 'The learner'), learner: reply.learner };
  });
}

// ── The Super Admin ──────────────────────────────────────────────────────────

/** Every program, drafts and archived included, with its member and admin counts. */
export function readStudioPrograms() {
  return refusedOr(async () => ({ programs: listOf(await adminLearningApi.listPrograms(), 'programs', 'The program list') }));
}

/** `detail()`: the program, its contents, its assigned admins and every enrolment row, removed ones included. */
function detailOf(reply) {
  if (!reply?.program) throw new Error('The program came back in a shape this page cannot read.');
  return {
    program: reply.program,
    contents: listOf(reply, 'contents', 'The program'),
    admins: listOf(reply, 'admins', 'The program'),
    enrolments: listOf(reply, 'enrolments', 'The program'),
  };
}

export function readStudioProgram(uid) {
  return refusedOr(async () => detailOf(await adminLearningApi.getProgram(uid)));
}

/** A new program, created as a draft. Resolves to its detail. */
export async function createProgram(form) {
  return detailOf(await adminLearningApi.createProgram(programBody(form, true)));
}

/** Name, region and description. */
export async function saveProgram(uid, form) {
  return detailOf(await adminLearningApi.updateProgram(uid, programBody(form, false)));
}

/** Publish, unpublish (back to draft) or archive. */
export async function setProgramStatus(uid, action) {
  return detailOf(await adminLearningApi.updateProgram(uid, { status: PROGRAM_STATUS[action] }));
}

/** Open to self-enrolment, or by invitation only. */
export async function setProgramEnrolment(uid, open) {
  return detailOf(await adminLearningApi.updateProgram(uid, { enrolment: open ? 'open' : 'invite' }));
}

/** The program's whole ordered list, as the route takes it (`programModel.js` builds it). */
export async function saveContents(uid, contents) {
  return detailOf(await adminLearningApi.setProgramContents(uid, contents));
}

export async function assignAdmin(uid, userUid) {
  return detailOf(await adminLearningApi.assignProgramAdmin(uid, userUid));
}

export async function unassignAdmin(uid, userUid) {
  return detailOf(await adminLearningApi.unassignProgramAdmin(uid, userUid));
}

export async function enrolMember(uid, userUid) {
  return detailOf(await adminLearningApi.enrolInProgram(uid, userUid));
}

/** Marks the enrolment removed; the route keeps the row. */
export async function unenrolMember(uid, userUid) {
  return detailOf(await adminLearningApi.unenrolFromProgram(uid, userUid));
}

const CHOICE_READS = {
  course: [() => adminLearningApi.listCourses(), 'courses', 'The course list'],
  item: [() => adminLearningApi.listItems(), 'items', 'The video and reading list'],
  exam: [() => adminLearningApi.listExams(), 'exams', 'The exam list'],
  exercise: [() => adminLearningApi.listExercises(), 'exercises', 'The exercise list'],
};

/**
 * What content can be added, kind by kind. Each list answers alone: one that
 * fails is that kind's "unreadable", and the other kinds can still be chosen.
 */
export async function readContentChoices() {
  const entries = await Promise.all(Object.entries(CHOICE_READS).map(async ([kind, [list, key, what]]) => {
    try {
      return [kind, { status: 'ready', rows: listOf(await list(), key, what) }];
    } catch (err) {
      reportError('Learning:program-choices', err);
      return [kind, { status: 'unreadable', message: err?.message || `${what} could not be read.` }];
    }
  }));
  return { byKind: Object.fromEntries(entries) };
}

/** People by name or email, as the console's user search finds them. Name, role and uid only. */
export async function findUsers(q) {
  const reply = await api.adminListUsers({ q, limit: USER_SEARCH_LIMIT });
  const list = Array.isArray(reply) ? reply : reply?.results;
  if (!Array.isArray(list)) throw new Error('The user search came back in a shape this page cannot read.');
  return list.map(userRow).filter((u) => u.uid);
}
