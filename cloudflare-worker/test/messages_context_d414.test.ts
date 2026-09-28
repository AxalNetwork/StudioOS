/**
 * D414 — Messages: who the other person is, and what a thread is about.
 *
 * Built from the migrations that ship (185 messages, 201 advisors, 238 advisor
 * engagements, and since D415 323 attachments, read off disk), through the
 * route itself:
 *
 *   * the counterparty is a card: handle, role, headline, and a name and photo
 *     only where their privacy_prefs show them on their public profile;
 *   * nobody's email address is served, in the list or the thread;
 *   * a thread about an advisor engagement resolves into a context strip for
 *     the advisor and the founder on it, and for nobody else — re-checked on
 *     every read, not trusted from the thread;
 *   * a thread cannot be opened about an engagement its starter cannot open.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import messages, { personCard } from '../src/routes/messages.ts';
import { makeD1 } from './_perks_harness.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MIG = (n: string) => readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations', n), 'utf8');

const ADVISOR = 1, FOUNDER = 2, OUTSIDER = 3, PRIVATE = 4;
const USERS: Array<[number, string, string, string, string | null, string | null, string | null]> = [
  // id, role, name, uid, headline, display_name, privacy_prefs
  [ADVISOR, 'advisor', 'Ada Advisor', 'ada-handle', 'GTM and pricing', 'Ada A.', null],
  [FOUNDER, 'founder', 'Finn Founder', 'finn-handle', 'Building async ops', null, null],
  [OUTSIDER, 'partner', 'Otto Outsider', 'otto-handle', null, null, null],
  [PRIVATE, 'investor', 'Priv Person', 'priv-handle', 'Seed investor', null, JSON.stringify({ public_profile: { name: false, headshot: false } })],
];

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY, uid TEXT UNIQUE NOT NULL, role TEXT NOT NULL, email TEXT, name TEXT NOT NULL,
    display_name TEXT, headline TEXT, privacy_prefs TEXT, headshot_r2_key TEXT,
    is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, subscription_tier TEXT, subscription_status TEXT
  );`);
  for (const m of ['185_messages.sql', '201_advisors_table_in_ledger.sql', '238_advisor_engagements.sql', '323_message_attachments.sql']) db.exec(MIG(m));
  const u = db.prepare('INSERT INTO users (id, role, name, uid, headline, display_name, privacy_prefs, email, headshot_r2_key) VALUES (?,?,?,?,?,?,?,?,?)');
  for (const [id, role, name, uid, headline, dn, pp] of USERS) u.run(id, role, name, uid, headline, dn, pp, `${uid}@example.test`, `headshots/${uid}.png`);
  db.prepare(`INSERT INTO advisors (id, uid, user_id, display_name) VALUES (10, 'adv-10', ?, 'Ada A.')`).run(ADVISOR);
  db.prepare(`INSERT INTO advisor_engagements (id, uid, advisor_id, founder_user_id, client_name, lane, scope_label, amount_cents)
              VALUES (77, 'eng-77', 10, ?, 'Finn Co', 'signed', 'Pricing pressure-test', 420000)`).run(FOUNDER);
  return db;
}

async function token(userId: number) {
  const role = USERS.find((u) => u[0] === userId)![1];
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

function harness() {
  const db = freshDb();
  const env = { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db, { beforeBatch: null }) };
  const call = async (method: string, path: string, who: number, body?: any) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${await token(who)}` };
    const init: RequestInit = { method, headers };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; (init as any).body = JSON.stringify(body); }
    const res = await messages.request(path, init, env);
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { db, call };
}

const start = (call: any, from: number, toUid: string, extra: Record<string, unknown> = {}) =>
  call('POST', '/', from, { to_email: `${toUid}@example.test`, body: 'Hello there', ...extra });

test('the list serves each counterparty as a card, and no email anywhere', async () => {
  const { call } = harness();
  const created = await start(call, ADVISOR, 'finn-handle');
  assert.equal(created.status, 201);
  // Two unread in ONE conversation, so the total cannot pass by counting threads.
  assert.equal((await call('POST', `/${created.body.uid}/messages`, ADVISOR, { body: 'And a follow-up' })).status, 201);
  const r = await call('GET', '/', FOUNDER);
  assert.equal(r.status, 200);
  const [t] = r.body.items;
  assert.deepEqual(t.participants, [{
    user_id: ADVISOR, handle: 'ada-handle', role: 'advisor', name: 'Ada A.', headline: 'GTM and pricing',
    headshot_url: '/api/settings/headshot/ada-handle', profile_path: '/u/ada-handle',
  }]);
  assert.ok(!JSON.stringify(r.body).includes('@example.test'), 'an email address reached the list');
  assert.equal(t.unread, 2);
  assert.equal(r.body.unread_total, 2);
  assert.equal(r.body.items.length, 1);
  assert.match(r.body.absent.auto_threads, /do not open on their own/);
});

test('a member who hides their name and photo publicly is not named here either', async () => {
  const { call } = harness();
  await start(call, PRIVATE, 'finn-handle');
  const list = await call('GET', '/', FOUNDER);
  const p = list.body.items[0].participants[0];
  assert.equal(p.name, null);
  assert.equal(p.headshot_url, null);
  assert.equal(p.headline, 'Seed investor', 'the headline shows, as it does on the public card');
  assert.match(list.body.absent.name, /does not show their name/);
  const detail = await call('GET', `/${list.body.items[0].uid}`, FOUNDER);
  assert.equal(detail.body.participants[0].name, null);
  assert.ok(!JSON.stringify(detail.body).includes('Priv Person'), 'the hidden name leaked through the thread');
});

test('the thread serves cards and sender ids, never a name or address on each message', async () => {
  const { call } = harness();
  const created = await start(call, ADVISOR, 'finn-handle');
  const d = await call('GET', `/${created.body.uid}`, FOUNDER);
  assert.equal(d.status, 200);
  assert.deepEqual(d.body.me, { user_id: FOUNDER });
  // D415 adds each message's files, by id and name only.
  assert.deepEqual(Object.keys(d.body.messages[0]).sort(), ['attachments', 'body', 'created_at', 'sender_user_id', 'uid']);
  assert.deepEqual(d.body.participants.map((p: any) => p.user_id), [ADVISOR], 'the reader is not their own counterparty');
  assert.ok(!JSON.stringify(d.body).includes('@example.test'), 'an email address reached the thread');
});

test('an engagement thread resolves for the advisor and the founder on it', async () => {
  const { call } = harness();
  const created = await start(call, ADVISOR, 'finn-handle', { subject_type: 'engagement', subject_id: 77, subject: 'Pricing' });
  assert.equal(created.status, 201);
  const asAdvisor = await call('GET', `/${created.body.uid}`, ADVISOR);
  assert.deepEqual(asAdvisor.body.context, {
    kind: 'Engagement', title: 'Pricing pressure-test', amount_cents: 420000, status: 'Signed',
    link: { label: 'View engagement', path: '/practice/engagements' }, link_absent: null,
  });
  const asFounder = await call('GET', `/${created.body.uid}`, FOUNDER);
  assert.equal(asFounder.body.context.title, 'Pricing pressure-test');
  assert.equal(asFounder.body.context.link, null);
  assert.match(asFounder.body.absent.context_link, /no page yet where a founder opens/);
});

test('being in the thread is not enough: a participant not on the engagement sees nothing about it', async () => {
  const { db, call } = harness();
  const created = await start(call, ADVISOR, 'otto-handle', { subject_type: 'engagement', subject_id: 77 });
  assert.equal(created.status, 201, 'the advisor may pin their own engagement');
  const asOutsider = await call('GET', `/${created.body.uid}`, OUTSIDER);
  assert.equal(asOutsider.status, 200);
  assert.equal(asOutsider.body.context, null);
  assert.ok(!JSON.stringify(asOutsider.body).includes('Pricing pressure-test'), 'the title leaked');
  assert.ok(!JSON.stringify(asOutsider.body).includes('420000'), 'the amount leaked');
  // Re-checked on read: moving the engagement to another founder takes the
  // strip away from the old one without touching the thread.
  const t2 = await start(call, ADVISOR, 'finn-handle', { subject_type: 'engagement', subject_id: 77 });
  db.prepare('UPDATE advisor_engagements SET founder_user_id = ? WHERE id = 77').run(OUTSIDER);
  const after = await call('GET', `/${t2.body.uid}`, FOUNDER);
  assert.equal(after.body.context, null);
  // "Cannot see" and "does not exist" read the same.
  db.prepare('DELETE FROM advisor_engagements WHERE id = 77').run();
  const gone = await call('GET', `/${t2.body.uid}`, ADVISOR);
  assert.equal(gone.body.context, null);
  assert.equal(gone.body.absent.context, asOutsider.body.absent.context);
});

test('a thread cannot be opened about an engagement its starter cannot open', async () => {
  const { db, call } = harness();
  const r = await start(call, OUTSIDER, 'finn-handle', { subject_type: 'engagement', subject_id: 77 });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'subject_not_found');
  assert.equal(typeof r.body.message, 'string');
  // A made-up id answers the same as a real one the caller cannot open.
  const ghost = await start(call, OUTSIDER, 'finn-handle', { subject_type: 'engagement', subject_id: 9999 });
  assert.deepEqual(ghost.body, r.body);
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM message_threads').get() as any).n), 0);
  const bad = await start(call, ADVISOR, 'finn-handle', { subject_type: 'engagement', subject_id: 'abc' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'subject_invalid');
});

test('a subject type nothing writes shows the Worker’s sentence, not a guess', async () => {
  const { call } = harness();
  const created = await start(call, ADVISOR, 'finn-handle', { subject_type: 'match', subject_id: 5 });
  assert.equal(created.status, 201);
  const d = await call('GET', `/${created.body.uid}`, FOUNDER);
  assert.equal(d.body.context, null);
  assert.match(d.body.absent.context, /Nothing in the product opens a conversation about a match yet/);
  const intro = await start(call, ADVISOR, 'otto-handle', { subject_type: 'introduction' });
  const i = await call('GET', `/${intro.body.uid}`, ADVISOR);
  assert.match(i.body.absent.context, /about an introduction yet/);
  const plain = await start(call, ADVISOR, 'otto-handle');
  const p = await call('GET', `/${plain.body.uid}`, ADVISOR);
  assert.equal(p.body.context, null);
  assert.ok(!('context' in p.body.absent), 'a direct message is about nothing, which is not an absence');
});

test('a thread you are not in is still a 404', async () => {
  const { call } = harness();
  const created = await start(call, ADVISOR, 'finn-handle', { subject_type: 'engagement', subject_id: 77 });
  const r = await call('GET', `/${created.body.uid}`, OUTSIDER);
  assert.equal(r.status, 404);
  assert.ok(!JSON.stringify(r.body).includes('Pricing'));
});

test('personCard: role defaults apply, and the card never carries an email', () => {
  const card = personCard({ user_id: 9, handle: 'h', role: 'Founder', name: 'N', display_name: null, headline: null, privacy_prefs: null, headshot_r2_key: null, email: 'x@example.test' });
  assert.deepEqual(card, { user_id: 9, handle: 'h', role: 'founder', name: 'N', headline: null, headshot_url: null, profile_path: '/u/h' });
});
