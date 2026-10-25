/**
 * D1042 (#2890, Approvals part 4 of #2390) — the product tester store and
 * HQ's decisions.
 *
 * The database is the baseline plus every numbered migration above the cutoff,
 * schema only, so migration 576 runs as it ships and the routes' SQL runs
 * against production's columns. Every person and product is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/product_testers_d1042.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import testersRoute from '../src/routes/admin_product_testers.ts';
import { reapplyAfter, TRANSITIONS } from '../src/services/productTesters.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const SUPER = 1, ADMIN = 2, MEMBER = 3;
const ADA = 10, BEN = 11, CY = 12, DEE = 13, EVE = 14, FAY = 15, ADMIN_TESTER = 16;
const DECLINE = 'Your answers did not cover the testing window.';

const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, email_verified, kyc_status) VALUES (?, ?, ?, ?, 1, ?, ?)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test', 1, 'verified');
  u.run(ADMIN, 'admin', 'Pat Plain', 'pat@example.test', 1, 'verified');
  u.run(MEMBER, 'founder', 'Mo Member', 'mo@example.test', 1, 'verified');
  u.run(ADA, 'founder', 'Ada Applied', 'ada@example.test', 1, 'verified');
  u.run(BEN, 'investor', 'Ben Active', 'ben@example.test', 1, 'not_started');
  u.run(CY, 'partner', 'Cy Paused', 'cy@example.test', 1, 'pending');
  u.run(DEE, 'founder', 'Dee Unverified', 'dee@example.test', 0, 'not_started');
  u.run(EVE, 'founder', 'Eve Declined', 'eve@example.test', 1, 'verified');
  u.run(FAY, 'founder', 'Fay Later', 'fay@example.test', 1, 'verified');
  u.run(ADMIN_TESTER, 'founder', 'Sam Secret', 'sam@example.test', 1, 'verified');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(ADMIN_TESTER);
  for (const id of [SUPER, ADMIN, MEMBER]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))")
      .run(id, `totp-${id}`);
  }
  const t = db.prepare(`INSERT INTO product_testers (id, user_id, status, applied_at, decided_at, decided_by, reason, answers)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  t.run(1, ADA, 'applied', '2026-10-02 09:00:00', null, null, null, '[{"q":"Device","a":"iPhone"}]');
  t.run(2, BEN, 'active', '2026-09-01 09:00:00', '2026-09-03 10:00:00', SUPER, null, '[]');
  t.run(3, CY, 'paused', '2026-09-05 09:00:00', '2026-09-20 10:00:00', SUPER, 'Away until November.', '[]');
  t.run(4, DEE, 'applied', '2026-10-01 09:00:00', null, null, null, '[]');
  t.run(5, EVE, 'declined', '2026-08-01 09:00:00', '2026-08-10 12:00:00', SUPER, 'Not this round.', '[]');
  t.run(6, FAY, 'applied', '2026-10-05 09:00:00', null, null, null, '[]');
  t.run(7, ADMIN_TESTER, 'applied', '2026-10-06 09:00:00', null, null, null, '[]');
  db.prepare(`INSERT INTO testing_programmes (id, uid, owner_kind, created_by, product_name, places, status)
    VALUES (1, 'tp_one', 'hq', ?, 'Ledger Lite', 5, 'testing')`).run(SUPER);
  db.prepare(`INSERT INTO testing_applications (uid, programme_id, user_id, status, created_at)
    VALUES ('ta_one', 1, ?, 'picked', '2026-09-10 09:00:00')`).run(BEN);
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/product-testers', testersRoute);
app.onError((err) => {
  const m = String((err as Error)?.message || '');
  if (m === 'Unauthorized') return new Response(JSON.stringify({ error: m }), { status: 401 });
  if (m === 'Admin required') return new Response(JSON.stringify({ error: m }), { status: 403 });
  throw err;
});

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: who, role: who === MEMBER ? 'founder' : 'admin', jti: `totp-${who}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await withThrownResponses(() => app.request(`/api/admin/product-testers${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error, console.log] = saved; }
}
const statusOf = (db: DatabaseSync, id: number) => (db.prepare('SELECT status FROM product_testers WHERE id = ?').get(id) as any).status;
const eventsOf = (db: DatabaseSync, id: number) => db.prepare(
  'SELECT action, from_status, to_status, actor_user_id, note, reason FROM product_tester_events WHERE tester_id = ? ORDER BY id').all(id).map((r: any) => ({ ...r }));
const inboxOf = (db: DatabaseSync, userId: number) => {
  try { return db.prepare('SELECT type, title, body, link FROM notifications_inbox WHERE user_id = ? ORDER BY id').all(userId) as any[]; } catch { return []; }
};

test('the list is every tester, oldest application first, with the member and every status counted', async () => {
  const db = fixture();
  const res = await call(db, ADMIN, 'GET', '');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.rows.map((r: any) => r.id), [5, 2, 3, 4, 1, 6, 7]);
  assert.deepEqual(res.body.totals, { applied: 4, active: 1, paused: 1, declined: 1, removed: 0, total: 7 });
  const ada = res.body.rows.find((r: any) => r.id === 1);
  assert.deepEqual(ada.member, { id: ADA, name: 'Ada Applied', email: 'ada@example.test', role: 'founder', email_verified: true, kyc_status: 'verified' });
  assert.deepEqual(ada.answers, [{ q: 'Device', a: 'iPhone' }]);
  assert.equal(res.body.rows.find((r: any) => r.id === 4).member.email_verified, false);
  assert.equal(res.body.rows.find((r: any) => r.id === 5).reapply_after, '2026-11-08');
});

test('the list filters by status and pages', async () => {
  const db = fixture();
  const applied = await call(db, ADMIN, 'GET', '?status=applied&page_size=2');
  assert.deepEqual(applied.body.rows.map((r: any) => r.id), [4, 1]);
  assert.equal(applied.body.matching, 4);
  assert.equal(applied.body.page_size, 2);
  const second = await call(db, ADMIN, 'GET', '?status=applied&page_size=2&page=2');
  assert.deepEqual(second.body.rows.map((r: any) => r.id), [6, 7]);
  assert.equal((await call(db, ADMIN, 'GET', '?page_size=500')).body.page_size, 100);
  const bad = await call(db, ADMIN, 'GET', '?status=pending');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'unknown_status');
});

test('one tester carries their programs and history; an unknown one is a 404', async () => {
  const db = fixture();
  const one = await call(db, ADMIN, 'GET', '/2');
  assert.equal(one.status, 200);
  assert.equal(one.body.tester.member.name, 'Ben Active');
  assert.deepEqual(one.body.programs.map((p: any) => [p.product_name, p.program_status, p.application_status]), [['Ledger Lite', 'testing', 'picked']]);
  assert.deepEqual(one.body.events, []);
  assert.equal((await call(db, ADMIN, 'GET', '/99')).status, 404);
  assert.equal((await call(db, ADMIN, 'GET', '/abc')).status, 404);
});

test('only an admin reads or decides', async () => {
  const db = fixture();
  assert.equal((await call(db, MEMBER, 'GET', '')).status, 403);
  assert.equal((await call(db, MEMBER, 'POST', '/1/approve', {})).status, 403);
  assert.equal(statusOf(db, 1), 'applied');
  assert.equal((await call(db, SUPER, 'GET', '')).status, 200);
});

test('approve: applied → active, one event, and the member told by email and inbox', async () => {
  const db = fixture();
  const res = await call(db, ADMIN, 'POST', '/1/approve', { note: 'Good device spread.' });
  assert.equal(res.status, 200);
  assert.equal(res.body.tester.status, 'active');
  assert.equal(res.body.tester.decided_by, ADMIN);
  assert.equal(res.body.tester.note, 'Good device spread.');
  assert.deepEqual(eventsOf(db, 1), [{ action: 'approved', from_status: 'applied', to_status: 'active', actor_user_id: ADMIN, note: 'Good device spread.', reason: null }]);
  const inbox = inboxOf(db, ADA);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].type, 'product_tester_approved');
  assert.equal(inbox[0].link, '/studio');
  assert.doesNotMatch(inbox[0].body, /device spread/, 'the note is HQ\'s and never reaches the member');
  const again = await call(db, ADMIN, 'POST', '/1/approve', {});
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'wrong_status');
  assert.equal(eventsOf(db, 1).length, 1);
});

test('decline needs a reason of 10 characters, tells it, and sets the reapply day 90 days on', async () => {
  const db = fixture();
  const short = await call(db, ADMIN, 'POST', '/1/decline', { reason: 'No room.' });
  assert.equal(short.status, 400);
  assert.equal(short.body.error, 'reason_required');
  assert.equal(statusOf(db, 1), 'applied');
  const res = await call(db, ADMIN, 'POST', '/1/decline', { reason: DECLINE });
  assert.equal(res.status, 200);
  assert.equal(res.body.tester.status, 'declined');
  assert.equal(res.body.tester.reason, DECLINE);
  assert.equal(res.body.reapply_after, reapplyAfter(res.body.tester.decided_at));
  const day = new Date(); day.setUTCDate(day.getUTCDate() + 90);
  assert.equal(res.body.reapply_after, day.toISOString().slice(0, 10));
  const inbox = inboxOf(db, ADA);
  assert.equal(inbox[0].type, 'product_tester_declined');
  assert.ok(inbox[0].body.includes(DECLINE));
  assert.ok(inbox[0].body.includes(res.body.reapply_after));
  assert.equal(eventsOf(db, 1)[0].reason, DECLINE);
});

test('pause needs a reason; resume clears it; remove ends an active or paused tester', async () => {
  const db = fixture();
  assert.equal((await call(db, ADMIN, 'POST', '/2/pause', {})).body.error, 'reason_required');
  const paused = await call(db, ADMIN, 'POST', '/2/pause', { reason: 'Travelling.' });
  assert.equal(paused.body.tester.status, 'paused');
  assert.ok(inboxOf(db, BEN)[0].body.includes('carry on'));
  const resumed = await call(db, ADMIN, 'POST', '/2/resume', {});
  assert.equal(resumed.body.tester.status, 'active');
  assert.equal(resumed.body.tester.reason, null);
  assert.equal((await call(db, ADMIN, 'POST', '/3/remove', {})).body.error, 'reason_required');
  const removed = await call(db, ADMIN, 'POST', '/3/remove', { reason: 'Left the studio.' });
  assert.equal(removed.body.tester.status, 'removed');
  assert.deepEqual(eventsOf(db, 2).map((e) => [e.action, e.from_status, e.to_status]), [['paused', 'active', 'paused'], ['resumed', 'paused', 'active']]);
  assert.deepEqual(eventsOf(db, 3).map((e) => [e.action, e.from_status, e.to_status]), [['removed', 'paused', 'removed']]);
  assert.equal((await call(db, ADMIN, 'POST', '/3/resume', {})).status, 409);
  assert.equal((await call(db, ADMIN, 'POST', '/5/approve', {})).status, 409);
  assert.equal((await call(db, ADMIN, 'POST', '/1/pause', { reason: 'x' })).status, 409);
});

test('every transition is only from its own statuses', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(TRANSITIONS).map(([k, t]) => [k, [t.from, t.to]])), {
    approve: [['applied'], 'active'], decline: [['applied'], 'declined'], pause: [['active'], 'paused'],
    resume: [['paused'], 'active'], remove: [['active', 'paused'], 'removed'],
  });
});

test('a member whose email is not verified cannot be told, so the decision is refused with a code', async () => {
  const db = fixture();
  const res = await call(db, ADMIN, 'POST', '/4/approve', {});
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'email_unverified');
  assert.equal(res.body.message, 'Dee Unverified’s email is not verified, so they cannot be told. Ask them to verify it first.');
  assert.equal(statusOf(db, 4), 'applied');
  assert.deepEqual(eventsOf(db, 4), []);
  assert.deepEqual(inboxOf(db, DEE), []);
});

test('an admin or super admin cannot be a tester', async () => {
  const db = fixture();
  const res = await call(db, ADMIN, 'POST', '/7/approve', {});
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'admins_cannot_test');
  assert.equal(statusOf(db, 7), 'applied');
});

test('a decision raced by another changes nothing and writes no event', async () => {
  const db = fixture();
  const real = d1Over(db);
  // Another admin declines between the read and the write.
  const racing: any = { ...real, prepare: real.prepare.bind(real), batch: async (stmts: any[]) => {
    db.prepare("UPDATE product_testers SET status = 'declined', decided_at = '2026-10-20 10:00:00', decided_by = 1 WHERE id = 6").run();
    return real.batch(stmts);
  } };
  const token = await new SignJWT({ user_id: ADMIN, role: 'admin', jti: `totp-${ADMIN}` }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await withThrownResponses(() => app.request('/api/admin/product-testers/6/approve', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: racing } as any));
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as any).error, 'tester_changed');
  assert.equal(statusOf(db, 6), 'declined');
  assert.deepEqual(eventsOf(db, 6), []);
  assert.deepEqual(inboxOf(db, FAY), []);
});

test('the event log is append-only and a decided row needs its stamp', () => {
  const db = fixture();
  db.prepare("INSERT INTO product_tester_events (tester_id, user_id, action, to_status) VALUES (1, ?, 'applied', 'applied')").run(ADA);
  assert.throws(() => db.prepare("UPDATE product_tester_events SET note = 'x'").run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM product_tester_events').run(), /append-only/);
  assert.throws(() => db.prepare("UPDATE product_testers SET status = 'active' WHERE id = 1").run(), /CHECK/);
  assert.throws(() => db.prepare("UPDATE product_testers SET consent_email_at = '2026-10-01' WHERE id = 1").run(), /CHECK/);
});
