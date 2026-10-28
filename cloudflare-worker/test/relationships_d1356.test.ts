/**
 * D1356 (#3571, part 7 of #3564): the team relationship layer. Synthetic
 * people on the real migrated schema; `fetch` throws, so nothing can reach a
 * contact.
 *
 *   · a member who did not share is never returned, by any route, called as anyone, from any team;
 *   · no email, phone, notes or URL in any shared reply;
 *   · withdrawing takes effect on the next read, for every team or for one;
 *   · an ineligible source (an API row) is never shared;
 *   · a name alone never matches;
 *   · every share, withdrawal, read and introduction request is audited.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import relationships from '../src/routes/relationships.ts';
import { INTRO_REQUESTS_PER_DAY, whoKnowsQuery } from '../src/services/relationships.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

after(removeMigratedDatabases);
const JWT_SECRET = 'synthetic-d1356-only-not-a-real-credential'.repeat(2);
const ADA_URL = 'https://www.linkedin.com/in/synthetic-ada';
const PRIVATE = ['ada@example.invalid', 'linkedin.com', 'Synthetic private note', '+1 555 0100', 'bob@example.invalid', 'dan@example.invalid'];

// Who is who:
//   2 founder of venture 1, 4 its co-founder, 5 its advisor (not its team), 3 founder of venture 3;
//   6 an investor firm, 7 its accepted seat, 8 its revoked seat; 1 and 9 HQ admins.
function fixture() {
  const db = migratedDatabase();
  const u = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, investor_seat_primary_user_id) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid, primary] of [[1, 'admin', null, null], [9, 'admin', null, null], [2, 'founder', 100, null], [3, 'founder', 300, null],
    [4, 'founder', null, null], [5, 'advisor', null, null], [6, 'investor', null, null], [7, 'investor', null, 6], [8, 'investor', null, 6]] as const) {
    u.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, primary);
  }
  db.exec("INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(3,'Other venture',300)");
  db.exec(`INSERT INTO project_members(project_id,user_id,role,status) VALUES (1,4,'cofounder','accepted'),(1,5,'advisor','accepted')`);
  db.exec(`INSERT INTO investor_seats(id,primary_user_id,seat_email,seat_user_id,accepted_at,revoked_at) VALUES
           (1,6,'synthetic-7@example.invalid',7,'2026-10-01',NULL),(2,6,'synthetic-8@example.invalid',8,'2026-10-01','2026-10-10')`);
  const nc = db.prepare('INSERT INTO network_connections(id,user_id,name,email,company,title,phone,notes,source,linkedin_url,connected_on) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  nc.run(21, 2, 'Synthetic Ada', 'ada@example.invalid', 'Acme', 'CTO', '+1 555 0100', 'Synthetic private note', 'linkedin_csv', ADA_URL, '2024-03-12');
  nc.run(22, 2, 'Synthetic Bob', 'bob@example.invalid', 'Acme', 'CEO', null, null, 'manual', null, null);
  nc.run(23, 2, 'Synthetic Carl', null, 'Acme', 'COO', null, null, 'linkedin_api', 'https://www.linkedin.com/in/synthetic-carl', null);
  nc.run(24, 2, 'Synthetic Grace', null, 'Navy', null, null, null, 'manual', null, null);
  nc.run(41, 4, 'Ada S.', null, 'Acme', null, null, null, 'csv', ADA_URL, null);
  nc.run(31, 3, 'Synthetic Ada', null, 'Acme', null, null, null, 'linkedin_csv', ADA_URL, null);
  nc.run(71, 7, 'Synthetic Dan', 'dan@example.invalid', 'Fund Co', 'Partner', null, null, 'manual', null, null);
  nc.run(81, 8, 'Synthetic Fay', null, 'Fund Co', null, null, null, 'manual', null, null);
  nc.run(11, 1, 'Synthetic Eve', null, 'Gov', null, null, null, 'manual', null, null);
  const src = db.prepare('INSERT INTO contact_sources(owner_user_id,contact_table,contact_id,source,created_row) VALUES (?,\'network_connections\',?,?,1)');
  src.run(2, 21, 'linkedin_csv'); src.run(2, 23, 'linkedin_api'); src.run(4, 41, 'csv'); src.run(3, 31, 'linkedin_csv');
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/relationships', relationships);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in this test'); }) as any;
  const close = () => { globalThis.fetch = real; db.close(); };
  const audits = () => db.prepare("SELECT actor_user_id, owner_user_id, event, subject FROM integration_audit_log WHERE provider = 'relationships' ORDER BY id").all().map((r: any) => ({ ...r }));
  return { db, env, app, close, audits };
}
type F = ReturnType<typeof fixture>;

async function call(f: F, who: number, method: string, path: string, json?: unknown, claims: Record<string, unknown> = {}) {
  const jwt = await new SignJWT({ user_id: who, ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: json === undefined ? undefined : JSON.stringify(json) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text };
}
const ADA = `/api/relationships/who-knows?person=${encodeURIComponent(ADA_URL)}`;
const ACME = '/api/relationships/who-knows?company=Acme';
const share = (f: F, who: number, on: boolean) => call(f, who, 'PUT', '/api/relationships/sharing', { share: on });
const owners = (r: any) => (r.body.people || []).map((p: any) => `${p.teammate.id}:${p.ref}`).sort();
const EVERYONE = [1, 2, 3, 4, 5, 6, 7, 8, 9];

test('a query names one person by URL or email, or a company or fund; a name alone is refused', () => {
  assert.deepEqual(whoKnowsQuery({ person: 'https://uk.linkedin.com/in/Synthetic-Ada/?trk=x' }), { kind: 'person', value: `url:${ADA_URL}` });
  assert.deepEqual(whoKnowsQuery({ person: ' Ada@Example.invalid ' }), { kind: 'person', value: 'email:ada@example.invalid' });
  assert.throws(() => whoKnowsQuery({ person: 'Synthetic Ada' }), /A name alone never matches/);
  assert.throws(() => whoKnowsQuery({}), /one person, company or fund/);
  assert.throws(() => whoKnowsQuery({ person: 'x@example.invalid', company: 'Acme' }), /one person, company or fund/);
  assert.deepEqual(whoKnowsQuery({ fund: 'Fund Co' }), { kind: 'fund', value: 'Fund Co' });
});

test('KEY: a member who did not share is never returned, by any route, called as anyone, from any team', async () => {
  const f = fixture();
  try {
    for (const who of EVERYONE) {
      for (const path of [ADA, ACME, '/api/relationships/who-knows?person=bob%40example.invalid', '/api/relationships/who-knows?fund=Fund%20Co', '/api/relationships/who-knows?company=Gov']) {
        const r = await call(f, who, 'GET', path);
        assert.equal(r.status, 200, `${who} ${path}`);
        assert.deepEqual(r.body.people, [], `${who} ${path}: nobody shared`);
      }
      for (const [teammate, ref] of [[2, 21], [2, 22], [4, 41], [3, 31], [7, 71], [1, 11]]) {
        if (teammate === who) continue;
        const r = await call(f, who, 'POST', '/api/relationships/intro-request', { teammate, ref });
        assert.deepEqual([r.status, r.body.detail], [404, 'Not found.'], `${who} asking ${teammate}:${ref}`);
      }
      const reqs = await call(f, who, 'GET', '/api/relationships/intro-requests');
      assert.deepEqual([reqs.body.sent, reqs.body.received], [[], []]);
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM relationship_interactions').get()!.n, 0);
  } finally { f.close(); }
});

test('shared, a teammate sees that a member knows a person — name, company, title — and never their email, phone, notes or URL', async () => {
  const f = fixture();
  try {
    assert.equal((await share(f, 2, true)).status, 200);
    const r = await call(f, 4, 'GET', ADA);
    assert.deepEqual(r.body.people, [{
      ref: 21, teammate: { id: 2, name: 'Synthetic member 2' }, team: { key: 'project:1', label: 'Synthetic venture' },
      person: { name: 'Synthetic Ada', company: 'Acme', title: 'CTO' },
      how: { source: 'linkedin_csv', source_label: 'LinkedIn connections file', connected_since: '2024-03-12' },
    }]);
    for (const s of PRIVATE) assert.ok(!r.text.includes(s), `the reply carries ${s}`);
    assert.deepEqual(owners(await call(f, 4, 'GET', '/api/relationships/who-knows?person=ada%40example.invalid')), ['2:21'], 'by exact email');
    const acme = await call(f, 4, 'GET', ACME);
    assert.deepEqual(owners(acme), ['2:21', '2:22'], 'a typed row is the member\'s to share; an API row is not');
    for (const s of PRIVATE) assert.ok(!acme.text.includes(s), `the company reply carries ${s}`);
    for (const who of [3, 5, 6, 7, 8, 1, 9]) assert.deepEqual((await call(f, who, 'GET', ACME)).body.people, [], `${who} is not on venture 1's team`);
    assert.deepEqual((await call(f, 2, 'GET', ACME)).body.people, [], 'my own rows are not "a teammate knows"');
    assert.deepEqual((await call(f, 2, 'GET', ADA)).body.people, [], 'and 4 has not shared');
  } finally { f.close(); }
});

test('an ineligible source is never shared, and a name alone never matches', async () => {
  const f = fixture();
  try {
    await share(f, 2, true);
    const carl = await call(f, 4, 'GET', `/api/relationships/who-knows?person=${encodeURIComponent('https://www.linkedin.com/in/synthetic-carl')}`);
    assert.deepEqual(carl.body.people, [], 'an API-only row waits for part 5\'s flags');
    assert.equal((await call(f, 4, 'POST', '/api/relationships/intro-request', { teammate: 2, ref: 23 })).status, 404);
    const name = await call(f, 4, 'GET', '/api/relationships/who-knows?person=Synthetic%20Grace');
    assert.deepEqual([name.status, name.body.error], [400, 'person_unmatchable']);
    assert.equal(f.db.prepare('SELECT person_key FROM shared_relationships WHERE contact_id = 24').get()!.person_key, null, 'Grace has no identity key');
    assert.equal(f.db.prepare('SELECT linkedin_url FROM network_connections WHERE id = 41').get()!.linkedin_url, ADA_URL, 'a member\'s own rows are not rewritten');
  } finally { f.close(); }
});

test('withdrawing takes effect on the next read, for every team or for one', async () => {
  const f = fixture();
  try {
    await share(f, 2, true);
    assert.deepEqual(owners(await call(f, 4, 'GET', ADA)), ['2:21']);
    const off = await call(f, 2, 'PUT', '/api/relationships/sharing/teams/project:1', { share: false });
    assert.deepEqual(off.body.teams, [{ key: 'project:1', kind: 'venture', label: 'Synthetic venture', shared: false }]);
    assert.equal(off.body.opted_in, true);
    assert.deepEqual((await call(f, 4, 'GET', ADA)).body.people, [], 'off for this team');
    await call(f, 2, 'PUT', '/api/relationships/sharing/teams/project:1', { share: true });
    assert.deepEqual(owners(await call(f, 4, 'GET', ADA)), ['2:21'], 'on again');
    await share(f, 2, false);
    assert.deepEqual(owners(await call(f, 4, 'GET', ADA)), ['2:21'], 'a team turned on by itself stays on');
    await call(f, 2, 'PUT', '/api/relationships/sharing/teams/project:1', { share: false });
    assert.deepEqual((await call(f, 4, 'GET', ADA)).body.people, []);
    await share(f, 2, true);
    assert.deepEqual((await call(f, 4, 'GET', ADA)).body.people, [], 'the opt-in does not override a team turned off');
    assert.deepEqual((await call(f, 2, 'PUT', '/api/relationships/sharing/teams/project:3', { share: true })).body.error, 'not_found', 'not my team');
    assert.equal((await call(f, 2, 'PUT', '/api/relationships/sharing/teams/firm:6', { share: true })).status, 404);
    assert.equal((await call(f, 2, 'PUT', '/api/relationships/sharing/teams/bogus', { share: true })).status, 404);
    assert.equal((await call(f, 2, 'PUT', '/api/relationships/sharing', { share: 'yes' })).status, 400);
  } finally { f.close(); }
});

test('teams come from the memberships Axal records: a firm and its accepted seats, HQ admins; never an advisor or a revoked seat', async () => {
  const f = fixture();
  try {
    for (const who of [7, 8, 1, 5]) await share(f, who, true);
    assert.deepEqual(owners(await call(f, 6, 'GET', '/api/relationships/who-knows?fund=Fund%20Co')), ['7:71'], 'the seat, not the revoked seat');
    assert.deepEqual((await call(f, 8, 'GET', '/api/relationships/who-knows?fund=Fund%20Co')).body.people, [], 'a revoked seat is no longer the firm');
    assert.deepEqual(owners(await call(f, 9, 'GET', '/api/relationships/who-knows?company=Gov')), ['1:11'], 'HQ admins');
    assert.deepEqual((await call(f, 2, 'GET', '/api/relationships/who-knows?company=Gov')).body.people, [], 'a founder is not HQ');
    assert.deepEqual((await call(f, 6, 'GET', '/api/relationships/sharing')).body.teams.map((t: any) => t.key), ['firm:6']);
    assert.deepEqual((await call(f, 5, 'GET', '/api/relationships/sharing')).body.teams, [], 'an advisor is on no venture\'s team');
    assert.deepEqual((await call(f, 4, 'GET', '/api/relationships/sharing')).body.teams.map((t: any) => t.key), ['project:1']);
  } finally { f.close(); }
});

test('an introduction request reaches the teammate alone, sends nothing to the contact, and is decided once by them', async () => {
  const f = fixture();
  try {
    await share(f, 2, true);
    await share(f, 1, true);
    assert.equal((await call(f, 4, 'POST', '/api/relationships/intro-request', { teammate: 1, ref: 21 })).status, 404, 'the contact is 2\'s: asking someone else for it is not found');
    assert.equal((await call(f, 4, 'POST', '/api/relationships/intro-request', { teammate: 4, ref: 21 })).status, 404, 'nor asking myself');
    const ask = await call(f, 4, 'POST', '/api/relationships/intro-request', { teammate: 2, ref: 21, note: 'Met at the demo day.' });
    assert.equal(ask.status, 201, JSON.stringify(ask.body));
    assert.deepEqual([ask.body.request.kind, ask.body.request.status, ask.body.request.person], ['intro_requested', 'pending', { name: 'Synthetic Ada', company: 'Acme' }]);
    for (const s of PRIVATE) assert.ok(!ask.text.includes(s));
    const n = f.db.prepare('SELECT user_id, type, title, body FROM notifications_inbox ORDER BY id').all() as any[];
    assert.deepEqual(n.map((x) => [x.user_id, x.type]), [[2, 'relationship_intro_requested']], 'the teammate is told; nobody else');
    assert.match(n[0].body, /Nothing is sent until you decide/);
    const uid = ask.body.request.uid;
    assert.equal((await call(f, 4, 'GET', '/api/relationships/intro-requests')).body.sent[0].uid, uid);
    assert.equal((await call(f, 2, 'GET', '/api/relationships/intro-requests')).body.received[0].uid, uid);
    assert.deepEqual((await call(f, 3, 'GET', '/api/relationships/intro-requests')).body, { sent: [], received: [] });
    assert.equal((await call(f, 4, 'POST', `/api/relationships/intro-requests/${uid}/decide`, { decision: 'made' })).status, 404, 'the asker cannot answer for the teammate');
    assert.equal((await call(f, 2, 'POST', `/api/relationships/intro-requests/${uid}/decide`, { decision: 'maybe' })).status, 400);
    const made = await call(f, 2, 'POST', `/api/relationships/intro-requests/${uid}/decide`, { decision: 'made' });
    assert.deepEqual([made.status, made.body.request.status], [200, 'made']);
    assert.equal((await call(f, 2, 'POST', `/api/relationships/intro-requests/${uid}/decide`, { decision: 'declined' })).body.error, 'decided');
    assert.deepEqual(f.db.prepare('SELECT kind, status, parent_uid FROM relationship_interactions ORDER BY id').all().map((r: any) => [r.kind, r.status, r.parent_uid]),
      [['intro_requested', 'made', null], ['intro_made', 'made', uid]]);
    assert.equal((await call(f, 4, 'POST', '/api/relationships/intro-request', { teammate: 2, ref: 21, note: 'x'.repeat(1001) })).body.error, 'note_too_long');
    await share(f, 2, false);
    assert.equal((await call(f, 4, 'POST', '/api/relationships/intro-request', { teammate: 2, ref: 21 })).status, 404, 'withdrawn: no new request');
  } finally { f.close(); }
});

test('the daily request limit holds; a support session is refused', async () => {
  const f = fixture();
  try {
    await share(f, 2, true);
    const fill = f.db.prepare("INSERT INTO relationship_interactions(uid,kind,requester_user_id,teammate_user_id,team_key,person_name) VALUES (?, 'intro_requested', 4, 2, 'project:1', 'x')");
    for (let i = 0; i < INTRO_REQUESTS_PER_DAY; i++) fill.run(`f${String(i).padStart(31, '0')}`);
    const r = await call(f, 4, 'POST', '/api/relationships/intro-request', { teammate: 2, ref: 21 });
    assert.deepEqual([r.status, r.body.error], [429, 'intro_rate_limited']);
    for (const [method, path, json] of [['GET', ADA], ['GET', '/api/relationships/sharing'], ['PUT', '/api/relationships/sharing', { share: true }],
      ['POST', '/api/relationships/intro-request', { teammate: 2, ref: 21 }], ['GET', '/api/relationships/intro-requests']] as const) {
      const s = await call(f, 4, method, path, json, { impersonated_by: 1 });
      assert.deepEqual([s.status, s.body.error], [403, 'support_session_refused'], path);
    }
  } finally { f.close(); }
});

test('every share, withdrawal, who-knows read and introduction request is audited, by ids and counts', async () => {
  const f = fixture();
  try {
    await share(f, 2, true);
    await call(f, 2, 'PUT', '/api/relationships/sharing/teams/project:1', { share: false });
    await call(f, 2, 'PUT', '/api/relationships/sharing/teams/project:1', { share: true });
    await call(f, 4, 'GET', ADA);
    await call(f, 4, 'GET', '/api/relationships/who-knows?company=Nobody');
    const uid = (await call(f, 4, 'POST', '/api/relationships/intro-request', { teammate: 2, ref: 21 })).body.request.uid;
    await call(f, 2, 'POST', `/api/relationships/intro-requests/${uid}/decide`, { decision: 'declined' });
    await share(f, 2, false);
    assert.deepEqual(f.audits(), [
      { actor_user_id: 2, owner_user_id: 2, event: 'share', subject: 'grant:*' },
      { actor_user_id: 2, owner_user_id: 2, event: 'share', subject: 'withdraw:project:1' },
      { actor_user_id: 2, owner_user_id: 2, event: 'share', subject: 'grant:project:1' },
      { actor_user_id: 4, owner_user_id: 4, event: 'access', subject: 'who_knows:person:1' },
      { actor_user_id: 4, owner_user_id: 2, event: 'access', subject: 'who_knows_shown:person' },
      { actor_user_id: 4, owner_user_id: 4, event: 'access', subject: 'who_knows:company:0' },
      { actor_user_id: 4, owner_user_id: 2, event: 'access', subject: `intro_request:${uid}` },
      { actor_user_id: 2, owner_user_id: 4, event: 'access', subject: `intro_declined:${uid}` },
      { actor_user_id: 2, owner_user_id: 2, event: 'share', subject: 'withdraw:*' },
    ]);
    assert.ok(!JSON.stringify(f.audits()).includes('@'), 'no email in the audit');
  } finally { f.close(); }
});
