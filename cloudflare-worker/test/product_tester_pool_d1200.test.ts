/**
 * D1200 (#3150, Product testing part 5 of #2382) — the tester pool as the
 * Product testing page reads it:
 *
 *   1. each tester carries who decided, by name, and the programmes applied to
 *      and picked for, counted per tester;
 *   2. the list filters by role, availability given and being in a programme,
 *      and `matching` counts what the filters keep;
 *   3. an applicant row (D812's owner list) carries the Tester badge: an active
 *      or paused tester has it, an applied, declined or removed one does not,
 *      and a pool that cannot be read badges nobody.
 *
 * The database is the baseline plus every numbered migration above the cutoff,
 * schema only, as D1042's test builds one. Every person and product is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/product_tester_pool_d1200.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import testersRoute from '../src/routes/admin_product_testers.ts';
import { applicants } from '../src/services/testing.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d1200-0123456789-abcdef'; // synthetic test fixture
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const SUPER = 1;
const ADA = 10, BEN = 11, CY = 12, DEE = 13, EVE = 14;

const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

/**
 * Ada applied (no decision); Ben is active, decided by Sue, with availability,
 * picked in an open programme and applied to two more (one withdrawn); Cy is
 * paused, picked in a closed programme only; Dee was removed; Eve declined.
 */
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, email_verified, kyc_status) VALUES (?, ?, ?, ?, 1, 1, ?)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test', 'verified');
  u.run(ADA, 'founder', 'Ada Applied', 'ada@example.test', 'verified');
  u.run(BEN, 'investor', 'Ben Active', 'ben@example.test', 'verified');
  u.run(CY, 'partner', 'Cy Paused', 'cy@example.test', 'verified');
  u.run(DEE, 'founder', 'Dee Removed', 'dee@example.test', 'verified');
  u.run(EVE, 'founder', 'Eve Declined', 'eve@example.test', 'verified');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, 'totp-1', 'totp', 'totp', datetime('now'))").run(SUPER);
  const t = db.prepare(`INSERT INTO product_testers (id, user_id, status, applied_at, decided_at, decided_by, availability, answers)
    VALUES (?, ?, ?, ?, ?, ?, ?, '[]')`);
  t.run(1, ADA, 'applied', '2026-10-02 09:00:00', null, null, null);
  t.run(2, BEN, 'active', '2026-09-01 09:00:00', '2026-09-03 10:00:00', SUPER, 'Weekday evenings');
  t.run(3, CY, 'paused', '2026-09-05 09:00:00', '2026-09-20 10:00:00', SUPER, '  ');
  t.run(4, DEE, 'removed', '2026-08-05 09:00:00', '2026-09-21 10:00:00', SUPER, 'Weekends');
  t.run(5, EVE, 'declined', '2026-08-01 09:00:00', '2026-08-10 12:00:00', SUPER, null);
  const p = db.prepare(`INSERT INTO testing_programmes (id, uid, owner_kind, created_by, product_name, places, status) VALUES (?, ?, 'hq', ?, ?, 5, ?)`);
  p.run(1, 'tp_open', SUPER, 'Ledger Lite', 'testing');
  p.run(2, 'tp_closed', SUPER, 'Old Pilot', 'closed');
  p.run(3, 'tp_other', SUPER, 'Third', 'open');
  const a = db.prepare('INSERT INTO testing_applications (uid, programme_id, user_id, status) VALUES (?, ?, ?, ?)');
  a.run('a1', 1, BEN, 'picked');
  a.run('a2', 2, BEN, 'declined');
  a.run('a3', 3, BEN, 'withdrawn');
  a.run('a4', 2, CY, 'picked');
  a.run('a5', 1, ADA, 'applied');
  a.run('a6', 1, DEE, 'applied');
  a.run('a7', 1, EVE, 'applied');
  a.run('a8', 1, CY, 'applied');
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/product-testers', testersRoute);

async function list(db: DatabaseSync, qs = '') {
  const token = await new SignJWT({ user_id: SUPER, role: 'admin', jti: 'totp-1' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await withThrownResponses(() => app.request(`/api/admin/product-testers${qs}`, { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error, console.log] = saved; }
}
const byId = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.id, r]));

test('1. each tester carries who decided, by name, and the programmes applied to and picked for', async () => {
  // Mutation checked: a withdrawn application counted → Ben's applied is 3; picked counted with applied → Ben's picked is 2;
  // the decider's name dropped → Sue fails.
  const r = await list(fixture());
  assert.equal(r.status, 200);
  const rows = byId(r.body.rows);
  assert.deepEqual(rows[2].programmes, { applied: 2, picked: 1 }, 'a withdrawn application is not counted');
  assert.deepEqual(rows[3].programmes, { applied: 2, picked: 1 });
  assert.deepEqual(rows[1].programmes, { applied: 1, picked: 0 });
  assert.deepEqual(rows[5].programmes, { applied: 1, picked: 0 });
  assert.equal(rows[2].decided_by_name, 'Sue Super');
  assert.equal(rows[2].decided_by, SUPER, 'the id stays for Approvals');
  assert.equal(rows[1].decided_by_name, null, 'no decision, no name');
  assert.equal(rows[2].member.email, 'ben@example.test', 'the email stays as Approvals has it');
});

test('2. the filters: role, availability given, in a programme, and matching counts what they keep', async () => {
  // Mutation checked: whitespace counted as availability → Cy is kept; a closed programme's pick counted → Cy is in a programme;
  // matching left as the status total → 5 fails.
  const db = fixture();
  let r = await list(db, '?role=founder');
  assert.deepEqual(r.body.rows.map((x: any) => x.id).sort(), [1, 4, 5]);
  assert.equal(r.body.matching, 3);
  assert.equal(r.body.totals.total, 5, 'the totals are the whole pool');
  r = await list(db, '?availability_given=yes');
  assert.deepEqual(r.body.rows.map((x: any) => x.id).sort(), [2, 4], 'blank availability is not given');
  r = await list(db, '?availability_given=no');
  assert.deepEqual(r.body.rows.map((x: any) => x.id).sort(), [1, 3, 5]);
  r = await list(db, '?in_programme=yes');
  assert.deepEqual(r.body.rows.map((x: any) => x.id), [2], 'a pick in a closed programme is not a place');
  r = await list(db, '?in_programme=no&status=paused');
  assert.deepEqual(r.body.rows.map((x: any) => x.id), [3]);
  assert.equal(r.body.matching, 1);
  r = await list(db, '?status=active');
  assert.equal(r.body.matching, 1, 'with no new filter, matching is the status total as before');
  for (const [qs, code] of [['?role=Robert%27);', 'unknown_role'], ['?availability_given=maybe', 'bad_filter'], ['?in_programme=1', 'bad_filter']]) {
    r = await list(db, qs);
    assert.equal(r.status, 400, qs);
    assert.equal(r.body.error, code);
  }
});

test('3. the Tester badge on applicants: active and paused have it, applied, declined and removed do not', async () => {
  // Mutation checked: paused left out → Cy unbadged; removed let in → Dee badged; an unread pool as false → the null assertion fails.
  const db = fixture();
  const env: any = { DB: d1Over(db) };
  const out = await applicants(env, { kind: 'hq' }, 'tp_open');
  const badge = Object.fromEntries(out.items.map((x: any) => [x.name, x.tester]));
  assert.deepEqual(badge, { 'Ben Active': true, 'Ada Applied': false, 'Dee Removed': false, 'Eve Declined': false, 'Cy Paused': true });
  assert.equal(out.tester_pool_readable, true);
  assert.ok(out.items.every((x: any) => !('email' in x) && !('user_id' in x)), 'no email and no account id on an applicant row');

  db.exec('DROP TABLE product_testers');
  const saved = console.warn; console.warn = () => {};
  try {
    const lost = await applicants(env, { kind: 'hq' }, 'tp_open');
    assert.equal(lost.tester_pool_readable, false);
    assert.ok(lost.items.every((x: any) => x.tester === null), 'a pool not read badges nobody, and says so');
    assert.equal(lost.items.length, 5, 'the applicants still read');
  } finally { console.warn = saved; }
});
