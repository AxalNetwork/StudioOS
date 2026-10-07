/**
 * D611 (#1311) — a colleague seat invite is a link the inviter can pass on,
 * and accepting it does not silently change someone's role.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/investor_seats_d611.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import seats from '../src/routes/investor_seats.ts';
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

const roleOf = (db: DatabaseSync, id: number) => (db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string }).role;

test('D611/D632: the inviter gets the link once, never the token, and the list never carries it', async () => {
  const db = freshDb();
  const invited = await call(db, 'POST', '/investor-seats/invite', 1, { email: 'seat@firm.test' });
  assert.equal(invited.status, 200);
  assert.equal(invited.body.email_sent, false);
  assert.match(invited.body.invite_link, /^https:\/\/axal\.vc\/investor-seats\/accept\?token=/);
  assert.equal('invite_token' in invited.body, false);
  const token = new URL(invited.body.invite_link).searchParams.get('token');
  assert.ok(token);

  const listed = await call(db, 'GET', '/investor-seats', 1);
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  const pending = listed.body.seats.find((s: any) => s.seat_email === 'seat@firm.test');
  // D632 supersedes D611 here: the link is shown once, in the invite reply.
  assert.equal(pending.invite_link, undefined);
  assert.equal('invite_token' in pending, false);

  const accepted = await call(db, 'POST', '/investor-seats/accept', 4, { token });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const after = await call(db, 'GET', '/investor-seats', 1);
  const joined = after.body.seats.find((s: any) => s.seat_email === 'seat@firm.test');
  assert.equal(joined.invite_link, undefined);
  assert.equal(roleOf(db, 4), 'investor');

  const again = await call(db, 'POST', '/investor-seats/invite', 1, { email: 'other@firm.test' });
  const otherId = (await call(db, 'GET', '/investor-seats', 1)).body.seats.find((s: any) => s.seat_email === 'other@firm.test').id;
  assert.equal((await call(db, 'DELETE', `/investor-seats/${otherId}`, 1)).status, 200);
  const revoked = (await call(db, 'GET', '/investor-seats', 1)).body.seats.find((s: any) => s.seat_email === 'other@firm.test');
  assert.ok(revoked.revoked_at);
  assert.equal(revoked.invite_link, undefined);
  assert.equal(again.body.email_sent, false);
});

test('D611: an admin cannot take a seat, and a founder must confirm the role change', async () => {
  const db = freshDb();
  const adminInvite = await call(db, 'POST', '/investor-seats/invite', 1, { email: 'admin@firm.test' });
  const adminToken = new URL(adminInvite.body.invite_link).searchParams.get('token');
  const admin = await call(db, 'POST', '/investor-seats/accept', 2, { token: adminToken });
  assert.equal(admin.status, 409);
  assert.equal(admin.body.error, 'admin_cannot_take_seat');
  assert.equal(roleOf(db, 2), 'admin');

  const founderInvite = await call(db, 'POST', '/investor-seats/invite', 1, { email: 'founder@firm.test' });
  const founderToken = new URL(founderInvite.body.invite_link).searchParams.get('token');
  const held = await call(db, 'POST', '/investor-seats/accept', 3, { token: founderToken });
  assert.equal(held.status, 409);
  assert.equal(held.body.error, 'role_change_needs_confirmation');
  assert.equal(held.body.role, 'founder');
  assert.equal(roleOf(db, 3), 'founder');

  const ok = await call(db, 'POST', '/investor-seats/accept', 3, { token: founderToken, confirm_role_change: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(roleOf(db, 3), 'investor');
});
