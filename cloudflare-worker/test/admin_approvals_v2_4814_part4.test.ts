/**
 * D4814 (#4814, part 4) — Decided as an audit trail (AP-07): `hq=0` leaves
 * HQ's lanes out for a Super Admin ("Include HQ lanes"), and `deciders` lists
 * every admin account for "Decided by", names only. The database is the
 * baseline plus every migration, schema only, as D1044's test builds it.
 * Every name is made up.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import approvalsRoute from '../src/routes/admin_approvals.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const SUPER = 1, PLAIN = 2, MEMBER = 3, GONE = 5;
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, ?)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test', 1);
  u.run(PLAIN, 'admin', 'Pat Plain', 'pat@example.test', 1);
  u.run(MEMBER, 'founder', 'Mo Member', 'mo@example.test', 1);
  u.run(GONE, 'admin', '', 'gone@example.test', 0);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, PLAIN, MEMBER]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))")
      .run(id, `totp-${id}`);
  }
  db.exec(`INSERT INTO lp_applications (id, user_id, fund_slug, investor_type, status, reviewed_by, reviewed_at, created_at) VALUES
    (1, ${MEMBER}, 'f1', 'individual', 'approved', ${PLAIN}, datetime('now', '-1 day'), datetime('now', '-3 days'))`);
  return db;
}

const app = new Hono();
app.route('/api/admin/approvals', approvalsRoute);
async function call(db: DatabaseSync, who: number, path: string) {
  const token = await new SignJWT({ user_id: who, role: 'admin', jti: `totp-${who}` }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(`/api/admin/approvals${path}`, { headers: { Authorization: `Bearer ${token}` } },
      { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}

test('hq=0 leaves HQ\'s lanes out for a Super Admin; a plain Admin never had them; anything else is refused', async () => {
  const db = fixture();
  const all = await call(db, SUPER, '/decided');
  assert.equal(all.status, 200);
  assert.ok(all.body.lanes.some((l: any) => l.scope === 'hq'), 'a Super Admin reads HQ\'s lanes by default');
  const studio = await call(db, SUPER, '/decided?hq=0');
  assert.ok(!studio.body.lanes.some((l: any) => l.scope === 'hq'), 'hq=0 leaves them out');
  assert.equal(studio.body.lanes.length, all.body.lanes.filter((l: any) => l.scope !== 'hq').length, 'and only them');
  assert.equal((await call(db, SUPER, '/decided?hq=0&lane=support')).body.error, 'bad_lane', 'an HQ lane cannot be named with hq=0');
  assert.equal((await call(db, SUPER, '/decided?hq=1&lane=support')).status, 200);
  const plain = await call(db, PLAIN, '/decided?hq=1');
  assert.ok(!plain.body.lanes.some((l: any) => l.scope === 'hq'), 'hq=1 grants a plain Admin nothing');
  const bad = await call(db, SUPER, '/decided?hq=yes');
  assert.deepEqual([bad.status, bad.body.error], [400, 'bad_hq']);
});

test('deciders: every admin account, active or not, by name; no member; names only', async () => {
  const db = fixture();
  const { body } = await call(db, PLAIN, '/decided');
  assert.deepEqual(body.deciders, [{ id: GONE, name: 'gone@example.test' }, { id: PLAIN, name: 'Pat Plain' }, { id: SUPER, name: 'Sue Super' }]);
  assert.ok(!body.deciders.some((d: any) => d.id === MEMBER), 'a member never decides');
  assert.ok(body.deciders.every((d: any) => Object.keys(d).sort().join() === 'id,name'), 'no email field, no role');
  assert.equal(body.items.length, 1, 'the log is unchanged');
});
