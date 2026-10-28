/**
 * D1344 (#3552, part 5 of #3547): the two Worker reads the Email page needs.
 *
 *   · `GET /api/mail/sent` — the member's own sent log, newest first, 20 a
 *     page, with the refs each quoted and the person of the draft it came
 *     from; `person` keeps that person's rows; another member's rows never.
 *   · the pack's `person.address` — the address the person's own module row
 *     records (a prospect's, a co-founder's, a growth partner's contact), null
 *     for an interview, which records none, and null for a Network match,
 *     whose address only `GET /api/mail/shares` serves (D1342).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import mailAccounts from '../src/routes/mail_accounts.ts';
import mailDrafts from '../src/routes/mail_drafts.ts';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

after(removeMigratedDatabases);
const JWT_SECRET = 'synthetic-d1344-only-not-a-real-credential'.repeat(2);
const FOUNDER = 2, OTHER = 3;

async function fixture() {
  __resetForTest();
  const db = migratedDatabase();
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  insert.run(FOUNDER, 'founder', 100, 'Synthetic founder', 'synthetic-2@example.invalid', 'studio');
  insert.run(OTHER, 'founder', 300, 'Other founder', 'synthetic-3@example.invalid', 'studio');
  db.exec(`
    INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100);
    INSERT INTO discovery_interviews(id,project_id,interviewee_name,stage,done_at,pains_json,updated_at) VALUES (11,1,'Synthetic Ada','done','2026-10-01','[]','2026-10-02 09:00:00');
    INSERT INTO raise_prospects(id,uid,project_id,name,firm,stage,email,updated_at) VALUES (21,'p21',1,'Synthetic Investor','Synthetic Fund','talking',' Investor@Example.invalid ','2026-10-03 10:00:00'),
                                                                                         (22,'p22',1,'No Address','','talking','not an address','2026-10-03 10:00:00');
    INSERT INTO cap_table_holders(id,user_id,project_id,name,security_type,shares,founder_role,email,updated_at) VALUES (5,2,1,'Synthetic Cofounder','common',1000,'cofounder','cofounder@example.invalid','2026-10-04 10:00:00');
    INSERT INTO growth_partners(uid,project_id,name,type,stage,contact_email,updated_at) VALUES ('gp1abc',1,'Synthetic Partner','referral','talking','partner@example.invalid','2026-10-05 10:00:00');
    INSERT INTO mail_accounts(id,uid,user_id,provider,address) VALUES (1,'acct1',${FOUNDER},'outlook','me@example.invalid'),(2,'acct2',${OTHER},'outlook','other@example.invalid');
    INSERT INTO mail_drafts(uid,user_id,person_ref,intent,tone,length,subject,body) VALUES ('d1',${FOUNDER},'prospect:21','send_update','warm','short','Update','Body'),
                                                                                       ('d2',${FOUNDER},'interviewee:11','thank_follow_up','warm','short','Thanks','Body');
  `);
  const sent = db.prepare('INSERT INTO mail_sent(uid,user_id,account_id,recipient,recipient_hash,subject,draft_uid,refs_json,sent_at,error,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  for (let i = 0; i < 23; i++) {
    const draft = i % 2 ? 'd1' : 'd2';
    sent.run(`s${i}`, FOUNDER, 1, `person${i}@example.invalid`, `h${i}`, `Subject ${i}`, i === 22 ? null : draft, JSON.stringify(i % 2 ? ['prospect:21', 'kpis:1'] : ['interviewee:11']),
      i === 21 ? null : `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T09:00:00Z`, i === 21 ? 'The mail server refused it. Nothing was sent.' : null, `2026-10-01 09:${String(i).padStart(2, '0')}:00`);
  }
  sent.run('o1', OTHER, 2, 'secret-recipient@example.invalid', 'ho', 'Not yours', null, '[]', '2026-10-05T09:00:00Z', null, '2026-10-05 09:00:00');
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/mail', mailAccounts).route('/api/mail', mailDrafts);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, env, app, close: () => db.close() };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, path: string) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { headers: { Authorization: `Bearer ${jwt}` } }, f.env);
  return { status: res.status, body: await res.json() as any };
}

test('the sent log: the member\'s own rows, newest first, 20 a page, with what each quoted', async () => {
  const f = await fixture();
  try {
    const one = await call(f, FOUNDER, '/api/mail/sent');
    assert.equal(one.status, 200);
    assert.deepEqual([one.body.total, one.body.page, one.body.per_page, one.body.items.length], [23, 1, 20, 20]);
    assert.equal(one.body.items[0].uid, 's22', 'newest first');
    assert.deepEqual(one.body.items.find((r: any) => r.uid === 's21'), {
      uid: 's21', to: 'person21@example.invalid', subject: 'Subject 21', sent_at: null, created_at: '2026-10-01 09:21:00',
      status: 'failed', error: 'The mail server refused it. Nothing was sent.', draft_uid: 'd1', person: 'prospect:21', quoted: ['prospect:21', 'kpis:1'],
    });
    assert.equal(one.body.items[0].person, null, 'a send with no draft names no person');
    const two = await call(f, FOUNDER, '/api/mail/sent?page=2');
    assert.deepEqual(two.body.items.map((r: any) => r.uid), ['s2', 's1', 's0']);
    assert.doesNotMatch(JSON.stringify([one.body, two.body]), /secret-recipient|Not yours/, 'another member\'s rows never');
    const theirs = await call(f, OTHER, '/api/mail/sent');
    assert.deepEqual(theirs.body.items.map((r: any) => r.uid), ['o1']);
    const prospect = await call(f, FOUNDER, '/api/mail/sent?person=prospect:21');
    assert.equal(prospect.body.total, 11);
    assert.ok(prospect.body.items.every((r: any) => r.person === 'prospect:21'));
    assert.equal((await call(f, OTHER, '/api/mail/sent?person=prospect:21')).body.total, 0, 'a person filter reads only the member\'s own drafts');
    assert.equal((await call(f, FOUNDER, '/api/mail/sent?page=-4')).body.page, 1);
  } finally { f.close(); }
});

test('the pack carries the address the person\'s own module row records, and nothing else', async () => {
  const f = await fixture();
  try {
    const addr = async (ref: string) => (await call(f, FOUNDER, `/api/mail/context?person=${encodeURIComponent(ref)}`)).body.person?.address;
    assert.equal(await addr('prospect:21'), 'investor@example.invalid', 'trimmed and lower-cased');
    assert.equal(await addr('prospect:22'), null, 'a value that is not an address is not guessed into one');
    assert.equal(await addr('cofounder:h-5'), 'cofounder@example.invalid');
    assert.equal(await addr('growth_partner:gp1abc'), 'partner@example.invalid');
    assert.equal(await addr('interviewee:11'), null, 'an interview records no address');
    assert.equal((await call(f, OTHER, '/api/mail/context?person=prospect:21')).status, 404, 'another venture\'s record, address and all');
  } finally { f.close(); }
});
