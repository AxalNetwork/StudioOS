/**
 * D643 (#1438) — the eight sample wellbeing experts are not listed as real.
 *
 *   · in production the directory read inserts nothing, so production lists
 *     only experts who applied and were verified;
 *   · in development the samples are seeded, a member's list neither shows
 *     nor counts one, a member cannot open or book one, and the admin roster
 *     sees each marked `is_sample`;
 *   · migration 433 sets the samples inactive, never deletes them, touches
 *     nothing else, and is safe to re-run.
 *
 * The real router on node:sqlite. The expert tables are the baseline's own
 * DDL, so the columns are production's.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/wellbeing_samples_d643.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import wellbeing from '../src/routes/wellbeing.ts';
import { ensureSeededExperts, isSampleExpert, SAMPLE_EXPERT_UID_PREFIX } from '../src/services/wellbeing/seedExperts.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MEMBER = 1, ADMIN = 2;
const ROLES: Record<number, string> = { [MEMBER]: 'founder', [ADMIN]: 'admin' };
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATION = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/433_wellbeing_sample_experts_inactive.sql'), 'utf8');
const ddl = (name: string) => {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is not in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
};

/** One real, verified, listable expert, so an empty list is never the only proof. */
function setup({ real = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, email TEXT, name TEXT,
             is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, subscription_tier TEXT, subscription_status TEXT);
           CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, title TEXT, body TEXT, link TEXT, payload TEXT, created_at TEXT);`);
  for (const t of ['experts', 'expert_services', 'expert_availability', 'expert_bookings', 'expert_ratings', 'expert_profile_views']) db.exec(ddl(t));
  const u = db.prepare('INSERT INTO users (id, role, email, name, subscription_tier) VALUES (?, ?, ?, ?, ?)');
  u.run(MEMBER, 'founder', 'm@example.test', 'Mia Member', 'growth');
  u.run(ADMIN, 'admin', 'a@example.test', 'Ada Admin', 'growth');
  if (real) {
    db.prepare(`INSERT INTO experts (uid, name, is_active, verified, profile_completion_pct, timezones_json, categories_json, languages_json)
                VALUES ('real1', 'Rae Real', 1, 1, 90, '["Europe/Paris"]', '["executive_coach"]', '["en"]')`).run();
  }
  return db;
}
const envOf = (db: any, ENVIRONMENT: string) => ({ JWT_SECRET, ENVIRONMENT, DB: d1Over(db) }) as any;
async function call(e: any, method: string, path: string, who: number, body?: unknown) {
  const tok = await new SignJWT({ user_id: who, role: ROLES[who] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await wellbeing.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, e);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const quiet = async <T>(fn: () => Promise<T>) => {
  const w = console.warn, er = console.error, i = console.info, l = console.log;
  console.warn = () => {}; console.error = () => {}; console.info = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = er; console.info = i; console.log = l; }
};
const sampleRows = (db: any) => db.prepare(`SELECT uid, is_active FROM experts WHERE uid LIKE 'seed\\_%' ESCAPE '\\' ORDER BY uid`).all();

// ── Production ───────────────────────────────────────────────────────────────

test('production: the directory read inserts no sample, and lists only the real expert', async () => {
  for (const ENVIRONMENT of ['production', 'prod']) {
    const db = setup(); const e = envOf(db, ENVIRONMENT);
    const member = await quiet(() => call(e, 'GET', '/experts?limit=50', MEMBER));
    assert.equal(member.status, 200);
    assert.deepEqual(member.body.matches.map((m: any) => m.uid), ['real1'], ENVIRONMENT);
    assert.equal(member.body.total_active, 1);
    const admin = await quiet(() => call(e, 'GET', '/experts?limit=50', ADMIN));
    assert.deepEqual(admin.body.matches.map((m: any) => m.uid), ['real1'], 'the admin read seeds nothing either');
    await quiet(() => call(e, 'GET', '/experts/real1', MEMBER));
    assert.deepEqual(sampleRows(db), [], `${ENVIRONMENT}: a sample was inserted`);
  }
});

test('production with no real expert: the directory is empty, and says it holds none', async () => {
  const db = setup({ real: false }); const e = envOf(db, 'production');
  const r = await quiet(() => call(e, 'GET', '/experts?limit=50', MEMBER));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.matches, []);
  assert.equal(r.body.total_active, 0, 'the page reads 0 as "No wellbeing experts are listed yet"');
  assert.deepEqual(sampleRows(db), []);
});

test('the seeder itself writes nothing in production, and the eight samples in development', async () => {
  const prod = setup({ real: false });
  await ensureSeededExperts(envOf(prod, 'production'));
  assert.equal(sampleRows(prod).length, 0);
  const dev = setup({ real: false });
  await ensureSeededExperts(envOf(dev, 'development'));
  await ensureSeededExperts(envOf(dev, 'development'));
  assert.equal(sampleRows(dev).length, 8, 'eight samples, once each');
});

// ── Development: samples exist, members never meet one ───────────────────────

test('development: a member\'s list neither shows nor counts a sample', async () => {
  const db = setup(); const e = envOf(db, 'development');
  const r = await quiet(() => call(e, 'GET', '/experts?limit=50', MEMBER));
  assert.equal(r.status, 200);
  assert.equal(sampleRows(db).length, 8, 'the development seed ran');
  assert.deepEqual(r.body.matches.map((m: any) => m.uid), ['real1']);
  assert.equal(r.body.total_active, 1);
  assert.equal(r.body.filtered_count, 1);
  assert.equal(r.body.matches[0].is_sample, false);
});

test('development: the admin roster sees every sample, each marked is_sample', async () => {
  const db = setup(); const e = envOf(db, 'development');
  const r = await quiet(() => call(e, 'GET', '/experts?limit=50', ADMIN));
  assert.equal(r.status, 200);
  const marks = Object.fromEntries(r.body.matches.map((m: any) => [m.uid, m.is_sample]));
  assert.equal(Object.keys(marks).length, 9);
  assert.equal(marks.real1, false);
  for (const s of sampleRows(db)) assert.equal(marks[s.uid], true, `${s.uid} is not marked`);
});

test('development: a member cannot open or book a sample; an admin can open one, marked', async () => {
  const db = setup(); const e = envOf(db, 'development');
  await quiet(() => call(e, 'GET', '/experts?limit=50', ADMIN));
  const one = await quiet(() => call(e, 'GET', '/experts/seed_marina_lopes', MEMBER));
  assert.equal(one.status, 404);
  const views = db.prepare('SELECT COUNT(*) AS n FROM expert_profile_views').get() as { n: number };
  assert.equal(views.n, 0, 'a refused open spent a free-tier view');
  const book = await quiet(() => call(e, 'POST', '/experts/seed_marina_lopes/book', MEMBER, {}));
  assert.equal(book.status, 404);
  const n = db.prepare('SELECT COUNT(*) AS n FROM expert_bookings').get() as { n: number };
  assert.equal(n.n, 0, 'a booking was written against a sample');
  const adm = await quiet(() => call(e, 'GET', '/experts/seed_marina_lopes', ADMIN));
  assert.equal(adm.status, 200);
  assert.equal(adm.body.is_sample, true);
  const real = await quiet(() => call(e, 'GET', '/experts/real1', MEMBER));
  assert.equal(real.status, 200, 'the real expert still opens');
  assert.equal(real.body.is_sample, false);
});

test('a sample is known by its uid prefix, and the member read draws the same line', async () => {
  assert.equal(SAMPLE_EXPERT_UID_PREFIX, 'seed_');
  const uids = ['seed_x', 'seed_', 'seedling', 'Seed_x', 'xseed_y', 'a1b2c3'];
  assert.deepEqual(uids.filter(isSampleExpert), ['seed_x', 'seed_']);
  assert.equal(isSampleExpert(null), false);
  assert.equal(isSampleExpert(undefined), false);
  // Every uid listable, so only the sample rule decides what a member sees.
  const db = setup({ real: false });
  const ins = db.prepare(`INSERT INTO experts (uid, name, is_active, verified, profile_completion_pct, languages_json)
                          VALUES (?, ?, 1, 1, 90, '["en"]')`);
  for (const uid of uids) ins.run(uid, `Name ${uid}`);
  const r = await quiet(() => call(envOf(db, 'production'), 'GET', '/experts?limit=50', MEMBER));
  assert.deepEqual(r.body.matches.map((m: any) => m.uid).sort(), uids.filter((u) => !isSampleExpert(u)).sort());
  assert.equal(r.body.total_active, 4);
});

// ── Migration 433 ────────────────────────────────────────────────────────────

test('migration 433 sets the samples inactive, keeps them, touches nothing else, and re-runs cleanly', async () => {
  const db = setup();
  await ensureSeededExperts(envOf(db, 'development'));
  db.prepare(`INSERT INTO experts (uid, name, is_active, verified) VALUES ('real_seed_lookalike', 'Lee Lookalike', 1, 1)`).run();
  db.prepare(`UPDATE experts SET hidden_by_admin = 1 WHERE uid = 'seed_alex_morgan'`).run();
  const cols = 'uid, name, verified, hidden_by_admin, calendly_url, profile_completion_pct, created_at';
  const before = db.prepare(`SELECT ${cols}, is_active FROM experts ORDER BY uid`).all() as any[];
  assert.equal(before.filter((r) => isSampleExpert(r.uid) && r.is_active === 1).length, 8);

  db.exec(MIGRATION);
  const after = db.prepare(`SELECT ${cols}, is_active FROM experts ORDER BY uid`).all() as any[];
  assert.equal(after.length, before.length, 'a row was deleted');
  for (let i = 0; i < after.length; i++) {
    const { is_active: was, ...b } = before[i];
    const { is_active: now, ...a } = after[i];
    assert.deepEqual({ ...a }, { ...b }, `${a.uid}: a column other than is_active changed`);
    assert.equal(now, isSampleExpert(a.uid) ? 0 : was, `${a.uid}: is_active`);
  }
  const stamped = db.prepare(`SELECT COUNT(*) AS n FROM experts WHERE updated_at IS NOT NULL`).get() as { n: number };
  assert.equal(stamped.n, 8, 'only the eight samples were stamped');

  db.prepare(`UPDATE experts SET updated_at = 'first-run' WHERE updated_at IS NOT NULL`).run();
  db.exec(MIGRATION);
  const untouched = db.prepare(`SELECT COUNT(*) AS n FROM experts WHERE updated_at = 'first-run'`).get() as { n: number };
  assert.equal(untouched.n, 8, 'a re-run touched a sample row again');
  assert.deepEqual(db.prepare(`SELECT ${cols}, is_active FROM experts ORDER BY uid`).all().map((r: any) => ({ ...r })),
    after.map((r) => ({ ...r })), 'a re-run changed a row');

  // The development seed, run again after the migration, does not revive them.
  await ensureSeededExperts(envOf(db, 'development'));
  assert.ok(sampleRows(db).every((r: any) => r.is_active === 0), 'the seed re-activated a sample');
});
