/**
 * D6225 (#6225) — questions about a sent report (`/api/report-questions`,
 * routes/report_questions.ts, over migration
 * 202611272118_6225_report_questions.sql), on real SQLite over the baseline
 * and every later migration. Every person, company and figure is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/report_questions_6225.test.ts
 *
 * Who: FOUNDER and COFOUNDER run proj-seven; INV_A and INV_B each received its
 * Q3 report; STRANGER received only another company's report; ADVISOR is an
 * accepted advisor of proj-seven; OTHER_FOUNDER runs proj-eight.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import questions, { QUESTION_REFUSALS, mount } from '../src/routes/report_questions.ts';
import { loadSchema } from './_schema_once.mjs';

const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const out = (db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END").all() as any[]).map((x) => x.sql as string);
  db.close();
  return out;
})();
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-d6225';

const app = new Hono<any>();
app.route('/api/report-questions', questions);

const ADMIN = 1, FOUNDER = 3, COFOUNDER = 4, ADVISOR = 5, INV_A = 6, INV_B = 7, STRANGER = 9, OTHER_FOUNDER = 10;
const ROLE: Record<number, string> = { 1: 'admin', 3: 'founder', 4: 'founder', 5: 'advisor', 6: 'investor', 7: 'investor', 9: 'investor', 10: 'founder' };
const Q3 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3';
const DRAFT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb8';
const AT = (uid: string) => `/api/report-questions/reports/${uid}`;
const FIGURES = JSON.stringify([{ key: 'mrr', label: 'MRR', value: 44100 }, { key: 'runway_months', label: 'Runway', value: 14 }]);

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  DDL.forEach((s) => db.exec(s));
  db.exec(`
    INSERT INTO founders (id, name, email) VALUES (31, 'Fay Founder', 'fay@example.test'), (32, 'Oli Other', 'oli@example.test');
    INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES
      (1, 'admin', 'Ada Admin', 'ada@example.test', NULL, 1), (3, 'founder', 'Fay Founder', 'fay@example.test', 31, 1),
      (4, 'founder', 'Cal Cofounder', 'cal@example.test', NULL, 1), (5, 'advisor', 'Avi Advisor', 'avi@example.test', NULL, 1),
      (6, 'investor', 'Ivy Alpha', 'ivy@example.test', NULL, 1), (7, 'investor', 'Ben Beta', 'ben@example.test', NULL, 1),
      (9, 'investor', 'Sam Stranger', 'sam@example.test', NULL, 1), (10, 'founder', 'Oli Other', 'oli@example.test', 32, 1);
    INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'proj-seven', 'Fixture Robotics', 31), (8, 'proj-eight', 'Other Venture', 32);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (7, 4, 'cofounder', 'accepted'), (7, 5, 'advisor', 'accepted');
    INSERT INTO portfolio_updates (id, uid, project_id, author_user_id, period, title, status, kind, sent_at, figures_json) VALUES
      (1, '${Q3}', 7, 3, 'Q3 2026', 'Q3', 'submitted', 'report', '2026-11-10 10:00:00', '${FIGURES}'),
      (2, '${DRAFT}', 7, 3, 'Q4 2026', 'Q4', 'draft', 'report', NULL, '[]'),
      (3, '${OTHER}', 8, 10, 'Q3 2026', 'Q3 other', 'submitted', 'report', '2026-11-10 10:00:00', '[]');
    INSERT INTO update_recipients (update_id, audience, user_id) VALUES (1, 'investor', 6), (1, 'investor', 7), (2, 'investor', 6), (3, 'investor', 9);
  `);
  return db;
}

const envOf = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) }) as any;
async function token(user: number, extra: Record<string, unknown> = {}) {
  return new SignJWT({ user_id: user, role: ROLE[user], ...extra }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
async function call(env: any, method: string, path: string, as: number, body?: unknown, claims: Record<string, unknown> = {}) {
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${await token(as, claims)}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}
const stored = (db: DatabaseSync) => JSON.parse(JSON.stringify(db.prepare('SELECT asker_user_id, body, answer_body, answered_by_user_id, read_at IS NOT NULL AS read, withdrawn_at IS NOT NULL AS withdrawn FROM report_questions ORDER BY id').all()));
const inbox = (db: DatabaseSync) => JSON.parse(JSON.stringify(db.prepare('SELECT user_id, type, link FROM notifications_inbox ORDER BY id').all()));

test('the router mounts itself at /api/report-questions', () => {
  assert.equal((mount as any).path, '/api/report-questions');
  assert.equal((mount as any).router, questions);
});

test('the migration: one question per row, 1–600 characters, one answer of 1–1,200 that is never edited, never both answered and withdrawn', () => {
  const db = freshDb();
  const cols = (db.prepare("SELECT name FROM pragma_table_info('report_questions')").all() as any[]).map((c) => c.name);
  assert.deepEqual(cols, ['id', 'uid', 'update_id', 'project_id', 'asker_user_id', 'figure_key', 'body', 'read_at', 'withdrawn_at', 'answer_body', 'answered_by_user_id', 'answered_at', 'created_at']);
  const ins = (uid: string, body: string) => db.prepare('INSERT INTO report_questions (uid, update_id, project_id, asker_user_id, body) VALUES (?, 1, 7, 6, ?)').run(uid, body);
  ins('q1', 'Why did runway fall?');
  assert.throws(() => ins('q2', '   '), /CHECK/);
  assert.throws(() => ins('q3', 'x'.repeat(601)), /CHECK/);
  assert.throws(() => ins('q1', 'same uid'), /UNIQUE/);
  assert.throws(() => db.prepare("UPDATE report_questions SET answer_body = 'half' WHERE uid = 'q1'").run(), /CHECK/);
  db.prepare("UPDATE report_questions SET answer_body = 'Hiring.', answered_by_user_id = 3, answered_at = '2026-11-12T10:00:00Z' WHERE uid = 'q1'").run();
  assert.throws(() => db.prepare("UPDATE report_questions SET answer_body = 'Changed' WHERE uid = 'q1'").run(), /never edited/);
  assert.throws(() => db.prepare("UPDATE report_questions SET withdrawn_at = '2026-11-13' WHERE uid = 'q1'").run(), /CHECK/);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_report_questions_report'").get());
});

test('each investor reads only their own thread; the founders read every thread, and the asker’s name only they see', async () => {
  const db = freshDb(); const env = envOf(db);
  const a = await call(env, 'POST', AT(Q3), INV_A, { body: '  Why did runway fall?  ', figure_key: 'runway_months' });
  assert.equal(a.status, 201, a.text);
  assert.equal(a.body.question.body, 'Why did runway fall?');
  assert.equal(a.body.question.figure_key, 'runway_months');
  assert.equal(a.body.question.state, 'sent');
  assert.ok(!('asker' in a.body.question), 'the asker is not named back to an investor');
  const b = await call(env, 'POST', AT(Q3), INV_B, { body: 'What is the hiring plan?' });
  assert.equal(b.status, 201, b.text);

  const mineA = await call(env, 'GET', AT(Q3), INV_A);
  assert.equal(mineA.status, 200);
  assert.equal(mineA.body.view, 'asker');
  assert.equal(mineA.body.can_ask, true);
  assert.equal(mineA.body.can_reply, false);
  assert.deepEqual(mineA.body.questions.map((q: any) => q.body), ['Why did runway fall?']);
  assert.ok(!mineA.text.includes('Ben Beta') && !mineA.text.includes('hiring plan'), 'nothing of the other investor');
  const mineB = await call(env, 'GET', AT(Q3), INV_B);
  assert.deepEqual(mineB.body.questions.map((q: any) => q.body), ['What is the hiring plan?']);

  // INV_B cannot withdraw INV_A's question: the same 404 as none.
  const steal = await call(env, 'POST', `/api/report-questions/questions/${a.body.question.uid}/withdraw`, INV_B);
  assert.equal(steal.status, 404);
  assert.equal(steal.body.error, 'question_not_found');

  const team = await call(env, 'GET', AT(Q3), COFOUNDER);
  assert.equal(team.status, 200);
  assert.equal(team.body.view, 'team');
  assert.equal(team.body.can_reply, true);
  assert.equal(team.body.can_ask, false);
  assert.deepEqual(team.body.questions.map((q: any) => [q.asker.name, q.state]), [['Ivy Alpha', 'sent'], ['Ben Beta', 'sent']]);
  // That first read marked them read: the next read says so, and so does the investor's.
  const again = await call(env, 'GET', AT(Q3), FOUNDER);
  assert.deepEqual(again.body.questions.map((q: any) => q.state), ['read', 'read']);
  assert.equal((await call(env, 'GET', AT(Q3), INV_A)).body.questions[0].state, 'read');
});

test('a question tells every founder, and an answer tells only the asker', async () => {
  const db = freshDb(); const env = envOf(db);
  const a = await call(env, 'POST', AT(Q3), INV_A, { body: 'Why did runway fall?' });
  assert.equal(a.body.founders_told, 2);
  assert.deepEqual(inbox(db).map((n: any) => [n.user_id, n.type]), [[FOUNDER, 'reporting_question_asked'], [COFOUNDER, 'reporting_question_asked']]);
  assert.equal(inbox(db)[0].link, `/grow/reporting/${Q3}?project_id=7#questions`);

  const reply = await call(env, 'POST', `/api/report-questions/questions/${a.body.question.uid}/reply`, COFOUNDER, { body: 'Two senior hires in August.' });
  assert.equal(reply.status, 200, reply.text);
  assert.equal(reply.body.question.state, 'answered');
  assert.equal(reply.body.question.answer.body, 'Two senior hires in August.');
  assert.equal(reply.body.question.answer.by, 'Cal Cofounder');
  assert.equal(reply.body.asker_told, true);
  const after = inbox(db).slice(2);
  assert.deepEqual(after.map((n: any) => [n.user_id, n.type, n.link]), [[INV_A, 'reporting_question_answered', '/portfolio/companies/proj-seven/reports']]);

  const read = await call(env, 'GET', AT(Q3), INV_A);
  assert.equal(read.body.questions[0].state, 'answered');
  assert.equal(read.body.questions[0].answer.by, 'Cal Cofounder');
  // A reply is never edited, and an answered question is not withdrawn.
  const twice = await call(env, 'POST', `/api/report-questions/questions/${a.body.question.uid}/reply`, FOUNDER, { body: 'Another answer' });
  assert.equal(twice.status, 409);
  assert.equal(twice.body.error, 'already_answered');
  assert.equal(twice.body.message, QUESTION_REFUSALS.already_answered);
  assert.equal((await call(env, 'POST', `/api/report-questions/questions/${a.body.question.uid}/withdraw`, INV_A)).body.error, 'already_answered');
  assert.equal(stored(db)[0].answer_body, 'Two senior hires in August.');
});

test('a non-recipient, another company’s founder and a draft are refused; the investor cannot answer, an advisor and an admin only read', async () => {
  const db = freshDb(); const env = envOf(db);
  const a = await call(env, 'POST', AT(Q3), INV_A, { body: 'Why did runway fall?' });
  const reply = `/api/report-questions/questions/${a.body.question.uid}/reply`;

  for (const who of [STRANGER, OTHER_FOUNDER]) {
    const read = await call(env, 'GET', AT(Q3), who);
    assert.equal(read.status, 404, `GET as ${who}`);
    assert.equal(read.body.error, 'not_found');
    assert.equal((await call(env, 'POST', AT(Q3), who, { body: 'Let me in' })).status, 404, `ask as ${who}`);
    const r = await call(env, 'POST', reply, who, { body: 'Not mine to answer' });
    assert.equal(r.status, 404, `reply as ${who}`);
    assert.equal(r.body.error, 'question_not_found');
  }
  // A recipient of a draft (never sent) has nothing to ask about.
  assert.equal((await call(env, 'POST', AT(DRAFT), INV_A, { body: 'Early?' })).status, 404);
  // The other company's founder answers nothing here, and reads their own report's empty list.
  assert.deepEqual((await call(env, 'GET', AT(OTHER), OTHER_FOUNDER)).body.questions, []);

  const own = await call(env, 'POST', reply, INV_A, { body: 'Answering myself' });
  assert.equal(own.status, 403);
  assert.equal(own.body.error, 'founders_only');
  assert.equal((await call(env, 'POST', AT(Q3), FOUNDER, { body: 'A founder asking' })).body.error, 'recipients_only');

  for (const who of [ADVISOR, ADMIN]) {
    const read = await call(env, 'GET', AT(Q3), who);
    assert.equal(read.status, 200, `GET as ${who}: ${read.text}`);
    assert.equal(read.body.view, 'read_only');
    assert.equal(read.body.can_reply, false);
    assert.equal(read.body.can_ask, false);
    assert.equal(read.body.questions.length, 1);
    const r = await call(env, 'POST', reply, who, { body: 'Read-only answer' });
    assert.equal(r.status, 403, `reply as ${who}`);
    assert.equal(r.body.error, 'founders_only');
  }
  assert.deepEqual(stored(db).map((q: any) => [q.asker_user_id, q.answer_body, q.read]), [[INV_A, null, 0]], 'nobody but the asker wrote; a read-only read marks nothing read');
});

test('a support session reads and writes nothing; the founders’ read in one marks nothing read', async () => {
  const db = freshDb(); const env = envOf(db);
  const a = await call(env, 'POST', AT(Q3), INV_A, { body: 'Why did runway fall?' });
  const support = { impersonated_by: ADMIN };
  const read = await call(env, 'GET', AT(Q3), INV_A, undefined, support);
  assert.equal(read.status, 200);
  assert.equal(read.body.can_ask, false);
  assert.equal(read.body.write_refusal, QUESTION_REFUSALS.support_session_refused);
  const ask = await call(env, 'POST', AT(Q3), INV_A, { body: 'From support' }, support);
  assert.equal(ask.status, 403);
  assert.equal(ask.body.error, 'support_session_refused');
  assert.equal((await call(env, 'POST', `/api/report-questions/questions/${a.body.question.uid}/withdraw`, INV_A, undefined, support)).status, 403);
  const teamRead = await call(env, 'GET', AT(Q3), FOUNDER, undefined, support);
  assert.equal(teamRead.body.can_reply, false);
  const r = await call(env, 'POST', `/api/report-questions/questions/${a.body.question.uid}/reply`, FOUNDER, { body: 'From support' }, support);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'support_session_refused');
  assert.deepEqual(stored(db), [{ asker_user_id: INV_A, body: 'Why did runway fall?', answer_body: null, answered_by_user_id: null, read: 0, withdrawn: 0 }]);
});

test('input: lengths, a figure not in the report, the per-report cap, and a withdrawn question cannot be answered', async () => {
  const db = freshDb(); const env = envOf(db);
  assert.equal((await call(env, 'POST', AT(Q3), INV_A, { body: '   ' })).body.error, 'invalid_question');
  assert.equal((await call(env, 'POST', AT(Q3), INV_A, { body: 'x'.repeat(601) })).body.error, 'invalid_question');
  assert.equal((await call(env, 'POST', AT(Q3), INV_A, { body: 'x'.repeat(600) })).status, 201);
  assert.equal((await call(env, 'POST', AT(Q3), INV_A, { body: 'Burn?', figure_key: 'burn' })).body.error, 'invalid_figure');
  const w = await call(env, 'POST', AT(Q3), INV_A, { body: 'Never mind this one' });
  const withdrawn = await call(env, 'POST', `/api/report-questions/questions/${w.body.question.uid}/withdraw`, INV_A);
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.body.question.state, 'withdrawn');
  const late = await call(env, 'POST', `/api/report-questions/questions/${w.body.question.uid}/reply`, FOUNDER, { body: 'Too late' });
  assert.equal(late.status, 409);
  assert.equal(late.body.error, 'question_withdrawn');
  assert.equal((await call(env, 'POST', `/api/report-questions/questions/${w.body.question.uid}/reply`, FOUNDER, { body: 'x'.repeat(1201) })).body.error, 'invalid_reply');
  for (let i = 0; i < 48; i += 1) db.prepare('INSERT INTO report_questions (uid, update_id, project_id, asker_user_id, body) VALUES (?, 1, 7, 6, ?)').run(`fill${i}`, `q ${i}`);
  const over = await call(env, 'POST', AT(Q3), INV_A, { body: 'One more' });
  assert.equal(over.status, 409);
  assert.equal(over.body.error, 'too_many_questions');
  assert.equal((await call(env, 'POST', AT(Q3), INV_B, { body: 'Mine is separate' })).status, 201, 'the cap is per investor');
});

test('a failed read is a 503 with a sentence, never an empty thread', async () => {
  const db = freshDb();
  db.exec('DROP TABLE report_questions');
  const res = await call(envOf(db), 'GET', AT(Q3), INV_A);
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'questions_unreadable');
  assert.ok(!/no such table/i.test(res.text), 'the database error is not sent');
});
