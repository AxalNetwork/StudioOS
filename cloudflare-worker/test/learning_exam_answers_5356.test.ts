/**
 * #5356 part 2 (D5356) — an open exam attempt's choices are held on the server (the owner's answer B).
 *
 * Pinned: a save is accepted only for the caller's own open, unexpired attempt; the choices are validated against the
 * attempt's questions and options; a revision not above the last is refused 409 with the saved copy, so a delayed
 * request cannot overwrite a newer save; a submitted or expired attempt is refused; another learner's attempt is 404;
 * a resume on a second device returns the saved choices and uses no allowance; saving never grades or reveals.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/learning_exam_answers_5356.test.ts
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
  // D4650 part 2: course metadata. D4650 part 3: question explanations.
  db.exec(sqlOf('202611071012'));
  db.exec(sqlOf('202611071049'));
  // D5356 part 2: the attempt's server-held choices.
  db.exec(sqlOf('202611101028'));
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



const save = (db: DatabaseSync, who: number, examUid: string, attemptUid: string, answers: unknown, revision: unknown) =>
  member(db, who, `/exams/${examUid}/attempts/${attemptUid}/answers`, { method: 'PUT', body: { answers, revision } });
const start = (db: DatabaseSync, who: number, examUid: string) => member(db, who, `/exams/${examUid}/attempts`, { method: 'POST' });

test('a save on the caller\'s own open attempt is kept, and a resume on another device returns it, using no allowance', async () => {
  const db = seeded();
  const { exam, q1, q2 } = await publishedExam(db, { max_attempts: 1 });
  const first = await start(db, MEMBER, exam.uid);
  assert.equal(first.status, 201);
  assert.equal(first.body.draft, null, 'nothing saved yet');
  const a = first.body.attempt.uid;
  const r = await save(db, MEMBER, exam.uid, a, { [q1.uid]: [1], [q2.uid]: [0] }, 1);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.draft.answers, r.body.draft.revision], [{ [q1.uid]: [1], [q2.uid]: [0] }, 1]);
  // The second device: the same start route resumes the open attempt, with the saved choices.
  const resumed = await start(db, MEMBER, exam.uid);
  assert.equal(resumed.status, 200, 'resumed, not a new attempt');
  assert.equal(resumed.body.attempt.uid, a);
  assert.deepEqual([resumed.body.draft.answers, resumed.body.draft.revision], [{ [q1.uid]: [1], [q2.uid]: [0] }, 1]);
  const row = db.prepare('SELECT COUNT(*) AS n, MAX(answers_json) AS submitted, MAX(score_percent) AS score FROM learning_exam_attempts').get() as any;
  assert.deepEqual([row.n, row.submitted, row.score], [1, null, null], 'one attempt, never graded, no allowance used');
  assert.ok(!JSON.stringify(r.body).includes('correct'), 'a save reveals nothing');
});

test('a stale revision is refused with the saved copy; two tabs each land in order', async () => {
  const db = seeded();
  const { exam, q1 } = await publishedExam(db);
  const a = (await start(db, MEMBER, exam.uid)).body.attempt.uid;
  assert.equal((await save(db, MEMBER, exam.uid, a, { [q1.uid]: [2] }, 3)).status, 200);
  // A delayed request from before.
  const late = await save(db, MEMBER, exam.uid, a, { [q1.uid]: [0] }, 2);
  assert.equal(late.status, 409);
  assert.equal(late.body.error, 'stale_revision');
  assert.deepEqual([late.body.draft.answers, late.body.draft.revision], [{ [q1.uid]: [2] }, 3], 'the saved copy comes back');
  // The same revision again (a second tab that counted to the same number) is stale too.
  assert.equal((await save(db, MEMBER, exam.uid, a, { [q1.uid]: [1] }, 3)).status, 409);
  // That tab takes the server's revision and sends once more: it lands.
  assert.equal((await save(db, MEMBER, exam.uid, a, { [q1.uid]: [1] }, 4)).status, 200);
  assert.deepEqual((await start(db, MEMBER, exam.uid)).body.draft.answers, { [q1.uid]: [1] });
});

test('choices are validated against the attempt\'s own questions and options; a bad revision is refused', async () => {
  const db = seeded();
  const { exam, q1, q2 } = await publishedExam(db);
  const a = (await start(db, MEMBER, exam.uid)).body.attempt.uid;
  for (const bad of [{ [q1.uid]: [0, 1] }, { [q1.uid]: [9] }, { [q2.uid]: ['x'] }, [1, 2], 'text']) {
    const r = await save(db, MEMBER, exam.uid, a, bad, 1);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.error, 'bad_answers');
  }
  // A uid that is not in the attempt is dropped, not stored.
  const r = await save(db, MEMBER, exam.uid, a, { [q1.uid]: [1], nope: [0] }, 1);
  assert.deepEqual(r.body.draft.answers, { [q1.uid]: [1] });
  for (const rev of [0, -1, 1.5, 'one', null, 2_000_000_000]) {
    assert.equal((await save(db, MEMBER, exam.uid, a, {}, rev)).body.error, 'bad_revision', String(rev));
  }
});

test('another learner\'s attempt is 404; a submitted or expired attempt is refused and keeps nothing', async () => {
  const db = seeded();
  const { exam, q1 } = await publishedExam(db, { time_limit_minutes: 10 });
  const a = (await start(db, MEMBER, exam.uid)).body.attempt.uid;
  const other = await save(db, OTHER, exam.uid, a, { [q1.uid]: [1] }, 1);
  assert.equal(other.status, 404);
  assert.equal(db.prepare('SELECT draft_answers_json FROM learning_exam_attempts WHERE uid = ?').get(a).draft_answers_json, null);
  // Expired: the clock started an hour ago on a ten-minute exam.
  db.prepare("UPDATE learning_exam_attempts SET started_at = ? WHERE uid = ?").run(new Date(Date.now() - 3_600_000).toISOString(), a);
  const late = await save(db, MEMBER, exam.uid, a, { [q1.uid]: [1] }, 1);
  assert.deepEqual([late.status, late.body.error], [409, 'time_limit_passed']);
  // Submitted.
  const db2 = seeded();
  const e2 = await publishedExam(db2);
  const a2 = (await start(db2, MEMBER, e2.exam.uid)).body.attempt.uid;
  assert.equal((await member(db2, MEMBER, `/exams/${e2.exam.uid}/attempts/${a2}/submit`, { method: 'POST', body: { answers: { [e2.q1.uid]: [1] } } })).status, 200);
  const after = await save(db2, MEMBER, e2.exam.uid, a2, { [e2.q1.uid]: [0] }, 1);
  assert.deepEqual([after.status, after.body.error], [409, 'already_submitted']);
  assert.equal(db2.prepare('SELECT draft_answers_json FROM learning_exam_attempts WHERE uid = ?').get(a2).draft_answers_json, null);
});

test('a database before the migration still starts attempts, and a save says it is not recorded', async () => {
  const db = seeded();
  const { exam, q1 } = await publishedExam(db);
  db.exec('ALTER TABLE learning_exam_attempts DROP COLUMN draft_saved_at; ALTER TABLE learning_exam_attempts DROP COLUMN draft_revision; ALTER TABLE learning_exam_attempts DROP COLUMN draft_answers_json;');
  const s = await start(db, MEMBER, exam.uid);
  assert.deepEqual([s.status, s.body.draft], [201, null]);
  const r = await save(db, MEMBER, exam.uid, s.body.attempt.uid, { [q1.uid]: [1] }, 1);
  assert.deepEqual([r.status, r.body.error], [503, 'drafts_not_recorded']);
});
