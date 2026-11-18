/**
 * D6052 (#6052) — inviting a raise prospect who has no Axal account, through Contacts' one invite path.
 *
 *   1. The owner invites a prospect: one `raise_prospect_invites` row (who invited whom), one audit row,
 *      the prospect's contact linked, the email sent; the invitations read says Invited and its date.
 *   2. A sent invitation blocks another for a day; a failed send blocks nothing and reads as not invited.
 *   3. The address is the prospect's own: a typed one fills an empty prospect and never replaces one.
 *   4. Who may invite: the owner only. A co-founder reads why not; staff, another founder and another
 *      venture's prospect are refused, and nothing is written.
 *   5. An account with the invited address is linked to the invitation, and still joins no call's audience
 *      until it is an active investor whose KYC is approved.
 *   6. The route's own rate-limit bucket: per founder, fail-closed, POST only.
 *
 * Real routes over tables read from the canonical baseline and migrations. The clock is fixed. Every person
 * is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/prospect_invites_6052.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import contacts from '../src/routes/contacts.ts';
import { notOnAxal } from '../src/services/roundCalls.ts';
import { CONTACT_INVITE_SEND } from '../src/middleware/rateLimit.ts';
import { INVITE_ROLE_REASON } from '../src/services/prospectInvites.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const SECRET = 'fixture-only-d6052-01234567890123456789';
const NOW = Date.parse('2026-11-16T15:00:00.000Z');
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const migration = (f: string) => readFileSync(`cloudflare-worker/sql/migrations/${f}`, 'utf8');

/**
 * People: 1 the owner of venture 1; 2 the owner of venture 2; 6 a co-founder on venture 1; 9 an admin;
 * 4 a verified investor. Prospects on venture 1: 1 Nora (address, no account), 2 Ola (no address),
 * 3 Ivy (the verified investor); on venture 2: 9 Elsewhere.
 */
function fixture(mail: 'sent' | 'off' = 'sent') {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const table of ['entities', 'users', 'founders', 'super_admins', 'user_sessions', 'user_company_links', 'projects', 'raise_prospects',
    'activity_logs', 'project_members', 'mi_pro_subscriptions']) db.exec(tableFromBaseline(baseline, table));
  db.exec(migration('277_user_recovery_state.sql'));
  db.exec(migration('127_contacts.sql'));
  db.exec(migration('128_contact_promotion.sql').split('\n').filter((l) => !/^\s*--/.test(l)).join('\n'));
  db.exec(migration('166_contact_attribution.sql'));
  db.exec(migration('386_contact_strength_organization.sql'));
  db.exec(migration('202611161518_6052_raise_prospect_invites.sql'));
  db.exec("INSERT INTO founders(id,name,email) VALUES(1,'Owner','owner@example.test'),(2,'Other','other@example.test'),(6,'Cofounder','co@example.test')");
  const user = db.prepare('INSERT INTO users(id,name,email,role,founder_id,kyc_status,is_active) VALUES(?,?,?,?,?,?,?)');
  for (const row of [[1, 'Owner', 'owner@example.test', 'founder', 1, 'approved', 1], [2, 'Other', 'other@example.test', 'founder', 2, 'approved', 1],
    [4, 'Ivy', 'ivy@example.test', 'investor', null, 'approved', 1], [6, 'Cofounder', 'co@example.test', 'founder', 6, 'approved', 1],
    [9, 'Admin', 'admin@example.test', 'admin', null, 'approved', 1]]) user.run(...row);
  db.exec(`INSERT INTO projects(id,uid,name,founder_id,company_id) VALUES (1,'energy','Energy',1,NULL),(2,'other','Other',2,NULL),(3,'cofounders','Own',6,NULL);
    INSERT INTO project_members(project_id,user_id,role,status) VALUES (1,6,'cofounder','accepted');
    INSERT INTO raise_prospects(id,uid,project_id,name,email) VALUES
      (1,'p1',1,'Nora','Nora@Example.test'),(2,'p2',1,'Ola',NULL),(3,'p3',1,'Ivy','ivy@example.test'),(9,'p9',2,'Elsewhere','elsewhere@example.test');`);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'production', APP_URL: 'https://app.example.test',
    ...(mail === 'sent' ? { GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh' } : {}) };
  return { db, env };
}

function clock(t: any, at = NOW) {
  mock.timers.enable({ apis: ['Date'], now: at });
  t.after(() => mock.timers.reset());
  const sent: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: any) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/')) return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
    if (String(url).startsWith('https://gmail.googleapis.com/')) { sent.push(String(init?.body || '')); return new Response('{}', { status: 200 }); }
    throw new Error('unexpected fetch ' + url);
  }) as any;
  t.after(() => { globalThis.fetch = realFetch; });
  return sent;
}

async function call(f: any, path: string, who: number, method = 'GET', body?: unknown) {
  const app = new Hono<any>(); app.route('/api/contacts', contacts);
  app.onError((e, c) => c.json({ error: e.message }, (AUTH_ERROR_STATUSES[e.message] || 500) as any));
  const headers: any = { Authorization: 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET)) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const quiet = console.error; console.error = () => {};
  try {
    const res = await app.request('/api/contacts' + path, { method, headers, ...body === undefined ? {} : { body: JSON.stringify(body) } }, f.env);
    return { status: res.status, body: await res.json() as any };
  } finally { console.error = quiet; }
}
const invite = (f: any, body: Record<string, unknown>, who = 1) => call(f, '/invite', who, 'POST', { project_id: 1, ...body });
const states = async (f: any, who = 1) => (await call(f, '/raise-prospects/invites?project_id=1', who)).body;
const stateOf = async (f: any, id: number, who = 1) => (await states(f, who)).items.find((i: any) => i.prospect_id === id);
const count = (f: any, sql: string) => Number((f.db.prepare(sql).get() as any).n);

test('1. the owner invites a prospect: one invitation row, one audit row, the contact linked, and Invited with its date', async (t) => {
  // Mutations checked: the invitation row not written; the audit row not written; invited_by not the actor;
  // the invited date read from a failed send; the contact not linked to the prospect.
  const sent = clock(t);
  const f = fixture();
  assert.deepEqual(await stateOf(f, 1), { prospect_id: 1, has_email: true, invited_at: null, joined_at: null }, 'not invited yet');
  const r = await invite(f, { prospect_id: 1, message: 'Join us for the seed.' });
  assert.equal(r.status, 201);
  assert.equal(r.body.email_sent, true);
  assert.equal(r.body.invite.invited_at, '2026-11-16T15:00:00.000Z');
  assert.equal(sent.length, 1, 'one email left');
  const row = f.db.prepare('SELECT * FROM raise_prospect_invites').all() as any[];
  assert.equal(row.length, 1);
  assert.deepEqual([row[0].project_id, row[0].prospect_id, row[0].invited_by, row[0].email, row[0].email_sent, row[0].accepted_user_id],
    [1, 1, 1, 'nora@example.test', 1, null], 'who invited whom, at the prospect’s own address, lower-cased');
  const audit = f.db.prepare("SELECT * FROM activity_logs WHERE action = 'raise_prospect_invited'").all() as any[];
  assert.equal(audit.length, 1, 'one audit record');
  assert.deepEqual([audit[0].user_id, audit[0].project_id, JSON.parse(audit[0].details).invite_uid], [1, 1, row[0].uid]);
  assert.doesNotMatch(audit[0].details, /@/, 'the audit row holds no address');
  const prospect = f.db.prepare('SELECT contact_id FROM raise_prospects WHERE id = 1').get() as any;
  assert.equal(prospect.contact_id, row[0].contact_id, 'the prospect’s contact is the invitation’s');
  assert.equal((f.db.prepare('SELECT status, audience FROM contacts WHERE id = ?').get(prospect.contact_id) as any).status, 'invited');
  assert.equal(count(f, 'SELECT COUNT(*) AS n FROM contact_replies'), 1, 'the contact’s history says the invitation went out');
  const read = await states(f);
  assert.deepEqual([read.can_invite, read.reason, read.gap_hours], [true, null, 24]);
  assert.deepEqual(read.items.find((i: any) => i.prospect_id === 1), { prospect_id: 1, has_email: true, invited_at: '2026-11-16T15:00:00.000Z', joined_at: null });
  assert.doesNotMatch(JSON.stringify(read), /@/, 'the read returns no address');
});

test('2. a sent invitation blocks another for a day; a failed send blocks nothing and is not Invited', async (t) => {
  // Mutations checked: the day's gap dropped; the gap counting failed sends; the cutoff a day too long.
  clock(t);
  const f = fixture();
  assert.equal((await invite(f, { prospect_id: 1 })).status, 201);
  mock.timers.setTime(NOW + 23 * 3600_000);
  const again = await invite(f, { prospect_id: 1 });
  assert.deepEqual([again.status, again.body.error, again.body.invited_at], [429, 'invite_recent', '2026-11-16T15:00:00.000Z']);
  assert.equal(count(f, 'SELECT COUNT(*) AS n FROM raise_prospect_invites'), 1, 'a refused invitation writes nothing');
  mock.timers.setTime(NOW + 25 * 3600_000);
  assert.equal((await invite(f, { prospect_id: 1 })).status, 201, 'a day later it can be sent again');

  const off = fixture('off');
  const failed = await invite(off, { prospect_id: 1 });
  assert.deepEqual([failed.status, failed.body.email_sent, failed.body.invite.invited_at], [201, false, null]);
  assert.ok(failed.body.email_error, 'the failure is said');
  assert.equal(count(off, 'SELECT COUNT(*) AS n FROM raise_prospect_invites WHERE email_sent = 0'), 1, 'the attempt is still recorded');
  assert.equal(count(off, "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'raise_prospect_invited'"), 1);
  assert.equal(count(off, 'SELECT COUNT(*) AS n FROM contact_replies'), 0, 'no delivery is claimed');
  assert.equal((await stateOf(off, 1)).invited_at, null, 'a failed send is not Invited');
  assert.equal((await invite(off, { prospect_id: 1 })).status, 201, 'and it can be tried again at once');
});

test('3. the address is the prospect’s own: a typed one fills an empty prospect and never replaces one', async (t) => {
  // Mutations checked: a typed address replacing the recorded one; an empty prospect invited with no address;
  // the typed address not written to the prospect; a verified investor invited again.
  clock(t);
  const f = fixture();
  const differs = await invite(f, { prospect_id: 1, email: 'someone@else.test' });
  assert.deepEqual([differs.status, differs.body.error], [409, 'prospect_email_differs']);
  assert.equal((await invite(f, { prospect_id: 1, email: ' NORA@example.test ' })).status, 201, 'the same address, typed differently, is the same');
  const none = await invite(f, { prospect_id: 2 });
  assert.deepEqual([none.status, none.body.error], [400, 'email_required']);
  assert.equal((await stateOf(f, 2)).has_email, false);
  assert.equal((await invite(f, { prospect_id: 2, email: 'Ola@Example.test' })).status, 201);
  assert.equal((f.db.prepare('SELECT email FROM raise_prospects WHERE id = 2').get() as any).email, 'ola@example.test', 'the empty prospect takes the address');
  assert.deepEqual({ ...f.db.prepare('SELECT invited_by, email FROM raise_prospect_invites WHERE prospect_id = 2').get() as any },
    { invited_by: 1, email: 'ola@example.test' }, 'the founder who sent it, to the typed address');
  const verified = await invite(f, { prospect_id: 3 });
  assert.deepEqual([verified.status, verified.body.error], [409, 'already_on_axal']);
  assert.equal(count(f, 'SELECT COUNT(*) AS n FROM raise_prospect_invites'), 2, 'only the two sent invitations are recorded');
});

test('4. the owner only: a co-founder reads why not, staff, another founder and another venture’s prospect are refused', async (t) => {
  // Mutations checked: the ownership test dropped from canInviteProspect; staff admitted; another venture's
  // prospect accepted under this venture's id.
  clock(t);
  const f = fixture();
  const member = await states(f, 6);
  assert.deepEqual([member.can_invite, member.reason], [false, INVITE_ROLE_REASON], 'the co-founder reads the reason');
  assert.equal(member.items.length, 3, 'and the pipeline’s invitation states');
  assert.equal((await invite(f, { prospect_id: 1 }, 6)).status, 404, 'a co-founder cannot invite');
  const staff = await invite(f, { prospect_id: 1 }, 9);
  assert.deepEqual([staff.status, staff.body.error], [403, 'admin_read_only']);
  assert.equal((await invite(f, { prospect_id: 1 }, 2)).status, 404, 'another founder');
  const elsewhere = await invite(f, { prospect_id: 9 });
  assert.deepEqual([elsewhere.status, elsewhere.body.error], [404, 'prospect_not_found']);
  assert.equal((await call(f, '/raise-prospects/invites?project_id=1', 2)).status, 404, 'another founder reads nothing');
  assert.equal(count(f, 'SELECT COUNT(*) AS n FROM raise_prospect_invites'), 0, 'nothing is written');
  assert.equal(count(f, "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'raise_prospect_invited'"), 0);
});

test('5. the account that joins is linked to its invitation, and joins no call until it is a verified investor', async (t) => {
  // Mutations checked: linking an invitation that never left; stamping an acceptance with no account.
  clock(t);
  const f = fixture();
  await invite(f, { prospect_id: 1 });
  const offOnly = fixture('off');
  await invite(offOnly, { prospect_id: 1 });
  assert.equal((await stateOf(f, 1)).joined_at, null, 'no account yet');
  assert.deepEqual({ ...f.db.prepare('SELECT accepted_user_id, accepted_at FROM raise_prospect_invites').get() as any },
    { accepted_user_id: null, accepted_at: null }, 'nothing is stamped before an account exists');
  mock.timers.setTime(NOW + 3600_000);
  for (const db of [f.db, offOnly.db]) db.exec("INSERT INTO users(id,name,email,role,kyc_status,is_active) VALUES(20,'Nora','nora@example.test','exploring','pending',1)");
  assert.equal((await stateOf(f, 1)).joined_at, '2026-11-16T16:00:00.000Z', 'Joined, with its date');
  assert.equal((f.db.prepare('SELECT accepted_user_id FROM raise_prospect_invites').get() as any).accepted_user_id, 20, 'the account is linked');
  assert.equal((await stateOf(offOnly, 1)).joined_at, null, 'an invitation that never left links nothing');

  const callRow: any = { project_id: 1 };
  const waiting = (await notOnAxal(f.env, callRow, [1])).map((r: any) => r.prospect_id);
  assert.ok(waiting.includes(1), 'joined but not a verified investor: still not choosable');
  f.db.exec("UPDATE users SET role='investor' WHERE id=20");
  assert.ok((await notOnAxal(f.env, callRow, [1])).some((r: any) => r.prospect_id === 1), 'an investor whose KYC is pending is not choosable');
  f.db.exec("UPDATE users SET kyc_status='approved' WHERE id=20");
  assert.ok(!(await notOnAxal(f.env, callRow, [1])).some((r: any) => r.prospect_id === 1), 'a verified investor leaves the not-on-Axal list and can be chosen');
});

test('6. Contacts’ invite route has its own bucket: per founder, fail-closed, POST only', () => {
  const src = readFileSync('cloudflare-worker/src/middleware/rateLimit.ts', 'utf8');
  const at = src.indexOf("name: 'contact_invite_send'");
  const end = src.indexOf('\n  },', at);
  assert.ok(at >= 0 && end > at, 'the contact_invite_send bucket is gone');
  const bucket = src.slice(at, end);
  assert.equal((bucket.match(/name: '/g) ?? []).length, 1, 'the slice reads one bucket');
  const limit = Number(/limit:\s*(\d+)/.exec(bucket)?.[1]);
  assert.ok(limit > 0 && limit <= 20, `limit ${limit} is a real cap`);
  assert.ok(Number(/windowSec:\s*(\d+)/.exec(bucket)?.[1]) >= 3600);
  assert.match(bucket, /failClosed:\s*true/);
  assert.match(bucket, /scope:\s*'user'/);
  assert.match(bucket, /m === 'POST' && CONTACT_INVITE_SEND\.test\(p\)/);
  for (const p of ['/api/contacts/invite', '/api/contacts/invite/']) assert.ok(CONTACT_INVITE_SEND.test(p), p);
  for (const p of ['/api/contacts/invites', '/api/contacts/x/invite', '/api/contacts/raise-prospects/invites', '/api/contacts/invite/extra']) assert.ok(!CONTACT_INVITE_SEND.test(p), p);
});
