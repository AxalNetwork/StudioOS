/**
 * D562 stage 3 — the Learning programs screens wired to D558's routes (#1159):
 * a member's "My programs" with self-enrolment, the assigned admin's
 * read-only programs and learners, and the Super Admin's regional programs
 * studio.
 *
 * Every fixture here is in the shape `routes/learning_programs.ts`,
 * `routes/admin_learning_programs.ts` and `services/learningPrograms.ts`
 * send, and the first test reads those files to hold the fixtures to them.
 * Reads and writes go through the real client against a stubbed `fetch`, so
 * the method, the path and the body are the ones the page would send.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_programs_d558_ui.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';

import {
  ENROLLED_BY, completionCell, contentChoices, contentsBody, learnerFor, movedContent, programBody, programForm, programProgress,
  progressLine, readStatus, splitEnrolments, subjectKindLabel, userRow, withContent, withoutContent,
} from '../src/pages/learning/programModel.js';
import {
  assignAdmin, createProgram, enrolMember, enrolSelf, findUsers, readAssignedPrograms, readContentChoices, readMyPrograms,
  readOpenPrograms, readProgramLearner, readProgramLearners, readStudioProgram, readStudioPrograms, saveContents, saveProgram,
  setProgramEnrolment, setProgramStatus, unassignAdmin, unenrolMember,
} from '../src/pages/learning/programReads.js';
import { MyProgramsSection } from '../src/pages/learning/MyPrograms.jsx';
import ProgramsTable from '../src/pages/learning/ProgramsTable.jsx';
import ProgramLearnersTable, { LearnerRecord } from '../src/pages/learning/ProgramLearnersTable.jsx';
import ProgramDetail, { ContentPicker, PeopleResults, ProgramFields } from '../src/pages/learning/ProgramDetail.jsx';
import {
  AssignedProgramsView, ProgramLearnersView, ProgramPage, ProgramsPage, learnersCoverage,
} from '../src/pages/learning/LearningPrograms.jsx';
import {
  StudioProgramPage, StudioProgramView, StudioProgramsPage, StudioProgramsView, programCoverage, programHandlers,
} from '../src/pages/learning/ProgramStudio.jsx';

process.env.TZ = 'UTC';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el, path = '/learning') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
// `&amp;` is decoded last, so an escaped entity is never read as the character it escapes.
const flat = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const text = (el, path) => flat(html(el, path));
function tagOf(markup, id) {
  const at = markup.indexOf(`data-testid="${id}"`);
  if (at < 0) return '';
  return markup.slice(markup.lastIndexOf('<', at), markup.indexOf('>', at) + 1);
}
/** The markup from one test id's element to the next sibling marker, for reading one row. */
const sliceFrom = (markup, id, until) => {
  const at = markup.indexOf(`data-testid="${id}"`);
  if (at < 0) return '';
  const end = until ? markup.indexOf(`data-testid="${until}"`, at + 1) : -1;
  return markup.slice(at, end < 0 ? undefined : end);
};
const count = (markup, needle) => markup.split(needle).length - 1;

// ── Fixtures, in the routes' own shapes ────────────────────────────────────

/** `programView` (services/learningPrograms.ts): never the numeric id. */
const NORDICS = {
  uid: 'p-nordics', name: 'Nordics', region: 'Nordics', description: 'The Nordic founders’ cohort.', enrolment: 'invite',
  status: 'published', created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-03T10:00:00.000Z',
};
const OPEN = {
  uid: 'p-open', name: 'Open cohort', region: null, description: 'Anyone may join this one.', enrolment: 'open',
  status: 'published', created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-02T10:00:00.000Z',
};
const DACH = {
  uid: 'p-dach', name: 'DACH', region: null, description: null, enrolment: 'invite',
  status: 'draft', created_at: '2026-10-04T10:00:00.000Z', updated_at: '2026-10-04T10:00:00.000Z',
};
/** `describeContents`: each subject's title and status from its own store, in stored order. */
const CONTENTS = [
  { subject_kind: 'exam', subject_uid: 'x-check', position: 2, title: 'Nordic check', status: 'published', href: '/learning/exams/x-check' },
  { subject_kind: 'course', subject_uid: 'c-101', position: 0, title: 'Nordic 101', status: 'published', href: '/learning/courses/nordic-101' },
  { subject_kind: 'item', subject_uid: 'v-welcome', position: 1, title: 'Cohort welcome', status: 'published', href: '/learning/items/v-welcome' },
  { subject_kind: 'exercise', subject_uid: 'e-plan', position: 3, title: 'Your plan', status: 'published', href: '/learning/exercises/e-plan' },
  { subject_kind: 'item', subject_uid: 'r-rules', position: 4, title: 'Regional rules', status: 'draft', href: '/learning/items/r-rules' },
];
/** `completionFor`: one entry per content row, in the contents' order. */
const MIA = {
  uid: 'u-mia', name: 'Mia Member', enrolled_at: '2026-10-02T09:00:00.000Z',
  completion: [
    { subject_kind: 'course', subject_uid: 'c-101', status: 'completed', required: 2, completed: 2, percent: 100 },
    { subject_kind: 'item', subject_uid: 'v-welcome', status: 'completed', percent: 100 },
    { subject_kind: 'exam', subject_uid: 'x-check', status: 'passed', best_score_percent: 100, attempts: 1 },
    { subject_kind: 'exercise', subject_uid: 'e-plan', status: 'submitted' },
    { subject_kind: 'item', subject_uid: 'r-rules', status: 'not_started', percent: null },
  ],
};
const PIA = {
  uid: 'u-pia', name: 'Pia Peer', enrolled_at: '2026-10-02T10:00:00.000Z',
  completion: [
    { subject_kind: 'course', subject_uid: 'c-101', status: 'in_progress', required: 2, completed: 1, percent: 50 },
    { subject_kind: 'item', subject_uid: 'v-welcome', status: 'in_progress', percent: 40 },
    { subject_kind: 'exam', subject_uid: 'x-check', status: 'not_passed', best_score_percent: 40, attempts: 2 },
    { subject_kind: 'exercise', subject_uid: 'e-plan', status: 'needs_work' },
    { subject_kind: 'item', subject_uid: 'r-rules', status: 'not_started', percent: null },
  ],
};
/** Nothing started: the route sends `percent: 0` for a course with required lessons and none done. */
const OTTO = {
  uid: 'u-otto', name: null, enrolled_at: '2026-10-03T10:00:00.000Z',
  completion: [
    { subject_kind: 'course', subject_uid: 'c-101', status: 'not_started', required: 2, completed: 0, percent: 0 },
    { subject_kind: 'item', subject_uid: 'v-welcome', status: 'not_started', percent: null },
    { subject_kind: 'exam', subject_uid: 'x-check', status: 'not_attempted', best_score_percent: null, attempts: 0 },
    { subject_kind: 'exercise', subject_uid: 'e-plan', status: 'not_submitted' },
    { subject_kind: 'item', subject_uid: 'r-rules', status: 'not_started', percent: null },
  ],
};
/** `GET /api/learning/programs/:uid/learners`. */
const LEARNERS_REPLY = { program: NORDICS, contents: CONTENTS, learners: [MIA, PIA, OTTO] };
/** `detail()` (routes/admin_learning_programs.ts): removed enrolments are kept. */
const DETAIL = {
  program: NORDICS,
  contents: CONTENTS,
  admins: [{ uid: 'u-ada', name: 'Ada Assigned', assigned_at: '2026-10-01T10:00:00.000Z' }],
  enrolments: [
    { uid: 'u-mia', name: 'Mia Member', status: 'active', enrolled_at: '2026-10-02T09:00:00.000Z', updated_at: '2026-10-02T09:00:00.000Z', enrolled_by: 'super_admin' },
    { uid: 'u-pia', name: 'Pia Peer', status: 'active', enrolled_at: '2026-10-02T10:00:00.000Z', updated_at: '2026-10-02T10:00:00.000Z', enrolled_by: 'self' },
    { uid: 'u-rex', name: 'Rex Removed', status: 'removed', enrolled_at: '2026-10-01T09:00:00.000Z', updated_at: '2026-10-04T09:00:00.000Z', enrolled_by: 'super_admin' },
  ],
};
/** `GET /api/admin/users?q=` without the envelope: a flat array, email included. */
const USERS = [
  { id: 2, uid: 'u-ada', email: 'u-ada@example.test', name: 'Ada Assigned', role: 'admin', is_active: 1, email_verified: 1, kyc_status: null, access_level: null, created_at: '2026-01-01' },
  { id: 4, uid: 'u-ola', email: 'u-ola@example.test', name: 'Ola Other', role: 'admin', is_active: 0, email_verified: 1, kyc_status: null, access_level: null, created_at: '2026-01-02' },
  { id: 10, uid: 'u-mia', email: 'u-mia@example.test', name: 'Mia Member', role: 'founder', is_active: 1, email_verified: 1, kyc_status: null, access_level: null, created_at: '2026-01-03' },
];
const refusal = (code, message) => ({ error: code, message, detail: message });

/**
 * The real client against a stubbed fetch: each call recorded, each reply
 * taken in turn. The error beacon (`lib/log.js` posts a failed read to
 * `/api/client-error`) is answered apart, so it never takes a route's reply.
 */
async function withFetch(replies, run) {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const calls = [];
  const queue = [...replies];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/api/client-error')) return new Response(null, { status: 204 });
    calls.push({ method: init.method || 'GET', path: String(url).replace(/^.*\/api/, ''), body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const next = queue.shift() ?? { status: 200, body: {} };
    const reply = next.status ? next : { status: 200, body: next };
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  };
  try { await run(); } finally { globalThis.fetch = orig; }
  return calls;
}
const lines = (calls) => calls.map((c) => `${c.method} ${c.path}`);

// ── The routes' shapes ─────────────────────────────────────────────────────

/**
 * What each route sends or takes, beside the line of the pages that reads or
 * sends it. A pair holds only while both halves hold: a route that stops
 * sending a field, or a page that stops reading it, fails here by name.
 */
const W = (f) => `cloudflare-worker/src/${f}`;
const P = (f) => `frontend/src/pages/learning/${f}`;
const CONTRACT = [
  // Mounted where the clients call them.
  [W('index.ts'), "app.route('/api/learning', learningProgramsRoutes);", P('programReads.js'), "import { learningApi } from '../../lib/api/learning.js';"],
  [W('index.ts'), "app.route('/api/admin/learning', adminLearningProgramsRoutes);", P('programReads.js'), "import { adminLearningApi } from '../../lib/api/adminLearning.js';"],
  // A member.
  [W('routes/learning_programs.ts'), "r.get('/programs/enrolled', async", P('programReads.js'), 'learningApi.myEnrolledPrograms()'],
  [W('routes/learning_programs.ts'), 'programs: (res.results || []).map((p) => ({ ...programView(p), enrolled_at: p.enrolled_at }))', P('programReads.js'), "listOf(await learningApi.myEnrolledPrograms(), 'programs', 'Your programs')"],
  [W('routes/learning_programs.ts'), "r.get('/programs/:uid', async", P('programReads.js'), 'learningApi.program(program.uid)'],
  [W('routes/learning_programs.ts'), 'return c.json({ program: programView(p), contents: described, enrolled: s.enrolled, my_completion: mine });', P('programReads.js'), 'Array.isArray(reply.my_completion) ? reply.my_completion : null'],
  [W('routes/learning_programs.ts'), "r.get('/programs', async", P('programReads.js'), 'learningApi.programs()'],
  [W('routes/learning_programs.ts'), "programs: (res.results || []).map((p) => ({ ...programView(p), enrolled: p.my_status === 'active' }))", P('MyPrograms.jsx'), '.filter((p) => !p.enrolled)'],
  [W('routes/learning_programs.ts'), "r.post('/programs/:uid/enrol', async", P('programReads.js'), 'learningApi.enrolInProgram(uid)'],
  [W('routes/learning_programs.ts'), "return c.json({ enrolment: { program_uid: p.uid, status: 'active', enrolled_at: t } }, 201);", P('programReads.js'), '(await learningApi.enrolInProgram(uid))?.enrolment || null'],
  [W('routes/learning_programs.ts'), "message: 'This program enrols by invitation.'", P('MyPrograms.jsx'), "setSaid({ uid, message: err?.message || 'You could not be enrolled.' });"],
  [W('routes/learning_programs.ts'), "message: 'You were removed from this program; ask its administrator.'", P('MyPrograms.jsx'), 'error={said?.uid === p.uid ? said.message : '],
  // An assigned admin, read-only.
  [W('routes/learning_programs.ts'), "r.get('/programs/mine', async", P('programReads.js'), 'learningApi.assignedPrograms()'],
  [W('routes/learning_programs.ts'), 'programs: (res.results || []).map((p) => ({ ...programView(p), learners: Number(p.learners), contents: Number(p.contents) }))', P('ProgramsTable.jsx'), "count(p.contents, 'item', 'items', 'No content')"],
  [W('routes/learning_programs.ts'), "r.get('/programs/:uid/learners', async", P('programReads.js'), 'learningApi.programLearners(uid)'],
  [W('routes/learning_programs.ts'), 'learners: await completionFor(c.env, p.id, contents, learners),', P('programReads.js'), "learners: listOf(reply, 'learners', 'The program')"],
  [W('routes/learning_programs.ts'), "r.get('/programs/:uid/learners/:userUid', async", P('programReads.js'), 'learningApi.programLearner(uid, userUid)'],
  [W('routes/learning_programs.ts'), 'learner: (await completionFor(c.env, p.id, contents, learners))[0],', P('programReads.js'), '!Array.isArray(reply.learner.completion)'],
  [W('routes/learning_programs.ts'), "message: 'You can follow the learners of programs assigned to you.'", P('programReads.js'), "if (err?.status === 403) return { refused: { code: err.code || null, message: err.message || '' } };"],
  [W('routes/learning_programs.ts'), "message: 'No such learner in this program.'", P('LearningPrograms.jsx'), 'notFound={learnerState.message ||'],
  // The Super Admin.
  [W('routes/admin_learning_programs.ts'), "r.get('/programs', async", P('programReads.js'), 'adminLearningApi.listPrograms()'],
  [W('routes/admin_learning_programs.ts'), 'programs: (res.results || []).map((p) => ({ ...programView(p), learners: Number(p.learners), admins: Number(p.admins) }))', P('ProgramsTable.jsx'), "count(p.admins, 'admin', 'admins', 'None assigned')"],
  [W('routes/admin_learning_programs.ts'), "r.post('/programs', async", P('programReads.js'), 'adminLearningApi.createProgram(programBody(form, true))'],
  [W('routes/admin_learning_programs.ts'), "r.get('/programs/:uid', async", P('programReads.js'), 'adminLearningApi.getProgram(uid)'],
  [W('routes/admin_learning_programs.ts'), "r.patch('/programs/:uid', async", P('programReads.js'), 'adminLearningApi.updateProgram(uid, { status: PROGRAM_STATUS[action] })'],
  [W('routes/admin_learning_programs.ts'), "for (const col of ['name', 'region', 'description', 'enrolment', 'status'])", P('programModel.js'), "...(creating ? { enrolment: form.enrolment === 'open' ? 'open' : 'invite' } : {}),"],
  [W('services/learningAccess.ts'), "export const LEARNING_STATUSES = ['draft', 'published', 'archived'] as const;", P('programModel.js'), "{ publish: 'published', unpublish: 'draft', archive: 'archived' }"],
  [W('routes/admin_learning_programs.ts'), "r.put('/programs/:uid/contents', async", P('programReads.js'), 'adminLearningApi.setProgramContents(uid, contents)'],
  [W('routes/admin_learning_programs.ts'), 'const list = b?.contents;', P('programModel.js'), '({ subject_kind: c.subject_kind, subject_uid: c.subject_uid })'],
  [W('routes/admin_learning_programs.ts'), "if (kind === 'webinar') bad('webinar_not_built'", P('ProgramDetail.jsx'), '<option value="webinar" disabled>'],
  [W('routes/admin_learning_programs.ts'), "r.post('/programs/:uid/admins', async", P('programReads.js'), 'adminLearningApi.assignProgramAdmin(uid, userUid)'],
  [W('routes/admin_learning_programs.ts'), "return refuse(c, 400, { code: 'not_an_admin'", P('ProgramDetail.jsx'), "adminsOnly ? all.filter((u) => u.role === 'admin') : all"],
  [W('routes/admin_learning_programs.ts'), "r.delete('/programs/:uid/admins/:userUid', async", P('programReads.js'), 'adminLearningApi.unassignProgramAdmin(uid, userUid)'],
  [W('routes/admin_learning_programs.ts'), "r.post('/programs/:uid/enrollments', async", P('programReads.js'), 'adminLearningApi.enrolInProgram(uid, userUid)'],
  [W('routes/admin_learning_programs.ts'), "r.delete('/programs/:uid/enrollments/:userUid', async", P('programReads.js'), 'adminLearningApi.unenrolFromProgram(uid, userUid)'],
  [W('routes/admin_learning_programs.ts'), 'admins: admins.results || [],', P('programReads.js'), "admins: listOf(reply, 'admins', 'The program'),"],
  [W('routes/admin_learning_programs.ts'), 'enrolments: enrolments.results || [],', P('programReads.js'), "enrolments: listOf(reply, 'enrolments', 'The program'),"],
  [W('routes/admin_learning_programs.ts'), 'SELECT u.uid, COALESCE(u.display_name, u.name) AS name, a.assigned_at FROM learning_program_admins a', P('ProgramDetail.jsx'), 'a.assigned_at ? `since ${formatDay(a.assigned_at)}` : null'],
  [W('routes/admin_learning_programs.ts'), 'SELECT u.uid, COALESCE(u.display_name, u.name) AS name, e.status, e.enrolled_at, e.updated_at,', P('ProgramDetail.jsx'), 'removed {formatDay(m.updated_at)'],
  [W('routes/admin_learning_programs.ts'), "CASE WHEN e.enrolled_by = e.user_id THEN 'self' ELSE 'super_admin' END AS enrolled_by", P('programModel.js'), "{ self: 'joined by themselves', super_admin: 'enrolled by a Super Admin' }"],
  // The shapes every one of them shares.
  [W('services/learningPrograms.ts'), 'uid: p.uid, name: p.name, region: p.region ?? null, description: p.description ?? null,', P('ProgramsTable.jsx'), '{p.region || <Unrecorded>Region not recorded</Unrecorded>}'],
  [W('services/learningPrograms.ts'), "title: row?.title ?? null, status: row ? row.status : 'missing',", P('programModel.js'), "missing: 'No longer exists',"],
  [W('services/learningPrograms.ts'), "href: !row ? null", P('MyPrograms.jsx'), '{!unavailable && content.href'],
  [W('services/learningPrograms.ts'), 'return { ...base, status, required: req.length, completed: done, percent: req.length ? Math.round((100 * done) / req.length) : null };', P('programModel.js'), 'const required = wholeOf(entry.required);'],
  [W('services/learningPrograms.ts'), "status: own?.status === 'completed' ? 'completed' : own ? 'in_progress' : 'not_started', percent: own?.percent ?? null", P('programModel.js'), "if (s !== 'in_progress') return dash('Not started');"],
  [W('services/learningPrograms.ts'), "status: latestSub.get(key(uid, 'exercise', x.subject_uid)) ?? 'not_submitted'", P('programModel.js'), "return dash('Not submitted');"],
  ['cloudflare-worker/sql/migrations/390_learning_exercises_exams.sql', "CHECK (status IN ('submitted', 'accepted', 'needs_work'))", P('programModel.js'), "if (s === 'needs_work') return"],
  [W('services/learningPrograms.ts'), "status: !e ? 'not_attempted' : e.passed ? 'passed' : 'not_passed', best_score_percent: e?.best ?? null, attempts: e?.attempts ?? 0", P('programModel.js'), 'const best = wholeOf(entry.best_score_percent);'],
  [W('services/learningPrograms.ts'), 'uid: l.uid, name: l.name ?? null, enrolled_at: l.enrolled_at,', P('ProgramLearnersTable.jsx'), 'completionCell(entryFor(learner.completion, c))'],
  // The console's user search, which "Assign" and "Enrol" use: a flat array without the envelope, email included.
  [W('routes/admin.ts'), 'SELECT id, uid, email, name, role, is_active', P('programModel.js'), "return { uid: String(u?.uid ?? ''), name: u?.name || null, role: u?.role || null, active:"],
  [W('routes/admin.ts'), 'return c.json(rows);', P('programReads.js'), 'Array.isArray(reply) ? reply : reply?.results'],
];

test('every route D558 mounted sends what the pages read, and takes what they send', () => {
  const cache = new Map();
  const src = (f) => { if (!cache.has(f)) cache.set(f, read(f)); return cache.get(f); };
  for (const [worker, sends, page, reads] of CONTRACT) {
    const sent = src(worker).includes(sends);
    assert.ok(sent && src(page).includes(reads), sent ? `${page} no longer reads it: ${reads}` : `${worker} no longer carries: ${sends}`);
  }
});

// ── The calls, through the real client ─────────────────────────────────────

test('a member: their programs each read with their completion, the open ones, and self-enrolment', async () => {
  let mine; let open; let joined;
  const calls = await withFetch([
    { programs: [{ ...NORDICS, enrolled_at: '2026-10-02T09:00:00.000Z' }, { ...OPEN, enrolled_at: '2026-10-03T09:00:00.000Z' }, { ...DACH, status: 'published', enrolled_at: '2026-10-03T09:00:00.000Z' }] },
    { program: NORDICS, contents: CONTENTS, enrolled: true, my_completion: PIA.completion },
    { status: 500, body: refusal('internal', 'Something failed.') },
    { status: 404, body: refusal('not_found', 'No such program.') },
    { programs: [{ ...OPEN, enrolled: true }, { ...NORDICS, enrolment: 'open', enrolled: false }] },
    { status: 201, body: { enrolment: { program_uid: 'p-nordics', status: 'active', enrolled_at: '2026-10-06T10:00:00.000Z' } } },
  ], async () => {
    mine = await readMyPrograms();
    open = await readOpenPrograms();
    joined = await enrolSelf('p-nordics');
  });
  assert.deepEqual(lines(calls), [
    'GET /learning/programs/enrolled',
    'GET /learning/programs/p-nordics',
    'GET /learning/programs/p-open',
    'GET /learning/programs/p-dach',
    'GET /learning/programs',
    'POST /learning/programs/p-nordics/enrol',
  ]);
  assert.equal(calls[5].body, undefined, 'self-enrolment sends no body: the user is the session\'s');
  assert.deepEqual(mine.rows.map((r) => [r.program.uid, r.detail.status]), [['p-nordics', 'ready'], ['p-open', 'unreadable'], ['p-dach', 'missing']],
    'one program\'s failed read blanked the others, or was read as empty');
  assert.deepEqual(mine.rows[0].detail.completion, PIA.completion);
  assert.equal(mine.rows[0].detail.contents.length, 5);
  assert.deepEqual(open.programs.map((p) => [p.uid, p.enrolled]), [['p-open', true], ['p-nordics', false]]);
  assert.equal(joined.status, 'active');
  // A reply in the wrong shape is a failed read, not "in no program".
  await withFetch([{ rows: [] }, { ok: true }], async () => {
    await assert.rejects(readMyPrograms(), /Your programs came back in a shape this page cannot read\./);
    await assert.rejects(readOpenPrograms(), /cannot read/);
  });
  // The route's refusals, as they came.
  await withFetch([
    { status: 403, body: refusal('invite_only', 'This program enrols by invitation.') },
    { status: 403, body: refusal('removed', 'You were removed from this program; ask its administrator.') },
  ], async () => {
    await assert.rejects(enrolSelf('p-dach'), (err) => err.message === 'This program enrols by invitation.' && err.code === 'invite_only');
    await assert.rejects(enrolSelf('p-open'), (err) => err.message === 'You were removed from this program; ask its administrator.');
  });
});

test('an assigned admin reads, read-only: their programs, the learners, one learner; a 403 is the route\'s refusal, not a failed read', async () => {
  let list; let learners; let one;
  const calls = await withFetch([
    { programs: [{ ...NORDICS, learners: 3, contents: 5 }] },
    LEARNERS_REPLY,
    { program: NORDICS, contents: CONTENTS, learner: PIA },
  ], async () => {
    list = await readAssignedPrograms();
    learners = await readProgramLearners('p-nordics');
    one = await readProgramLearner('p-nordics', 'u-pia');
  });
  assert.deepEqual(lines(calls), ['GET /learning/programs/mine', 'GET /learning/programs/p-nordics/learners', 'GET /learning/programs/p-nordics/learners/u-pia']);
  assert.ok(calls.every((c) => c.method === 'GET'), 'the read-only view wrote something');
  assert.deepEqual(list.programs.map((p) => [p.uid, p.learners, p.contents]), [['p-nordics', 3, 5]]);
  assert.deepEqual(learners.learners.map((l) => l.uid), ['u-mia', 'u-pia', 'u-otto']);
  assert.equal(learners.program.name, 'Nordics');
  assert.equal(one.learner.uid, 'u-pia');
  const notAssigned = refusal('not_assigned', 'You can follow the learners of programs assigned to you.');
  await withFetch([{ status: 403, body: notAssigned }, { status: 403, body: refusal('admins_only', 'Programs are assigned to admins.') }, { status: 403, body: notAssigned }], async () => {
    assert.deepEqual(await readProgramLearners('p-other'), { refused: { code: 'not_assigned', message: 'You can follow the learners of programs assigned to you.' } });
    assert.deepEqual(await readAssignedPrograms(), { refused: { code: 'admins_only', message: 'Programs are assigned to admins.' } });
    assert.equal((await readProgramLearner('p-other', 'u-mia')).refused.code, 'not_assigned');
  });
  // A 404 keeps its status, for "no such program" and "no such learner in this program".
  await withFetch([{ status: 404, body: refusal('not_found', 'No such program.') }, { status: 404, body: refusal('not_enrolled', 'No such learner in this program.') }, { learners: [] }], async () => {
    await assert.rejects(readProgramLearners('gone'), (err) => err.status === 404 && err.message === 'No such program.');
    await assert.rejects(readProgramLearner('p-nordics', 'u-otto'), (err) => err.status === 404 && err.message === 'No such learner in this program.');
    await assert.rejects(readProgramLearners('p-nordics'), /cannot read/);
  });
});

test('the Super Admin\'s studio: every call with its method, path and body, the program read back from each write', async () => {
  const replies = [{ programs: [{ ...NORDICS, learners: 2, admins: 1 }] }, DETAIL, ...Array.from({ length: 12 }, () => DETAIL)];
  let first;
  const calls = await withFetch(replies, async () => {
    await readStudioPrograms();
    first = await readStudioProgram('p-nordics');
    await createProgram({ name: 'Baltics', region: 'Baltics', description: '', enrolment: 'open' });
    await saveProgram('p-nordics', { name: 'Nordics', region: 'Nordics and Baltics', description: 'Text', enrolment: 'open' });
    await setProgramStatus('p-nordics', 'publish');
    await setProgramStatus('p-nordics', 'unpublish');
    await setProgramStatus('p-nordics', 'archive');
    await setProgramEnrolment('p-nordics', true);
    await saveContents('p-nordics', withContent(CONTENTS, 'exercise', 'e-two'));
    await assignAdmin('p-nordics', 'u-ola');
    await unassignAdmin('p-nordics', 'u-ada');
    await enrolMember('p-nordics', 'u-rex');
    await unenrolMember('p-nordics', 'u-pia');
    await setProgramEnrolment('p-nordics', false);
  });
  assert.deepEqual(lines(calls), [
    'GET /admin/learning/programs',
    'GET /admin/learning/programs/p-nordics',
    'POST /admin/learning/programs',
    'PATCH /admin/learning/programs/p-nordics',
    'PATCH /admin/learning/programs/p-nordics',
    'PATCH /admin/learning/programs/p-nordics',
    'PATCH /admin/learning/programs/p-nordics',
    'PATCH /admin/learning/programs/p-nordics',
    'PUT /admin/learning/programs/p-nordics/contents',
    'POST /admin/learning/programs/p-nordics/admins',
    'DELETE /admin/learning/programs/p-nordics/admins/u-ada',
    'POST /admin/learning/programs/p-nordics/enrollments',
    'DELETE /admin/learning/programs/p-nordics/enrollments/u-pia',
    'PATCH /admin/learning/programs/p-nordics',
  ]);
  const bodyOf = (i) => calls[i].body;
  assert.deepEqual(first.enrolments.map((e) => [e.uid, e.status]), [['u-mia', 'active'], ['u-pia', 'active'], ['u-rex', 'removed']]);
  // A new program: its fields and how it enrols. An edit leaves enrolment to the members card's switch.
  assert.deepEqual(bodyOf(2), { name: 'Baltics', region: 'Baltics', description: '', enrolment: 'open' });
  assert.deepEqual(bodyOf(3), { name: 'Nordics', region: 'Nordics and Baltics', description: 'Text' });
  assert.deepEqual([bodyOf(4), bodyOf(5), bodyOf(6)], [{ status: 'published' }, { status: 'draft' }, { status: 'archived' }]);
  assert.deepEqual([bodyOf(7), bodyOf(13)], [{ enrolment: 'open' }, { enrolment: 'invite' }]);
  // The whole list, in stored order, kind and uid only, with the new subject at the end.
  assert.deepEqual(bodyOf(8), { contents: [
    { subject_kind: 'course', subject_uid: 'c-101' }, { subject_kind: 'item', subject_uid: 'v-welcome' },
    { subject_kind: 'exam', subject_uid: 'x-check' }, { subject_kind: 'exercise', subject_uid: 'e-plan' },
    { subject_kind: 'item', subject_uid: 'r-rules' }, { subject_kind: 'exercise', subject_uid: 'e-two' },
  ] });
  assert.deepEqual([bodyOf(9), bodyOf(11)], [{ user_uid: 'u-ola' }, { user_uid: 'u-rex' }]);
  assert.deepEqual([bodyOf(10), bodyOf(12)], [undefined, undefined], 'a removal sends no body');
  // A write's reply in the wrong shape is not drawn as an empty program.
  await withFetch([{ program: NORDICS, contents: [] }], async () => {
    await assert.rejects(saveProgram('p-nordics', programForm(NORDICS)), /cannot read/);
  });
});

test('a refusal reaches the studio in the route\'s own words', async () => {
  await withFetch([
    { status: 400, body: refusal('bad_name', 'A program needs a name.') },
    { status: 400, body: refusal('webinar_not_built', 'Webinars are not a Learning store yet (D560), so a program cannot hold one.') },
    { status: 400, body: refusal('not_an_admin', 'Only an admin can be assigned to a program.') },
    { status: 404, body: refusal('not_enrolled', 'That user is not enrolled in this program.') },
    { status: 403, body: refusal('forbidden', 'Super Admin only.') },
  ], async () => {
    await assert.rejects(createProgram({ name: '', region: '', description: '', enrolment: 'invite' }), (err) => err.message === 'A program needs a name.' && err.code === 'bad_name');
    await assert.rejects(saveContents('p-nordics', [{ subject_kind: 'webinar', subject_uid: 'w1' }]), /a program cannot hold one\./);
    await assert.rejects(assignAdmin('p-nordics', 'u-mia'), (err) => err.message === 'Only an admin can be assigned to a program.');
    await assert.rejects(unenrolMember('p-nordics', 'u-otto'), (err) => err.status === 404 && err.message === 'That user is not enrolled in this program.');
    assert.deepEqual(await readStudioProgram('p-nordics'), { refused: { code: 'forbidden', message: 'Super Admin only.' } });
  });
});

test('choosing content and people: four lists that answer alone, and a search that never keeps an email', async () => {
  let choices; let found;
  const calls = await withFetch([
    { courses: [{ uid: 'c-101', slug: 'nordic-101', title: 'Nordic 101', status: 'published' }] },
    { items: [{ uid: 'v-welcome', kind: 'video', title: 'Cohort welcome', status: 'published' }] },
    { status: 500, body: refusal('internal', 'The exam list could not be read.') },
    { exercises: [{ uid: 'e-plan', title: 'Your plan', status: 'draft' }] },
    USERS,
  ], async () => {
    choices = await readContentChoices();
    found = await findUsers('ada');
  });
  assert.deepEqual(lines(calls), [
    'GET /admin/learning/courses', 'GET /admin/learning/items', 'GET /admin/learning/exams', 'GET /admin/learning/exercises',
    'GET /admin/users?q=ada&limit=20',
  ]);
  assert.deepEqual(Object.entries(choices.byKind).map(([k, v]) => [k, v.status]), [['course', 'ready'], ['item', 'ready'], ['exam', 'unreadable'], ['exercise', 'ready']]);
  assert.equal(choices.byKind.exam.message, 'The exam list could not be read.');
  assert.deepEqual(found, [
    { uid: 'u-ada', name: 'Ada Assigned', role: 'admin', active: true },
    { uid: 'u-ola', name: 'Ola Other', role: 'admin', active: false },
    { uid: 'u-mia', name: 'Mia Member', role: 'founder', active: true },
  ]);
  assert.doesNotMatch(JSON.stringify(found), /@example\.test/, 'the search kept an email');
  await withFetch([{ status: 400, body: refusal('query_too_short', 'Type at least two characters to search.') }, { users: [] }], async () => {
    await assert.rejects(findUsers('a'), (err) => err.message === 'Type at least two characters to search.');
    await assert.rejects(findUsers('ada'), /cannot read/);
  });
});

// ── The pure half ──────────────────────────────────────────────────────────

test('a learner\'s standing per content: a tick, a percent, a score, a review, a dash, and never a zero for nothing', () => {
  const cell = (e) => completionCell(e);
  assert.deepEqual(MIA.completion.map(cell).map((c) => [c.mark, c.label]), [
    ['✓', 'Completed'], ['✓', 'Completed'], ['100%', 'Passed, best score 100% · 1 attempt'], ['Submitted', 'Submitted, not reviewed yet'], ['—', 'Not started'],
  ]);
  assert.deepEqual(PIA.completion.map(cell).map((c) => [c.mark, c.label, c.tone]), [
    ['50%', 'In progress, 1 of 2 required lessons', 'neutral'], ['40%', 'In progress, 40%', 'neutral'],
    ['40%', 'Not passed, best score 40% · 2 attempts', 'warn'], ['Needs work', 'Needs work', 'warn'], ['—', 'Not started', 'none'],
  ]);
  assert.deepEqual(OTTO.completion.map(cell).map((c) => c.label), ['Not started', 'Not started', 'Not attempted', 'Not submitted', 'Not started']);
  assert.ok(OTTO.completion.map(cell).every((c) => c.mark === '—'), 'a course with percent 0 and nothing started was drawn as a number');
  // Started with no percent or none done yet, a course with no required lesson, a passed exam with no score, and a kind not measured yet.
  assert.deepEqual(cell({ subject_kind: 'item', status: 'in_progress', percent: null }), { mark: 'Started', tone: 'neutral', label: 'In progress' });
  assert.deepEqual(cell({ subject_kind: 'item', status: 'in_progress', percent: 0 }), { mark: 'Started', tone: 'neutral', label: 'In progress' });
  assert.deepEqual(cell({ subject_kind: 'course', status: 'in_progress', required: 2, completed: 0, percent: 0 }),
    { mark: 'Started', tone: 'neutral', label: 'In progress, 0 of 2 required lessons' }, 'a started course was drawn as 0%');
  assert.deepEqual(cell({ subject_kind: 'course', status: 'in_progress', required: 0, completed: 0, percent: null }), { mark: 'Started', tone: 'neutral', label: 'In progress' });
  assert.equal(cell({ subject_kind: 'exam', status: 'passed', best_score_percent: null, attempts: 1 }).mark, 'Passed');
  assert.equal(cell({ subject_kind: 'webinar', subject_uid: 'w', status: 'not_built' }).label, 'Not recorded');
  assert.equal(cell(null).label, 'Not recorded');
  assert.equal(cell({ subject_kind: 'exercise', status: 'accepted' }).tone, 'ok');
  assert.equal(subjectKindLabel('item'), 'Video or reading');
});

test('a member\'s progress counts what they can open, and nothing started is not a zero', () => {
  // Mia: course, video and exam done, the exercise submitted but not accepted; the draft reading is not counted.
  assert.deepEqual(programProgress(CONTENTS, MIA.completion), { done: 3, total: 4 });
  assert.deepEqual(programProgress(CONTENTS, PIA.completion), { done: 0, total: 4 });
  assert.equal(programProgress(CONTENTS, null), null, 'no completion was counted as none done');
  assert.equal(progressLine({ done: 3, total: 4 }), '3 of 4 complete');
  assert.equal(progressLine({ done: 0, total: 4 }), 'None of 4 complete yet');
  assert.equal(progressLine({ done: 0, total: 0 }), 'Nothing in this program is published yet.');
  // The entries are matched by kind and uid, not by position.
  assert.deepEqual(programProgress(CONTENTS, [...MIA.completion].reverse()), { done: 3, total: 4 });
});

test('the studio\'s pure half: the bodies, the whole ordered list, the choices, the people', () => {
  assert.deepEqual(contentsBody(CONTENTS).map((c) => c.subject_uid), ['c-101', 'v-welcome', 'x-check', 'e-plan', 'r-rules'], 'the list is not in stored order');
  assert.deepEqual(withoutContent(CONTENTS, 'exam', 'x-check').map((c) => c.subject_uid), ['c-101', 'v-welcome', 'e-plan', 'r-rules']);
  assert.deepEqual(withoutContent(CONTENTS, 'course', 'x-check').length, 5, 'a subject was removed by its uid alone');
  assert.deepEqual(movedContent(CONTENTS, 'exam', 'x-check', -1).map((c) => c.subject_uid), ['c-101', 'x-check', 'v-welcome', 'e-plan', 'r-rules']);
  assert.deepEqual(movedContent(CONTENTS, 'course', 'c-101', 1).map((c) => c.subject_uid), ['v-welcome', 'c-101', 'x-check', 'e-plan', 'r-rules']);
  assert.equal(movedContent(CONTENTS, 'course', 'c-101', -1), null);
  assert.equal(movedContent(CONTENTS, 'item', 'r-rules', 1), null);
  assert.deepEqual(programForm(null), { name: '', region: '', description: '', enrolment: 'invite' }, 'a new program is open to anyone by default');
  assert.deepEqual(programBody({ name: 'N', region: '', description: '', enrolment: 'nonsense' }, true).enrolment, 'invite');
  const items = [
    { uid: 'v-welcome', kind: 'video', title: 'Cohort welcome', status: 'published' },
    { uid: 'r-new', kind: 'reading', title: 'Glossary', status: 'draft' },
    { uid: 'v-old', kind: 'video', title: 'Old', status: 'archived' },
    { uid: 'v-two', kind: 'video', title: 'Second', status: 'published' },
  ];
  assert.deepEqual(contentChoices(items, 'item', CONTENTS), [{ uid: 'r-new', label: 'Glossary (reading, draft)' }, { uid: 'v-two', label: 'Second (video)' }],
    'the picker offered something held, or something archived');
  assert.deepEqual(contentChoices([{ uid: 'x-2', title: 'Second check', status: 'published' }], 'exam', CONTENTS), [{ uid: 'x-2', label: 'Second check' }]);
  assert.deepEqual(userRow(USERS[0]), { uid: 'u-ada', name: 'Ada Assigned', role: 'admin', active: true });
  assert.ok(!('email' in userRow(USERS[0])));
  assert.deepEqual(Object.values(splitEnrolments(DETAIL.enrolments)).map((rows) => rows.map((e) => e.uid)), [['u-mia', 'u-pia'], ['u-rex']]);
  assert.deepEqual(ENROLLED_BY, { self: 'joined by themselves', super_admin: 'enrolled by a Super Admin' });
  // A read's state as a component draws it, and a reply for another member held as loading.
  assert.deepEqual([readStatus({ status: 'missing' }), readStatus({ status: 'idle' }), readStatus(undefined), readStatus({ status: 'unreadable' })], ['ready', 'loading', 'loading', 'unreadable']);
  const pia = { status: 'ready', contents: CONTENTS, learner: PIA };
  assert.deepEqual(learnerFor(pia, 'u-mia'), { status: 'loading' });
  assert.equal(learnerFor(pia, 'u-pia'), pia);
  assert.deepEqual(learnerFor({ status: 'missing', message: 'x' }, 'u-mia'), { status: 'missing', message: 'x' });
});

// ── A member's "My programs" ───────────────────────────────────────────────

const mineState = (rows) => ({ status: 'ready', rows });
const openState = (programs) => ({ status: 'ready', programs });

test('My programs: each program with its region, the member\'s progress and what it holds, and the ones open to join', () => {
  const markup = html(h(MyProgramsSection, {
    enrolled: mineState([{ program: NORDICS, detail: { status: 'ready', contents: CONTENTS, completion: MIA.completion } }]),
    open: openState([{ ...OPEN, enrolled: false }, { ...NORDICS, enrolled: true }]),
    onEnrol: () => {},
  }));
  const nordics = flat(sliceFrom(markup, 'my-program-p-nordics', 'list-open-programs'));
  assert.match(nordics, /^.*?Nordics Nordics 3 of 4 complete What it holds · 5/);
  // In stored order; a published subject opens its page; the draft is said, not linked.
  assert.match(nordics, /Course Nordic 101 Completed Video or reading Cohort welcome Completed Exam Nordic check Passed, best score 100% · 1 attempt Exercise Your plan Submitted, not reviewed yet Video or reading Regional rules Not published yet/);
  assert.match(markup, /href="\/learning\/courses\/nordic-101"/);
  assert.match(markup, /href="\/learning\/exams\/x-check"/);
  assert.doesNotMatch(markup, /href="\/learning\/items\/r-rules"/, 'a draft the member cannot open was linked');
  assert.match(markup, /style="width:75%"/, 'the bar is not the route\'s count');
  // Open to join: the programs the member is not in, each with Join.
  const join = sliceFrom(markup, 'list-open-programs');
  assert.match(flat(join), /Open to join .* Open cohort Region not recorded Join Anyone may join this one\./);
  assert.ok(tagOf(markup, 'button-join-p-open'));
  assert.doesNotMatch(markup, /button-join-p-nordics/, 'a program the member is in was offered to join');
  assert.match(flat(markup), /Most programs are by invitation: a Super Admin enrols their members\./);
});

test('My programs: nothing started is not a zero, one failed program is that program\'s, and every state of the section', () => {
  const rows = [
    { program: NORDICS, detail: { status: 'ready', contents: CONTENTS, completion: OTTO.completion } },
    { program: OPEN, detail: { status: 'unreadable', message: 'Something failed.' } },
    { program: DACH, detail: { status: 'missing', message: 'No such program.' } },
  ];
  const markup = html(h(MyProgramsSection, { enrolled: mineState(rows), open: openState([]), onRetry: { enrolled: () => {} } }));
  const out = flat(markup);
  assert.match(out, /Nordics Nordics None of 4 complete yet/);
  assert.doesNotMatch(out, /\b0%|\b0 of /, 'nothing started was drawn as a zero');
  assert.match(markup, /style="width:0%"/);
  assert.match(flat(sliceFrom(markup, 'my-program-p-open', 'my-program-p-dach')), /Your progress in this program could not be read, so this is not a claim that you have done nothing in it\. Retry/);
  assert.match(flat(sliceFrom(markup, 'my-program-p-dach')), /This program is no longer open to you\./);
  assert.equal(count(markup, 'data-testid="my-program-p-'), 3, 'a program whose own read failed was dropped');
  // No published content: no bar, and the line says so.
  const empty = html(h(MyProgramsSection, { enrolled: mineState([{ program: NORDICS, detail: { status: 'ready', contents: [CONTENTS[4]], completion: [OTTO.completion[4]] } }]), open: openState([]) }));
  assert.doesNotMatch(empty, /style="width/);
  assert.match(flat(empty), /Nothing in this program is published yet\./);
  // The route sent no completion: said, never counted.
  assert.match(text(h(MyProgramsSection, { enrolled: mineState([{ program: NORDICS, detail: { status: 'ready', contents: CONTENTS, completion: null } }]), open: openState([]) })),
    /Your progress is not recorded\./);
  // The section's own states.
  assert.match(html(h(MyProgramsSection, { enrolled: { status: 'loading' }, open: { status: 'loading' } })), /data-testid="learning-loading"/);
  assert.match(html(h(MyProgramsSection, { enrolled: { status: 'idle' }, open: { status: 'idle' } })), /data-testid="learning-loading"/);
  assert.match(text(h(MyProgramsSection, { enrolled: { status: 'unreadable' }, open: openState([]), onRetry: { enrolled: () => {} } })),
    /Your programs could not be read\. This is not a claim that you are in none\./);
  assert.match(text(h(MyProgramsSection, { enrolled: mineState([]), open: openState([]) })), /You are in no program yet/);
  // The open list failing is named on its own line; the member's programs still draw.
  const openFailed = text(h(MyProgramsSection, { enrolled: mineState([]), open: { status: 'unreadable' }, onRetry: { open: () => {} } }));
  assert.match(openFailed, /The programs open to self-enrolment could not be read, so this is not a claim that there are none\./);
  assert.match(openFailed, /You are in no program yet/);
});

test('joining: the button calls the route, and its refusal is shown beside the program it was for', () => {
  const asked = [];
  const props = {
    enrolled: mineState([]), open: openState([{ ...OPEN, enrolled: false }, { ...NORDICS, uid: 'p-two', enrolment: 'open', enrolled: false }]),
    onEnrol: (uid) => asked.push(uid),
  };
  const refused = html(h(MyProgramsSection, { ...props, said: { uid: 'p-open', message: 'You were removed from this program; ask its administrator.' } }));
  assert.match(flat(sliceFrom(refused, 'open-program-p-open', 'open-program-p-two')), /You were removed from this program; ask its administrator\./);
  assert.doesNotMatch(flat(sliceFrom(refused, 'open-program-p-two')), /You were removed/, 'a refusal was shown under another program');
  assert.match(tagOf(refused, 'join-error-p-open'), /role="alert"/);
  const joining = html(h(MyProgramsSection, { ...props, enrolling: 'p-open' }));
  assert.match(flat(sliceFrom(joining, 'open-program-p-open', 'open-program-p-two')), /Joining…/);
  assert.match(tagOf(joining, 'button-join-p-two'), /disabled=""/, 'a second join could start while one was running');
  // The container wires Join to self-enrolment, then reads both lists again.
  const src = codeOnly(read('frontend/src/pages/learning/MyPrograms.jsx'));
  assert.match(src, /await enrolSelf\(uid\);\s*retryEnrolled\(\);\s*retryOpen\(\);/);
  assert.match(src, /onClick=\{\(\) => onEnrol\(program\.uid\)\}/);
  // A member reads only their own: the section never asks for another learner's record.
  assert.doesNotMatch(src, /readProgramLearners?|programLearner/);
  assert.match(src, /import \{ enrolSelf, readMyPrograms, readOpenPrograms \} from '\.\/programReads';/);
});

// ── The lists ──────────────────────────────────────────────────────────────

test('ProgramsTable: each scope draws what its route counts, zero in words, a missing count not recorded', () => {
  const studio = html(h(ProgramsTable, { status: 'ready', scope: 'studio', programs: [{ ...NORDICS, learners: 2, admins: 1 }, { ...DACH, learners: 0, admins: 0 }, { ...OPEN, learners: null, admins: undefined }] }));
  assert.match(tagOf(studio, 'program-row-p-nordics'), /data-testid/);
  assert.match(studio, /href="\/learning\/studio\/programs\/p-nordics"/);
  assert.match(flat(sliceFrom(studio, 'program-row-p-nordics', 'program-row-p-dach')), /Nordics Published Nordics 2 members 1 admin By invitation/);
  assert.match(flat(sliceFrom(studio, 'program-row-p-dach', 'program-row-p-open')), /DACH Draft Region not recorded None enrolled None assigned By invitation/);
  assert.match(flat(sliceFrom(studio, 'program-row-p-open', 'programs-content-note')), /Open cohort Published Region not recorded Not recorded Not recorded Open enrolment/);
  assert.match(flat(studio), /Program Region Members Admins Enrolment /);
  assert.match(flat(studio), /Content is not counted in this list\. Open a program to see its content in order\./);
  assert.doesNotMatch(flat(studio), /\b0 (members|admins|items)\b/, 'a zero count was drawn as a bare 0');
  const mine = html(h(ProgramsTable, { status: 'ready', scope: 'assigned', programs: [{ ...NORDICS, learners: 3, contents: 5 }, { ...DACH, learners: 1, contents: 0 }] }));
  assert.match(mine, /href="\/learning\/programs\/p-nordics"/);
  assert.doesNotMatch(mine, /href="\/learning\/studio/, 'an assigned admin was sent to the studio');
  assert.match(flat(sliceFrom(mine, 'program-row-p-nordics', 'program-row-p-dach')), /Nordics Published Nordics 3 members By invitation 5 items/);
  assert.match(flat(sliceFrom(mine, 'program-row-p-dach')), /DACH Draft Region not recorded 1 member By invitation No content/);
  assert.doesNotMatch(mine, /programs-content-note/);
  // Empty: each scope says what it is, with somewhere to go.
  const none = html(h(ProgramsTable, { status: 'ready', scope: 'assigned', programs: [] }));
  assert.match(flat(none), /No program assigned A Super Admin assigns regional programs to admins\./);
  assert.match(none, /href="\/help\/tickets"/);
  assert.match(html(h(ProgramsTable, { status: 'ready', scope: 'studio', programs: [] })), /href="\/learning\/studio\/programs\?new=program"/);
  // The assigned page: the list, a refusal in the route's words, and the four states.
  assert.match(html(h(AssignedProgramsView, { state: { status: 'ready', programs: [{ ...NORDICS, learners: 3, contents: 5 }] } })), /program-row-p-nordics/);
  const refusedList = html(h(AssignedProgramsView, { state: { status: 'ready', refused: { code: 'admins_only', message: 'Programs are assigned to admins.' } } }));
  assert.match(flat(refusedList), /Not open to you Programs are assigned to admins\./);
  assert.doesNotMatch(refusedList, /learning-unreadable/);
  assert.match(html(h(AssignedProgramsView, { state: { status: 'loading' } })), /learning-loading/);
  assert.match(html(h(AssignedProgramsView, { state: { status: 'unreadable' }, onRetry: () => {} })), /learning-unreadable/);
});

// ── The assigned admin's learners view ─────────────────────────────────────

test('the learners view: each member against the content in order, never an email, the record of the one chosen', () => {
  const href = (u) => `/learning/programs/p-nordics?learner=${u}`;
  const withEmail = { ...LEARNERS_REPLY, learners: [MIA, PIA, { ...OTTO, email: 'u-otto@example.test' }] };
  const markup = html(h(ProgramLearnersView, {
    state: { status: 'ready', ...withEmail }, learnerState: { status: 'ready', contents: CONTENTS, learner: PIA }, selectedUid: 'u-pia', learnerHref: href,
  }));
  const out = flat(markup);
  assert.match(out, /Read-only Assigned to you by a Super Admin\. Content and enrolment are managed at HQ\./);
  assert.match(out, /Members against content 3 members · 5 items/);
  assert.match(out, /Member Course Nordic 101 Video or reading Cohort welcome Exam Nordic check Exercise Your plan Video or reading Regional rules/, 'the columns are not in stored order');
  assert.match(flat(sliceFrom(markup, 'learner-row-u-mia', 'learner-row-u-pia')), /Mia Member ✓ Completed ✓ Completed 100% Passed, best score 100% · 1 attempt Submitted Submitted, not reviewed yet — Not started/);
  assert.match(flat(sliceFrom(markup, 'learner-row-u-pia', 'learner-row-u-otto')), /Pia Peer 50% In progress, 1 of 2 required lessons 40% In progress, 40% 40% Not passed, best score 40% · 2 attempts Needs work Needs work — Not started/);
  assert.match(flat(sliceFrom(markup, 'learner-row-u-otto', 'program-learners-legend')), /Name not recorded — Not started — Not started — Not attempted — Not submitted — Not started/);
  assert.doesNotMatch(markup, /u-otto@example\.test/, 'an email reached the table');
  assert.doesNotMatch(flat(sliceFrom(markup, 'learner-row-u-otto', 'program-learners-legend')), /\b0%?\b/, 'nothing started was drawn as 0');
  assert.match(out, /A member who never opened an item shows a dash, not 0\./);
  // Each name opens that member's record at its own address; the chosen one is marked.
  assert.match(tagOf(markup, 'link-learner-u-mia'), /href="\/learning\/programs\/p-nordics\?learner=u-mia"/);
  assert.match(tagOf(markup, 'link-learner-u-pia'), /aria-current="true"/);
  assert.doesNotMatch(tagOf(markup, 'link-learner-u-mia'), /aria-current/);
  // The record: the chosen member's own read, every content row in order.
  const record = flat(sliceFrom(markup, 'learner-record'));
  assert.match(record, /Member record Pia Peer Enrolled 2 Oct 2026 Course Nordic 101 In progress, 1 of 2 required lessons Video or reading Cohort welcome In progress, 40% Exam Nordic check Not passed, best score 40% · 2 attempts Exercise Your plan Needs work Video or reading Regional rules Not started/);
  // Read-only: no write control anywhere on the view.
  assert.doesNotMatch(markup, /<button|<form|<input|<select|<textarea/, 'the read-only view offers a write');
  assert.deepEqual(learnersCoverage({ status: 'ready', ...LEARNERS_REPLY }), ['3 members and 5 content items in “Nordics”']);
});

test('the learners view: a refusal in the route\'s words, no such program, no such learner, nobody chosen, and every state', () => {
  const refused = html(h(ProgramLearnersView, { state: { status: 'ready', refused: { code: 'not_assigned', message: 'You can follow the learners of programs assigned to you.' } } }));
  assert.match(flat(refused), /Not open to you You can follow the learners of programs assigned to you\./);
  assert.doesNotMatch(refused, /learner-row-|learning-unreadable|Read-only/, 'a refused admin saw the table, or a failed read');
  assert.match(tagOf(refused, 'learning-refused'), /data-testid/);
  assert.match(text(h(ProgramLearnersView, { state: { status: 'missing', message: 'No such program.' } })), /No such program No such program\./);
  const ready = { status: 'ready', ...LEARNERS_REPLY };
  assert.match(text(h(ProgramLearnersView, { state: ready, learnerState: { status: 'missing', message: 'No such learner in this program.' }, selectedUid: 'u-gone' })),
    /Not in this program No such learner in this program\./);
  assert.match(text(h(ProgramLearnersView, { state: ready })), /No member chosen Choose a member in the table to see their record\./);
  assert.match(sliceFrom(html(h(ProgramLearnersView, { state: ready, learnerState: { status: 'loading' }, selectedUid: 'u-pia' })), 'learner-record'), /learning-loading/);
  assert.match(sliceFrom(html(h(ProgramLearnersView, { state: ready, learnerState: { status: 'unreadable' }, selectedUid: 'u-pia', onRetryLearner: () => {} })), 'learner-record'),
    /learning-unreadable/);
  assert.match(html(h(ProgramLearnersView, { state: { status: 'loading' } })), /learning-loading/);
  assert.match(text(h(ProgramLearnersView, { state: { status: 'unreadable' }, onRetry: () => {} })), /The program’s members could not be read\. This is not a claim that nobody is enrolled\./);
  assert.match(text(h(ProgramLearnersTable, { status: 'ready', program: NORDICS, contents: CONTENTS, learners: [] })), /No member enrolled/);
  assert.match(text(h(ProgramLearnersTable, { status: 'ready', program: NORDICS, contents: [], learners: [MIA] })), /No content in this program/);
  assert.match(text(h(LearnerRecord, { status: 'ready', learner: { ...MIA, enrolled_at: null }, contents: CONTENTS })), /Mia Member Enrolled date not recorded/);
});

// ── The Super Admin's program ──────────────────────────────────────────────

const HANDLERS = Object.fromEntries(['onSave', 'onStatus', 'onSetOpen', 'onAddContent', 'onRemoveContent', 'onMoveContent', 'onAssign', 'onUnassign',
  'onEnrol', 'onUnenrol', 'onFindUsers', 'onWantChoices'].map((k) => [k, () => Promise.resolve(true)]));

test('the studio\'s program: its fields and status, content in order, admins, members and the removed kept apart', () => {
  const markup = html(h(ProgramDetail, { status: 'ready', ...DETAIL, handlers: HANDLERS, notice: 'Saved.' }), '/learning/studio/programs/p-nordics');
  assert.match(tagOf(markup, 'input-program-name'), /value="Nordics"/);
  assert.match(tagOf(markup, 'input-program-region'), /value="Nordics"/);
  assert.match(markup, /The Nordic founders’ cohort\.<\/textarea>/);
  assert.doesNotMatch(markup, /select-program-enrolment/, 'enrolment is the members card\'s switch on a stored program');
  assert.match(flat(markup), /Save program Saved\./);
  // Status: a published program can go back to draft or be archived, and is not offered "Publish".
  assert.doesNotMatch(markup, /button-studio-publish/);
  assert.match(markup, /button-studio-unpublish/);
  assert.match(markup, /button-studio-archive/);
  assert.match(html(h(ProgramDetail, { status: 'ready', ...DETAIL, program: { ...NORDICS, status: 'draft' }, handlers: HANDLERS })), /button-studio-publish/);
  // Content in stored order, its kind, and a status beside anything not published.
  const contents = flat(sliceFrom(markup, 'program-contents', 'program-admins'));
  assert.match(contents, /Content, in order 5 Course Nordic 101 .*Video or reading Cohort welcome .*Exam Nordic check .*Exercise Your plan .*Video or reading Regional rules Draft/);
  const ups = [...markup.matchAll(/<button[^>]*aria-label="Move content up"[^>]*>/g)].map((m) => m[0].includes('disabled=""'));
  const downs = [...markup.matchAll(/<button[^>]*aria-label="Move content down"[^>]*>/g)].map((m) => m[0].includes('disabled=""'));
  assert.deepEqual([ups, downs], [[true, false, false, false, false], [false, false, false, false, true]], 'up and down are not disabled at the ends');
  // Admins, members, and the removed rows the route keeps.
  assert.match(flat(sliceFrom(markup, 'program-admins', 'program-members')), /Assigned admins 1 Ada Assigned · since 1 Oct 2026 Remove Admins see this program’s content and each member’s completion\. They author nothing\./);
  const members = flat(sliceFrom(markup, 'program-members'));
  assert.match(members, /Members 2 Open to self-enrolment Mia Member · enrolled by a Super Admin, 2 Oct 2026 Remove Pia Peer · joined by themselves, 2 Oct 2026 Remove/);
  assert.match(members, /Removed · 1 Rex Removed · removed 4 Oct 2026 Enrol again/);
  assert.doesNotMatch(flat(sliceFrom(markup, 'program-member-u-pia', 'program-members-removed')), /Rex Removed/, 'a removed member was listed as a member');
  assert.match(tagOf(markup, 'switch-program-open'), /role="switch"/);
  assert.match(tagOf(markup, 'switch-program-open'), /aria-checked="false"/);
  assert.match(tagOf(html(h(ProgramDetail, { status: 'ready', ...DETAIL, program: { ...NORDICS, enrolment: 'open' }, handlers: HANDLERS })), 'switch-program-open'), /aria-checked="true"/);
  // A member's progress is the read-only view's, linked rather than recomputed here.
  assert.match(tagOf(markup, 'link-program-progress'), /href="\/learning\/programs\/p-nordics"/);
  assert.doesNotMatch(markup, /@example\.test/);
  assert.deepEqual(programCoverage({ status: 'ready', ...DETAIL }), ['“Nordics”: 5 content items, 1 assigned admin, 2 members']);
});

test('the studio\'s program: a refusal shown beside what was changed, writes held without a handler, and its states', () => {
  for (const where of ['fields', 'contents', 'admins', 'enrolments']) {
    const markup = html(h(ProgramDetail, { status: 'ready', ...DETAIL, handlers: HANDLERS, error: { where, message: 'The route said no.' } }));
    assert.equal(count(flat(markup), 'The route said no.'), 1, `a ${where} refusal was shown more than once, or not at all`);
    const card = { fields: 'program-fields-error', contents: 'program-contents-error', admins: 'program-admins-error', enrolments: 'program-members-error' }[where];
    assert.match(tagOf(markup, card), /role="alert"/, `a ${where} refusal is not beside the ${where}`);
  }
  // No handler: drawn, held disabled, never live.
  const held = html(h(ProgramDetail, { status: 'ready', ...DETAIL, handlers: {} }));
  for (const id of ['button-program-add-content', 'button-program-assign', 'button-program-enrol', 'switch-program-open', 'button-remove-content-c-101',
    'program-admin-u-ada-remove', 'program-member-u-mia-remove', 'button-program-save', 'button-studio-unpublish', 'button-studio-archive']) {
    assert.match(tagOf(held, id), /disabled=""/, `${id} is live with nothing behind it`);
    assert.doesNotMatch(tagOf(html(h(ProgramDetail, { status: 'ready', ...DETAIL, handlers: HANDLERS })), id), /disabled=""/, `${id} is held with its handler there`);
  }
  assert.match(text(h(StudioProgramView, { state: { status: 'missing', message: 'No such program.' }, handlers: HANDLERS })), /No such program No program has that address\./);
  assert.match(html(h(StudioProgramView, { state: { status: 'loading' }, handlers: HANDLERS })), /learning-loading/);
  assert.match(text(h(StudioProgramView, { state: { status: 'unreadable' }, handlers: HANDLERS, onRetry: () => {} })), /The program could not be read\. This is not a claim that the program is empty\./);
  assert.match(text(h(StudioProgramView, { state: { status: 'ready', refused: { code: 'forbidden', message: 'Super Admin only.' } }, handlers: HANDLERS })), /Not open to you Super Admin only\./);
  assert.match(html(h(StudioProgramView, { state: { status: 'ready', ...DETAIL }, handlers: HANDLERS, said: { error: { where: 'admins', message: 'Only an admin can be assigned to a program.' } } })),
    /data-testid="program-admins-error"[^>]*>Only an admin can be assigned to a program\./);
});

test('every removal asks first: content, an assigned admin and a member, and only the confirmation calls the route', () => {
  const markup = html(h(ProgramDetail, { status: 'ready', ...DETAIL, handlers: HANDLERS }));
  assert.doesNotMatch(markup, /-confirm"|program-confirm-content/, 'a confirmation shows before anyone asked');
  const src = codeOnly(read('frontend/src/pages/learning/ProgramDetail.jsx'));
  // The Remove buttons open the confirmation; only the confirmation calls the write.
  assert.equal(count(src, 'onClick={() => setConfirming(true)}'), 2, 'a Remove button writes without asking');
  assert.match(src, /onConfirm=\{\(\) => \{ setConfirming\(false\); handlers\.onRemoveContent\(content\.subject_kind, content\.subject_uid\); \}\}/);
  assert.match(src, /onConfirm=\{\(\) => \{ setConfirming\(false\); onRemove\(\); \}\}/);
  assert.equal(count(src, 'handlers.onRemoveContent('), 1, 'something else removes content without asking');
  assert.equal(count(src, 'onRemove()'), 1, 'something else removes a person without asking');
  assert.equal(count(src, 'handlers.onUnassign('), 1);
  assert.equal(count(src, 'handlers.onUnenrol('), 1);
  assert.match(src, /onRemove=\{handlers\.onUnassign && \(\(\) => handlers\.onUnassign\(a\.uid\)\)\}/);
  assert.match(src, /onRemove=\{handlers\.onUnenrol && \(\(\) => handlers\.onUnenrol\(m\.uid\)\)\}/);
  // What each confirmation says, in plain words.
  assert.match(src, /Remove “\$\{title\}” from this program\? If it is program-only, the program’s members lose it at once\. It stays in the studio\./);
  assert.match(src, /Unassign \$\{a\.name \|\| 'this admin'\}\? They stop seeing this program’s members at once\./);
  assert.match(src, /from this program\? They lose its program-only content at once and cannot rejoin by themselves\. The record of their enrolment stays\./);
  // Archiving the program asks too: the studio's own status actions, as a program.
  assert.match(src, /<StatusActions status=\{program\.status\} what="program" onStatus=\{handlers\.onStatus\} busy=\{busy \|\| !handlers\.onStatus\} \/>/);
});

test('adding content: the kinds the route takes, the studio\'s rows not yet held, and a list that failed named', () => {
  const ready = (rows) => ({ status: 'ready', rows });
  const choices = { status: 'ready', byKind: {
    course: ready([{ uid: 'c-101', title: 'Nordic 101', status: 'published' }, { uid: 'c-202', title: 'Nordic 202', status: 'draft' }, { uid: 'c-old', title: 'Old', status: 'archived' }]),
    item: ready([{ uid: 'v-welcome', kind: 'video', title: 'Cohort welcome', status: 'published' }, { uid: 'r-two', kind: 'reading', title: 'Glossary', status: 'published' }]),
    exam: { status: 'unreadable', message: 'The exam list could not be read.' },
    exercise: ready([]),
  } };
  const picker = (kind) => html(h(ContentPicker, { choices, held: CONTENTS, onAdd: () => {}, onCancel: () => {}, initialKind: kind }));
  const course = picker('course');
  assert.match(course, /<option value="webinar" disabled="">Webinar \(not a program content yet\)<\/option>/);
  assert.deepEqual([...course.matchAll(/<option value="(course|item|exam|exercise)"/g)].map((m) => m[1]), ['course', 'item', 'exam', 'exercise']);
  assert.match(course, /<option value="c-202">Nordic 202 \(draft\)<\/option>/);
  assert.doesNotMatch(course, /value="c-101"|value="c-old"/, 'the picker offered a course the program holds, or an archived one');
  assert.match(tagOf(course, 'button-program-content-add'), /disabled=""/, 'Add is live before anything is chosen');
  assert.match(picker('item'), /<option value="r-two">Glossary \(reading\)<\/option>/);
  assert.match(flat(picker('exam')), /The exam list could not be read\./);
  assert.match(flat(picker('exercise')), /Nothing of this kind is left to add\./);
  assert.match(html(h(ContentPicker, { choices: { status: 'loading' }, held: CONTENTS, onAdd: () => {}, onCancel: () => {} })), /learning-loading/);
  assert.match(flat(html(h(ContentPicker, { choices: { status: 'unreadable', message: 'Lists failed.' }, held: [], onAdd: () => {}, onCancel: () => {} }))), /Lists failed\./);
});

test('finding people: a name, a role and a uid, admins alone for Assign, and who already holds the place', () => {
  const rows = USERS.map(userRow);
  const found = { status: 'ready', q: 'a', rows };
  const admins = html(h(PeopleResults, { found, adminsOnly: true, taken: ['u-ada'], takenLabel: 'Assigned', actionLabel: 'Assign', onPick: () => {} }));
  assert.match(flat(admins), /Ada Assigned · Admin · u-ada Assigned Ola Other · Admin · u-ola · inactive Assign/);
  assert.doesNotMatch(admins, /u-mia/, 'a founder was offered for an admin\'s place');
  assert.match(tagOf(admins, 'button-pick-u-ada'), /disabled=""/, 'an admin already assigned was offered again');
  assert.doesNotMatch(tagOf(admins, 'button-pick-u-ola'), /disabled=""/);
  assert.match(flat(admins), /Only admins are listed: only an admin can be assigned\./);
  const members = html(h(PeopleResults, { found, taken: ['u-mia'], takenLabel: 'Enrolled', actionLabel: 'Enrol', onPick: () => {} }));
  assert.match(flat(members), /Mia Member · Founder · u-mia Enrolled/);
  assert.doesNotMatch(members, /@example\.test/);
  assert.match(text(h(PeopleResults, { found: { status: 'ready', q: 'zed', rows: [] } })), /Nobody matches “zed”\./);
  assert.match(text(h(PeopleResults, { found: { status: 'ready', q: 'mia', rows: [rows[2]] }, adminsOnly: true })), /No admin matches “mia”\. Only an admin can be assigned\./);
  assert.match(text(h(PeopleResults, { found: { status: 'unreadable', message: 'Type at least two characters to search.' } })), /Type at least two characters to search\./);
  const many = { status: 'ready', q: 'a', rows: Array.from({ length: 20 }, (_, i) => ({ uid: `u${i}`, name: `N${i}`, role: 'founder', active: true })) };
  assert.match(text(h(PeopleResults, { found: many, actionLabel: 'Enrol', onPick: () => {} })), /The first 20 matches\. Type more of the name to narrow it\./);
  assert.equal(html(h(PeopleResults, { found: { status: 'idle' } })), '');
});

test('the studio\'s handlers send the whole ordered list, built from the program as stored', async () => {
  const seen = [];
  const run = async (where, write, notice) => { seen.push({ where, notice }); await write(); return true; };
  let wanted = false;
  const handlers = programHandlers({ uid: 'p-nordics', current: DETAIL, run, setWantChoices: (v) => { wanted = v; } });
  const calls = await withFetch(Array.from({ length: 8 }, () => DETAIL), async () => {
    await handlers.onMoveContent('exam', 'x-check', -1);
    await handlers.onRemoveContent('item', 'v-welcome');
    await handlers.onAddContent('course', 'c-202');
    await handlers.onStatus('archive');
    await handlers.onSave({ name: 'Nordics', region: 'North', description: '', enrolment: 'invite' });
    await handlers.onSetOpen(true);
    await handlers.onAssign('u-ola');
    await handlers.onUnenrol('u-pia');
  });
  assert.deepEqual(calls[0].body.contents.map((c) => c.subject_uid), ['c-101', 'x-check', 'v-welcome', 'e-plan', 'r-rules']);
  assert.deepEqual(calls[1].body.contents.map((c) => c.subject_uid), ['c-101', 'x-check', 'e-plan', 'r-rules']);
  assert.deepEqual(calls[2].body.contents.at(-1), { subject_kind: 'course', subject_uid: 'c-202' });
  assert.deepEqual(calls.slice(3).map((c) => [c.method, c.path, c.body]), [
    ['PATCH', '/admin/learning/programs/p-nordics', { status: 'archived' }],
    ['PATCH', '/admin/learning/programs/p-nordics', { name: 'Nordics', region: 'North', description: '' }],
    ['PATCH', '/admin/learning/programs/p-nordics', { enrolment: 'open' }],
    ['POST', '/admin/learning/programs/p-nordics/admins', { user_uid: 'u-ola' }],
    ['DELETE', '/admin/learning/programs/p-nordics/enrollments/u-pia', undefined],
  ]);
  // Each write's refusal belongs to the card it was made in; a status change says what it did.
  assert.deepEqual(seen.map((s) => s.where), ['contents', 'contents', 'contents', 'fields', 'fields', 'enrolments', 'admins', 'enrolments']);
  assert.deepEqual([seen[3].notice, seen[4].notice], ['Archived.', 'Saved.']);
  // Already at its end: nothing is sent.
  const still = await withFetch([], async () => {
    assert.equal(await handlers.onMoveContent('course', 'c-101', -1), false);
  });
  assert.deepEqual(still, []);
  handlers.onWantChoices();
  assert.equal(wanted, true, 'opening the picker does not ask for the content lists');
});

test('the studio\'s list: every program, New program at its own address, and the create form', () => {
  const list = html(h(StudioProgramsView, { state: { status: 'ready', programs: [{ ...NORDICS, learners: 2, admins: 1 }] } }), '/learning/studio/programs');
  assert.match(list, /data-testid="programs-studio"/);
  assert.doesNotMatch(list, /program-new/);
  const creating = html(h(StudioProgramsView, { state: { status: 'ready', programs: [] }, creating: true, onCreate: () => {}, error: 'A program needs a name.' }), '/learning/studio/programs?new=program');
  assert.match(flat(sliceFrom(creating, 'program-new', 'programs-studio')), /New program created as a draft Name Region .*Description Enrolment By invitation: a Super Admin enrols each member Open: members can also join it themselves .*Create draft A program needs a name\. Cancel/);
  assert.match(tagOf(creating, 'select-program-enrolment'), /data-testid/);
  assert.match(tagOf(creating, 'link-program-new-cancel'), /href="\/learning\/studio\/programs"/);
  assert.match(html(h(ProgramFields, { program: null, onSubmit: () => {} })), /<option value="invite" selected="">/, 'a new program does not start by invitation');
  assert.match(text(h(StudioProgramsView, { state: { status: 'ready', refused: { code: 'forbidden', message: 'Super Admin only.' } } })), /Not open to you Super Admin only\./);
  assert.match(html(h(StudioProgramsView, { state: { status: 'unreadable' }, onRetry: () => {} })), /learning-unreadable/);
});

// ── The four pages ─────────────────────────────────────────────────────────

test('the four pages: each its own frame, header and rail, reading from its first render', () => {
  const programs = html(h(ProgramsPage, { sub: 'Programs a Super Admin has assigned to you.' }), '/learning/programs');
  assert.match(programs, /data-testid="learning-programs"/);
  assert.match(programs, /data-testid="programs-assigned"/);
  assert.match(programs, /data-testid="learning-loading"/);
  assert.match(flat(programs), /Worker AI · Learning programs/);
  assert.match(tagOf(programs, 'link-learning-back'), /href="\/learning"/);
  const program = html(h(ProgramPage, { uid: 'p-nordics', sub: 'Read-only.' }), '/learning/programs/p-nordics?learner=u-pia');
  assert.match(program, /data-testid="learning-program"/);
  assert.match(program, /data-testid="program-learners"/);
  assert.match(flat(program), /Read-only Assigned to you by a Super Admin\./);
  assert.match(flat(program), /Worker AI · Learning programs/);
  assert.match(tagOf(program, 'link-learning-back'), /href="\/learning\/programs"/);
  assert.match(sliceFrom(program, 'learner-record'), /learning-loading/, 'the chosen member\'s record is not read');
  const studio = html(h(StudioProgramsPage, { sub: 'Programs group content for a region.' }), '/learning/studio/programs');
  assert.match(studio, /data-testid="learning-studio-programs"/);
  assert.match(tagOf(studio, 'link-program-new'), /href="\/learning\/studio\/programs\?new=program"/);
  assert.match(flat(studio), /Worker AI · Learning studio/);
  assert.match(tagOf(studio, 'link-learning-back'), /href="\/learning\/studio"/);
  assert.doesNotMatch(html(h(StudioProgramsPage, { sub: '' }), '/learning/studio/programs?new=program'), /link-program-new"/, 'New program is offered with its form open');
  const one = html(h(StudioProgramPage, { uid: 'p-nordics', sub: 'Content in order, assigned admins and members.' }), '/learning/studio/programs/p-nordics');
  assert.match(one, /data-testid="learning-studio-program"/);
  assert.match(one, /data-testid="program-detail"/);
  assert.match(tagOf(one, 'link-learning-back'), /href="\/learning\/studio\/programs"/);
  // What a server render cannot run, read from the source: the chosen member is read only once
  // chosen, and only that member's reply is drawn; a name links to the address the page reads;
  // a program just created opens at its own address.
  const adminSrc = codeOnly(read('frontend/src/pages/learning/LearningPrograms.jsx'));
  assert.match(adminSrc, /\{ enabled: Boolean\(selected\), scope: 'program-learner' \}/);
  assert.match(adminSrc, /learnerState=\{learnerFor\(learnerRead, selected\)\}/, 'the record can draw another member\'s reply');
  const asked = /const selected = params\.get\('(\w+)'\) \|\| '';/.exec(adminSrc)?.[1];
  assert.equal(asked, 'learner');
  assert.ok(adminSrc.includes(`?${asked}=\${encodeURIComponent(u)}`), 'a name links to an address the page does not read');
  assert.match(codeOnly(read('frontend/src/pages/learning/ProgramStudio.jsx')),
    /const created = await createProgram\(form\);\s*navigate\(`\/learning\/studio\/programs\/\$\{encodeURIComponent\(created\.program\.uid\)\}`\);/);
  // A literal accent on each rail: steel for the assigned admin, oxblood for HQ.
  const rails = [['LearningPrograms.jsx', 'admin'], ['ProgramStudio.jsx', 'super_admin']];
  for (const [file, role] of rails) {
    const mounts = [...codeOnly(read(`frontend/src/pages/learning/${file}`)).matchAll(/<WorkerRail[\s\S]*?\/>/g)].map((m) => m[0]);
    assert.equal(mounts.length, 1, `${file} mounts ${mounts.length} rails`);
    assert.ok(mounts[0].includes(`role="${role}"`), `${file}'s rail is not role="${role}"`);
    assert.match(mounts[0], /note="Eadwyn /);
  }
});

test('the calls stay in one file, through methods the clients already declare', () => {
  const dir = 'frontend/src/pages/learning';
  for (const f of ['MyPrograms.jsx', 'LearningPrograms.jsx', 'ProgramStudio.jsx', 'ProgramDetail.jsx', 'ProgramsTable.jsx', 'ProgramLearnersTable.jsx', 'programModel.js']) {
    assert.doesNotMatch(codeOnly(read(`${dir}/${f}`)), /lib\/api|learningApi|adminLearningApi/, `${f} reaches the client`);
  }
  const reads = codeOnly(read(`${dir}/programReads.js`));
  assert.match(reads, /import \{ api \} from '\.\.\/\.\.\/lib\/api';/);
  assert.match(reads, /import \{ learningApi \} from '\.\.\/\.\.\/lib\/api\/learning\.js';/);
  assert.match(reads, /import \{ adminLearningApi \} from '\.\.\/\.\.\/lib\/api\/adminLearning\.js';/);
  const declared = { learningApi: read('frontend/src/lib/api/learning.js'), adminLearningApi: read('frontend/src/lib/api/adminLearning.js'), api: read('frontend/src/lib/api.js') };
  const called = [...reads.matchAll(/\b(learningApi|adminLearningApi|api)\.(\w+)\(/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual([...new Set(called.map(([c, m]) => `${c}.${m}`))].sort(), [
    'adminLearningApi.assignProgramAdmin', 'adminLearningApi.createProgram', 'adminLearningApi.enrolInProgram', 'adminLearningApi.getProgram',
    'adminLearningApi.listCourses', 'adminLearningApi.listExams', 'adminLearningApi.listExercises', 'adminLearningApi.listItems',
    'adminLearningApi.listPrograms', 'adminLearningApi.setProgramContents', 'adminLearningApi.unassignProgramAdmin',
    'adminLearningApi.unenrolFromProgram', 'adminLearningApi.updateProgram',
    'api.adminListUsers',
    'learningApi.assignedPrograms', 'learningApi.enrolInProgram', 'learningApi.myEnrolledPrograms', 'learningApi.program',
    'learningApi.programLearner', 'learningApi.programLearners', 'learningApi.programs',
  ]);
  for (const [client, method] of called) assert.ok(declared[client].includes(`  ${method}: (`), `${client}.${method} is not a method the client declares`);
});
