/**
 * #4650 part 3 (D4650) — an exam question's explanation and revision links,
 * through the studio (`admin_learning_assessment.ts`) and the member's attempt
 * (`learning_assessment.ts`), over the Learning migrations and 202611071049.
 *
 *   1. the author writes an explanation and links, on a new question and on its own;
 *   2. the explanation can be written after the first attempt; the question itself stays fixed;
 *   3. a member sees explanations only beside revealed answers: never while an
 *      attempt is open, never on a score-only exam, and only for questions that have one;
 *   4. the attempt's own reveal policy decides (D4643), not the exam's current one;
 *   5. bad values are refused with their own codes.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/learning_explanations_4650.test.ts
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
const MIGRATIONS = resolve(HERE, '../sql/migrations');
const sqlOf = (n: string) => readFileSync(resolve(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.startsWith(`${n}_`)) as string), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1, MEMBER = 10;
const ROLE: Record<number, string> = { [SUPER]: 'admin', [MEMBER]: 'founder' };
const WHY = 'The lead investor sets the terms; the others follow.';

function seeded(): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db, { below: 388 });
  for (const n of ['388', '389', '390', '202611062214', '202611071049']) db.exec(sqlOf(n));
  db.exec(`INSERT INTO users (id, uid, email, name, role, is_active) VALUES
      (${SUPER}, 'u-super', 'super@example.test', 'Super Holder', 'admin', 1),
      (${MEMBER}, 'u-mia', 'mia@example.test', 'Mia Member', 'founder', 1);
    INSERT INTO super_admins (user_id) VALUES (${SUPER});`);
  return db;
}

async function call(app: any, db: DatabaseSync, who: number, path: string, init: { method?: string; body?: unknown } = {}) {
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res: Response = await app.request(path, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  const raw = await res.text();
  let body: any = null; try { body = JSON.parse(raw); } catch { body = null; }
  return { status: res.status, body, raw };
}
const admin = (db: DatabaseSync, path: string, init?: { method?: string; body?: unknown }) => call(adminAssessment, db, SUPER, path, init);
const member = (db: DatabaseSync, path: string, init?: { method?: string; body?: unknown }) => call(learningAssessment, db, MEMBER, path, init);

/** A published exam: q1 explained with two links, q2 with nothing. */
async function exam(db: DatabaseSync, reveal: 'score' | 'score_and_answers') {
  const e = (await admin(db, '/exams', { method: 'POST', body: { title: 'Term sheets', pass_mark_percent: 50, reveal } })).body.exam;
  await admin(db, `/exams/${e.uid}/questions`, { method: 'POST', body: {
    prompt: 'Who leads?', kind: 'single', options: ['Founder', 'Lead investor'], correct: [1],
    explanation: WHY, revision: [{ title: 'Term sheets, lesson 2', url: '/learning/courses/seed/term-sheets' }, { title: 'A worked example', url: 'https://example.com/term-sheet' }],
  } });
  const tree = (await admin(db, `/exams/${e.uid}/questions`, { method: 'POST', body: { prompt: 'Which are terms?', kind: 'multiple', options: ['Valuation', 'Weather'], correct: [0] } })).body.exam;
  await admin(db, `/exams/${e.uid}/publish`, { method: 'POST' });
  return { exam: e, q1: tree.questions[0], q2: tree.questions[1] };
}
const start = (db: DatabaseSync, uid: string) => member(db, `/exams/${uid}/attempts`, { method: 'POST' });
const submit = (db: DatabaseSync, uid: string, attempt: string, answers: Record<string, number[]>) =>
  member(db, `/exams/${uid}/attempts/${attempt}/submit`, { method: 'POST', body: { answers } });

test('1. the author writes an explanation and links, on a new question and on its own', async () => {
  // Mutation checked: the INSERT not binding the explanation → the tree's q1 explanation is null.
  const db = seeded();
  const { exam: e, q1, q2 } = await exam(db, 'score_and_answers');
  assert.equal(q1.explanation, WHY);
  assert.equal(q1.revision.length, 2);
  assert.deepEqual([q2.explanation, q2.revision], [null, []]);
  const put = await admin(db, `/questions/${q2.uid}/explanation`, { method: 'PUT', body: { explanation: '  Weather is not a term.  ' } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const q2After = put.body.exam.questions.find((q: any) => q.uid === q2.uid);
  assert.deepEqual([q2After.explanation, q2After.revision], ['Weather is not a term.', []]);
  // PUT replaces both: a key left out clears it.
  const cleared = await admin(db, `/questions/${q1.uid}/explanation`, { method: 'PUT', body: { revision: [] } });
  assert.deepEqual([cleared.body.exam.questions[0].explanation, cleared.body.exam.questions[0].revision], [null, []]);
  assert.equal((await admin(db, `/exams/${e.uid}`)).body.exam.questions[1].explanation, 'Weather is not a term.');
});

test('2. an explanation can be written after the first attempt; the question itself stays fixed', async () => {
  // Mutation checked: the PUT guarded by NOT EXISTS (an attempt) → 409 here.
  const db = seeded();
  const { exam: e, q2 } = await exam(db, 'score_and_answers');
  await start(db, e.uid);
  const frozen = await admin(db, `/questions/${q2.uid}`, { method: 'PATCH', body: { prompt: 'Changed?' } });
  assert.equal(frozen.status, 409);
  const explained = await admin(db, `/questions/${q2.uid}/explanation`, { method: 'PUT', body: { explanation: 'Only valuation is a term here.' } });
  assert.equal(explained.status, 200);
  assert.equal(explained.body.exam.questions[1].explanation, 'Only valuation is a term here.');
  assert.equal(explained.body.exam.questions[1].prompt, 'Which are terms?');
});

test('3. a member sees explanations only beside revealed answers, and only for questions that have one', async () => {
  // Mutation checked: explanations added to the hidden branch of attemptView → the score-only submit carries them.
  const db = seeded();
  const { exam: e, q1, q2 } = await exam(db, 'score_and_answers');
  const open = await start(db, e.uid);
  assert.equal(open.raw.includes(WHY), false, 'an open attempt never carries an explanation');
  const done = await submit(db, e.uid, open.body.attempt.uid, { [q1.uid]: [0] });
  assert.equal(done.body.attempt.answers_revealed, true);
  assert.deepEqual(Object.keys(done.body.attempt.explanations), [q1.uid], 'only the explained question');
  assert.equal(done.body.attempt.explanations[q1.uid].explanation, WHY);
  assert.deepEqual(done.body.attempt.explanations[q1.uid].revision.map((l: any) => l.url), ['/learning/courses/seed/term-sheets', 'https://example.com/term-sheet']);
  assert.equal(done.body.attempt.explanations[q2.uid], undefined);

  const hidden = seeded();
  const h = await exam(hidden, 'score');
  const a = await start(hidden, h.exam.uid);
  const scored = await submit(hidden, h.exam.uid, a.body.attempt.uid, { [h.q1.uid]: [1] });
  assert.equal(scored.body.attempt.answers_revealed, false);
  assert.equal(scored.raw.includes(WHY), false, 'a score-only exam never sends an explanation');
  assert.equal(scored.body.attempt.explanations, undefined);
  const listed = await member(hidden, `/exams/${h.exam.uid}/attempts`);
  assert.equal(listed.raw.includes(WHY), false);
});

test('4. the attempt\'s own reveal policy decides, not the exam\'s current one', async () => {
  // Mutation checked: attemptView reading exam.reveal instead of policyOf → the explanation leaks after the exam is switched.
  const db = seeded();
  const { exam: e, q1 } = await exam(db, 'score');
  const a = await start(db, e.uid);
  await admin(db, `/exams/${e.uid}`, { method: 'PATCH', body: { reveal: 'score_and_answers' } });
  const done = await submit(db, e.uid, a.body.attempt.uid, { [q1.uid]: [1] });
  assert.equal(done.body.attempt.answers_revealed, false);
  assert.equal(done.raw.includes(WHY), false, 'started under score, it stays hidden');
});

test('5. bad values are refused with their own codes', async () => {
  // Mutation checked: http links allowed → the first case answers 200.
  const db = seeded();
  const { q1 } = await exam(db, 'score_and_answers');
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ revision: [{ title: 'Old', url: 'http://example.com' }] }, 'bad_revision'],
    [{ revision: [{ title: 'Script', url: 'javascript:alert(1)' }] }, 'bad_revision'],
    [{ revision: [{ title: 'Up', url: '/admin/learning' }] }, 'bad_revision'],
    [{ revision: Array.from({ length: 6 }, (_, i) => ({ title: `L${i}`, url: 'https://example.com' })) }, 'bad_revision'],
    [{ revision: [{ title: 'x'.repeat(121), url: 'https://example.com' }] }, 'bad_revision'],
    [{ explanation: 'x'.repeat(1001) }, 'bad_explanation'],
    [{ explanation: 7 }, 'bad_explanation'],
  ];
  for (const [body, code] of cases) {
    const r = await admin(db, `/questions/${q1.uid}/explanation`, { method: 'PUT', body });
    assert.deepEqual([r.status, r.body?.error], [400, code], JSON.stringify(body));
  }
  assert.equal((await admin(db, '/questions/q-none/explanation', { method: 'PUT', body: {} })).status, 404);
});
