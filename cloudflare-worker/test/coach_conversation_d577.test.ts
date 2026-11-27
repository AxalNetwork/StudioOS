/** D577: real Eadwyn routes, JWT auth and SQLite answer ledger. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import advisor from '../src/routes/advisor.ts';
import { BANKS, bankFor, profilingBankFor } from '../src/services/advisor/questionBank.ts';
import { computeProfilingCompletion } from '../src/services/advisor/profilingModules.ts';

import { withGuard } from './_guard_stub.mjs';
import { AI_BUDGET_MIGRATION, AI_LOG_SCHEMA } from './_ai_budget_fixture.mjs';
const secret = 'test-coach-routing-secret-0123456789';
function setup(rate: number | null = 50, active = 1, role = 'advisor') {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, is_active INTEGER, jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE advisors (id INTEGER PRIMARY KEY, user_id INTEGER, is_active INTEGER, hourly_rate_usd REAL);
    INSERT INTO users VALUES (7, '${role}', 1, 0, 'Test member', 'member@example.test');
    INSERT INTO users VALUES (8, 'advisor', 1, 0, 'Other member', 'other@example.test');`);
  db.prepare('INSERT INTO advisors VALUES (1, 7, ?, ?)').run(active, rate);
  // D763: `/answer`'s guard is a run of its own, held against the member's AI budget.
  db.exec(AI_LOG_SCHEMA + AI_BUDGET_MIGRATION);
  db.exec(`INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES('${role}',1000000,1000000,7);`);
  const DB: any = {
    prepare(sql: string) {
      let args: any[] = [];
      const st: any = {
        bind(...values: any[]) { args = values; return st; },
        async first() { return db.prepare(sql).get(...args) || null; },
        async all() { return { success: true, results: db.prepare(sql).all(...args) }; },
        async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
      };
      return st;
    },
    async exec(sql: string) { db.exec(sql); return {}; },
    async batch(statements: any[]) { return Promise.all(statements.map(s => s.run())); },
  };
  // D763: `/answer` checks the typed value with the guard, which fails closed; it answers safe here.
  const env: any = { DB, JWT_SECRET: secret, AI: withGuard({ run: async () => { throw new Error('no model runs in this test'); } }) };
  async function call(path: string, method = 'GET', userId = 7, body?: any) {
    const token = await new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
    const res = await advisor.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, env, { waitUntil() {}, passThroughOnException() {} } as any);
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  return { db, env, call };
}
function answer(db: DatabaseSync, conv: number, id: string, status = 'saved', user = 7) {
  db.prepare(`INSERT INTO advisor_answers (conversation_id,user_id,question_id,raw_value,saved_status,answered_at) VALUES (?,?,?,'4',?,datetime('now'))`).run(conv, user, id, status);
}

for (const [name, rate, active, role, expected] of [
  ['paid active', 50, 1, 'advisor', 'coach'],
  ['free active', 0, 1, 'advisor', 'advisor'],
  ['unpriced active', null, 1, 'advisor', 'advisor'],
  ['negative price', -1, 1, 'advisor', 'advisor'],
  ['paid inactive', 50, 0, 'advisor', 'advisor'],
  ['founder with paid listing', 50, 1, 'founder', 'founder'],
] as const) {
  test(`${name} routes by the owner-approved marker`, async () => {
    const { db, call } = setup(rate, active, role);
    try {
      const r = await call('/manifest');
      assert.equal(r.status, 200);
      assert.equal(r.body.persona, expected);
      assert.deepEqual(r.body.questions.map((q: any) => q.id), bankFor(expected).map(q => q.id));
      assert.equal(db.prepare('SELECT role FROM users WHERE id=7').get()!.role, role);
    } finally { db.close(); }
  });
}

test('each profiling conversation uses its unchanged bank and module floors', () => {
  for (const [persona, bank] of [['coach', BANKS.fitCoach], ['advisor', BANKS.fitAdvisor]] as const) {
    assert.deepEqual(profilingBankFor(persona), bank);
    assert.deepEqual(bankFor(persona).filter(q => q.id.startsWith('fit.')), bank);
    assert.deepEqual(computeProfilingCompletion(profilingBankFor(persona), new Set()).modules.map(m => [m.key, m.required]), [['skills', 5], ['work_values', 4], ['archetype', 6], ['axal_fit', 8]]);
  }
});

test('legacy coach answers appear, count and are not re-asked; price flips preserve both banks', async () => {
  const { db, call } = setup(0);
  try {
    const legacy = await call('/start', 'POST');
    assert.equal(legacy.status, 200);
    const conv = Number(db.prepare('SELECT id FROM advisor_conversations').get()!.id);
    const coachId = BANKS.fitCoach[0].id;
    const advisorId = BANKS.fitAdvisor[0].id;
    answer(db, conv, coachId, 'noop');
    answer(db, conv, advisorId);
    db.exec("INSERT INTO advisor_conversations (uid,user_id,persona,state) VALUES ('other-member',8,'advisor','complete')");
    const other = Number(db.prepare("SELECT id FROM advisor_conversations WHERE user_id=8").get()!.id);
    answer(db, other, BANKS.fitCoach[1].id, 'saved', 8);
    db.exec('UPDATE advisors SET hourly_rate_usd=50 WHERE user_id=7');
    const coach = await call('/start', 'POST');
    assert.equal(coach.body.persona, 'coach');
    assert.equal(coach.body.progress.answered, 1);
    assert.equal(coach.body.next_question.id.startsWith('fit.coach.'), true);
    assert.notEqual(coach.body.next_question.id, coachId);
    const captured = await call('/answered');
    assert.deepEqual(captured.body.answered.map((q: any) => q.question_id), [coachId]);
    const progress = await call('/progress');
    assert.equal(progress.body.profiling.answered, 1);
    const queue = await call('/queue');
    assert.equal(queue.body.persona, 'coach');
    assert.ok(queue.body.queue.length > 0);
    assert.equal(queue.body.queue.every((q: any) => q.id.startsWith('fit.coach.') && q.id !== coachId), true);
    db.exec('UPDATE advisors SET hourly_rate_usd=0 WHERE user_id=7');
    const free = await call('/start', 'POST');
    assert.equal(free.body.persona, 'advisor');
    assert.equal(free.body.progress.answered, 1);
    assert.deepEqual((await call('/answered')).body.answered.map((q: any) => q.question_id), [advisorId]);
    db.exec("UPDATE advisor_conversations SET state='complete'; UPDATE advisors SET hourly_rate_usd=50 WHERE user_id=7");
    const restarted = await call('/start', 'POST');
    assert.equal(restarted.body.progress.answered, 1);
    assert.notEqual(restarted.body.next_question.id, coachId);
    assert.deepEqual((await call('/answered')).body.answered.map((q: any) => q.question_id), [coachId]);
    assert.equal(Number(db.prepare('SELECT count(*) AS n FROM advisor_answers').get()!.n), 3);
  } finally { db.close(); }
});

test('switching from a completed advisor chat does not show coach as complete or pin an advisor question', async () => {
  const { db, call } = setup(0);
  try {
    await call('/start', 'POST');
    db.exec("UPDATE advisor_conversations SET state='complete'; UPDATE advisors SET hourly_rate_usd=50");
    const before = await call('/progress');
    assert.equal(before.body.persona, 'coach');
    assert.equal(before.body.complete, false);
    assert.equal(before.body.overall.complete, false);
    assert.equal(before.body.current_question_id, null);
    const turn = await call('/turn', 'POST');
    assert.equal(turn.body.persona, 'coach');
    assert.equal(turn.body.next_question.id.startsWith('fit.coach.'), true);
  } finally { db.close(); }
});

test('carryover deduplicates IDs, excludes failed replies and retains skips without calling them answers', async () => {
  const { db, call } = setup();
  try {
    await call('/start', 'POST');
    const conv = Number(db.prepare('SELECT id FROM advisor_conversations').get()!.id);
    const id = BANKS.fitCoach[0].id;
    answer(db, conv, id);
    answer(db, conv, BANKS.fitCoach[1].id, 'skipped');
    answer(db, conv, BANKS.fitCoach[2].id, 'failed');
    db.exec("UPDATE advisor_conversations SET state='complete'");
    await call('/start', 'POST');
    const newer = Number(db.prepare('SELECT max(id) AS id FROM advisor_conversations').get()!.id);
    answer(db, newer, id, 'noop');
    const captured = await call('/answered');
    assert.deepEqual(captured.body.answered.map((q: any) => [q.question_id, q.saved_status]), [[id, 'noop']]);
    const progress = await call('/progress');
    assert.equal(progress.body.answered, 1);
    assert.equal(progress.body.skipped, 1);
    assert.equal(progress.body.profiling.answered, 1);
    const queue = await call('/queue');
    assert.equal(queue.body.queue.some((q: any) => q.id === id || q.id === BANKS.fitCoach[1].id), false);
    assert.equal(Number(db.prepare('SELECT count(*) AS n FROM advisor_answers').get()!.n), 4);
  } finally { db.close(); }
});

test('coach answer and skip advance only the coach bank; unasked advisor questions are refused', async () => {
  const { db, call } = setup();
  try {
    const started = await call('/start', 'POST');
    const uid = started.body.conversation_uid;
    const forbidden = await call('/answer', 'POST', 7, { conversation_id: uid, question_id: BANKS.fitAdvisor[0].id, value: '4' });
    assert.equal(forbidden.status, 409);
    const saved = await call('/answer', 'POST', 7, { conversation_id: uid, question_id: started.body.next_question.id, value: '4' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.persona, 'coach');
    assert.equal(saved.body.next_question.id.startsWith('fit.coach.'), true);
    const skipped = await call('/skip', 'POST', 7, { conversation_id: uid, question_id: saved.body.next_question.id });
    assert.equal(skipped.status, 200);
    assert.equal(skipped.body.next_question.id.startsWith('fit.coach.'), true);
    const next = await call('/next-question');
    assert.equal(next.body.persona, 'coach');
    assert.equal(next.body.next_question.id.startsWith('fit.coach.'), true);
  } finally { db.close(); }
});

test('coach tool permissions stay at advisor scope and the emergency kill skips listing reads', async () => {
  const { db, env, call } = setup();
  try {
    await call('/start', 'POST');
    const denied = await call('/tool', 'POST', 7, { name: 'findInvestor', args: {} });
    assert.equal(denied.status, 403);
    let listingReads = 0;
    const prepare = env.DB.prepare;
    env.DB.prepare = (sql: string) => {
      if (sql.includes('FROM advisors WHERE user_id')) { listingReads += 1; throw new Error('listing unreadable'); }
      return prepare(sql);
    };
    env.ADVISOR_V2_DISABLED = '1';
    const killed = await call('/manifest');
    assert.equal(killed.status, 503);
    assert.equal(listingReads, 0);
  } finally { db.close(); }
});

test('a completed coach bank keeps the coach voice and reflection history across restarts', async () => {
  const { db, call } = setup();
  try {
    await call('/start', 'POST');
    const conv = Number(db.prepare('SELECT id FROM advisor_conversations').get()!.id);
    for (const q of BANKS.fitCoach) answer(db, conv, q.id);
    answer(db, conv, 'dyn.reflect.1', 'noop');
    db.exec("UPDATE advisor_conversations SET state='complete'");
    const turn = await call('/turn', 'POST');
    assert.equal(turn.body.next_question.id, 'dyn.reflect.2');
    assert.equal(turn.body.next_question.persona, 'coach');
    assert.match(turn.body.next_question.prompt, /coaching/);
    assert.doesNotMatch(turn.body.next_question.prompt, /advisor|advice|recommendation|fiduciary/i);
  } finally { db.close(); }
});

test('coach carryover retains partially completed role detection', async () => {
  const { db, call } = setup();
  try {
    await call('/start', 'POST');
    const conv = Number(db.prepare('SELECT id FROM advisor_conversations').get()!.id);
    answer(db, conv, 'role_detect.primary');
    const queue = await call('/queue');
    assert.equal(queue.body.queue.some((q: any) => q.id === 'role_detect.organization'), true);
    assert.equal(queue.body.queue.some((q: any) => q.id === 'role_detect.primary'), false);
  } finally { db.close(); }
});

test('unreadable listings and carryover do not silently become another persona or an empty list', async () => {
  const { db, env, call } = setup();
  try {
    await call('/start', 'POST');
    const prepare = env.DB.prepare;
    env.DB.prepare = (sql: string) => {
      if (sql.includes('FROM advisors WHERE user_id')) throw new Error('listing unreadable');
      return prepare(sql);
    };
    assert.equal((await call('/manifest')).status, 500);
    env.DB.prepare = (sql: string) => {
      if (sql.includes('FROM advisor_answers WHERE user_id')) throw new Error('ledger unreadable');
      return prepare(sql);
    };
    const answered = await call('/answered');
    assert.equal(answered.status, 503);
    assert.equal(answered.body.error, 'answers_unreadable');
  } finally { db.close(); }
});
