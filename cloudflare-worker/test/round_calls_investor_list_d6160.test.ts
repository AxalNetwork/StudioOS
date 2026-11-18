/**
 * D6160 (#6160), CLS16: the investor's round calls list. `GET /round-calls`
 * for an investor returns, per call, the company's name, the recorded terms,
 * the state it reads as, and the caller's OWN response — never another
 * recipient's indication, data-room request, question or count.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import routes from '../src/routes/round_calls.ts';
import { effectiveCallState } from '../src/services/roundCallPolicy.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const SECRET = 'fixture-only-d6160-0123456789012345678901';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const table of ['entities', 'users', 'founders', 'super_admins', 'user_sessions', 'user_company_links', 'projects', 'activity_logs', 'mi_pro_subscriptions']) {
    db.exec(tableFromBaseline(baseline, table));
  }
  db.exec(readFileSync('cloudflare-worker/sql/migrations/302_push_subscriptions.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/277_user_recovery_state.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/436_round_calls.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/456_round_call_counsel_terms.sql', 'utf8'));
  db.exec("INSERT INTO founders(id,name,email) VALUES(1,'Owner','owner@example.test')");
  const user = db.prepare('INSERT INTO users(id,name,email,role,founder_id,kyc_status,is_active) VALUES(?,?,?,?,?,?,?)');
  for (const row of [[1, 'Owner', 'owner@example.test', 'founder', 1, 'approved', 1], [4, 'Ivy', 'ivy@example.test', 'investor', null, 'approved', 1],
    [5, 'Pending', 'pending@example.test', 'investor', null, 'pending', 1], [7, 'Rival', 'rival@example.test', 'investor', null, 'approved', 1]]) user.run(...row);
  db.exec("INSERT INTO projects(id,uid,name,founder_id,company_id,description) VALUES(1,'kestrel','Kestrel Grid',1,10,'x'),(2,'ostrava','Ostrava Robotics',1,10,'y')");
  const call = db.prepare("INSERT INTO round_calls(id,uid,project_id,company_id,name,amount_cents,instrument,terms,minimum_cheque_cents,target_close,state,terms_hash,created_by,sent_at,closed_at) VALUES(?,?,?,10,?,?,?,'t',?,?,?,'h',1,?,?)");
  call.run(1, 'open-call', 1, 'Seed', 120000000, 'safe', 2500000, '2099-01-15', 'sent', '2026-11-13 10:00:00', null);
  call.run(2, 'expired-call', 2, 'Seed', 200000000, 'equity', 2500000, '2020-01-02', 'sent', '2026-10-19 10:00:00', null);
  call.run(3, 'paused-call', 1, 'Pre-seed', 40000000, 'convertible_note', 1000000, '2099-02-01', 'awaiting_counsel', '2026-11-02 10:00:00', null);
  call.run(4, 'draft-call', 1, 'Draft', 40000000, 'safe', 1000000, '2099-02-01', 'draft', null, null);
  call.run(5, 'not-mine', 1, 'Bridge', 30000000, 'safe', 1000000, '2099-02-01', 'sent', '2026-11-01 10:00:00', null);
  const recipient = db.prepare("INSERT INTO round_call_recipients(call_id,investor_user_id,origin,opened_at,commitment_cents,data_room_requested_at) VALUES(?,?,'match',?,?,?)");
  // Ivy (4) is on calls 1–4; the rival (7) is on calls 1, 2 and 5 with responses of their own.
  recipient.run(1, 4, null, null, null);
  recipient.run(2, 4, '2026-10-20 09:00:00', 2500000, null);
  recipient.run(3, 4, '2026-11-03 09:00:00', null, '2026-11-04 09:00:00');
  recipient.run(4, 4, null, null, null);
  recipient.run(1, 7, '2026-11-13 11:00:00', 9900000, '2026-11-13 12:00:00');
  recipient.run(2, 7, '2026-10-21 11:00:00', 7700000, '2026-10-21 12:00:00');
  recipient.run(5, 7, '2026-11-01 11:00:00', 5500000, null);
  const question = db.prepare('INSERT INTO round_call_questions(uid,call_id,investor_user_id,question,answer) VALUES(?,?,?,?,?)');
  question.run('q1', 3, 4, 'Mine, answered', 'Yes');
  question.run('q2', 3, 4, 'Mine, open', null);
  for (const [uid, callId] of [['r1', 1], ['r2', 1], ['r3', 1], ['r4', 2], ['r5', 3]]) question.run(uid, callId, 7, 'Rival asks', 'Answered');
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'production', ROUND_CALLS_ENABLED: 'true' };
  return { db, env };
}

async function list(f: any, who: number, extraEnv = {}) {
  const app = new Hono<any>(); app.route('/round-calls', routes);
  app.onError((e, c) => c.json({ error: e.message }, (AUTH_ERROR_STATUSES[e.message] || 500) as any));
  const token = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request('/round-calls', { headers: { Authorization: 'Bearer ' + token } }, { ...f.env, ...extraEnv });
  return { status: res.status, body: await res.json() as any };
}

test('the investor list names the company, the terms and the state it reads as, and drafts are never listed', async () => {
  const f = fixture();
  const { status, body } = await list(f, 4);
  assert.equal(status, 200);
  assert.equal(body.viewer, 'investor');
  // Mutation checked: dropping `rc.state<>'draft'` lists draft-call and this fails.
  assert.deepEqual(body.items.map((c: any) => c.uid), ['open-call', 'paused-call', 'expired-call']);
  const byUid = Object.fromEntries(body.items.map((c: any) => [c.uid, c]));
  // Mutation checked: reading the company from another column (or not joining projects) fails this.
  assert.deepEqual(byUid['open-call'].company, { name: 'Kestrel Grid' });
  assert.deepEqual(byUid['expired-call'].company, { name: 'Ostrava Robotics' });
  assert.deepEqual([byUid['open-call'].instrument, byUid['open-call'].amount_cents, byUid['open-call'].minimum_cheque_cents],
    ['safe', 120000000, 2500000]);
  // Mutation checked: returning `state` as the effective state reads 'sent' for the expired call and fails.
  assert.deepEqual(body.items.map((c: any) => [c.uid, c.effective_state]),
    [['open-call', 'open'], ['paused-call', 'paused'], ['expired-call', 'closed']]);
  // Name only: nothing about the founder or the project beyond its name.
  assert.deepEqual(Object.keys(byUid['open-call'].company), ['name']);
});

test('each row carries only the caller’s own response, never another recipient’s', async () => {
  const f = fixture();
  const { body } = await list(f, 4);
  const byUid = Object.fromEntries(body.items.map((c: any) => [c.uid, c]));
  // The rival indicated 9,900,000 cents and asked three questions on open-call; Ivy did nothing there.
  // Mutation checked: counting questions by call alone (no investor_user_id) reads 3 here and fails.
  assert.deepEqual(byUid['open-call'].mine, { opened_at: null, commitment_cents: null, data_room_requested_at: null, question_count: 0, answered_count: 0 });
  assert.deepEqual(byUid['expired-call'].mine, { opened_at: '2026-10-20 09:00:00', commitment_cents: 2500000, data_room_requested_at: null, question_count: 0, answered_count: 0 });
  // Mutation checked: dropping `q.answer IS NOT NULL` reads answered_count 2 and fails.
  assert.deepEqual(byUid['paused-call'].mine, { opened_at: '2026-11-03 09:00:00', commitment_cents: null, data_room_requested_at: '2026-11-04 09:00:00', question_count: 2, answered_count: 1 });
  // A call sent only to the rival is not Ivy's to see.
  assert.equal(byUid['not-mine'], undefined);
  // No other recipient's figure appears anywhere in the reply.
  const text = JSON.stringify(body);
  for (const leak of ['9900000', '7700000', '5500000', 'Rival', 'rival@example.test', '2026-11-13 11:00:00', '2026-10-21 12:00:00', 'investor_user_id', 'recipients']) {
    assert.ok(!text.includes(leak), leak);
  }
  // The rival's own list is theirs alone.
  const rival = await list(f, 7);
  assert.deepEqual(rival.body.items.map((c: any) => [c.uid, c.mine.commitment_cents, c.mine.question_count]),
    [['open-call', 9900000, 3], ['not-mine', 5500000, 0], ['expired-call', 7700000, 1]]);
});

test('an unverified investor is refused and the switch answers 503 round_calls_disabled', async () => {
  const f = fixture();
  const pending = await list(f, 5);
  assert.deepEqual([pending.status, pending.body.code], [403, 'verified_investor_required']);
  const off = await list(f, 4, { ROUND_CALLS_ENABLED: 'false' });
  assert.deepEqual([off.status, off.body.code], [503, 'round_calls_disabled']);
});

test('effectiveCallState: waiting on counsel is paused, a sent call past its close is closed', () => {
  assert.equal(effectiveCallState({ state: 'sent', target_close: '2026-11-15' }, '2026-11-15'), 'open');
  assert.equal(effectiveCallState({ state: 'sent', target_close: '2026-11-14' }, '2026-11-15'), 'closed');
  assert.equal(effectiveCallState({ state: 'awaiting_counsel', target_close: '2020-01-01' }, '2026-11-15'), 'paused');
  assert.equal(effectiveCallState({ state: 'closed', target_close: '2099-01-01' }, '2026-11-15'), 'closed');
});
