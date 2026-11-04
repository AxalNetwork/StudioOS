/**
 * D4329 (#4329, D1357 part 8a): the introduction request lifecycle. Synthetic
 * people on the real migrated schema. `fetch` answers only the introducer's own
 * mailbox provider; anything else throws, so nothing reaches the person.
 *
 *   · pending → accepted (or declined, "Not now", with the note the asker reads) → made, recorded on send;
 *   · made only from the teammate's own send for an accepted request, checked before anything goes out;
 *   · the asker withdraws a pending request, and only a pending one;
 *   · an outcome from either side, once made; until then "Not recorded";
 *   · follow-ups: a due date, done, snoozed until; the due count is the caller's own;
 *   · the log filters by the caller's own teams and by status;
 *   · every step refuses anyone not on the request, in the words of a request that does not exist.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import relationships from '../src/routes/relationships.ts';
import mailAccounts from '../src/routes/mail_accounts.ts';
import { followUpState, NOT_RECORDED } from '../src/services/relationships.ts';
import { saveAccount } from '../src/services/mail/accounts.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

after(removeMigratedDatabases);
const JWT_SECRET = 'synthetic-d4329-only-not-a-real-credential'.repeat(2);
const ADA_URL = 'https://www.linkedin.com/in/synthetic-ada';
const PRIVATE = ['ada@example.invalid', 'linkedin.com', 'Synthetic private note', '+1 555 0100'];
const TODAY = new Date().toISOString().slice(0, 10);
const dayAfter = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

// 2 founder of venture 1 (shares Ada), 4 its co-founder (asks), 5 its advisor (not its team),
// 3 founder of venture 3 (another team), 6 an investor firm.
function fixture() {
  const db = migratedDatabase();
  const u = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid] of [[2, 'founder', 100], [3, 'founder', 300], [4, 'founder', null], [5, 'advisor', null], [6, 'investor', null]] as const) {
    u.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  }
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(3,'Other venture',300)");
  db.exec("INSERT INTO project_members(project_id,user_id,role,status) VALUES (1,4,'cofounder','accepted'),(1,5,'advisor','accepted')");
  const nc = db.prepare('INSERT INTO network_connections(id,user_id,name,email,company,title,phone,notes,source,linkedin_url,connected_on) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  nc.run(21, 2, 'Synthetic Ada', 'ada@example.invalid', 'Acme', 'CTO', '+1 555 0100', 'Synthetic private note', 'linkedin_csv', ADA_URL, '2024-03-12');
  nc.run(24, 2, 'Synthetic Grace', null, 'Navy', null, null, null, 'manual', null, null);
  db.prepare("INSERT INTO contact_sources(owner_user_id,contact_table,contact_id,source,created_row) VALUES (2,'network_connections',21,'linkedin_csv',1)").run();
  const env: any = {
    DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', KEK_PII: 'synthetic-kek-d4329-'.repeat(3),
    MAIL_MICROSOFT_CLIENT_ID: 'ms-client', MAIL_MICROSOFT_CLIENT_SECRET: 'ms-secret',
  };
  const app = new Hono<any>().route('/api/relationships', relationships).route('/api/mail', mailAccounts);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const sends: string[] = [];
  const real = globalThis.fetch;
  // Only the introducer's own mailbox provider answers. Nothing else is reachable.
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input);
    const json = (status: number, j: any) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes('/oauth2/v2.0/token')) return json(200, { access_token: 'synthetic-access', scope: 'Mail.Send offline_access' });
    if (url === 'https://graph.microsoft.com/v1.0/me/messages') { sends.push(String(init.body || '')); return json(201, { id: 'graph-1', internetMessageId: '<graph-1@outlook.invalid>' }); }
    if (url.endsWith('/send')) return new Response(null, { status: 202 });
    throw new Error(`no network in this test: ${url}`);
  }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const rows = () => db.prepare('SELECT kind, status, parent_uid, outcome FROM relationship_interactions ORDER BY id').all().map((r: any) => [r.kind, r.status, r.parent_uid, r.outcome]);
  return { db, env, app, close, sends, rows };
}
type F = ReturnType<typeof fixture>;

async function call(f: F, who: number, method: string, path: string, json?: unknown, claims: Record<string, unknown> = {}) {
  const jwt = await new SignJWT({ user_id: who, ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: json === undefined ? undefined : JSON.stringify(json) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text };
}
const R = '/api/relationships';
const shareAll = (f: F, who: number) => call(f, who, 'PUT', `${R}/sharing`, { share: true });
async function ask(f: F, extra: Record<string, unknown> = {}) {
  const r = await call(f, 4, 'POST', `${R}/intro-request`, { teammate: 2, ref: 21, note: 'Met at the demo day.', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.request.uid as string;
}
const step = (f: F, who: number, uid: string, path: string, json?: unknown, method = 'POST') => call(f, who, method, `${R}/intro-requests/${uid}${path}`, json);
async function mailbox(f: F, who: number) {
  return saveAccount(f.env, { id: who, role: 'founder' } as any, {
    provider: 'outlook', address: `introducer-${who}@example.invalid`, display_name: null, scopes: 'Mail.Send offline_access', can_read: false,
    creds: { kind: 'oauth', refresh_token: 'synthetic-refresh-d4329' },
  });
}
async function sendIntro(f: F, who: number, accountUid: string, introUid: unknown) {
  const nonce = (await call(f, who, 'POST', '/api/mail/send/confirm', { account_uid: accountUid })).body.nonce;
  return call(f, who, 'POST', '/api/mail/send', { account_uid: accountUid, to: 'ada@example.invalid', subject: 'Introducing Synthetic member 4', body: 'Ada, meet Synthetic member 4.', nonce, intro_uid: introUid });
}

test('the context note is the asker\'s, read by the two people on the request only; it is checked for length', async () => {
  // Mutation checked: context_note dropped on insert (the teammate's card has nothing to forward).
  const f = fixture();
  try {
    await shareAll(f, 2);
    assert.equal((await call(f, 4, 'POST', `${R}/intro-request`, { teammate: 2, ref: 21, context_note: 'x'.repeat(1001) })).body.error, 'context_note_too_long');
    const uid = await ask(f, { context_note: 'Ada is raising a seed fund; Acme is a fit.' });
    const received = (await call(f, 2, 'GET', `${R}/intro-requests`)).body.received[0];
    assert.equal(received.context_note, 'Ada is raising a seed fund; Acme is a fit.');
    assert.equal((await call(f, 4, 'GET', `${R}/intro-requests`)).body.sent[0].context_note, 'Ada is raising a seed fund; Acme is a fit.');
    for (const who of [3, 5, 6]) {
      const r = await call(f, who, 'GET', `${R}/intro-requests`);
      assert.deepEqual(r.body, { sent: [], received: [], follow_ups_due: 0 }, `${who} reads nothing of it`);
      assert.ok(!r.text.includes('seed fund'));
    }
    assert.equal(received.uid, uid);
    assert.deepEqual(received.outcome, { value: null, label: NOT_RECORDED, note: null, recorded_by_user_id: null, recorded_at: null });
  } finally { f.close(); }
});

test('accept, then made on send: two steps; the decision note reaches the asker; made only from the teammate\'s own send', async () => {
  // Mutations checked: decide accepting 'made' (one press skips the send); markMadeOnSend without the accepted guard;
  // the intro check run after the send (a send for someone else's request would leave).
  const f = fixture();
  try {
    await shareAll(f, 2);
    const uid = await ask(f);
    const mine = await mailbox(f, 2);
    const theirs = await mailbox(f, 4);
    assert.deepEqual([(await sendIntro(f, 2, mine.uid, uid)).status, f.sends.length], [409, 0], 'pending: nothing goes out');
    assert.equal((await step(f, 2, uid, '/decide', { decision: 'made' })).body.error, 'decision_invalid');
    assert.equal((await step(f, 2, uid, '/decide', { decision: 'accepted', note: 'y'.repeat(1001) })).body.error, 'decision_note_too_long');
    for (const who of [3, 4, 5, 6]) assert.equal((await step(f, who, uid, '/decide', { decision: 'accepted' })).status, 404, `${who} cannot answer`);
    const acc = await step(f, 2, uid, '/decide', { decision: 'accepted', note: 'Happy to. I will write this week.' });
    assert.deepEqual([acc.status, acc.body.request.status, acc.body.request.decision_note], [200, 'accepted', 'Happy to. I will write this week.']);
    assert.ok(acc.body.request.accepted_at);
    assert.equal((await step(f, 2, uid, '/decide', { decision: 'declined' })).body.error, 'decided', 'answered once');
    const sent = (await call(f, 4, 'GET', `${R}/intro-requests`)).body.sent[0];
    assert.deepEqual([sent.status, sent.decision_note], ['accepted', 'Happy to. I will write this week.'], 'the asker reads the note');
    // The asker's own mailbox cannot make it, nor can a malformed or unknown uid; nothing goes out for any of them.
    for (const [who, acct, intro] of [[4, theirs.uid, uid], [2, mine.uid, 'nope'], [2, mine.uid, 'f'.repeat(32)]] as const) {
      const r = await sendIntro(f, who, acct, intro);
      assert.deepEqual([r.status, r.body.error], [404, 'not_found'], `${who} ${intro}`);
    }
    assert.equal(f.sends.length, 0, 'no refused send left');
    const made = await sendIntro(f, 2, mine.uid, uid);
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.deepEqual(made.body.intro, { uid, status: 'made' });
    assert.equal(f.sends.length, 1, 'one email, from the introducer\'s own mailbox');
    const after = (await call(f, 2, 'GET', `${R}/intro-requests`)).body.received[0];
    assert.equal(after.status, 'made');
    assert.equal(after.mail_sent_uid, made.body.sent.uid, 'the introducer sees which send made it');
    assert.equal((await call(f, 4, 'GET', `${R}/intro-requests`)).body.sent[0].mail_sent_uid, null, 'the asker never reads the introducer\'s mailbox');
    assert.equal((await sendIntro(f, 2, mine.uid, uid)).body.error, 'intro_already_made');
    assert.deepEqual(f.rows(), [['intro_requested', 'made', null, null], ['intro_accepted', 'accepted', uid, null], ['intro_made', 'made', uid, null]]);
    const n = f.db.prepare("SELECT user_id, title FROM notifications_inbox WHERE type = 'relationship_intro_answered' ORDER BY id").all() as any[];
    assert.deepEqual(n.map((x) => [x.user_id, x.title]), [[4, 'Your introduction request was accepted'], [4, 'Your introduction was made']]);
  } finally { f.close(); }
});

test('Not now: declined, with the note the asker reads; no intro can be sent for it', async () => {
  const f = fixture();
  try {
    await shareAll(f, 2);
    const uid = await ask(f);
    const no = await step(f, 2, uid, '/decide', { decision: 'declined', note: 'I don\'t know Ada well enough.' });
    assert.deepEqual([no.body.request.status, no.body.request.accepted_at], ['declined', null]);
    assert.equal((await call(f, 4, 'GET', `${R}/intro-requests`)).body.sent[0].decision_note, 'I don\'t know Ada well enough.');
    const mine = await mailbox(f, 2);
    assert.deepEqual([(await sendIntro(f, 2, mine.uid, uid)).body.error, f.sends.length], ['intro_not_accepted', 0]);
  } finally { f.close(); }
});

test('the asker withdraws a pending request, and only a pending one; the teammate is told and can no longer answer', async () => {
  // Mutation checked: withdraw without the status guard (an accepted request could be pulled back).
  const f = fixture();
  try {
    await shareAll(f, 2);
    const uid = await ask(f);
    for (const who of [2, 3, 5, 6]) assert.equal((await step(f, who, uid, '/withdraw')).status, 404, `${who} cannot withdraw it`);
    const w = await step(f, 4, uid, '/withdraw');
    assert.deepEqual([w.status, w.body.request.status], [200, 'withdrawn']);
    assert.ok(w.body.request.withdrawn_at);
    assert.equal((await step(f, 4, uid, '/withdraw')).body.error, 'not_pending');
    assert.equal((await step(f, 2, uid, '/decide', { decision: 'accepted' })).body.error, 'decided');
    const told = f.db.prepare("SELECT user_id FROM notifications_inbox WHERE type = 'relationship_intro_withdrawn'").all() as any[];
    assert.deepEqual(told.map((x) => x.user_id), [2]);
    const second = await ask(f);
    await step(f, 2, second, '/decide', { decision: 'accepted' });
    assert.equal((await step(f, 4, second, '/withdraw')).body.error, 'not_pending', 'accepted: no longer withdrawable');
  } finally { f.close(); }
});

test('an outcome from either side once made; the latest is what the log reads; never before it is made', async () => {
  const f = fixture();
  try {
    await shareAll(f, 2);
    const uid = await ask(f);
    await step(f, 2, uid, '/decide', { decision: 'accepted' });
    assert.equal((await step(f, 4, uid, '/outcome', { outcome: 'meeting_held' })).body.error, 'intro_not_made');
    await sendIntro(f, 2, (await mailbox(f, 2)).uid, uid);
    assert.equal((await step(f, 4, uid, '/outcome', { outcome: 'great' })).body.error, 'outcome_invalid');
    for (const who of [3, 5, 6]) assert.equal((await step(f, who, uid, '/outcome', { outcome: 'no_reply' })).status, 404, `${who} records nothing`);
    const a = await step(f, 4, uid, '/outcome', { outcome: 'no_reply' });
    assert.deepEqual([a.status, a.body.request.outcome.label, a.body.request.outcome.recorded_by_user_id], [200, 'No reply', 4]);
    const b = await step(f, 2, uid, '/outcome', { outcome: 'meeting_held', note: 'Met on 12 Nov.' });
    assert.deepEqual([b.body.request.outcome.value, b.body.request.outcome.label, b.body.request.outcome.note], ['meeting_held', 'Meeting held', 'Met on 12 Nov.']);
    assert.equal((await call(f, 4, 'GET', `${R}/intro-requests`)).body.sent[0].outcome.label, 'Meeting held', 'the asker reads the latest');
    assert.equal(f.rows().filter(([k]) => k === 'outcome').length, 2);
  } finally { f.close(); }
});

test('follow-ups: set, due, snoozed until, done; the count is the caller\'s own and only while due', async () => {
  // Mutations checked: the due count without user_id (the teammate's follow-up counted for the asker); a snoozed follow-up counted as due.
  const f = fixture();
  try {
    await shareAll(f, 2);
    const uid = await ask(f);
    assert.equal((await step(f, 4, uid, '/follow-up', { due_on: TODAY }, 'PUT')).body.error, 'follow_up_unavailable', 'pending: nothing to follow up');
    await step(f, 2, uid, '/decide', { decision: 'accepted' });
    for (const bad of ['tomorrow', '2026-02-30', '', null]) assert.equal((await step(f, 4, uid, '/follow-up', { due_on: bad }, 'PUT')).body.error, 'due_on_invalid', String(bad));
    for (const who of [3, 5, 6]) assert.equal((await step(f, who, uid, '/follow-up', { due_on: TODAY }, 'PUT')).status, 404, `${who} sets none`);
    assert.equal((await step(f, 4, uid, '/follow-up/done')).body.error, 'follow_up_not_found');
    const set = await step(f, 4, uid, '/follow-up', { due_on: TODAY }, 'PUT');
    assert.deepEqual(set.body.request.follow_up, { due_on: TODAY, snoozed_until: null, done_at: null, state: 'due' });
    assert.equal((await call(f, 4, 'GET', `${R}/intro-requests`)).body.follow_ups_due, 1);
    assert.equal((await call(f, 2, 'GET', `${R}/intro-requests`)).body.follow_ups_due, 0, 'the teammate does not see the asker\'s follow-up');
    assert.equal((await call(f, 2, 'GET', `${R}/intro-requests`)).body.received[0].follow_up, null);
    assert.equal((await step(f, 4, uid, '/follow-up/snooze', { until: TODAY })).body.error, 'until_not_future');
    const snoozed = await step(f, 4, uid, '/follow-up/snooze', { until: dayAfter(4) });
    assert.deepEqual([snoozed.body.request.follow_up.state, snoozed.body.request.follow_up.snoozed_until], ['snoozed', dayAfter(4)]);
    assert.equal((await call(f, 4, 'GET', `${R}/intro-requests`)).body.follow_ups_due, 0, 'snoozed: not due');
    const done = await step(f, 4, uid, '/follow-up/done');
    assert.equal(done.body.request.follow_up.state, 'done');
    assert.equal((await call(f, 4, 'GET', `${R}/intro-requests`)).body.follow_ups_due, 0);
    const reset = await step(f, 4, uid, '/follow-up', { due_on: dayAfter(-1) }, 'PUT');
    assert.deepEqual([reset.body.request.follow_up.state, reset.body.request.follow_up.done_at], ['due', null], 'a new date reopens it');
    // The teammate keeps their own follow-up on the same request, counted for them alone.
    await step(f, 2, uid, '/follow-up', { due_on: TODAY }, 'PUT');
    assert.deepEqual([(await call(f, 2, 'GET', `${R}/intro-requests`)).body.follow_ups_due, (await call(f, 4, 'GET', `${R}/intro-requests`)).body.follow_ups_due], [1, 1]);
    assert.equal(followUpState({ request_uid: uid, due_on: '2026-11-10', done_at: null, snoozed_until: null }, '2026-11-03')!.state, 'scheduled');
  } finally { f.close(); }
});

test('the log filters by the caller\'s own teams and by status; another team or a bad status is refused', async () => {
  const f = fixture();
  try {
    await shareAll(f, 2);
    const a = await ask(f);
    const b = await call(f, 4, 'POST', `${R}/intro-request`, { teammate: 2, ref: 24 }).then((r) => r.body.request.uid);
    await step(f, 2, a, '/decide', { decision: 'accepted' });
    // A second team the two share (venture 2), with a request asked there.
    f.db.exec("INSERT INTO projects(id,name,founder_id) VALUES (2,'Second venture',100)");
    f.db.exec("INSERT INTO project_members(project_id,user_id,role,status) VALUES (2,4,'cofounder','accepted')");
    f.db.exec("INSERT INTO relationship_interactions(uid,kind,requester_user_id,teammate_user_id,team_key,person_name) VALUES ('c01234567890123456789abcdefabcde','intro_requested',4,2,'project:2','Synthetic Grace')");
    const c = 'c01234567890123456789abcdefabcde';
    const by = async (q: string) => (await call(f, 4, 'GET', `${R}/intro-requests${q}`)).body.sent.map((r: any) => r.uid);
    assert.deepEqual(await by('?status=accepted'), [a]);
    assert.deepEqual((await by('?status=pending')).sort(), [b, c].sort());
    assert.deepEqual(await by('?team=project:1&status=pending'), [b]);
    assert.deepEqual((await by('?team=project:1')).sort(), [a, b].sort(), 'the other team\'s request is not in it');
    assert.deepEqual(await by('?team=project:2'), [c]);
    assert.equal((await by('')).length, 3);
    assert.deepEqual(await by('?team=project:1&status=made'), []);
    assert.equal((await call(f, 4, 'GET', `${R}/intro-requests?status=asked`)).body.error, 'status_invalid');
    for (const team of ['project:3', 'hq', 'firm:6', '*', 'bogus']) {
      const r = await call(f, 4, 'GET', `${R}/intro-requests?team=${encodeURIComponent(team)}`);
      assert.deepEqual([r.status, r.body.detail], [404, 'Not found.'], `${team}: not one of mine, in the words of nothing`);
    }
    assert.deepEqual((await call(f, 3, 'GET', `${R}/intro-requests?team=project:3`)).body, { sent: [], received: [], follow_ups_due: 0 });
  } finally { f.close(); }
});

test('KEY: a member who never shared is in no request, no log row and no count; nothing is sent to the person', async () => {
  const f = fixture();
  try {
    // Nobody shared: no request can exist, so every read is empty and every step is not found.
    for (const who of [2, 3, 4, 5, 6]) {
      assert.deepEqual((await call(f, who, 'GET', `${R}/intro-requests`)).body, { sent: [], received: [], follow_ups_due: 0 });
      assert.equal((await call(f, who, 'POST', `${R}/intro-request`, { teammate: 2, ref: 21 })).status, 404);
    }
    await shareAll(f, 2);
    const uid = await ask(f);
    await step(f, 2, uid, '/decide', { decision: 'accepted' });
    for (const s of PRIVATE) {
      for (const who of [2, 4]) assert.ok(!(await call(f, who, 'GET', `${R}/intro-requests`)).text.includes(s), `${who}'s log carries ${s}`);
    }
    // Every step on someone else's request, and on one that does not exist, is the same 404.
    const steps: Array<[string, string, unknown]> = [['POST', '/decide', { decision: 'accepted' }], ['POST', '/withdraw', undefined], ['POST', '/outcome', { outcome: 'replied' }],
      ['PUT', '/follow-up', { due_on: TODAY }], ['POST', '/follow-up/done', undefined], ['POST', '/follow-up/snooze', { until: dayAfter(2) }]];
    for (const [method, path, json] of steps) {
      for (const [who, target] of [[3, uid], [5, uid], [6, uid], [4, 'f'.repeat(32)], [4, 'not-a-uid']] as const) {
        const r = await call(f, who, method, `${R}/intro-requests/${target}${path}`, json);
        assert.deepEqual([r.status, r.body.detail], [404, 'Not found.'], `${who} ${method} ${path} ${target}`);
      }
    }
    for (const [method, path, json] of steps) {
      const r = await call(f, 4, method, `${R}/intro-requests/${uid}${path}`, json, { impersonated_by: 1 });
      assert.deepEqual([r.status, r.body.error], [403, 'support_session_refused'], path);
    }
    assert.equal(f.sends.length, 0, 'no route sent anything');
  } finally { f.close(); }
});

test('every step is audited by ids, never an email', async () => {
  const f = fixture();
  try {
    await shareAll(f, 2);
    const a = await ask(f);
    await step(f, 2, a, '/decide', { decision: 'accepted' });
    await sendIntro(f, 2, (await mailbox(f, 2)).uid, a);
    await step(f, 4, a, '/outcome', { outcome: 'replied' });
    const b = await ask(f);
    await step(f, 4, b, '/withdraw');
    const audits = f.db.prepare("SELECT actor_user_id, owner_user_id, subject FROM integration_audit_log WHERE provider = 'relationships' AND event = 'access' ORDER BY id").all()
      .map((r: any) => `${r.actor_user_id}>${r.owner_user_id} ${r.subject}`);
    assert.deepEqual(audits, [`4>2 intro_request:${a}`, `2>4 intro_accepted:${a}`, `2>4 intro_made:${a}`, `4>2 intro_outcome:${a}`, `4>2 intro_request:${b}`, `4>2 intro_withdrawn:${b}`]);
    assert.ok(!JSON.stringify(audits).includes('@'));
  } finally { f.close(); }
});

test('the migration keeps the requests 653 already holds, with their ids, and widens the vocabulary', () => {
  const db = migratedDatabase();
  try {
    const cols = (db.prepare('PRAGMA table_info(relationship_interactions)').all() as any[]).map((c) => c.name);
    for (const c of ['context_note', 'decision_note', 'outcome', 'outcome_note', 'recorded_by_user_id', 'mail_sent_uid', 'accepted_at', 'made_at', 'withdrawn_at']) assert.ok(cols.includes(c), c);
    db.exec("INSERT INTO users(id, role, name, email, is_active) VALUES (2,'founder','a','a@example.invalid',1),(4,'founder','b','b@example.invalid',1)");
    db.exec("INSERT INTO relationship_interactions(uid,kind,requester_user_id,teammate_user_id,team_key,person_name,status) VALUES ('a','intro_requested',4,2,'project:1','x','accepted')");
    assert.throws(() => db.exec("INSERT INTO relationship_interactions(uid,kind,requester_user_id,teammate_user_id,team_key,person_name,outcome) VALUES ('b','outcome',4,2,'project:1','x',NULL)"), /CHECK/);
    assert.throws(() => db.exec("INSERT INTO relationship_interactions(uid,kind,requester_user_id,teammate_user_id,team_key,person_name,outcome) VALUES ('c','outcome',4,2,'project:1','x','great')"), /CHECK/);
    assert.throws(() => db.exec("INSERT INTO relationship_follow_ups(uid,request_uid,user_id,due_on) VALUES ('d','a',4,'soon')"), /CHECK/);
  } finally { db.close(); }
});

test('D1357 (#3572): a request names the asker and the teammate, by name, to the two of them; never an email', async () => {
  // Mutation checked: the names left out of the view → the two names fail; the log built without them → the received row fails.
  const f = fixture();
  try {
    await shareAll(f, 2);
    const r = await call(f, 4, 'POST', `${R}/intro-request`, { teammate: 2, ref: 21, note: 'Met at the demo day.' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const made = r.body.request;
    assert.deepEqual([made.requester, made.teammate], [{ id: 4, name: 'Synthetic member 4' }, { id: 2, name: 'Synthetic member 2' }]);
    for (const who of [4, 2]) {
      const log = await call(f, who, 'GET', `${R}/intro-requests`);
      assert.equal(log.status, 200);
      const row = [...log.body.sent, ...log.body.received][0];
      assert.deepEqual([row.requester.name, row.teammate.name], ['Synthetic member 4', 'Synthetic member 2']);
      assert.equal(/synthetic-\d@example\.invalid/.test(log.text), false, 'no member email');
      for (const p of PRIVATE) assert.equal(log.text.includes(p), false, `${p} is never in the log`);
    }
  } finally { f.close(); }
});
