/**
 * D559 (#1160) — authoring exercises and exams, and reviewing submissions.
 * Mounted at /api/admin/learning beside `admin_learning.ts`. The Super Admin
 * only; every write recorded with `logAdminAction`.
 *
 *   GET    /exercises                       POST /exercises
 *   GET    /exercises/:uid                  PATCH /exercises/:uid
 *   POST   /exercises/:uid/publish | unpublish | archive
 *   POST   /submissions/:uid/review         accepted or needs_work, with feedback
 *   GET    /exams                           POST /exams
 *   GET    /exams/:uid                      the exam with its questions AND their answers
 *   PATCH  /exams/:uid
 *   POST   /exams/:uid/publish | unpublish | archive
 *   POST   /exams/:uid/questions            PATCH /questions/:uid     DELETE /questions/:uid
 *
 * QUESTIONS FREEZE AT THE FIRST ATTEMPT. Once anyone has started an exam, its
 * questions cannot be added, edited or removed: an attempt is graded against
 * what it was shown, and a later edit would quietly change what a stored
 * score means. Make a new exam instead.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { refuse } from '../util/refusal';
import { newUid } from './_t13t14t15_helpers';
import { LEARNING_VISIBILITIES } from '../services/learningAccess';
import { parseCorrect, parseOptions } from '../services/learningAssessment';
import {
  gate, record, text, bad, oneOf, wholeOrNull, guarded, NEXT_STATUS,
} from './admin_learning';

const r = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;
const now = () => new Date().toISOString();

// ---- exercises -------------------------------------------------------------------------

const EXERCISE_SELECT = 'SELECT uid, title, instructions, submission_kind, checklist_json, visibility, status, created_by, created_at, updated_at, published_at FROM learning_exercises';

function checklist(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 30) bad('bad_checklist', 'checklist is a list of 1 to 30 items.');
  const items = (raw as unknown[]).map((x) => (typeof x === 'string' ? x.trim().slice(0, 300) : ''));
  if (items.some((x) => !x)) bad('bad_checklist', 'Each checklist item is some text.');
  return JSON.stringify(items);
}

r.get('/exercises', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  return c.json({ exercises: (await c.env.DB.prepare(EXERCISE_SELECT + ' ORDER BY updated_at DESC, id DESC LIMIT 500').all()).results || [] });
});

r.post('/exercises', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  return guarded(c, async () => {
    const b = await c.req.json().catch(() => ({} as any));
    const title = text(b?.title, 200);
    if (!title) bad('bad_title', 'An exercise needs a title.');
    const kind = oneOf(b?.submission_kind, ['text', 'checklist'] as const, 'submission_kind');
    if (!kind) bad('bad_submission_kind', 'submission_kind is text or checklist.');
    const list = checklist(b?.checklist);
    if (kind === 'checklist' && !list) bad('bad_checklist', 'A checklist exercise needs its items.');
    const uid = newUid();
    const t = now();
    await c.env.DB.prepare(
      `INSERT INTO learning_exercises (uid, title, instructions, submission_kind, checklist_json, visibility, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    ).bind(uid, title, text(b?.instructions, 20_000) ?? null, kind, kind === 'checklist' ? list : null,
      oneOf(b?.visibility, LEARNING_VISIBILITIES, 'visibility') ?? 'open', admin.id, t, t).run();
    await record(c, admin, 'learning.exercise.create', { uid });
    return c.json({ exercise: await c.env.DB.prepare(EXERCISE_SELECT + ' WHERE uid = ?').bind(uid).first() }, 201);
  });
});

r.get('/exercises/:uid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const ex = await c.env.DB.prepare(EXERCISE_SELECT + ' WHERE uid = ?').bind(c.req.param('uid')).first();
  return ex ? c.json({ exercise: ex }) : refuse(c, 404, { code: 'not_found', message: 'No such exercise.' });
});

r.patch('/exercises/:uid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  return guarded(c, async () => {
    const uid = c.req.param('uid');
    const ex = await c.env.DB.prepare('SELECT submission_kind FROM learning_exercises WHERE uid = ?').bind(uid).first<any>();
    if (!ex) return refuse(c, 404, { code: 'not_found', message: 'No such exercise.' });
    const b = await c.req.json().catch(() => ({} as any));
    const title = text(b?.title, 200);
    if (title === null) bad('bad_title', 'An exercise needs a title.');
    const list = checklist(b?.checklist);
    if (list !== undefined && ex.submission_kind !== 'checklist') bad('bad_checklist', 'Only a checklist exercise has items.');
    if (list === null) bad('bad_checklist', 'A checklist exercise needs its items.');
    const vis = oneOf(b?.visibility, LEARNING_VISIBILITIES, 'visibility');
    const instructions = text(b?.instructions, 20_000);
    await c.env.DB.prepare(
      `UPDATE learning_exercises SET title = COALESCE(?, title), checklist_json = COALESCE(?, checklist_json),
         visibility = COALESCE(?, visibility),
         instructions = CASE WHEN ? = 1 THEN ? ELSE instructions END, updated_at = ? WHERE uid = ?`,
    ).bind(title ?? null, list ?? null, vis ?? null, instructions === undefined ? 0 : 1, instructions ?? null, now(), uid).run();
    await record(c, admin, 'learning.exercise.update', { uid });
    return c.json({ exercise: await c.env.DB.prepare(EXERCISE_SELECT + ' WHERE uid = ?').bind(uid).first() });
  });
});

async function setExerciseStatus(c: C, action: 'publish' | 'unpublish' | 'archive') {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const uid = c.req.param('uid') as string;
  const ex = await c.env.DB.prepare('SELECT id FROM learning_exercises WHERE uid = ?').bind(uid).first();
  if (!ex) return refuse(c, 404, { code: 'not_found', message: 'No such exercise.' });
  const t = now();
  await c.env.DB.prepare(
    `UPDATE learning_exercises SET status = ?, updated_at = ?, published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END WHERE uid = ?`,
  ).bind(NEXT_STATUS[action], t, NEXT_STATUS[action], t, uid).run();
  await record(c, admin, `learning.exercise.${action}`, { uid });
  return c.json({ exercise: await c.env.DB.prepare(EXERCISE_SELECT + ' WHERE uid = ?').bind(uid).first() });
}
r.post('/exercises/:uid/publish', (c) => setExerciseStatus(c, 'publish'));
r.post('/exercises/:uid/unpublish', (c) => setExerciseStatus(c, 'unpublish'));
r.post('/exercises/:uid/archive', (c) => setExerciseStatus(c, 'archive'));

r.post('/submissions/:uid/review', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const b = await c.req.json().catch(() => ({} as any));
  const status = b?.status;
  if (status !== 'accepted' && status !== 'needs_work') {
    return refuse(c, 400, { code: 'bad_status', message: 'status is accepted or needs_work.' });
  }
  const feedback = text(b?.feedback, 10_000) ?? null;
  if (status === 'needs_work' && !feedback) {
    return refuse(c, 400, { code: 'feedback_required', message: 'Needs work says what needs work: feedback is required.' });
  }
  const uid = c.req.param('uid');
  const res = await c.env.DB.prepare(
    `UPDATE learning_exercise_submissions SET status = ?, feedback = ?, reviewer_id = ?, reviewed_at = ? WHERE uid = ?`,
  ).bind(status, feedback, admin.id, now(), uid).run();
  if (!Number(res?.meta?.changes ?? 0)) return refuse(c, 404, { code: 'not_found', message: 'No such submission.' });
  const row = await c.env.DB.prepare('SELECT user_id FROM learning_exercise_submissions WHERE uid = ?').bind(uid).first<{ user_id: number }>();
  await record(c, admin, 'learning.submission.review', { uid, status, target_user_id: row?.user_id });
  return c.json({ submission: await c.env.DB.prepare('SELECT uid, status, feedback, reviewed_at FROM learning_exercise_submissions WHERE uid = ?').bind(uid).first() });
});

// ---- exams ----------------------------------------------------------------------------

const EXAM_SELECT = 'SELECT id, uid, title, intro, pass_mark_percent, time_limit_minutes, max_attempts, shuffle, reveal, visibility, status, created_by, created_at, updated_at, published_at FROM learning_exams';

function examFields(b: any, creating: boolean) {
  const title = text(b?.title, 200);
  if ((creating && !title) || title === null) bad('bad_title', 'An exam needs a title.');
  const pass = b?.pass_mark_percent === undefined ? undefined : Number(b.pass_mark_percent);
  if (pass !== undefined && !(Number.isInteger(pass) && pass >= 0 && pass <= 100)) bad('bad_pass_mark_percent', 'pass_mark_percent is a whole number from 0 to 100.');
  const limit = wholeOrNull(b?.time_limit_minutes, 'time_limit_minutes');
  if (limit === 0) bad('bad_time_limit_minutes', 'time_limit_minutes is more than 0, or empty for untimed.');
  const attempts = wholeOrNull(b?.max_attempts, 'max_attempts');
  if (attempts === 0) bad('bad_max_attempts', 'max_attempts is more than 0, or empty for unlimited.');
  return {
    title,
    intro: text(b?.intro, 20_000),
    pass_mark_percent: pass,
    time_limit_minutes: limit,
    max_attempts: attempts,
    shuffle: b?.shuffle === undefined ? undefined : (b.shuffle ? 1 : 0),
    reveal: oneOf(b?.reveal, ['score', 'score_and_answers'] as const, 'reveal'),
    visibility: oneOf(b?.visibility, LEARNING_VISIBILITIES, 'visibility'),
  };
}

async function examTree(env: Env, uid: string) {
  const exam = await env.DB.prepare(EXAM_SELECT + ' WHERE uid = ?').bind(uid).first<any>();
  if (!exam) return null;
  const qs = await env.DB.prepare(
    'SELECT uid, position, prompt, kind, options_json, correct_json FROM learning_exam_questions WHERE exam_id = ? ORDER BY position, id',
  ).bind(exam.id).all<any>();
  const attempts = await env.DB.prepare('SELECT COUNT(*) AS n FROM learning_exam_attempts WHERE exam_id = ?').bind(exam.id).first<{ n: number }>();
  const { id: _id, ...rest } = exam;
  return {
    ...rest,
    attempt_count: Number(attempts?.n ?? 0),
    // The Super Admin's own view carries the answers; no member route does.
    questions: (qs.results || []).map((q) => ({
      uid: q.uid, position: q.position, prompt: q.prompt, kind: q.kind,
      options: JSON.parse(q.options_json), correct: JSON.parse(q.correct_json),
    })),
  };
}

r.get('/exams', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const res = await c.env.DB.prepare(EXAM_SELECT + ' ORDER BY updated_at DESC, id DESC LIMIT 500').all<any>();
  return c.json({ exams: (res.results || []).map(({ id: _id, ...x }) => x) });
});

r.post('/exams', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  return guarded(c, async () => {
    const f = examFields(await c.req.json().catch(() => ({})), true);
    const uid = newUid();
    const t = now();
    await c.env.DB.prepare(
      `INSERT INTO learning_exams (uid, title, intro, pass_mark_percent, time_limit_minutes, max_attempts, shuffle, reveal, visibility, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    ).bind(uid, f.title, f.intro ?? null, f.pass_mark_percent ?? 70, f.time_limit_minutes ?? null, f.max_attempts ?? null,
      f.shuffle ?? 0, f.reveal ?? 'score', f.visibility ?? 'open', admin.id, t, t).run();
    await record(c, admin, 'learning.exam.create', { uid });
    return c.json({ exam: await examTree(c.env, uid) }, 201);
  });
});

r.get('/exams/:uid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const exam = await examTree(c.env, c.req.param('uid'));
  return exam ? c.json({ exam }) : refuse(c, 404, { code: 'not_found', message: 'No such exam.' });
});

r.patch('/exams/:uid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  return guarded(c, async () => {
    const uid = c.req.param('uid');
    const exists = await c.env.DB.prepare('SELECT id FROM learning_exams WHERE uid = ?').bind(uid).first();
    if (!exists) return refuse(c, 404, { code: 'not_found', message: 'No such exam.' });
    const f = examFields(await c.req.json().catch(() => ({})), false);
    // Each field is set only when given; "given as empty" (null) is honoured for the two nullable limits.
    await c.env.DB.prepare(
      `UPDATE learning_exams SET title = COALESCE(?, title),
         intro = CASE WHEN ? = 1 THEN ? ELSE intro END,
         pass_mark_percent = COALESCE(?, pass_mark_percent),
         time_limit_minutes = CASE WHEN ? = 1 THEN ? ELSE time_limit_minutes END,
         max_attempts = CASE WHEN ? = 1 THEN ? ELSE max_attempts END,
         shuffle = COALESCE(?, shuffle), reveal = COALESCE(?, reveal), visibility = COALESCE(?, visibility),
         updated_at = ? WHERE uid = ?`,
    ).bind(f.title ?? null, f.intro === undefined ? 0 : 1, f.intro ?? null, f.pass_mark_percent ?? null,
      f.time_limit_minutes === undefined ? 0 : 1, f.time_limit_minutes ?? null,
      f.max_attempts === undefined ? 0 : 1, f.max_attempts ?? null,
      f.shuffle ?? null, f.reveal ?? null, f.visibility ?? null, now(), uid).run();
    await record(c, admin, 'learning.exam.update', { uid });
    return c.json({ exam: await examTree(c.env, uid) });
  });
});

async function setExamStatus(c: C, action: 'publish' | 'unpublish' | 'archive') {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const uid = c.req.param('uid') as string;
  const exam = await c.env.DB.prepare('SELECT id FROM learning_exams WHERE uid = ?').bind(uid).first<{ id: number }>();
  if (!exam) return refuse(c, 404, { code: 'not_found', message: 'No such exam.' });
  if (action === 'publish') {
    const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM learning_exam_questions WHERE exam_id = ?').bind(exam.id).first<{ n: number }>();
    if (!Number(n?.n)) return refuse(c, 409, { code: 'no_questions', message: 'An exam needs at least one question before it is published.' });
  }
  const t = now();
  await c.env.DB.prepare(
    `UPDATE learning_exams SET status = ?, updated_at = ?, published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END WHERE uid = ?`,
  ).bind(NEXT_STATUS[action], t, NEXT_STATUS[action], t, uid).run();
  await record(c, admin, `learning.exam.${action}`, { uid });
  return c.json({ exam: await examTree(c.env, uid) });
}
r.post('/exams/:uid/publish', (c) => setExamStatus(c, 'publish'));
r.post('/exams/:uid/unpublish', (c) => setExamStatus(c, 'unpublish'));
r.post('/exams/:uid/archive', (c) => setExamStatus(c, 'archive'));

const FROZEN = { code: 'exam_has_attempts', message: 'Someone has started this exam, so its questions are fixed. Make a new exam to change them.' };

r.post('/exams/:uid/questions', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  return guarded(c, async () => {
    const exam = await c.env.DB.prepare('SELECT id, uid FROM learning_exams WHERE uid = ?').bind(c.req.param('uid')).first<any>();
    if (!exam) return refuse(c, 404, { code: 'not_found', message: 'No such exam.' });
    const b = await c.req.json().catch(() => ({} as any));
    const prompt = text(b?.prompt, 2000);
    if (!prompt) bad('bad_prompt', 'A question needs its prompt.');
    const kind = oneOf(b?.kind, ['single', 'multiple'] as const, 'kind');
    if (!kind) bad('bad_kind', 'kind is single or multiple.');
    const options = parseOptions(b?.options);
    if (!options) bad('bad_options', 'options is a list of 2 to 10 answers, each some text.');
    const correct = parseCorrect(kind as string, b?.correct, (options as string[]).length);
    if (!correct) bad('bad_correct', kind === 'single' ? 'A single-choice question has exactly one correct option.' : 'A multiple-choice question has one or more correct options.');
    const uid = newUid();
    // Frozen at the first attempt, checked in the insert itself.
    const ins = await c.env.DB.prepare(
      `INSERT INTO learning_exam_questions (uid, exam_id, position, prompt, kind, options_json, correct_json)
       SELECT ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM learning_exam_questions WHERE exam_id = ?), ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM learning_exam_attempts WHERE exam_id = ?)`,
    ).bind(uid, exam.id, exam.id, prompt, kind, JSON.stringify(options), JSON.stringify(correct), exam.id).run();
    if (!Number(ins?.meta?.changes ?? 0)) return refuse(c, 409, FROZEN);
    await record(c, admin, 'learning.question.create', { uid, exam_uid: exam.uid });
    return c.json({ exam: await examTree(c.env, exam.uid) }, 201);
  });
});

async function questionOf(env: Env, uid: string) {
  return env.DB.prepare(
    `SELECT q.id, q.uid, q.kind, q.options_json, e.id AS exam_id, e.uid AS exam_uid,
            (SELECT COUNT(*) FROM learning_exam_attempts a WHERE a.exam_id = e.id) AS attempts
       FROM learning_exam_questions q JOIN learning_exams e ON e.id = q.exam_id WHERE q.uid = ?`,
  ).bind(uid).first<any>();
}

r.patch('/questions/:uid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  return guarded(c, async () => {
    const q = await questionOf(c.env, c.req.param('uid'));
    if (!q) return refuse(c, 404, { code: 'not_found', message: 'No such question.' });
    const b = await c.req.json().catch(() => ({} as any));
    const prompt = text(b?.prompt, 2000);
    if (prompt === null) bad('bad_prompt', 'A question needs its prompt.');
    const kind = (oneOf(b?.kind, ['single', 'multiple'] as const, 'kind') ?? q.kind) as string;
    const options = b?.options === undefined ? JSON.parse(q.options_json) : parseOptions(b.options);
    if (!options) bad('bad_options', 'options is a list of 2 to 10 answers, each some text.');
    // Changing the options or the kind needs the answer restated, so it cannot point at a removed option.
    if ((b?.options !== undefined || b?.kind !== undefined) && b?.correct === undefined) {
      bad('bad_correct', 'Changing the options or the kind needs the correct answer restated.');
    }
    const correct = b?.correct === undefined ? undefined : parseCorrect(kind, b.correct, options.length);
    if (correct === null) bad('bad_correct', kind === 'single' ? 'A single-choice question has exactly one correct option.' : 'A multiple-choice question has one or more correct options.');
    const upd = await c.env.DB.prepare(
      `UPDATE learning_exam_questions SET prompt = COALESCE(?, prompt), kind = ?, options_json = ?,
         correct_json = COALESCE(?, correct_json), updated_at = ?
       WHERE id = ? AND NOT EXISTS (SELECT 1 FROM learning_exam_attempts WHERE exam_id = ?)`,
    ).bind(prompt ?? null, kind, JSON.stringify(options), correct ? JSON.stringify(correct) : null, now(), q.id, q.exam_id).run();
    if (!Number(upd?.meta?.changes ?? 0)) return refuse(c, 409, FROZEN);
    await record(c, admin, 'learning.question.update', { uid: q.uid, exam_uid: q.exam_uid });
    return c.json({ exam: await examTree(c.env, q.exam_uid) });
  });
});

r.delete('/questions/:uid', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  const q = await questionOf(c.env, c.req.param('uid'));
  if (!q) return refuse(c, 404, { code: 'not_found', message: 'No such question.' });
  const del = await c.env.DB.prepare(
    'DELETE FROM learning_exam_questions WHERE id = ? AND NOT EXISTS (SELECT 1 FROM learning_exam_attempts WHERE exam_id = ?)',
  ).bind(q.id, q.exam_id).run();
  if (!Number(del?.meta?.changes ?? 0)) return refuse(c, 409, FROZEN);
  await record(c, admin, 'learning.question.delete', { uid: q.uid, exam_uid: q.exam_uid });
  return c.json({ exam: await examTree(c.env, q.exam_uid) });
});

export default r;
