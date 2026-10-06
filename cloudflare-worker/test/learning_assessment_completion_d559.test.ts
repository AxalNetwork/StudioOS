/**
 * D559 follow-up (#1249) — an exercise or exam lesson completes itself when
 * the exercise is accepted or the exam passed.
 *
 * Run on a database built from the baseline and the migrations through 390,
 * with the real assessment routers. Pinned:
 *   - accepting a submission writes a completed row on every lesson naming the
 *     exercise, and each holding course's row, for that member only;
 *   - a passing attempt does the same for an exam;
 *   - needs work, a failed attempt and a timed-out attempt write nothing;
 *   - a second pass changes nothing, and nothing is ever downgraded;
 *   - the course row's percent is the one GET /courses/:slug serves.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/learning_assessment_completion_d559.test.ts
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
import { coursePercent, PROGRESS_UPSERT } from '../src/services/learningCompletion.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const MIGRATIONS = resolve(ROOT, 'cloudflare-worker/sql/migrations');
const sqlOf = (n: string) => readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith(`${n}_`)) as string), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const SUPER = 1, PLAIN_ADMIN = 2, MEMBER = 10, OTHER = 11;
const ROLE: Record<number, string> = { [SUPER]: 'admin', [PLAIN_ADMIN]: 'admin', [MEMBER]: 'founder', [OTHER]: 'investor' };

function builtFromMigrations(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8'));
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort(compareMigrations)
    .filter((f) => migrationNumber(f) > BASELINE_CUTOFF && migrationNumber(f) < 388);
  for (const f of files) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, f), 'utf8'))) {
      try { db.exec(stmt); } catch { /* already present on the baseline */ }
    }
  }
  db.exec(sqlOf('388'));
  // 389 (D558, programs) sits between: the member reads join its tables.
  db.exec(sqlOf('389'));
  db.exec(sqlOf('390'));
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

async function call(app: any, db: DatabaseSync, who: number, path: string, init: { method?: string; body?: unknown } = {}) {
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res: Response = await app.request(path, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any).catch((e: unknown) => {
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
  return { db, ex, exam, sit };
}

test('needs work writes nothing; acceptance completes the exercise in every course, for that member only', async () => {
  const { db, ex } = await setup();
  const before = rows(db, MEMBER);
  const sub = (await member(db, MEMBER, `/exercises/${ex.uid}/submissions`, { method: 'POST', body: { body: 'v1' } })).body.submission;
  const nw = await admin(db, SUPER, `/submissions/${sub.uid}/review`, { method: 'POST', body: { status: 'needs_work', feedback: 'Add numbers' } });
  assert.equal(nw.status, 200);
  assert.equal(nw.body.lesson_progress, null);
  assert.deepEqual(rows(db, MEMBER), before, 'needs work recorded progress');
  const sub2 = (await member(db, MEMBER, `/exercises/${ex.uid}/submissions`, { method: 'POST', body: { body: 'v2' } })).body.submission;
  const ok = await admin(db, SUPER, `/submissions/${sub2.uid}/review`, { method: 'POST', body: { status: 'accepted' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.lesson_progress.lessons, 2);
  assert.deepEqual(rows(db, MEMBER), [
    { subject_kind: 'course', subject_uid: 'crs-one', status: 'started', percent: 67 },
    { subject_kind: 'course', subject_uid: 'crs-two', status: 'completed', percent: 100 },
    { subject_kind: 'lesson', subject_uid: 'les-ex', status: 'completed', percent: null },
    { subject_kind: 'lesson', subject_uid: 'les-ex-2', status: 'completed', percent: null },
    { subject_kind: 'lesson', subject_uid: 'les-video', status: 'completed', percent: null },
  ]);
  assert.deepEqual(rows(db, OTHER), [], 'another member was recorded');
  // The course page and the course row agree.
  const page = await course(db, MEMBER, 'c-one');
  assert.equal(page.status, 200, JSON.stringify(page.body));
  assert.equal(page.body.progress.percent, 67);
  assert.equal(page.body.modules[0].lessons.find((l: any) => l.uid === 'les-ex').progress.status, 'completed');
});

test('a fail and a timeout write nothing; a pass completes the exam lesson, and a second pass changes nothing', async () => {
  const { db, sit } = await setup();
  const before = rows(db, MEMBER);
  const fail = await sit(MEMBER, false);
  assert.equal(fail.body.attempt.passed, false);
  assert.equal(fail.body.lesson_progress, null);
  assert.deepEqual(rows(db, MEMBER), before, 'a failed attempt recorded progress');
  const pass = await sit(MEMBER, true);
  assert.equal(pass.body.attempt.passed, true);
  assert.equal(pass.body.lesson_progress.lessons, 1);
  const after = rows(db, MEMBER);
  assert.deepEqual(after.filter((r) => r.subject_uid === 'les-exam' || r.subject_uid === 'crs-one'), [
    { subject_kind: 'course', subject_uid: 'crs-one', status: 'started', percent: 67 },
    { subject_kind: 'lesson', subject_uid: 'les-exam', status: 'completed', percent: null },
  ]);
  assert.ok(!after.some((r) => r.subject_uid === 'crs-two'), 'a course not holding the exam was written');
  const firstAt = (db.prepare(`SELECT completed_at FROM learning_progress WHERE user_id = ? AND subject_uid = 'les-exam'`).get(MEMBER) as any).completed_at;
  db.exec(`UPDATE learning_exams SET max_attempts = NULL`);
  await sit(MEMBER, true);
  assert.deepEqual(rows(db, MEMBER), after, 'a second pass changed the record');
  assert.equal((db.prepare(`SELECT completed_at FROM learning_progress WHERE user_id = ? AND subject_uid = 'les-exam'`).get(MEMBER) as any).completed_at, firstAt);
});

test('a timed-out attempt writes nothing', async () => {
  const { db, exam, sit } = await setup({ time_limit_minutes: 5 });
  const before = rows(db, MEMBER);
  const s = await member(db, MEMBER, `/exams/${exam.uid}/attempts`, { method: 'POST' });
  db.prepare(`UPDATE learning_exam_attempts SET started_at = ? WHERE uid = ?`).run('2026-01-01T00:00:00.000Z', s.body.attempt.uid);
  const late = await member(db, MEMBER, `/exams/${exam.uid}/attempts/${s.body.attempt.uid}/submit`, { method: 'POST', body: { answers: {} } });
  assert.equal(late.body.error, 'time_limit_passed');
  assert.deepEqual(rows(db, MEMBER), before, 'a timed-out attempt recorded progress');
  void sit;
});

test('nothing is downgraded: a completed course stays completed with its percent', async () => {
  const { db, ex } = await setup();
  db.prepare(`INSERT INTO learning_progress (user_id, subject_kind, subject_uid, status, percent, completed_at) VALUES (?, 'course', 'crs-one', 'completed', 100, '2026-10-03')`).run(MEMBER);
  const sub = (await member(db, MEMBER, `/exercises/${ex.uid}/submissions`, { method: 'POST', body: { body: 'v1' } })).body.submission;
  await admin(db, SUPER, `/submissions/${sub.uid}/review`, { method: 'POST', body: { status: 'accepted' } });
  assert.deepEqual({ ...(db.prepare(`SELECT status, percent, completed_at FROM learning_progress WHERE user_id = ? AND subject_uid = 'crs-one'`).get(MEMBER) as any) },
    { status: 'completed', percent: 100, completed_at: '2026-10-03' });
});

test('the measure is the course page\'s, and every value is bound', () => {
  assert.equal(coursePercent(3, 2), 67);
  assert.equal(coursePercent(3, 3), 100);
  assert.equal(coursePercent(0, 0), null);
  const svc = readFileSync(resolve(ROOT, 'cloudflare-worker/src/services/learningCompletion.ts'), 'utf8');
  assert.doesNotMatch(svc, /prepare\(`[^`]*\$\{/, 'a value is interpolated into SQL');
  assert.match(PROGRESS_UPSERT, /CASE WHEN learning_progress\.status = 'completed' THEN 'completed'/);
  assert.match(PROGRESS_UPSERT, /completed_at = COALESCE\(learning_progress\.completed_at, excluded\.completed_at\)/);
});
