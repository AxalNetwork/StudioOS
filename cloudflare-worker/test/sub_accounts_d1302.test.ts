/**
 * D1302 (#3399, Accounts part 3 of #2377) — an account's sub-accounts, read
 * where each lives: the Product tester (`product_testers`, D1042) and LP
 * (approved `lp_applications`). No second store.
 *
 * D1042's harness: the baseline plus every numbered migration above the
 * cutoff, schema only. The tester transitions, their notices and the refusal
 * of an admin account are D1042's own tests (product_testers_d1042); this file
 * reads what they write. Every person and fund is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/sub_accounts_d1302.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import subAccountsRoute from '../src/routes/admin_sub_accounts.ts';
import testersRoute from '../src/routes/admin_product_testers.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const SUPER = 1, ADMIN = 2, MEMBER = 3, OTHER_ADMIN = 4;
const ADA = 10, BEN = 11, CY = 12, LIA = 13, NOEL = 14, ELEVATED = 15, GONE = 99;

const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

function fixture({ drop = [] as string[] } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, email_verified, kyc_status) VALUES (?, ?, ?, ?, 1, 1, ?)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test', 'verified');
  u.run(ADMIN, 'admin', 'Pat Plain', 'pat@example.test', 'verified');
  u.run(MEMBER, 'founder', 'Mo Member', 'mo@example.test', 'verified');
  u.run(OTHER_ADMIN, 'admin', 'Otto Other', 'otto@example.test', 'verified');
  u.run(ADA, 'founder', 'Ada Applied', 'ada@example.test', 'verified');
  u.run(BEN, 'investor', 'Ben Both', 'ben@example.test', 'verified');
  u.run(CY, 'partner', 'Cy Paused', 'cy@example.test', 'pending');
  u.run(LIA, 'investor', 'Lia Two Funds', 'lia@example.test', 'verified');
  u.run(NOEL, 'exploring', 'Noel None', 'noel@example.test', 'not_started');
  // A Super Admin whose stored role is not 'admin' is an administrator all the same (D1042's rule).
  u.run(ELEVATED, 'founder', 'Eli Elevated', 'eli@example.test', 'verified');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(ELEVATED);
  for (const id of [SUPER, ADMIN, MEMBER]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))")
      .run(id, `totp-${id}`);
  }
  const t = db.prepare(`INSERT INTO product_testers (id, user_id, status, applied_at, decided_at, decided_by, reason, note, answers)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]')`);
  t.run(1, ADA, 'applied', '2026-10-02 09:00:00', null, null, null, null);
  t.run(2, BEN, 'active', '2026-09-01 09:00:00', '2026-09-03 10:00:00', GONE, null, 'HQ-only note');
  t.run(3, CY, 'paused', '2026-09-05 09:00:00', '2026-09-20 10:00:00', SUPER, 'Away until November.', null);
  const e = db.prepare(`INSERT INTO product_tester_events (tester_id, user_id, action, from_status, to_status, actor_user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  e.run(2, BEN, 'applied', null, 'applied', null, '2026-09-01 09:00:00');
  e.run(2, BEN, 'approved', 'applied', 'active', GONE, '2026-09-03 10:00:00');
  const l = db.prepare(`INSERT INTO lp_applications (user_id, fund_slug, investor_type, target_commitment, status, reviewed_by, reviewed_at, note, created_at)
    VALUES (?, ?, 'individual', 250000, ?, ?, ?, 'My own words', ?)`);
  l.run(BEN, 'spinout-fund-i', 'approved', SUPER, '2026-08-02 10:00:00', '2026-08-01 09:00:00');
  l.run(LIA, 'spinout-fund-i', 'approved', SUPER, '2026-07-02 10:00:00', '2026-07-01 09:00:00');
  l.run(LIA, 'fund-ii', 'approved', SUPER, '2026-09-02 10:00:00', '2026-09-01 09:00:00');
  l.run(LIA, 'fund-iii', 'pending', null, null, '2026-10-01 09:00:00');
  l.run(ADA, 'spinout-fund-i', 'declined', SUPER, '2026-10-03 10:00:00', '2026-10-01 09:00:00');
  for (const tname of drop) db.exec(`DROP TABLE ${tname}`);
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/sub-accounts', subAccountsRoute);
app.route('/api/admin/product-testers', testersRoute);
app.onError((err) => {
  const m = String((err as Error)?.message || '');
  if (m === 'Unauthorized') return new Response(JSON.stringify({ error: m }), { status: 401 });
  if (m === 'Admin required') return new Response(JSON.stringify({ error: m }), { status: 403 });
  throw err;
});

async function call(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, dbOver?: any) {
  const token = await new SignJWT({ user_id: who, role: who === MEMBER ? 'founder' : 'admin', jti: `totp-${who}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await withThrownResponses(() => app.request(`/api${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: dbOver || d1Over(db) } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error, console.log] = saved; }
}

/* ------------------------------------------------------------------ */

test('the counts: testers per status (applied is the lane’s pending), LPs once each, and the LP applications waiting', async () => {
  const db = fixture();
  const r = await call(db, ADMIN, 'GET', '/admin/sub-accounts/counts');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // Mutation checked: count a status not seen as missing → no `removed: 0`.
  assert.deepEqual(r.body.testers, { available: true, by_status: { applied: 1, active: 1, paused: 1, declined: 0, removed: 0 }, active: 1, pending: 1, unknown_status: 0 });
  // Mutation checked: count applications, not accounts → active 3.
  assert.deepEqual(r.body.lps, { available: true, active: 2, pending: 1 });
});

test('a store this database lacks is not_set_up, a store that fails is unreadable, and neither is ever a 0', async () => {
  const db = fixture({ drop: ['product_tester_events', 'product_testers'] });
  const r = await call(db, ADMIN, 'GET', '/admin/sub-accounts/counts');
  assert.deepEqual(r.body.testers, { available: false, reason: 'not_set_up' });
  assert.equal(r.body.lps.available, true, 'one block failing never blanks the other');

  const live = fixture();
  const real = d1Over(live);
  const broken = { ...real, prepare: (q: string) => { if (/lp_applications/.test(q)) throw new Error('D1_ERROR: disk I/O'); return real.prepare(q); } };
  const b = await call(live, ADMIN, 'GET', '/admin/sub-accounts/counts', undefined, broken);
  // Mutation checked: read any error as a missing table → not_set_up.
  assert.deepEqual(b.body.lps, { available: false, reason: 'unreadable' });
  assert.equal(b.body.testers.available, true);
  const one = await call(live, ADMIN, 'GET', `/admin/sub-accounts/accounts/${LIA}`, undefined, broken);
  assert.deepEqual(one.body.lp, { available: false, reason: 'unreadable' });
});

test('one account: the tester record and its history, the LP funds; no email, commitment or the applicant’s own note', async () => {
  const db = fixture();
  const ben = await call(db, ADMIN, 'GET', `/admin/sub-accounts/accounts/${BEN}`);
  assert.equal(ben.status, 200, JSON.stringify(ben.body));
  const t = ben.body.tester.record;
  assert.deepEqual([t.status, t.applied_at, t.decided_at, t.note], ['active', '2026-09-01 09:00:00', '2026-09-03 10:00:00', 'HQ-only note']);
  // A decider whose account is gone keeps the date; the name reads null.
  assert.deepEqual(t.decided_by, { id: GONE, name: null });
  assert.deepEqual(t.events.map((e: any) => [e.action, e.from, e.to, e.by]), [['applied', null, 'applied', null], ['approved', 'applied', 'active', { id: GONE, name: null }]]);
  assert.deepEqual([ben.body.lp.is_lp, ben.body.lp.funds], [true, ['spinout-fund-i']]);
  const body = JSON.stringify(ben.body);
  for (const secret of ['@example.test', '250000', 'My own words']) assert.ok(!body.includes(secret), secret);

  const cy = await call(db, ADMIN, 'GET', `/admin/sub-accounts/accounts/${CY}`);
  // Mutation checked: read the decider's email for the name → sue@example.test.
  assert.deepEqual([cy.body.tester.record.status, cy.body.tester.record.reason, cy.body.tester.record.decided_by], ['paused', 'Away until November.', { id: SUPER, name: 'Sue Super' }]);
  assert.ok(!JSON.stringify(cy.body).includes('@example.test'));

  const lia = await call(db, ADMIN, 'GET', `/admin/sub-accounts/accounts/${LIA}`);
  assert.equal(lia.body.tester.record, null, 'never applied to test');
  // Mutation checked: count a pending application as LP → fund-iii in funds.
  assert.deepEqual(lia.body.lp.funds.sort(), ['fund-ii', 'spinout-fund-i']);
  assert.deepEqual(lia.body.lp.applications.map((a: any) => [a.fund_slug, a.status]), [['fund-iii', 'pending'], ['fund-ii', 'approved'], ['spinout-fund-i', 'approved']]);

  const ada = await call(db, ADMIN, 'GET', `/admin/sub-accounts/accounts/${ADA}`);
  // Mutation checked: read any application as LP → true for a declined one.
  assert.equal(ada.body.lp.is_lp, false);
  assert.equal(ada.body.tester.record.status, 'applied');
  const noel = await call(db, ADMIN, 'GET', `/admin/sub-accounts/accounts/${NOEL}`);
  assert.deepEqual([noel.body.tester, noel.body.lp.is_lp, noel.body.lp.applications], [{ available: true, record: null }, false, []]);
});

test('who may read: an admin; another administrator’s record is the Super Admin’s; a member never', async () => {
  const db = fixture();
  assert.equal((await call(db, MEMBER, 'GET', '/admin/sub-accounts/counts')).status, 403);
  assert.equal((await call(db, MEMBER, 'GET', `/admin/sub-accounts/accounts/${BEN}`)).status, 403);
  const peer = await call(db, ADMIN, 'GET', `/admin/sub-accounts/accounts/${OTHER_ADMIN}`);
  // Mutation checked: drop the cross-admin check → 200.
  assert.deepEqual([peer.status, peer.body.error], [403, 'super_admin_required']);
  const sup = await call(db, ADMIN, 'GET', `/admin/sub-accounts/accounts/${SUPER}`);
  assert.equal(sup.status, 403, 'a Super Admin is an administrator too');
  // Mutation checked: count only role 'admin' → 200 for an elevated founder's record.
  assert.equal((await call(db, ADMIN, 'GET', `/admin/sub-accounts/accounts/${ELEVATED}`)).status, 403, 'the elevation, not the role word, makes an administrator');
  assert.equal((await call(db, SUPER, 'GET', `/admin/sub-accounts/accounts/${OTHER_ADMIN}`)).status, 200);
  assert.equal((await call(db, ADMIN, 'GET', `/admin/sub-accounts/accounts/${ADMIN}`)).status, 200, 'your own record is not a cross-admin read');
  assert.equal((await call(db, ADMIN, 'GET', '/admin/sub-accounts/accounts/9999')).body.error, 'account_not_found');
  assert.equal((await call(db, ADMIN, 'GET', '/admin/sub-accounts/accounts/0')).status, 404);
});

test('a decision on D1042’s route is what this read shows next: approve, and the record and the count move together', async () => {
  const db = fixture();
  const approve = await call(db, SUPER, 'POST', '/admin/product-testers/1/approve', { note: 'Good fit' });
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  const ada = await call(db, ADMIN, 'GET', `/admin/sub-accounts/accounts/${ADA}`);
  assert.equal(ada.body.tester.record.status, 'active');
  assert.deepEqual(ada.body.tester.record.events.at(-1).by, { id: SUPER, name: 'Sue Super' });
  const counts = await call(db, ADMIN, 'GET', '/admin/sub-accounts/counts');
  assert.deepEqual([counts.body.testers.active, counts.body.testers.pending], [2, 0]);
});

test('the wiring: mounted beside the tester decisions, and no second tester store', () => {
  const index = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/index.ts'), 'utf8');
  assert.ok(index.includes("app.route('/api/admin/sub-accounts', adminSubAccounts);"));
  assert.ok(!FILES.some((f) => /sub_account/.test(f)), 'D1302 adds no migration: the tester store is 576’s, LP is lp_applications');
});
