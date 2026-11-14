/**
 * D1222 (#3221, part of #2458) — Calls for Capital part 1, the Worker:
 *
 *   1. readiness from the venture's own Raise records, read while calls are off;
 *   2. the founder's prospects with no verified account in the audience
 *      preview, by name, and the save no longer failing on them;
 *   3. `not_delivered` per call, in `parts.calls` and on the founder's call;
 *   4. venture members drafting and answering, while the audience, send,
 *      extend and close stay the owner's.
 *
 * Real routes and services over the canonical SQLite schema. Every person and
 * figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/round_calls_part1_d1222.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import routes from '../src/routes/round_calls.ts';
import * as service from '../src/services/roundCalls.ts';
import { callsHistory } from '../src/services/raiseCycle.ts';
import { NO_ROUND, TERMS_IN_CALL, ventureReadiness, termsHash, deckContentHash } from '../src/services/roundCallPolicy.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const SECRET = 'fixture-only-d1222-01234567890123456789';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const TERMS = { name: 'Energy seed', amount_cents: 10000000, instrument: 'safe', terms: 'Recorded round terms', minimum_cheque_cents: 100000,
  target_close: '2099-01-15', deck_id: 1, deck_version: 2, data_room_project_uid: 'energy', stage: 'seed', sector: 'climate' };

/**
 * People: 1 the owner; 2 another founder; 4 a verified investor; 5 an investor
 * whose KYC is pending; 6 a co-founder on project 1 (a founder of their own
 * venture too); 7 an advisor on project 1; 9 a plain admin.
 * Prospects on project 1: Ivy (verified), Nora (no account), Pip (pending KYC).
 */
async function fixture(state = 'draft', on = true) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const table of ['entities', 'users', 'founders', 'super_admins', 'user_sessions', 'user_company_links', 'projects', 'raise_rounds', 'raise_prospects',
    'contacts', 'activity_logs', 'pitch_decks', 'cap_table_scenarios', 'investor_profiles', 'data_room_files', 'data_room_folders',
    'data_room_grants', 'pairwise_ndas', 'notifications_inbox', 'user_settings', 'mi_pro_subscriptions', 'portfolio_updates', 'project_members']) {
    db.exec(tableFromBaseline(baseline, table));
  }
  for (const m of ['302_push_subscriptions.sql', '277_user_recovery_state.sql', '436_round_calls.sql', '456_round_call_counsel_terms.sql', '410_safe_issuances.sql', '437_share_an_update.sql']) {
    db.exec(readFileSync(`cloudflare-worker/sql/migrations/${m}`, 'utf8'));
  }
  db.exec("INSERT INTO founders(id,name,email) VALUES(1,'Owner','owner@example.test'),(2,'Other','other@example.test'),(6,'Cofounder','co@example.test')");
  const user = db.prepare('INSERT INTO users(id,name,email,role,founder_id,kyc_status,is_active) VALUES(?,?,?,?,?,?,?)');
  for (const row of [[1, 'Owner', 'owner@example.test', 'founder', 1, 'approved', 1], [2, 'Other', 'other@example.test', 'founder', 2, 'approved', 1],
    [4, 'Ivy', 'ivy@example.test', 'investor', null, 'approved', 1], [5, 'Pip', 'pip@example.test', 'investor', null, 'pending', 1],
    [6, 'Cofounder', 'co@example.test', 'founder', 6, 'approved', 1], [7, 'Adviser', 'adviser@example.test', 'founder', null, 'approved', 1],
    [9, 'Plain admin', 'plain@example.test', 'admin', null, 'approved', 1]]) user.run(...row);
  db.exec(`INSERT INTO projects(id,uid,name,founder_id,company_id,sector,stage,description,use_of_funds,revenue) VALUES
      (1,'energy','Energy',1,NULL,'climate','seed','energy storage','Product',0),
      (2,'other','Other',2,NULL,'climate','seed','other venture',NULL,NULL);
    INSERT INTO project_members(project_id,user_id,role,status) VALUES (1,6,'cofounder','accepted'),(1,7,'advisor','accepted');
    INSERT INTO raise_rounds(uid,project_id,name,target_amount,close_date,status) VALUES ('round',1,'Seed',500000,'2099-01-01','active');
    INSERT INTO pitch_decks(id,project_id,version,title,slides) VALUES(1,1,2,'Energy deck','[]');
    INSERT INTO data_room_folders(uid,project_id,name) VALUES('folder',1,'Diligence');
    INSERT INTO raise_prospects(id,uid,project_id,name,email) VALUES
      (1,'p1',1,'Ivy','ivy@example.test'),(2,'p2',1,'Nora Notonaxal','nora@example.test'),(3,'p3',1,'Pip','pip@example.test'),
      (9,'p9',2,'Elsewhere','elsewhere@example.test');`);
  const deckHash = await deckContentHash('[]');
  const hash = await termsHash({ ...TERMS, deck_content_hash: deckHash });
  db.prepare('INSERT INTO round_calls(id,uid,project_id,company_id,name,amount_cents,instrument,terms,minimum_cheque_cents,target_close,deck_id,deck_version,data_room_project_uid,stage,sector,state,terms_hash,created_by,sent_at) VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('call', 1, null, TERMS.name, TERMS.amount_cents, TERMS.instrument, TERMS.terms, TERMS.minimum_cheque_cents, TERMS.target_close, 1, 2, 'energy', 'seed', 'climate', state, hash, 1, state === 'draft' ? null : '2026-10-20');
  db.prepare('UPDATE round_calls SET deck_content_hash=? WHERE id=1').run(deckHash);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'production', ROUND_CALLS_ENABLED: on ? 'true' : 'false' };
  const userRow = (id: number) => db.prepare('SELECT * FROM users WHERE id=?').get(id) as any;
  return { db, env, userRow };
}

async function call(f: any, path: string, who: number | null = 1, method = 'GET', body?: unknown) {
  const app = new Hono<any>(); app.route('/round-calls', routes);
  app.onError((e, c) => c.json({ error: e.message }, (AUTH_ERROR_STATUSES[e.message] || 500) as any));
  const headers: any = {};
  if (who) headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const saved = console.error; console.error = () => {};
  try {
    const res = await app.request('/round-calls' + path, { method, headers, ...body === undefined ? {} : { body: JSON.stringify(body) } }, f.env);
    return { status: res.status, body: await res.json() as any };
  } finally { console.error = saved; }
}
const byKey = (items: any[]) => Object.fromEntries(items.map((i) => [i.key, i.ready]));
const statusOf = async (fn: () => Promise<unknown>) => { try { await fn(); return 200; } catch (e: any) { return e.status || 500; } };

// ---------------------------------------------------------------- 1. readiness while off

test('1. readiness reads the venture\'s own records with calls off, item by item, and never a zero for terms', async () => {
  // Mutation checked: the route after the flag → 503; the flag-free read through projectFacts → 503;
  // terms counted ready; a past close counted ready; a missing round read as ready.
  const f = await fixture('draft', false);
  const r = await call(f, '/readiness?project_id=1');
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, false);
  assert.deepEqual(r.body.items.map((i: any) => i.label), ['Round target', 'Round terms', 'Pitch deck version', 'Data room', 'Use of funds', 'Traction', 'Target close']);
  assert.deepEqual(byKey(r.body.items), { round: true, terms: null, deck: true, data_room: true, use_of_funds: true, traction: true, close: true });
  assert.equal(r.body.items.find((i: any) => i.key === 'terms').reason, TERMS_IN_CALL);
  assert.deepEqual([r.body.ready, r.body.counted], [6, 6]);
  assert.doesNotMatch(JSON.stringify(r.body), /ivy|nora|pip|@example/i, 'no investor or prospect data');
  assert.equal((await call(f, '/context?project_id=1')).status, 503, 'everything else stays off');

  f.db.exec("UPDATE raise_rounds SET close_date='2001-01-01'; DELETE FROM data_room_folders; UPDATE projects SET use_of_funds='  ', revenue=NULL WHERE id=1");
  assert.deepEqual(byKey((await call(f, '/readiness?project_id=1')).body.items), { round: true, terms: null, deck: true, data_room: false, use_of_funds: false, traction: false, close: false });
  f.db.exec('DELETE FROM raise_rounds');
  const none = (await call(f, '/readiness?project_id=1')).body.items;
  assert.deepEqual([byKey(none).round, byKey(none).close, none[0].reason], [false, false, NO_ROUND]);
});

test('1. readiness is the venture\'s own: another venture, an investor, an advisor and an admin are refused; a co-founder reads it', async () => {
  // Mutation checked: members dropped from the readiness read → the co-founder 404; an advisor admitted as a member;
  // an investor admitted as a member.
  const f = await fixture('draft', false);
  const at = async (who: number | null, project = 1) => (await call(f, `/readiness?project_id=${project}`, who)).status;
  assert.deepEqual([await at(1), await at(6), await at(2), await at(7), await at(4), await at(9), await at(null), await at(1, 2), await at(1, 99)],
    [200, 200, 404, 404, 403, 403, 401, 404, 404]);
  f.db.exec("INSERT INTO project_members(project_id,user_id,role,status) VALUES (1,4,'cofounder','accepted'),(1,9,'cofounder','accepted')");
  assert.deepEqual([await at(4), await at(9)], [403, 403], 'an investor or an admin is never a member, whatever row says so');
  f.db.exec("UPDATE project_members SET status='pending' WHERE user_id=6");
  assert.equal(await at(6), 404, 'a membership not accepted is none');
  f.db.exec("UPDATE project_members SET status='accepted' WHERE user_id=6; UPDATE users SET is_active=0 WHERE id=6");
  assert.equal(await at(6), 401, 'a deactivated member is not signed in at all');
});

test('the policy: a close date today is still ready; a zero or missing target is not', () => {
  const base = { decks: 1, data_room_items: 1, use_of_funds: 'x', traction_summary: 'x' };
  assert.equal(byKey(ventureReadiness({ ...base, round: { target_amount: 1, close_date: '2026-10-26' } }, '2026-10-26')).close, true);
  assert.equal(byKey(ventureReadiness({ ...base, round: { target_amount: 1, close_date: '2026-10-25' } }, '2026-10-26')).close, false);
  assert.equal(byKey(ventureReadiness({ ...base, round: { target_amount: 0, close_date: '2099-01-01' } }, '2026-10-26')).round, false);
  assert.equal(byKey(ventureReadiness({ ...base, round: { target_amount: null, close_date: '2099-01-01' } }, '2026-10-26')).round, false);
  assert.equal(byKey(ventureReadiness({ ...base, round: { target_amount: 1, close_date: '2099-02-30' } }, '2026-10-26')).close, false, 'not a real date');
});

// ---------------------------------------------------------------- 2. not on Axal

test('2. the audience preview names the founder\'s prospects with no verified account, flagged when chosen, with no email', async () => {
  // Mutation checked: the verified listed too; the chosen flag lost; the email returned.
  const f = await fixture('draft');
  const r = await call(f, '/call/audience-preview', 1, 'POST', { chosen_prospect_ids: [1, 2], include_matches: false });
  assert.equal(r.status, 200);
  assert.equal(r.body.chosen, 1, 'only the verified investor is a recipient');
  assert.deepEqual(r.body.not_on_axal, [
    { prospect_id: 2, name: 'Nora Notonaxal', chosen: true },
    { prospect_id: 3, name: 'Pip', chosen: false },
  ]);
  assert.doesNotMatch(JSON.stringify(r.body.not_on_axal), /@/);
});

test('2. a chosen prospect not on Axal no longer fails the save: left out of the recipients and counted; another venture\'s prospect is still refused', async () => {
  // Mutation checked: the old failure back → 422; the unverified written as a recipient; another venture's prospect accepted.
  const f = await fixture('draft');
  const r = await call(f, '/call/audience', 1, 'PUT', { chosen_prospect_ids: [1, 2, 3], include_matches: false });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.chosen, r.body.not_on_axal], [1, 2]);
  assert.deepEqual(f.db.prepare('SELECT investor_user_id, origin FROM round_call_recipients ORDER BY id').all().map((x: any) => [x.investor_user_id, x.origin]), [[4, 'chosen']]);
  const bad = await call(f, '/call/audience', 1, 'PUT', { chosen_prospect_ids: [1, 9], include_matches: false });
  assert.deepEqual([bad.status, bad.body.code], [422, 'prospect_not_found']);
  assert.equal((await call(f, '/call/audience-preview', 1, 'POST', { chosen_prospect_ids: [9], include_matches: false })).status, 422);
});

// ---------------------------------------------------------------- 3. not delivered

test('3. not_delivered per call, in parts.calls and on the founder\'s call; a draft says null, never 0', async () => {
  // Mutation checked: the draft's null as 0 (both reads); the count reading notified rows.
  const f = await fixture('sent');
  const rec = f.db.prepare("INSERT INTO round_call_recipients(call_id,investor_user_id,origin,match_reasons_json,delivery_state) VALUES(1,?,'chosen','[]',?)");
  rec.run(4, 'not_delivered'); rec.run(5, 'notified'); rec.run(6, 'not_delivered');
  const page = await call(f, '/call');
  assert.equal(page.body.progress.not_delivered, 2);
  const history: any = await callsHistory({ env: f.env, projectId: 1, today: '2026-10-26' } as any);
  assert.equal(history.items[0].not_delivered, 2);
  f.db.exec("UPDATE round_calls SET state='draft', sent_at=NULL");
  assert.equal((await call(f, '/call')).body.progress.not_delivered, null);
  assert.equal(((await callsHistory({ env: f.env, projectId: 1, today: '2026-10-26' } as any)) as any).items[0].not_delivered, null);
});

// ---------------------------------------------------------------- 4. co-founders

test('4. a co-founder drafts, reads and answers; the page says what they may do', async () => {
  // Mutation checked: members dropped from the draft, read or answer routes; the service check without members.
  const f = await fixture('draft');
  assert.equal((await call(f, '/context?project_id=1', 6)).status, 200);
  assert.equal((await call(f, '?project_id=1', 6)).status, 200);
  const made = await call(f, '', 6, 'POST', { project_id: 1, ...TERMS, name: 'Co-founder draft', deck_id: null, data_room_project_uid: null });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.created_by, 6);
  const edit = await call(f, '/call', 6, 'PUT', { name: 'Renamed by the co-founder' });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.name, 'Renamed by the co-founder');
  const page = await call(f, '/call', 6);
  assert.deepEqual([page.body.relation, page.body.can], ['member', { draft: true, answer: true, audience: false, send: false, extend: false, close: false }]);
  assert.deepEqual((await call(f, '/call', 1)).body.can, { draft: true, answer: true, audience: true, send: true, extend: true, close: true });

  f.db.exec("UPDATE round_calls SET state='sent', sent_at='2026-10-20'; INSERT INTO round_call_questions(uid,call_id,investor_user_id,question,asked_at) VALUES('q1',1,4,'What is the runway?','2026-10-21')");
  const answer = await call(f, '/call/questions/q1', 6, 'PUT', { answer: 'Eighteen months.' });
  assert.equal(answer.status, 200);
  assert.deepEqual(Object.values(f.db.prepare("SELECT answer, answered_by FROM round_call_questions WHERE uid='q1'").get() as any), ['Eighteen months.', 6]);
});

test('4. the audience, send, extend and close stay the owner\'s: a co-founder is refused each and nothing changes', async () => {
  // Mutation checked: members on the audience; the send, close and audience services admitting members.
  // Members on the send or manage route alone is masked: the service checks the owner again, by design.
  const f = await fixture('draft');
  const before = JSON.stringify(f.db.prepare('SELECT * FROM round_calls').get());
  const refused = [
    await call(f, '/call/audience-preview', 6, 'POST', { chosen_prospect_ids: [1], include_matches: false }),
    await call(f, '/call/audience', 6, 'PUT', { chosen_prospect_ids: [1], include_matches: false }),
    await call(f, '/call/counsel-request', 6, 'POST', { revision: 1 }),
    await call(f, '/call/send', 6, 'POST', { acknowledge_missing: true }),
  ].map((r) => r.status);
  f.db.exec("UPDATE round_calls SET state='sent', sent_at='2026-10-20'");
  refused.push((await call(f, '/call/manage', 6, 'POST', { action: 'close' })).status);
  refused.push((await call(f, '/call/manage', 6, 'POST', { action: 'extend', target_close: '2099-06-01' })).status);
  assert.deepEqual(refused, [404, 404, 404, 404, 404, 404]);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM round_call_recipients').get().n, 0);
  assert.deepEqual([(f.db.prepare('SELECT state, target_close FROM round_calls').get() as any).state, (f.db.prepare('SELECT target_close FROM round_calls').get() as any).target_close], ['sent', '2099-01-15']);
  assert.ok(before.includes('"state":"draft"'));
  // The services check again, whatever route reaches them.
  const c = await service.loadCall(f.env, 'call');
  assert.equal(await statusOf(() => service.manageCall(f.env, c, f.userRow(6), { action: 'close' })), 404);
  assert.equal(await statusOf(() => service.sendCall(f.env, { ...c, state: 'draft' }, f.userRow(6), true)), 404, 'the send service admits the owner only');
  assert.equal(await statusOf(() => service.saveAudience(f.env, { ...c, state: 'draft' }, f.userRow(6), { chosen_prospect_ids: [1], include_matches: false })), 404);
});

test('4. an advisor, a membership not accepted and another venture\'s founder draft nothing', async () => {
  const f = await fixture('draft');
  const draft = (who: number) => call(f, '', who, 'POST', { project_id: 1, ...TERMS, deck_id: null, data_room_project_uid: null });
  assert.deepEqual([(await draft(7)).status, (await draft(2)).status, (await draft(9)).status, (await draft(4)).status], [404, 404, 403, 403]);
  f.db.exec("UPDATE project_members SET status='removed' WHERE user_id=6");
  assert.equal((await draft(6)).status, 404);
  assert.equal((await call(f, '/call/questions/q1', 7, 'PUT', { answer: 'No.' })).status, 404);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM round_calls').get().n, 1);
});

test('the flag is never switched on here', () => {
  assert.match(readFileSync('wrangler.toml', 'utf8'), /ROUND_CALLS_ENABLED = "false"/);
});
