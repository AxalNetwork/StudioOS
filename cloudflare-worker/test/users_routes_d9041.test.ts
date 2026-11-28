/**
 * D9041 (#9041) — `/api/users`, the user-administration reads, pinned against a real SQLite
 * database (the production baseline's `users`, `founders`, `partners` and `super_admins`).
 *
 *  1. The unaudited admin create is gone: `POST /api/users` answers 404 and writes no row.
 *  2. The list is admin only, and `?role=` filters on the stored role.
 *  3. One record: a member reads their own and no one else's; an admin reads a non-admin's
 *     but not another admin's or the Super Admin's; the Super Admin reads any admin's.
 *  4. The linked founder and partner rows carry named columns only.
 *
 * Every person is synthetic (`Fixture …`, `example.test`).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/users_routes_d9041.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import users from '../src/routes/users.ts';

const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const SECRET = ['fixture', 'users', randomUUID(), randomUUID()].join('-');

// 1 Super Admin, 2 and 3 admins, 4 and 5 founders (4 linked to founder 40), 6 a partner (linked to partner 60).
const SUPER = 1, ADMIN = 2, OTHER_ADMIN = 3, FOUNDER = 4, OTHER_FOUNDER = 5, PARTNER = 6;

function world() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'founders', 'partners', 'super_admins']) db.exec(tableFromBaseline(BASELINE, t));
  db.prepare("INSERT INTO founders (id, name, email, company, bio, sf_contact_id) VALUES (40, 'Fixture Founder', 'founder-4@example.test', 'Fixture Co', 'Fixture bio', 'fixture-sf-contact')").run();
  db.prepare("INSERT INTO partners (id, name, email, company, specialization, referral_code, directory_decided_by) VALUES (60, 'Fixture Partner', 'partner-6@example.test', 'Fixture Partners', 'legal', 'fixture-referral', 1)").run();
  const people: Array<[number, string, number | null, number | null]> = [
    [SUPER, 'admin', null, null], [ADMIN, 'admin', null, null], [OTHER_ADMIN, 'admin', null, null],
    [FOUNDER, 'founder', 40, null], [OTHER_FOUNDER, 'founder', null, null], [PARTNER, 'partner', null, 60],
  ];
  for (const [id, role, founderId, partnerId] of people) {
    db.prepare('INSERT INTO users (id, email, name, role, is_active, founder_id, partner_id, created_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)')
      .run(id, `member-${id}@example.test`, `Fixture ${id}`, role, founderId, partnerId, `2026-11-0${id}T00:00:00Z`);
  }
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>();
  app.route('/api/users', users);
  app.onError((err, c) => c.json({ error: 'refused' }, (AUTH_ERROR_STATUSES as any)[err.message] ?? 500));
  async function call(path: string, as: number | null, method = 'GET', body?: unknown) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (as !== null) {
      headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: as }).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    }
    const res = await app.request(`https://app.example.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    let json: any = null;
    try { json = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, body: json };
  }
  const count = () => (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  return { call, count };
}

test('1. POST /api/users answers 404 to an admin and the Super Admin, and writes no row', async () => {
  const w = world();
  for (const as of [ADMIN, SUPER]) {
    const r = await w.call('/api/users', as, 'POST', { email: `new-${as}@example.test`, name: 'Fixture New', role: 'partner' });
    assert.equal(r.status, 404, `caller ${as}`);
  }
  assert.equal(w.count(), 6);
});

test('2. the list is admin only, and ?role=admin returns only admins', async () => {
  const w = world();
  assert.equal((await w.call('/api/users', FOUNDER)).status, 403, 'a founder is refused the list');
  assert.equal((await w.call('/api/users?role=admin', PARTNER)).status, 403, 'and a partner, with a filter');
  assert.equal((await w.call('/api/users', null)).status, 401, 'no session');
  const all = await w.call('/api/users', ADMIN);
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.map((u: any) => u.id), [6, 5, 4, 3, 2, 1], 'every user, newest first');
  const admins = await w.call('/api/users?role=admin', ADMIN);
  assert.deepEqual(admins.body.map((u: any) => [u.id, u.role]), [[3, 'admin'], [2, 'admin'], [1, 'admin']]);
  const founders = await w.call('/api/users?role=founder', ADMIN);
  assert.deepEqual(founders.body.map((u: any) => u.id), [5, 4]);
  assert.deepEqual(Object.keys(all.body[0]).sort(), ['created_at', 'email', 'email_verified', 'id', 'is_active', 'name', 'role', 'uid']);
});

test('3. a founder reads their own record and is refused another user\'s', async () => {
  const w = world();
  const own = await w.call(`/api/users/${FOUNDER}`, FOUNDER);
  assert.equal(own.status, 200);
  assert.equal(own.body.id, FOUNDER);
  for (const target of [OTHER_FOUNDER, ADMIN, SUPER, PARTNER]) {
    assert.equal((await w.call(`/api/users/${target}`, FOUNDER)).status, 403, `founder reading ${target}`);
  }
  assert.equal((await w.call(`/api/users/${FOUNDER}`, null)).status, 401);
  assert.equal((await w.call('/api/users/0', FOUNDER)).status, 400);
});

test('4. an admin reads a non-admin\'s record and their own, but not another admin\'s or the Super Admin\'s', async () => {
  const w = world();
  for (const target of [FOUNDER, OTHER_FOUNDER, PARTNER, ADMIN]) {
    assert.equal((await w.call(`/api/users/${target}`, ADMIN)).status, 200, `admin reading ${target}`);
  }
  for (const target of [OTHER_ADMIN, SUPER]) {
    const r = await w.call(`/api/users/${target}`, ADMIN);
    assert.equal(r.status, 403, `admin reading ${target}`);
    assert.equal(r.body.error, 'super_admin_required');
    assert.equal(r.body.email, undefined, 'the refusal carries nothing of the record');
  }
  assert.equal((await w.call('/api/users/99', ADMIN)).status, 404);
});

test('5. the Super Admin reads any admin\'s record', async () => {
  const w = world();
  for (const target of [ADMIN, OTHER_ADMIN, SUPER, FOUNDER]) {
    const r = await w.call(`/api/users/${target}`, SUPER);
    assert.equal(r.status, 200, `Super Admin reading ${target}`);
    assert.equal(r.body.id, target);
  }
});

test('6. the linked founder and partner rows carry named columns only', async () => {
  const w = world();
  const founder = (await w.call(`/api/users/${FOUNDER}`, FOUNDER)).body.founder;
  assert.deepEqual(Object.keys(founder).sort(),
    ['bio', 'company', 'created_at', 'domain_expertise', 'email', 'experience_years', 'id', 'linkedin_url', 'name', 'uid']);
  assert.equal(founder.name, 'Fixture Founder');
  const partner = (await w.call(`/api/users/${PARTNER}`, ADMIN)).body.partner;
  assert.deepEqual(Object.keys(partner).sort(), ['company', 'created_at', 'email', 'id', 'name', 'specialization', 'status', 'uid']);
  assert.equal(partner.referral_code, undefined, 'the referral code stays off the read');
});

test('7. the route file serves no write, and the client has no createUser', () => {
  const route = readFileSync('cloudflare-worker/src/routes/users.ts', 'utf8');
  assert.doesNotMatch(route, /users\.(post|put|patch|delete)\(/);
  assert.doesNotMatch(route, /SELECT \* FROM/);
  const api = readFileSync('frontend/src/lib/api.js', 'utf8');
  assert.doesNotMatch(api, /\bcreateUser\s*:/);
  assert.match(api, /listUsers: \(role\) => request\(`\/users/);
});
