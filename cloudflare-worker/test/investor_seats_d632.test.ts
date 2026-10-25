/**
 * D632 (#1390) — the colleague seat: the invite link is shown once and the
 * list never carries it; the invitation reads its own state before anything
 * changes; every seat write records its actor.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/investor_seats_d632.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import seats, { maskEmail } from '../src/routes/investor_seats.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT,
    role TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    investor_tier TEXT NOT NULL DEFAULT 'free',
    investor_subscription_status TEXT NOT NULL DEFAULT 'free',
    investor_seat_count INTEGER NOT NULL DEFAULT 0,
    investor_seat_primary_user_id INTEGER
  );`);
  db.prepare(`INSERT INTO users (id, email, name, role, investor_tier, investor_subscription_status) VALUES (1, 'owner@firm.test', 'Owner', 'investor', 'institutional', 'active')`).run();
  db.prepare(`INSERT INTO users (id, email, name, role) VALUES (2, 'admin@firm.test', 'Admin', 'admin')`).run();
  db.prepare(`INSERT INTO users (id, email, name, role) VALUES (3, 'founder@firm.test', 'Founder', 'founder')`).run();
  db.prepare(`INSERT INTO users (id, email, name, role) VALUES (4, 'seat@firm.test', 'Seat', 'investor')`).run();
  db.exec(`CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, details TEXT, actor TEXT);`);
  db.exec(`CREATE TABLE investor_profiles (user_id INTEGER PRIMARY KEY, firm_name TEXT);`);
  return db;
}

const app = (() => {
  const a = new Hono();
  a.route('/api/investor-seats', seats as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    return st ? c.json({ detail: err.message }, st) : c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function call(db: DatabaseSync, method: string, path: string, as: number, body?: unknown) {
  const role = db.prepare('SELECT role FROM users WHERE id = ?').get(as) as { role: string };
  const tok = await new SignJWT({ user_id: as, role: role.role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://x/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), APP_URL: 'https://axal.vc' } as any);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json };
}


const logs = (db: DatabaseSync) => db.prepare('SELECT user_id, action, details, actor FROM activity_logs ORDER BY id').all() as any[];
const tokenOf = (link: string) => new URL(link).searchParams.get('token') as string;

test('D632: the invite reply carries the link once; the list carries state and never the link', async () => {
  const db = freshDb();
  const invited = await call(db, 'POST', '/investor-seats/invite', 1, { email: 'seat@firm.test' });
  assert.equal(invited.status, 200);
  assert.match(invited.body.invite_link, /\/investor-seats\/accept\?token=/);
  assert.ok(Number.isInteger(invited.body.id));

  const listed = await call(db, 'GET', '/investor-seats', 1);
  assert.equal(listed.status, 200);
  const [seat] = listed.body.seats;
  assert.equal(seat.id, invited.body.id);
  assert.equal(seat.state, 'invited');
  assert.equal(listed.body.used, 1);
  assert.equal(listed.body.cap, 4);
  assert.ok(!JSON.stringify(listed.body).includes(tokenOf(invited.body.invite_link)), 'the token never comes back from the list');
  assert.equal('invite_link' in seat, false);

  // The list's query never reads the token column at all.
  const srcText = readFileSync(new URL('../src/routes/investor_seats.ts', import.meta.url), 'utf8');
  const listSql = srcText.slice(srcText.indexOf('async function listOwned'), srcText.indexOf('seats.get('));
  assert.equal(/invite_token/.test(listSql), false);

  await call(db, 'POST', '/investor-seats/accept', 4, { token: tokenOf(invited.body.invite_link) });
  await call(db, 'POST', '/investor-seats/invite', 1, { email: 'gone@firm.test' });
  const gone = (await call(db, 'GET', '/investor-seats', 1)).body.seats.find((s: any) => s.seat_email === 'gone@firm.test');
  await call(db, 'DELETE', `/investor-seats/${gone.id}`, 1);
  const after = (await call(db, 'GET', '/investor-seats', 1)).body;
  const states = Object.fromEntries(after.seats.map((s: any) => [s.seat_email, s.state]));
  assert.deepEqual(states, { 'seat@firm.test': 'accepted', 'gone@firm.test': 'revoked' });
  assert.equal(after.used, 1, 'a revoked seat does not count against the plan');
});

test('D632: invite, accept and revoke each record their actor', async () => {
  const db = freshDb();
  const invited = await call(db, 'POST', '/investor-seats/invite', 1, { email: 'seat@firm.test' });
  await call(db, 'POST', '/investor-seats/accept', 4, { token: tokenOf(invited.body.invite_link) });
  await call(db, 'DELETE', `/investor-seats/${invited.body.id}`, 1);
  const rows = logs(db);
  assert.deepEqual(rows.map((r) => [r.action, r.user_id]), [
    ['investor_seat_invited', 1],
    ['investor_seat_accepted', 4],
    ['investor_seat_revoked', 1],
  ]);
  for (const r of rows) {
    assert.match(r.actor, /^[0-9a-f]{16,}$/, 'the actor is the hashed email');
    assert.equal(JSON.parse(r.details).seat_id, invited.body.id);
    assert.ok(!r.details.includes('seat@firm.test'), 'no address in the log line');
  }
});

test('D632: a log failure never undoes the write', async () => {
  const db = freshDb();
  db.exec('DROP TABLE activity_logs');
  const invited = await call(db, 'POST', '/investor-seats/invite', 1, { email: 'seat@firm.test' });
  assert.equal(invited.status, 200);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM investor_seats').get() as any).n, 1);
});

test('D632: the invitation reads who invited, and the firm when it is recorded', async () => {
  const db = freshDb();
  const invited = await call(db, 'POST', '/investor-seats/invite', 1, { email: 'seat@firm.test' });
  const token = tokenOf(invited.body.invite_link);
  const bare = await call(db, 'POST', '/investor-seats/invitation', 4, { token });
  assert.equal(bare.status, 200);
  assert.equal(bare.body.state, 'open');
  assert.deepEqual(bare.body.inviter, { name: 'Owner', firm: null, firm_readable: true });
  assert.equal(bare.body.role, 'investor');
  assert.equal('invited_email' in bare.body, false);

  db.prepare(`INSERT INTO investor_profiles (user_id, firm_name) VALUES (1, 'North Firm')`).run();
  assert.equal((await call(db, 'POST', '/investor-seats/invitation', 4, { token })).body.inviter.firm, 'North Firm');

  db.exec('DROP TABLE investor_profiles');
  const unread = await call(db, 'POST', '/investor-seats/invitation', 4, { token });
  assert.equal(unread.status, 200);
  assert.deepEqual(unread.body.inviter, { name: 'Owner', firm: null, firm_readable: false });
  assert.equal(logs(db).filter((r) => r.action !== 'investor_seat_invited').length, 0, 'reading writes nothing');
});

test('D632: each invitation state, including the wrong account', async () => {
  const db = freshDb();
  const invited = await call(db, 'POST', '/investor-seats/invite', 1, { email: 'seat@firm.test' });
  const token = tokenOf(invited.body.invite_link);

  const wrong = await call(db, 'POST', '/investor-seats/invitation', 3, { token });
  assert.equal(wrong.body.state, 'wrong_account');
  assert.equal(wrong.body.invited_email, 'se***@firm.test');
  assert.ok(!JSON.stringify(wrong.body).includes('seat@firm.test'));

  db.prepare(`UPDATE users SET investor_subscription_status = 'unpaid' WHERE id = 1`).run();
  assert.equal((await call(db, 'POST', '/investor-seats/invitation', 4, { token })).body.state, 'plan_lapsed');
  // D1052: a renewal Stripe is still retrying keeps the plan's seats.
  db.prepare(`UPDATE users SET investor_subscription_status = 'past_due' WHERE id = 1`).run();
  assert.notEqual((await call(db, 'POST', '/investor-seats/invitation', 4, { token })).body.state, 'plan_lapsed');
  db.prepare(`UPDATE users SET investor_subscription_status = 'active' WHERE id = 1`).run();

  assert.equal((await call(db, 'POST', '/investor-seats/accept', 4, { token })).status, 200);
  const mine = await call(db, 'POST', '/investor-seats/invitation', 4, { token });
  assert.equal(mine.body.state, 'accepted', 'the same link reads back as accepted, not as invalid');
  assert.equal(mine.body.yours, true);
  assert.equal((await call(db, 'POST', '/investor-seats/invitation', 3, { token })).body.yours, false);
  const twice = await call(db, 'POST', '/investor-seats/accept', 4, { token });
  assert.equal(twice.status, 409);
  assert.equal(twice.body.error, 'already_accepted');

  await call(db, 'DELETE', `/investor-seats/${invited.body.id}`, 1);
  assert.equal((await call(db, 'POST', '/investor-seats/invitation', 4, { token })).body.state, 'revoked');

  const bad = await call(db, 'POST', '/investor-seats/invitation', 4, { token: 'nope' });
  assert.equal(bad.status, 404);
  assert.match(bad.body.message, /not valid/);
  const none = await call(db, 'POST', '/investor-seats/invitation', 4, {});
  assert.equal(none.status, 400);
  assert.match(none.body.message, /missing its token/);
});

test('D632: every accept refusal reads as a sentence', async () => {
  const db = freshDb();
  const invited = await call(db, 'POST', '/investor-seats/invite', 1, { email: 'seat@firm.test' });
  const token = tokenOf(invited.body.invite_link);
  const wrong = await call(db, 'POST', '/investor-seats/accept', 3, { token });
  assert.equal(wrong.body.error, 'email_mismatch');
  assert.match(wrong.body.message, /different email address/);
  await call(db, 'DELETE', `/investor-seats/${invited.body.id}`, 1);
  const revoked = await call(db, 'POST', '/investor-seats/accept', 4, { token });
  assert.match(revoked.body.message, /revoked this seat/);
  const badEmail = await call(db, 'POST', '/investor-seats/invite', 1, { email: 'x' });
  assert.match(badEmail.body.message, /valid email/);
});

test('D632: maskEmail keeps the domain and two letters', () => {
  assert.equal(maskEmail('jane@firm.com'), 'ja***@firm.com');
  assert.equal(maskEmail('nope'), '***');
});
