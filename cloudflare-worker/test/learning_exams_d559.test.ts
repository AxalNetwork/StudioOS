/**
 * D559 (#1160) — exercises and exams, graded on the server with no answer leaked.
 *
 * Run on a database built from the baseline and the migrations through 390 (389 included).
 * What is pinned:
 *
 *   - no member-facing payload carries a correct answer before the attempt is
 *     submitted AND the exam's `reveal` allows it;
 *   - grading, exact, for single and multiple choice; the attempt limit, held
 *     in the insert; the time limit, from `started_at`, on the server;
 *   - another member's attempt or submission is refused or absent; the
 *     read-only review admits only whoever `canReviewLearning` admits (today
 *     the Super Admin; #1159 adds assigned program admins) and serves no email;
 *   - every Super Admin write records its actor; questions freeze at the first attempt.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/learning_exams_d559.test.ts
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
import { grade, memberQuestion, normaliseAnswers, parseCorrect } from '../src/services/learningAssessment.ts';
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

/** True if any key or value in a payload names a correct answer. */
const leaks = (payload: unknown) => /"correct(_json)?"\s*:/.test(JSON.stringify(payload));

// ---- the migration -------------------------------------------------------------------

test('390 applies to a database built from the migrations, with its sets as CHECKs', () => {
  const cols = (t: string) => (BUILT.prepare('SELECT name FROM pragma_table_info(?)').all(t) as any[]).map((r) => r.name);
  for (const t of ['learning_exercises', 'learning_exercise_submissions', 'learning_exams', 'learning_exam_questions', 'learning_exam_attempts']) {
    assert.ok(cols(t).length > 0, `${t} is missing`);
  }
  const db = seeded();
  assert.throws(() => db.prepare(`INSERT INTO learning_exams (uid, title, pass_mark_percent, created_by) VALUES ('x', 't', 101, 1)`).run(), /CHECK/);
  assert.throws(() => db.prepare(`INSERT INTO learning_exams (uid, title, reveal, created_by) VALUES ('y', 't', 'everything', 1)`).run(), /CHECK/);
});

// ---- no answer leaks ----------------------------------------------------------------------

test('no member payload carries a correct answer before submission, and none after unless reveal allows', async () => {
  const db = seeded();
  const { exam, q1, q2 } = await publishedExam(db, { reveal: 'score' });
  const intro = await member(db, MEMBER, `/exams/${exam.uid}`);
  assert.equal(intro.status, 200);
  assert.equal(intro.body.exam.question_count, 2);
  assert.ok(!leaks(intro.body) && !JSON.stringify(intro.body).includes('Who leads'), 'the intro served a question or an answer');
  const start = await member(db, MEMBER, `/exams/${exam.uid}/attempts`, { method: 'POST' });
  assert.equal(start.status, 201);
  assert.equal(start.body.questions.length, 2);
  assert.deepEqual(Object.keys(start.body.questions[0]).sort(), ['kind', 'options', 'prompt', 'uid']);
  assert.ok(!leaks(start.body), 'the started attempt served an answer');
  assert.ok(!leaks((await member(db, MEMBER, `/exams/${exam.uid}/attempts`)).body), 'the open attempt listed an answer');
  const sub = await member(db, MEMBER, `/exams/${exam.uid}/attempts/${start.body.attempt.uid}/submit`, { method: 'POST', body: { answers: { [q1.uid]: [1], [q2.uid]: [0] } } });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  assert.equal(sub.body.attempt.answers_revealed, false);
  assert.ok(!leaks(sub.body), 'reveal = score still revealed the answers');
  assert.ok(!leaks((await member(db, MEMBER, `/exams/${exam.uid}/attempts`)).body));
  // The same, on an exam that reveals: the answers arrive after submission only.
  const open = await publishedExam(db, { reveal: 'score_and_answers' });
  const s2 = await member(db, MEMBER, `/exams/${open.exam.uid}/attempts`, { method: 'POST' });
  assert.ok(!leaks(s2.body), 'a revealing exam leaked before submission');
  assert.ok(!leaks((await member(db, MEMBER, `/exams/${open.exam.uid}/attempts`)).body), 'a revealing exam listed an open attempt\'s answers');
  const done = await member(db, MEMBER, `/exams/${open.exam.uid}/attempts/${s2.body.attempt.uid}/submit`, { method: 'POST', body: { answers: {} } });
  assert.equal(done.body.attempt.answers_revealed, true);
  assert.deepEqual(done.body.attempt.correct, { [open.q1.uid]: [1], [open.q2.uid]: [0, 2] });
  assert.ok(!leaks(memberQuestion({ uid: 'q', prompt: 'p', kind: 'single', options_json: '["a","b"]', correct_json: '[1]' })));
});

// ---- grading ----------------------------------------------------------------------------

test('grading is exact for single and multiple choice, against the pass mark', async () => {
  const db = seeded();
  const { exam, q1, q2 } = await publishedExam(db);
  const run = async (answers: Record<string, number[]>) => {
    const s = await member(db, MEMBER, `/exams/${exam.uid}/attempts`, { method: 'POST' });
    return member(db, MEMBER, `/exams/${exam.uid}/attempts/${s.body.attempt.uid}/submit`, { method: 'POST', body: { answers } });
  };
  const full = await run({ [q1.uid]: [1], [q2.uid]: [2, 0] });
  assert.deepEqual([full.body.attempt.score_percent, full.body.attempt.passed, full.body.correct_count], [100, true, 2]);
  const partial = await run({ [q1.uid]: [1], [q2.uid]: [0] });
  assert.deepEqual([partial.body.attempt.score_percent, partial.body.attempt.passed], [50, false], 'a partial multiple-choice answer earned credit');
  const extra = await run({ [q1.uid]: [1], [q2.uid]: [0, 1, 2] });
  assert.equal(extra.body.attempt.score_percent, 50, 'choosing every option scored the multiple-choice question');
  const s = await member(db, MEMBER, `/exams/${exam.uid}/attempts`, { method: 'POST' });
  const two = await member(db, MEMBER, `/exams/${exam.uid}/attempts/${s.body.attempt.uid}/submit`, { method: 'POST', body: { answers: { [q1.uid]: [0, 1] } } });
  assert.equal(two.body.error, 'bad_answers', 'two answers to a single-choice question were graded');
  const out = await member(db, MEMBER, `/exams/${exam.uid}/attempts/${s.body.attempt.uid}/submit`, { method: 'POST', body: { answers: { [q1.uid]: [9] } } });
  assert.equal(out.body.error, 'bad_answers', 'an out-of-range option was graded');
  assert.deepEqual(grade([], {}), { correct: 0, total: 0, score_percent: 0 });
  assert.equal(normaliseAnswers({ q: [1] }, [{ uid: 'q', prompt: 'p', kind: 'multiple', options_json: '["a","b"]', correct_json: '[1]' }])?.q?.[0], 1);
  assert.equal(parseCorrect('single', [0, 1], 3), null);
  assert.equal(parseCorrect('multiple', [], 3), null);
});

test('the attempt limit holds; an open attempt is resumed, not doubled', async () => {
  const db = seeded();
  const { exam, q1 } = await publishedExam(db, { max_attempts: 1 });
  const a = await member(db, MEMBER, `/exams/${exam.uid}/attempts`, { method: 'POST' });
  const again = await member(db, MEMBER, `/exams/${exam.uid}/attempts`, { method: 'POST' });
  assert.equal(again.status, 200);
  assert.equal(again.body.attempt.uid, a.body.attempt.uid, 'a second open attempt was started');
  await member(db, MEMBER, `/exams/${exam.uid}/attempts/${a.body.attempt.uid}/submit`, { method: 'POST', body: { answers: { [q1.uid]: [1] } } });
  const over = await member(db, MEMBER, `/exams/${exam.uid}/attempts`, { method: 'POST' });
  assert.equal(over.status, 409);
  assert.equal(over.body.error, 'no_attempts_left');
  assert.equal((await member(db, MEMBER, `/exams/${exam.uid}/attempts`)).body.attempts_left, 0);
  assert.equal((await member(db, OTHER, `/exams/${exam.uid}/attempts`, { method: 'POST' })).status, 201, 'one member\'s attempts counted against another');
});

test('the time limit is enforced from started_at, on the server', async () => {
  const db = seeded();
  const { exam, q1 } = await publishedExam(db, { time_limit_minutes: 10 });
  const a = await member(db, MEMBER, `/exams/${exam.uid}/attempts`, { method: 'POST' });
  assert.ok(a.body.attempt.deadline, 'a timed attempt carries its deadline');
  const longAgo = new Date(Date.now() - 11 * 60_000).toISOString();
  db.prepare('UPDATE learning_exam_attempts SET started_at = ? WHERE uid = ?').run(longAgo, a.body.attempt.uid);
  const late = await member(db, MEMBER, `/exams/${exam.uid}/attempts/${a.body.attempt.uid}/submit`, { method: 'POST', body: { answers: { [q1.uid]: [1] } } });
  assert.equal(late.status, 409);
  assert.equal(late.body.error, 'time_limit_passed');
  const row = db.prepare('SELECT score_percent, passed, timed_out, answers_json FROM learning_exam_attempts WHERE uid = ?').get(a.body.attempt.uid) as any;
  assert.deepEqual([row.score_percent, row.passed, row.timed_out, row.answers_json], [0, 0, 1, null]);
  // Inside the limit (and its grace) is graded.
  const b = await member(db, MEMBER, `/exams/${exam.uid}/attempts`, { method: 'POST' });
  db.prepare('UPDATE learning_exam_attempts SET started_at = ? WHERE uid = ?').run(new Date(Date.now() - 9 * 60_000).toISOString(), b.body.attempt.uid);
  assert.equal((await member(db, MEMBER, `/exams/${exam.uid}/attempts/${b.body.attempt.uid}/submit`, { method: 'POST', body: { answers: { [q1.uid]: [1] } } })).status, 200);
  // An abandoned attempt past its deadline closes as timed out when the member next lists.
  const c = await member(db, MEMBER, `/exams/${exam.uid}/attempts`, { method: 'POST' });
  db.prepare('UPDATE learning_exam_attempts SET started_at = ? WHERE uid = ?').run(longAgo, c.body.attempt.uid);
  const list = await member(db, MEMBER, `/exams/${exam.uid}/attempts`);
  assert.equal(list.body.attempts.find((x: any) => x.uid === c.body.attempt.uid).timed_out, true);
});

// ---- access ----------------------------------------------------------------------------

test('another member\'s attempt is refused, and their attempts and submissions are not listed', async () => {
  const db = seeded();
  const { exam, q1 } = await publishedExam(db);
  const mine = await member(db, MEMBER, `/exams/${exam.uid}/attempts`, { method: 'POST' });
  const theirs = await member(db, OTHER, `/exams/${exam.uid}/attempts/${mine.body.attempt.uid}/submit`, { method: 'POST', body: { answers: { [q1.uid]: [1] } } });
  assert.equal(theirs.status, 404, 'another member submitted my attempt');
  assert.equal((await member(db, OTHER, `/exams/${exam.uid}/attempts`)).body.attempts.length, 0);
  const ex = (await admin(db, SUPER, '/exercises', { method: 'POST', body: { title: 'Write a one-pager', submission_kind: 'text' } })).body.exercise;
  await admin(db, SUPER, `/exercises/${ex.uid}/publish`, { method: 'POST' });
  await member(db, MEMBER, `/exercises/${ex.uid}/submissions`, { method: 'POST', body: { body: 'My one-pager' } });
  const otherView = await member(db, OTHER, `/exercises/${ex.uid}`);
  assert.equal(otherView.body.submissions.length, 0, 'another member saw my submission');
});

test('the read-only review: a member and a plain admin are refused; the Super Admin reads, with no email', async () => {
  const db = seeded();
  const { exam, q1 } = await publishedExam(db);
  const a = await member(db, MEMBER, `/exams/${exam.uid}/attempts`, { method: 'POST' });
  await member(db, MEMBER, `/exams/${exam.uid}/attempts/${a.body.attempt.uid}/submit`, { method: 'POST', body: { answers: { [q1.uid]: [1] } } });
  const ex = (await admin(db, SUPER, '/exercises', { method: 'POST', body: { title: 'One-pager', submission_kind: 'text' } })).body.exercise;
  await admin(db, SUPER, `/exercises/${ex.uid}/publish`, { method: 'POST' });
  await member(db, MEMBER, `/exercises/${ex.uid}/submissions`, { method: 'POST', body: { body: 'Draft one' } });
  for (const who of [MEMBER, PLAIN_ADMIN]) {
    assert.equal((await member(db, who, `/review/exams/${exam.uid}/attempts`)).status, 403);
    assert.equal((await member(db, who, `/review/exercises/${ex.uid}/submissions`)).status, 403);
  }
  const att = await member(db, SUPER, `/review/exams/${exam.uid}/attempts`);
  assert.equal(att.status, 200);
  assert.deepEqual([att.body.attempts[0].learner_name, att.body.attempts[0].learner_uid, att.body.attempts[0].score_percent], ['Mia Member', 'u-mia', 50]);
  const subs = await member(db, SUPER, `/review/exercises/${ex.uid}/submissions`);
  assert.equal(subs.body.submissions[0].body, 'Draft one');
  assert.doesNotMatch(JSON.stringify([att.body, subs.body]), /@example\.test|"email"|"user_id"/, 'the review served an email or an account id');
  assert.ok(!leaks(att.body), 'the review served the correct answers');
});

// ---- exercises -------------------------------------------------------------------------

test('exercises: resubmitting keeps earlier attempts; needs work needs feedback; accepted is final; the actor is recorded', async () => {
  const db = seeded();
  const ex = (await admin(db, SUPER, '/exercises', { method: 'POST', body: { title: 'One-pager', submission_kind: 'text' } })).body.exercise;
  assert.equal((await member(db, MEMBER, `/exercises/${ex.uid}`)).status, 404, 'a draft exercise was readable');
  await admin(db, SUPER, `/exercises/${ex.uid}/publish`, { method: 'POST' });
  const first = (await member(db, MEMBER, `/exercises/${ex.uid}/submissions`, { method: 'POST', body: { body: 'v1' } })).body.submission;
  assert.equal((await admin(db, SUPER, `/submissions/${first.uid}/review`, { method: 'POST', body: { status: 'needs_work' } })).body.error, 'feedback_required');
  assert.equal((await admin(db, PLAIN_ADMIN, `/submissions/${first.uid}/review`, { method: 'POST', body: { status: 'accepted' } })).status, 403);
  await admin(db, SUPER, `/submissions/${first.uid}/review`, { method: 'POST', body: { status: 'needs_work', feedback: 'Add numbers' } });
  const second = (await member(db, MEMBER, `/exercises/${ex.uid}/submissions`, { method: 'POST', body: { body: 'v2' } })).body.submission;
  const view = await member(db, MEMBER, `/exercises/${ex.uid}`);
  assert.deepEqual(view.body.submissions.map((s: any) => [s.body, s.status]), [['v2', 'submitted'], ['v1', 'needs_work']]);
  assert.equal(view.body.submissions[1].feedback, 'Add numbers');
  await admin(db, SUPER, `/submissions/${second.uid}/review`, { method: 'POST', body: { status: 'accepted', feedback: 'Good' } });
  assert.equal((await member(db, MEMBER, `/exercises/${ex.uid}/submissions`, { method: 'POST', body: { body: 'v3' } })).body.error, 'already_accepted');
  const audit = (db.prepare(`SELECT admin_user_id, action FROM admin_audit_log WHERE action LIKE 'learning.%' ORDER BY id`).all() as any[]).map((a) => [a.admin_user_id, a.action]);
  assert.deepEqual(audit, [[SUPER, 'learning.exercise.create'], [SUPER, 'learning.exercise.publish'], [SUPER, 'learning.submission.review'], [SUPER, 'learning.submission.review']]);
  // A checklist takes the indexes of the items done, and only those.
  const cl = (await admin(db, SUPER, '/exercises', { method: 'POST', body: { title: 'Setup', submission_kind: 'checklist', checklist: ['Bank', 'Cap table'] } })).body.exercise;
  await admin(db, SUPER, `/exercises/${cl.uid}/publish`, { method: 'POST' });
  assert.equal((await member(db, MEMBER, `/exercises/${cl.uid}/submissions`, { method: 'POST', body: { checked: [5] } })).body.error, 'bad_answer');
  assert.equal((await member(db, MEMBER, `/exercises/${cl.uid}/submissions`, { method: 'POST', body: { checked: [1, 0, 1] } })).body.submission.body, '[0,1]');
});

test('authoring: only the Super Admin; questions freeze at the first attempt; a draft exam is invisible', async () => {
  const db = seeded();
  assert.equal((await admin(db, MEMBER, '/exams', { method: 'POST', body: { title: 'x' } })).status, 403);
  assert.equal((await admin(db, PLAIN_ADMIN, '/exams', { method: 'POST', body: { title: 'x' } })).status, 403);
  const draft = (await admin(db, SUPER, '/exams', { method: 'POST', body: { title: 'Draft' } })).body.exam;
  assert.equal((await member(db, MEMBER, `/exams/${draft.uid}`)).status, 404);
  assert.equal((await admin(db, SUPER, `/exams/${draft.uid}/publish`, { method: 'POST' })).body.error, 'no_questions');
  assert.equal((await admin(db, SUPER, `/exams/${draft.uid}/questions`, { method: 'POST', body: { prompt: 'p', kind: 'single', options: ['a', 'b'], correct: [0, 1] } })).body.error, 'bad_correct');
  const { exam, q1 } = await publishedExam(db);
  await member(db, MEMBER, `/exams/${exam.uid}/attempts`, { method: 'POST' });
  assert.equal((await admin(db, SUPER, `/exams/${exam.uid}/questions`, { method: 'POST', body: { prompt: 'p', kind: 'single', options: ['a', 'b'], correct: [0] } })).body.error, 'exam_has_attempts');
  assert.equal((await admin(db, SUPER, `/questions/${q1.uid}`, { method: 'PATCH', body: { prompt: 'Changed' } })).body.error, 'exam_has_attempts');
  assert.equal((await admin(db, SUPER, `/questions/${q1.uid}`, { method: 'DELETE' })).body.error, 'exam_has_attempts');
  const tree = (await admin(db, SUPER, `/exams/${exam.uid}`)).body.exam;
  assert.equal(tree.questions[0].prompt, 'Who leads?');
  assert.deepEqual(tree.questions[0].correct, [1], 'the Super Admin\'s own view lost the answers');
  assert.equal(tree.attempt_count, 1);
});
