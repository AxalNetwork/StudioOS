/**
 * D9018 (#9018) — `GET /networkfx/syndicates/:id` returns the caller's own
 * line (`my_line`: commitment_cents, status, joined_at) and nothing about any
 * other member, on real SQLite with synthetic users.
 *
 *   1. A member gets their own line, never another member's user_id, name or
 *      amount; the roster stays empty and the counts stay as they were.
 *   2. The lead and an admin who are not members get `my_line: null`; an admin
 *      who is also a member gets their own line.
 *   3. A signed-in user who is neither lead, member nor admin is refused.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/syndicate_your_line_9018.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import networkfx from '../src/routes/networkfx.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');

const ADMIN = 1, LEAD = 2, MEMBER = 3, OTHER = 4, STRANGER = 5, ADMIN_MEMBER = 6;
const ROLE: Record<number, string> = { 1: 'admin', 2: 'investor', 3: 'investor', 4: 'investor', 5: 'investor', 6: 'admin' };

const app = (() => {
  const a = new Hono();
  a.route('/api/networkfx', networkfx as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    return st ? c.json({ detail: err.message }, st) : c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function call(db: InstanceType<typeof DatabaseSync>, user: number, path: string) {
  const tok = await new SignJWT({ user_id: user, role: ROLE[user] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, { headers: { Authorization: `Bearer ${tok}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
    const text = await res.text();
    return { status: res.status, text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() as any };
  } finally { [console.warn, console.error] = saved; }
}

async function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects']) db.exec(tableFromBaseline(BASELINE, t));
  const u = db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)`);
  u.run(ADMIN, 'admin', 'Synthetic Admin', 'admin@example.test');
  u.run(LEAD, 'investor', 'Synthetic Lead', 'lead@example.test');
  u.run(MEMBER, 'investor', 'Synthetic Member', 'member@example.test');
  u.run(OTHER, 'investor', 'Synthetic Other', 'other@example.test');
  u.run(STRANGER, 'investor', 'Synthetic Stranger', 'stranger@example.test');
  u.run(ADMIN_MEMBER, 'admin', 'Synthetic Staff Member', 'staff@example.test');
  // The route bootstraps its own syndicate tables on first touch.
  await call(db, ADMIN, '/api/networkfx/syndicates');
  db.prepare(`INSERT INTO syndicates (id, name, created_by, target_cents, status) VALUES (1, 'Synthetic syndicate', ?, 9000000, 'open')`).run(LEAD);
  const m = db.prepare(`INSERT INTO syndicate_members (syndicate_id, user_id, commitment_cents, status, joined_at) VALUES (1, ?, ?, ?, ?)`);
  m.run(MEMBER, 2000000, 'committed', '2026-11-20 09:41:00');
  m.run(OTHER, 7777700, 'committed', '2026-11-21 10:00:00');
  m.run(ADMIN_MEMBER, 300000, 'committed', '2026-11-22 11:00:00');
  return db;
}

test('D9018: a member reads their own line and no other member’s', async () => {
  const db = await freshDb();
  try {
    const r = await call(db, MEMBER, '/api/networkfx/syndicates/1');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.my_line, { commitment_cents: 2000000, status: 'committed', joined_at: '2026-11-20 09:41:00' });
    // The rest of the response is as before: counted, not named.
    assert.deepEqual(r.body.members, []);
    assert.equal(r.body.show_member_names, false);
    assert.equal(r.body.member_count, 3);
    assert.equal(r.body.committed_cents, 2000000 + 7777700 + 300000);
    // Nothing of another member reaches the body: their amount, name or id.
    assert.doesNotMatch(r.text, /7777700|Synthetic Other|other@example|Synthetic Staff|300000/);
    assert.ok(!JSON.stringify(r.body.my_line).includes('user_id'), 'my_line carries no user_id');

    const other = await call(db, OTHER, '/api/networkfx/syndicates/1');
    assert.equal(other.body.my_line.commitment_cents, 7777700, 'each member gets their own line');
    assert.doesNotMatch(other.text, /"commitment_cents":2000000\b/);
  } finally { db.close(); }
});

test('D9018: the lead and a non-member admin get my_line null; an admin who is a member gets their own', async () => {
  const db = await freshDb();
  try {
    const lead = await call(db, LEAD, '/api/networkfx/syndicates/1');
    assert.equal(lead.status, 200, lead.text);
    assert.equal(lead.body.my_line, null);
    assert.equal(lead.body.show_member_names, true);
    assert.equal(lead.body.members.length, 3, 'the lead keeps the named roster');

    const admin = await call(db, ADMIN, '/api/networkfx/syndicates/1');
    assert.equal(admin.status, 200, admin.text);
    assert.equal(admin.body.my_line, null);

    const staff = await call(db, ADMIN_MEMBER, '/api/networkfx/syndicates/1');
    assert.equal(staff.status, 200, staff.text);
    assert.deepEqual(staff.body.my_line, { commitment_cents: 300000, status: 'committed', joined_at: '2026-11-22 11:00:00' });
  } finally { db.close(); }
});

test('D9018: a non-member is refused and gets no line', async () => {
  const db = await freshDb();
  try {
    const r = await call(db, STRANGER, '/api/networkfx/syndicates/1');
    assert.equal(r.status, 403, r.text);
    assert.equal(r.body.my_line, undefined);
    assert.doesNotMatch(r.text, /2000000|7777700|Synthetic Member/);
  } finally { db.close(); }
});
