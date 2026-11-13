/**
 * D4814 (#4814, part 6, AP-07) — Decided's Open ↗ can open a co-marketing
 * pitch on its own board, which is addressed by uid where the decision log
 * keeps the numeric id: the log's co-marketing rows carry `item_uid`. Every
 * other row is unchanged. Every name is made up.
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
    (1, ${MEMBER}, 'f1', 'individual', 'approved', ${PLAIN}, datetime('now', '-1 day'), datetime('now', '-3 days'));
    INSERT INTO partners (id, name, company, email) VALUES (9, 'Synthetic partner', 'Synthetic agency', 'partner@example.test');
    INSERT INTO comarketing_pitches (id, uid, partner_id, submitter_user_id, title, summary, asset_type, status, reviewed_by_user_id, reviewed_at, created_at, updated_at) VALUES
      (31, 'pitch-abc', 9, ${MEMBER}, 'Synthetic pitch', 'Summary', 'webinar', 'approved', ${PLAIN}, datetime('now', '-2 hours'), datetime('now', '-2 days'), datetime('now', '-2 hours'))`);
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

test('a co-marketing row carries its uid for the board; every other row is as it was', async () => {
  const db = fixture();
  const { status, body } = await call(db, SUPER, '/decided');
  assert.equal(status, 200);
  const pitch = body.items.find((r: any) => r.lane === 'comarketing');
  assert.ok(pitch, JSON.stringify(body.items.map((r: any) => r.lane)));
  assert.deepEqual([pitch.item_id, pitch.item_uid], [31, 'pitch-abc']);
  const lp = body.items.find((r: any) => r.lane === 'lp');
  assert.ok(lp && !('item_uid' in lp), 'only co-marketing rows gain it');
});

test('a pitch gone from the store leaves its row without a uid, never a wrong one', async () => {
  const db = fixture();
  db.exec("UPDATE comarketing_pitches SET uid = 'pitch-new' WHERE id = 31");
  const { body } = await call(db, SUPER, '/decided');
  assert.equal(body.items.find((r: any) => r.lane === 'comarketing').item_uid, 'pitch-new', 'read live, not cached');
  db.exec('DELETE FROM comarketing_pitches WHERE id = 31');
  const after = await call(db, SUPER, '/decided');
  assert.ok(!after.body.items.some((r: any) => r.lane === 'comarketing'), 'a deleted pitch has no decided row to open');
});
