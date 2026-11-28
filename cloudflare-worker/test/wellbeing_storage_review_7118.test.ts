/**
 * D7118 part 4 (#7118): the controlled internal review of historical Wellness
 * storage and its recovery, and the earlier check-ins saying how each is held.
 * The real routers on node:sqlite, tables from the baseline and the migration.
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import storageReview from '../src/routes/wellbeing_storage_review.ts';
import reflections from '../src/routes/wellbeing_reflections.ts';
import { holdingOf, PULSE_FIELDS } from '../src/services/wellbeing/storageReview.ts';
import { encryptString } from '../src/services/cryptoBox.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const OTHER_KEY = { JWT_SECRET: 'a-different-secret-that-was-rotated-away-0000' };
const MIA = 1, OTTO = 2, ADMIN = 3, SUPER = 5;
const ROLE: Record<number, string> = { [MIA]: 'founder', [OTTO]: 'founder', [ADMIN]: 'admin', [SUPER]: 'admin' };
const MIGRATION = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/202611171643_7118_wellbeing_reflections.sql'), 'utf8');
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const ddl = (name: string) => {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is not in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
};
// A fixed clock: Tuesday 17 November 2026, noon UTC.
const NOW = Date.parse('2026-11-17T12:00:00Z');
test.beforeEach(() => { mock.timers.enable({ apis: ['Date'], now: NOW }); });
test.afterEach(() => { mock.timers.reset(); });

function setup({ legacyWeekly = false } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, email TEXT, name TEXT,
             is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, subscription_tier TEXT, subscription_status TEXT);
           CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
           CREATE TABLE user_licences (user_id INTEGER, licence TEXT);
           CREATE TABLE activity_logs (id INTEGER PRIMARY KEY, action TEXT, details TEXT, actor TEXT, user_id INTEGER);`);
  db.exec(ddl('wellbeing_daily_pulses'));
  for (const col of ['support_enc TEXT', 'decisions_enc TEXT', 'support_plain INTEGER', 'decisions_plain INTEGER']) {
    try { db.exec(`ALTER TABLE wellbeing_daily_pulses ADD COLUMN ${col}`); } catch { /* already in the baseline */ }
  }
  if (legacyWeekly) db.exec(ddl('wellbeing_checkins'));
  db.exec(MIGRATION);
  const u = db.prepare('INSERT INTO users (id, role, email, name) VALUES (?, ?, ?, ?)');
  u.run(MIA, 'founder', 'mia@example.test', 'Mia');
  u.run(OTTO, 'founder', 'otto@example.test', 'Otto');
  u.run(ADMIN, 'admin', 'admin@example.test', 'Ada');
  u.run(SUPER, 'admin', 'super@example.test', 'Sol');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  return db;
}
const envOf = (db: any, DB: any = d1Over(db)) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB }) as any;

async function call(router: any, e: any, method: string, path: string, who: number, body?: unknown) {
  const app = new Hono();
  app.route('/', router);
  app.onError((err, c) => c.json({ error: AUTH_ERROR_STATUSES[err.message] ? 'access_refused' : 'unavailable' }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const tok = await new SignJWT({ user_id: who, role: ROLE[who] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const w = console.warn, er = console.error, l = console.log, i = console.info;
  console.warn = () => {}; console.error = () => {}; console.log = () => {}; console.info = () => {};
  try {
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, e);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, text, headers: res.headers };
  } finally { console.warn = w; console.error = er; console.log = l; console.info = i; }
}

/** Three earlier check-ins for Mia: one encrypted, one the Task #33 writer kept in plaintext, one under a rotated key. */
async function seedPulses(db: any) {
  const ok = await encryptString({ JWT_SECRET }, 'a private line');
  const rotated = await encryptString(OTHER_KEY, 'lost words');
  const ins = db.prepare(`INSERT INTO wellbeing_daily_pulses (uid, user_id, day, free_text_enc, mood_plain, free_text_plain, created_at)
                          VALUES (?, ?, ?, ?, ?, ?, '2026-10-01 09:00:00')`);
  ins.run('enc1', MIA, '2026-09-07', ok, null, null);
  ins.run('plain1', MIA, '2026-09-14', null, 3, 'written in the clear');
  ins.run('lost1', MIA, '2026-09-21', rotated, null, null);
}

test('holding: ciphertext that opens, plaintext, ciphertext that no longer opens, and nothing', async () => {
  const env = { JWT_SECRET };
  const ok = await encryptString(env, '4');
  const rotated = await encryptString(OTHER_KEY, '4');
  assert.equal((await holdingOf(env, { mood_enc: ok }, PULSE_FIELDS)).held, 'encrypted');
  assert.equal((await holdingOf(env, { mood_enc: ok, stress_plain: 2 }, PULSE_FIELDS)).held, 'not_encrypted');
  assert.equal((await holdingOf(env, { mood_enc: ok, stress_enc: rotated }, PULSE_FIELDS)).held, 'partly_unreadable');
  assert.equal((await holdingOf(env, { mood_enc: rotated, mood_plain: 4 }, PULSE_FIELDS)).held, 'not_encrypted', 'a plaintext copy recovers it');
  assert.deepEqual(await holdingOf(env, { mood_enc: null, free_text_plain: '' }, PULSE_FIELDS), { held: 'empty', encrypted: 0, plain: 0, unreadable: 0 });
});

test('review: a Super Admin gets counts per store and nothing that names a member or a word', async () => {
  const db = setup(); await seedPulses(db);
  const e = envOf(db);
  assert.equal((await call(reflections, e, 'PUT', '/day/2026-11-17', MIA, { timezone: 'UTC', text: 'reflection words' })).status, 201);
  const res = await call(storageReview, e, 'GET', '/', SUPER);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const by = Object.fromEntries(res.body.stores.map((s: any) => [s.store, s]));
  assert.deepEqual(by.wellbeing_reflections, {
    store: 'wellbeing_reflections', present: true, rows: 1, checked: 1,
    held: { encrypted: 1, not_encrypted: 0, partly_unreadable: 0, empty: 0 }, earliest: '2026-11-17', latest: '2026-11-17',
  });
  assert.deepEqual(by.wellbeing_daily_pulses.held, { encrypted: 1, not_encrypted: 1, partly_unreadable: 1, empty: 0 });
  assert.equal(by.wellbeing_daily_pulses.rows, 3);
  assert.deepEqual([by.wellbeing_daily_pulses.earliest, by.wellbeing_daily_pulses.latest], ['2026-09-07', '2026-09-21']);
  assert.deepEqual(by.wellbeing_checkins, { store: 'wellbeing_checkins', present: false }, 'an absent store is not zero rows');
  for (const leak of ['private line', 'in the clear', 'lost words', 'reflection words', 'enc1', 'plain1', 'mia@', '"user_id"']) {
    assert.ok(!res.text.includes(leak), `the review returned ${leak}`);
  }
  const audit = db.prepare("SELECT action, user_id FROM activity_logs WHERE action = 'wellbeing_storage_review'").all() as any[];
  assert.deepEqual(audit.map((a) => a.user_id), [SUPER], 'the run is recorded against the Super Admin');
});

test('review: the pre-Task #33 weekly store is counted when it exists, plaintext included', async () => {
  const db = setup({ legacyWeekly: true });
  const ok = await encryptString({ JWT_SECRET }, '3');
  const ins = db.prepare(`INSERT INTO wellbeing_checkins (uid, user_id, week_anchor, stress_enc, sleep_enc, support_enc, decisions_enc, energy_enc, notes_plain)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  ins.run('w1', MIA, '2025-03-03', ok, ok, ok, ok, ok, null);
  ins.run('w2', OTTO, '2025-03-10', ok, ok, ok, ok, ok, 'a note in the clear');
  const res = await call(storageReview, envOf(db), 'GET', '/', SUPER);
  const legacy = res.body.stores.find((s: any) => s.store === 'wellbeing_checkins');
  assert.equal(legacy.present, true);
  assert.equal(legacy.rows, 2);
  assert.deepEqual(legacy.held, { encrypted: 1, not_encrypted: 1, partly_unreadable: 0, empty: 0 });
  assert.ok(!res.text.includes('a note in the clear'));
});

test('review: only a Super Admin; an admin, a member and a failed read are refused', async () => {
  const db = setup(); await seedPulses(db);
  assert.equal((await call(storageReview, envOf(db), 'GET', '/', ADMIN)).status, 403);
  assert.equal((await call(storageReview, envOf(db), 'GET', '/', MIA)).status, 403);
  const real = d1Over(db);
  const broken = { ...real, prepare: (sql: string) => { if (/FROM wellbeing_daily_pulses/.test(sql)) throw new Error('D1_ERROR: no such table'); return real.prepare(sql); } };
  const failed = await call(storageReview, envOf(db, broken), 'GET', '/', SUPER);
  assert.equal(failed.status, 503);
  assert.equal(failed.body.error, 'storage_review_unavailable');
  assert.ok(!failed.text.includes('D1_ERROR'), 'the raw error is logged, never returned');
});

test('earlier check-ins say how each is held, so "Stored encrypted" is never put over one that is not', async () => {
  const db = setup(); await seedPulses(db);
  const res = await call(reflections, envOf(db), 'GET', '/earlier', MIA);
  assert.equal(res.status, 200);
  assert.deepEqual(Object.fromEntries(res.body.earlier.map((x: any) => [x.uid, x.held])),
    { enc1: 'encrypted', plain1: 'not_encrypted', lost1: 'partly_unreadable' });
  const exp = await call(reflections, envOf(db), 'GET', '/export', MIA);
  assert.deepEqual(JSON.parse(exp.text).earlier_checkins.map((x: any) => x.held).sort(), ['encrypted', 'not_encrypted', 'partly_unreadable']);
  assert.equal((await call(reflections, envOf(db), 'GET', '/earlier', OTTO)).body.earlier.length, 0);
});
