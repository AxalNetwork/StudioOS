/**
 * D4643 (#4643, Learning audit 1/5) — completion and exam integrity.
 *
 *   1. simultaneous, repeated and resumed starts reuse one open attempt and use
 *      one allowance;
 *   2. an attempt keeps the pass mark, time limit and reveal policy it started
 *      under; an author's edit applies to new attempts; an attempt from before
 *      D4643 (no policy stored) reads the exam's current rules, as it always did;
 *   3. completion is authoritative: an exam or exercise lesson completes only by
 *      its result, never by the member's own "Mark complete"; a course's row is
 *      derived on the server from its required lessons, whatever is posted for
 *      it; an optional lesson never moves it; the course page, the course row
 *      and the member's other courses agree.
 *
 * Synthetic people and content only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/learning_integrity_4643.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import learningAssessment from '../src/routes/learning_assessment.ts';
import adminAssessment from '../src/routes/admin_learning_assessment.ts';
import learning from '../src/routes/learning.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const sqlOf = (n: string) => readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith(`${n}_`)) as string), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const SUPER = 1, PLAIN_ADMIN = 2, MEMBER = 10, OTHER = 11;
const ROLE: Record<number, string> = { [SUPER]: 'admin', [PLAIN_ADMIN]: 'admin', [MEMBER]: 'founder', [OTHER]: 'investor' };

function builtFromMigrations(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db, { below: 388 });
  db.exec(sqlOf('388'));
  // 389 (D558, programs) sits between: the member reads join its tables.
  db.exec(sqlOf('389'));
  db.exec(sqlOf('390'));
  // D4643 (#4643): the attempt's own pass mark, time limit and reveal policy.
  db.exec(sqlOf('202611062214'));
  return db;
}
const BUILT = builtFromMigrations();

function seeded(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  const ddl = (BUILT.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                               ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END`).all() as any[]).map((r) => r.sql);
  for (const s of ddl) { try { db.exec(s); } catch { /* views and triggers naming absent objects */ } }
  db.exec(`
    INSERT INTO users (id, uid, email, name, role, is_active) VALUES
      (${SUPER}, 'u-super', 'super@example.test', 'Super Holder', 'admin', 1),
      (${PLAIN_ADMIN}, 'u-plain', 'plain@example.test', 'Plain Admin', 'admin', 1),
      (${MEMBER}, 'u-mia', 'mia@example.test', 'Mia Member', 'founder', 1),
      (${OTHER}, 'u-otto', 'otto@example.test', 'Otto Other', 'investor', 1);
    INSERT INTO super_admins (user_id) VALUES (${SUPER});
  `);
  return db;
}

/** When set, the D1 binding every request gets (test 1's barrier); else node:sqlite as is. */
let bindingFor: ((db: DatabaseSync) => any) | null = null;
async function call(app: any, db: DatabaseSync, who: number, path: string, init: { method?: string; body?: unknown } = {}) {
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res: Response = await app.request(path, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: bindingFor ? bindingFor(db) : d1Over(db) } as any).catch((e: unknown) => {
    if (e instanceof Response) return e;
    throw e;
  });
  return { status: res.status, body: await res.json().catch(() => null) as any, raw: '' };
}
const admin = (db: DatabaseSync, who: number, path: string, init?: { method?: string; body?: unknown }) => call(adminAssessment, db, who, path, init);
const member = (db: DatabaseSync, who: number, path: string, init?: { method?: string; body?: unknown }) => call(learningAssessment, db, who, path, init);

/** A published exam: q1 single (right: 1), q2 multiple (right: 0 and 2). */
async function publishedExam(db: DatabaseSync, opts: Record<string, unknown> = {}) {
  const exam = (await admin(db, SUPER, '/exams', { method: 'POST', body: { title: 'Term sheets', pass_mark_percent: 70, ...opts } })).body.exam;
  await admin(db, SUPER, `/exams/${exam.uid}/questions`, { method: 'POST', body: { prompt: 'Who leads?', kind: 'single', options: ['Founder', 'Lead investor', 'Lawyer'], correct: [1] } });
  const tree = (await admin(db, SUPER, `/exams/${exam.uid}/questions`, { method: 'POST', body: { prompt: 'Which are terms?', kind: 'multiple', options: ['Valuation', 'Weather', 'Pro rata'], correct: [0, 2] } })).body.exam;
  await admin(db, SUPER, `/exams/${exam.uid}/publish`, { method: 'POST' });
  const [q1, q2] = tree.questions;
  return { exam, q1, q2 };
}


const course = (db: DatabaseSync, who: number, slug: string) => call(learning, db, who, `/courses/${slug}`);

/**
 * Two published courses. c-one: a video (already completed by MEMBER), the
 * exercise, the exam, all required, and an optional reading. c-two: the same
 * exercise, required, alone.
 */
function courses(db: DatabaseSync, exerciseUid: string, examUid: string) {
  db.exec(`
    INSERT INTO learning_courses (id, uid, slug, title, status, visibility, created_by, published_at) VALUES
      (1, 'crs-one', 'c-one', 'Raising', 'published', 'open', ${SUPER}, '2026-10-01'),
      (2, 'crs-two', 'c-two', 'Writing', 'published', 'open', ${SUPER}, '2026-10-01');
    INSERT INTO learning_course_modules (id, uid, course_id, title, position) VALUES (1, 'mod-one', 1, 'Basics', 0), (2, 'mod-two', 2, 'Basics', 0);
  `);
  const l = db.prepare('INSERT INTO learning_lessons (uid, module_id, title, position, kind, ref_uid, required) VALUES (?, ?, ?, ?, ?, ?, ?)');
  l.run('les-video', 1, 'Watch', 0, 'video', 'itm-x', 1);
  l.run('les-ex', 1, 'Write', 1, 'exercise', exerciseUid, 1);
  l.run('les-exam', 1, 'Test', 2, 'exam', examUid, 1);
  l.run('les-read', 1, 'Read', 3, 'reading', 'itm-y', 0);
  l.run('les-ex-2', 2, 'Write again', 0, 'exercise', exerciseUid, 1);
  db.prepare(`INSERT INTO learning_progress (user_id, subject_kind, subject_uid, status, completed_at) VALUES (?, 'lesson', 'les-video', 'completed', '2026-10-02')`).run(MEMBER);
}
const rows = (db: DatabaseSync, who: number) => (db.prepare(
  `SELECT subject_kind, subject_uid, status, percent FROM learning_progress WHERE user_id = ? ORDER BY subject_kind, subject_uid`,
).all(who) as any[]).map((r) => ({ ...r }));

async function setup(examOpts: Record<string, unknown> = {}) {
  const db = seeded();
  const ex = (await admin(db, SUPER, '/exercises', { method: 'POST', body: { title: 'One-pager', submission_kind: 'text' } })).body.exercise;
  await admin(db, SUPER, `/exercises/${ex.uid}/publish`, { method: 'POST' });
  const { exam, q1, q2 } = await publishedExam(db, examOpts);
  courses(db, ex.uid, exam.uid);
  const sit = async (who: number, pass: boolean) => {
    const s = await member(db, who, `/exams/${exam.uid}/attempts`, { method: 'POST' });
    return member(db, who, `/exams/${exam.uid}/attempts/${s.body.attempt.uid}/submit`, { method: 'POST',
      body: { answers: pass ? { [q1.uid]: [1], [q2.uid]: [0, 2] } : { [q1.uid]: [0] } } });
  };
  return { db, ex, exam, q1, q2, sit };
}


const progress = (db: DatabaseSync, who: number, body: Record<string, unknown>) => call(learning, db, who, '/progress', { method: 'POST', body });
const open = (db: DatabaseSync, examId: number) =>
  (db.prepare('SELECT COUNT(*) AS n FROM learning_exam_attempts WHERE exam_id = ? AND submitted_at IS NULL').get(examId) as any).n;
const examId = (db: DatabaseSync, uid: string) => (db.prepare('SELECT id FROM learning_exams WHERE uid = ?').get(uid) as any).id;

/**
 * A D1 binding that holds each start's "is an attempt open?" read until `n`
 * starts have made it, so all of them see none open and go on to insert: the
 * race two tabs or a retried request make, made certain.
 */
function barrier(n: number) {
  let waiting = 0;
  let release!: () => void;
  const gate = new Promise<void>((ok) => { release = ok; });
  return (db: DatabaseSync) => {
    const real: any = d1Over(db);
    return {
      ...real,
      batch: (...a: any[]) => real.batch(...a),
      prepare(sql: string) {
        const stmt = real.prepare(sql);
        if (!/FROM learning_exam_attempts WHERE exam_id = \? AND user_id = \? AND submitted_at IS NULL ORDER BY id LIMIT 1/.test(sql)) return stmt;
        const held = (b: any) => ({ ...b, first: async (...x: any[]) => {
          if (waiting < n) { waiting += 1; if (waiting === n) release(); await gate; }
          return b.first(...x);
        } });
        return { ...stmt, bind: (...args: any[]) => held(stmt.bind(...args)) };
      },
    };
  };
}

test('1. simultaneous, repeated and resumed starts reuse one attempt and use one allowance', async () => {
  // Mutation checked: the NOT EXISTS clause dropped from the start insert -> five starts at once open several attempts.
  const { db, exam } = await setup({ max_attempts: 2 });
  bindingFor = barrier(5);
  let starts;
  try {
    starts = await Promise.all(Array.from({ length: 5 }, () => member(db, MEMBER, `/exams/${exam.uid}/attempts`, { method: 'POST' })));
  } finally { bindingFor = null; }
  assert.deepEqual(starts.map((s) => s.status).sort(), [200, 200, 200, 200, 201], JSON.stringify(starts.map((s) => s.body)));
  assert.equal(new Set(starts.map((s) => s.body.attempt.uid)).size, 1, 'every start answered the same attempt');
  assert.equal(open(db, examId(db, exam.uid)), 1);
  const again = await member(db, MEMBER, `/exams/${exam.uid}/attempts`, { method: 'POST' });
  assert.deepEqual([again.status, again.body.attempt.uid], [200, starts[0].body.attempt.uid], 'a reload resumes it');
  const mine = await member(db, MEMBER, `/exams/${exam.uid}/attempts`);
  assert.equal(mine.body.attempts.length, 1);
  assert.equal(mine.body.attempts_left, 1, 'one allowance used');
  // Another member's start is their own attempt, and uses none of this member's allowance.
  const other = await member(db, OTHER, `/exams/${exam.uid}/attempts`, { method: 'POST' });
  assert.equal(other.status, 201);
  assert.notEqual(other.body.attempt.uid, starts[0].body.attempt.uid);
});

test('2. an attempt keeps the rules it started under; an edit applies to the next attempt', async () => {
  // Mutation checked: the grade read from the exam's live pass mark -> the half-right answer fails;
  // the reveal read from the exam -> the first attempt reveals its answers; the deadline from the exam -> 1 minute.
  const { db, exam, q1, q2 } = await setup({ pass_mark_percent: 50, time_limit_minutes: 30, reveal: 'score' });
  const first = await member(db, MEMBER, `/exams/${exam.uid}/attempts`, { method: 'POST' });
  const deadline = Date.parse(first.body.attempt.deadline) - Date.parse(first.body.attempt.started_at);
  assert.equal(deadline, 30 * 60 * 1000);
  const edit = await admin(db, SUPER, `/exams/${exam.uid}`, { method: 'PATCH', body: { pass_mark_percent: 90, time_limit_minutes: 1, reveal: 'score_and_answers' } });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  const resumed = await member(db, MEMBER, `/exams/${exam.uid}/attempts`, { method: 'POST' });
  assert.equal(resumed.body.attempt.deadline, first.body.attempt.deadline, 'the open attempt keeps its deadline');
  // One of two right: 50%, a pass under the attempt's 50, a fail under the edited 90.
  const half = { [q1.uid]: [1], [q2.uid]: [0] };
  const sub = await member(db, MEMBER, `/exams/${exam.uid}/attempts/${first.body.attempt.uid}/submit`, { method: 'POST', body: { answers: half } });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  assert.deepEqual([sub.body.attempt.score_percent, sub.body.attempt.passed, sub.body.attempt.answers_revealed], [50, true, false]);
  // The next attempt starts under the edited rules.
  const next = await member(db, MEMBER, `/exams/${exam.uid}/attempts`, { method: 'POST' });
  assert.equal(Date.parse(next.body.attempt.deadline) - Date.parse(next.body.attempt.started_at), 60 * 1000);
  const sub2 = await member(db, MEMBER, `/exams/${exam.uid}/attempts/${next.body.attempt.uid}/submit`, { method: 'POST', body: { answers: half } });
  assert.deepEqual([sub2.body.attempt.passed, sub2.body.attempt.answers_revealed], [false, true]);
  // Each stored result keeps its own reading.
  const list = (await member(db, MEMBER, `/exams/${exam.uid}/attempts`)).body.attempts;
  assert.deepEqual(list.map((a: any) => [a.passed, a.answers_revealed]), [[false, true], [true, false]]);
});

test('2b. an attempt from before D4643 (no rules stored) is read with the exam\'s current rules', async () => {
  const { db, exam, q1, q2 } = await setup({ pass_mark_percent: 50, reveal: 'score' });
  const s = await member(db, MEMBER, `/exams/${exam.uid}/attempts`, { method: 'POST' });
  db.prepare('UPDATE learning_exam_attempts SET pass_mark_percent = NULL, time_limit_minutes = NULL, reveal = NULL WHERE uid = ?').run(s.body.attempt.uid);
  await admin(db, SUPER, `/exams/${exam.uid}`, { method: 'PATCH', body: { pass_mark_percent: 90 } });
  const sub = await member(db, MEMBER, `/exams/${exam.uid}/attempts/${s.body.attempt.uid}/submit`, { method: 'POST', body: { answers: { [q1.uid]: [1], [q2.uid]: [0] } } });
  assert.equal(sub.body.attempt.passed, false, 'graded by the exam\'s pass mark at submission, as before');
});

test('3. an exam or exercise lesson completes only by its result, never by Mark complete', async () => {
  // Mutation checked: the assessed-kind refusal removed -> both lessons are marked complete by the member.
  const { db } = await setup();
  for (const uid of ['les-exam', 'les-ex']) {
    const r = await progress(db, MEMBER, { subject_kind: 'lesson', subject_uid: uid, status: 'completed' });
    assert.deepEqual([r.status, r.body.error], [409, 'completed_by_result'], uid);
    assert.equal((await progress(db, MEMBER, { subject_kind: 'lesson', subject_uid: uid, status: 'started' })).status, 200, `${uid}: started is still the member's`);
  }
  assert.deepEqual(rows(db, MEMBER).filter((r: any) => r.status === 'completed').map((r: any) => r.subject_uid), ['les-video']);
});

test('3b. a course row is derived by the server: what is posted for it is ignored, an optional lesson never moves it', async () => {
  // Mutation checked: the course branch removed (the posted status stored) -> the course reads completed at 33%.
  const { db } = await setup();
  const posted = await progress(db, MEMBER, { subject_kind: 'course', subject_uid: 'crs-one', status: 'completed', percent: 100 });
  assert.equal(posted.status, 200);
  assert.deepEqual([posted.body.progress.status, posted.body.progress.percent], ['started', 33], 'one of three required lessons');
  const optional = await progress(db, MEMBER, { subject_kind: 'lesson', subject_uid: 'les-read', status: 'completed' });
  assert.equal(optional.status, 200);
  const page = await course(db, MEMBER, 'c-one');
  assert.equal(page.body.progress.percent, 33, 'the optional reading is not counted');
  assert.deepEqual(rows(db, MEMBER).find((r: any) => r.subject_uid === 'crs-one'), { subject_kind: 'course', subject_uid: 'crs-one', status: 'started', percent: 33 });
});

test('3c. a passing exam and an accepted exercise complete the course everywhere it is read, for that member only', async () => {
  // Mutation checked: refreshCourses skipped after a manual lesson completion -> the course row lags the page.
  const { db, ex, sit } = await setup();
  assert.equal((await sit(MEMBER, true)).body.attempt.passed, true);
  const sub = (await member(db, MEMBER, `/exercises/${ex.uid}/submissions`, { method: 'POST', body: { body: 'v1' } })).body.submission;
  assert.equal((await admin(db, SUPER, `/submissions/${sub.uid}/review`, { method: 'POST', body: { status: 'accepted' } })).status, 200);
  const page = await course(db, MEMBER, 'c-one');
  assert.equal(page.body.progress.percent, 100);
  assert.deepEqual(rows(db, MEMBER).filter((r: any) => r.subject_kind === 'course'), [
    { subject_kind: 'course', subject_uid: 'crs-one', status: 'completed', percent: 100 },
    { subject_kind: 'course', subject_uid: 'crs-two', status: 'completed', percent: 100 },
  ]);
  assert.ok((await call(learning, db, MEMBER, '/me')).body.completed.some((x: any) => x.subject_uid === 'crs-one'));
  assert.deepEqual(rows(db, OTHER), [], 'nothing recorded for another member');
  // A manual completion moves the course row with it: a new course of one reading lesson.
  db.exec(`INSERT INTO learning_courses (id, uid, slug, title, status, visibility, created_by, published_at) VALUES (3, 'crs-three', 'c-three', 'Reading', 'published', 'open', ${SUPER}, '2026-10-01');
    INSERT INTO learning_course_modules (id, uid, course_id, title, position) VALUES (3, 'mod-three', 3, 'Basics', 0);
    INSERT INTO learning_lessons (uid, module_id, title, position, kind, ref_uid, required) VALUES ('les-only', 3, 'Only', 0, 'reading', 'itm-z', 1);`);
  assert.equal((await progress(db, MEMBER, { subject_kind: 'lesson', subject_uid: 'les-only', status: 'completed' })).status, 200);
  assert.deepEqual(rows(db, MEMBER).find((r: any) => r.subject_uid === 'crs-three'), { subject_kind: 'course', subject_uid: 'crs-three', status: 'completed', percent: 100 });
});
