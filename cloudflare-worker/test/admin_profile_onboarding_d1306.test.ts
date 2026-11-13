/**
 * D1306 (#3403, ACC4) — the account drawer's onboarding-profile line: `GET
 * /api/admin/users/:user_id/profile` carries the account's partner profile
 * (D989), its verdict and when (D991, migration 557) and its reference.
 *
 * The real route, through the real admin router, over the database a fresh
 * deployment builds (`schema_baseline.sql` plus every post-cutoff migration),
 * as D236's test reads it.
 *
 *   - a profile written for the account (`user_id`)        → its status, date and ref
 *   - a profile from before the account existed (address) → found by the address
 *   - an account's own profile wins over an address match  → the account's
 *   - no profile                                           → null
 *   - the store cannot be read                             → available: false, and the rest still loads
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/admin_profile_onboarding_d1306.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import admin from '../src/routes/admin.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { buildFresh, postCutoffMigrations } from '../../scripts/check-baseline-drift.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const LATER = (postCutoffMigrations(ROOT) as Array<{ sql: string }>).map((m) => m.sql);

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 1;
const OWN = 10;     // a profile written for the account
const EARLY = 11;   // a profile from before the account, matched by address
const BOTH = 12;    // its own profile and an older one by address
const NONE = 13;    // no profile

function appFor(router: any) {
  const a = new Hono<any>();
  a.route('/', router);
  a.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));
  return a;
}
const app = appFor(admin);

function freshDb() {
  const db = buildFresh(BASELINE, LATER);
  const user = db.prepare('INSERT INTO users (id, email, name, role, email_verified) VALUES (?, ?, ?, ?, 1)');
  user.run(HOLDER, 'hq@axal.example', 'Hana Sample', 'admin');
  user.run(OWN, 'own@example.test', 'Ola Sample', 'partner');
  user.run(EARLY, 'Early@Example.test', 'Eli Sample', 'partner');
  user.run(BOTH, 'both@example.test', 'Bo Sample', 'partner');
  user.run(NONE, 'none@example.test', 'Nia Sample', 'founder');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  db.prepare(`INSERT INTO user_sessions (user_id, jti, factor, assurance_level) VALUES (?, 'j-holder', 'totp', 'full')`).run(HOLDER);
  const pp = db.prepare(`INSERT INTO partner_profiles (email, user_id, persona, admin_status, reviewed_at, ref, updated_at)
                         VALUES (?, ?, 'operator', ?, ?, ?, ?)`);
  pp.run('own@example.test', OWN, 'verified', '2026-10-03 10:00:00', 'pp_own0000001', '2026-10-03 10:00:00');
  pp.run('early@example.test', null, 'pending', null, 'pp_early00001', '2026-09-01 10:00:00');
  pp.run('both@example.test', BOTH, 'rejected', '2026-10-05 09:00:00', 'pp_both00001', '2026-10-01 00:00:00');
  pp.run('BOTH@example.test', null, 'verified', '2026-10-20 09:00:00', 'pp_both00002', '2026-10-20 09:00:00');
  return db;
}

const envOver = (db: any) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });

async function profile(env: any, userId: number) {
  const t = await new SignJWT({ user_id: HOLDER, role: 'admin', jti: 'j-holder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/users/${userId}/profile`, { headers: { Authorization: `Bearer ${t}` } }, env);
  return { status: res.status, body: await res.json() as any };
}

test('the account\'s own profile: its verdict, when it was given, and its reference', async () => {
  const r = await profile(envOver(freshDb()), OWN);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.onboarding_profile, { available: true, ref: 'pp_own0000001', status: 'verified', reviewed_at: '2026-10-03 10:00:00' });
});

test('a profile written before the account existed is found by its address, whatever its case', async () => {
  const r = await profile(envOver(freshDb()), EARLY);
  assert.deepEqual(r.body.onboarding_profile, { available: true, ref: 'pp_early00001', status: 'pending', reviewed_at: null });
});

test('the account\'s own profile wins over a newer one only matched by address', async () => {
  const r = await profile(envOver(freshDb()), BOTH);
  assert.equal(r.body.onboarding_profile.ref, 'pp_both00001');
  assert.equal(r.body.onboarding_profile.status, 'rejected');
});

test('no profile is null, never an empty profile', async () => {
  const r = await profile(envOver(freshDb()), NONE);
  assert.equal(r.status, 200);
  assert.equal(r.body.onboarding_profile, null);
});

test('a store that cannot be read says so on its own line, and the record still loads', async () => {
  const db = freshDb();
  db.exec('DROP TABLE partner_profiles; CREATE TABLE partner_profiles (email TEXT)');
  const r = await profile(envOver(db), OWN);
  assert.equal(r.status, 200, 'the whole record failed with the onboarding profile');
  assert.deepEqual(r.body.onboarding_profile, { available: false, reason: 'unreadable' });
  assert.equal(r.body.user.id, OWN);
  assert.doesNotMatch(JSON.stringify(r.body.onboarding_profile), /@/, 'an address reached the answer');
});
