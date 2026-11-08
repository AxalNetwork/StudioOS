/**
 * D4807 (#4807) — ONE entitlement predicate for "is this account a mentor today?".
 *
 * Runs the real rule (`withMentorEligible`) on node:sqlite over the tables it
 * reads. A secondary Advisor licence counts; a revoked licence, a changed role
 * and a deactivated account each remove eligibility at once; a database
 * without `account_licences` falls back to the primary role. Every name is
 * invented.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/mentor_eligibility_4807.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { withMentorEligible, mentorEligibleSql, ELIGIBLE_PLACEHOLDER } from '../src/services/mentorEligibility.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

function envFor(db: DatabaseSync) {
  return {
    DB: {
      prepare(sql: string) {
        return {
          first: async () => (db.prepare(sql).get() as any) ?? null,
          all: async () => ({ results: db.prepare(sql).all() as any[] }),
        };
      },
    },
  } as any;
}

function build(withLicences: boolean) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, is_active INTEGER NOT NULL DEFAULT 1)');
  if (withLicences) {
    db.exec('CREATE TABLE account_licences (id INTEGER PRIMARY KEY, user_id INTEGER, licence TEXT, revoked_at TEXT)');
  }
  const add = (id: number, role: string | null, active = 1) =>
    db.prepare('INSERT INTO users (id, role, is_active) VALUES (?, ?, ?)').run(id, role, active);
  const lic = (uid: number, licence: string, revoked: string | null = null) =>
    db.prepare('INSERT INTO account_licences (user_id, licence, revoked_at) VALUES (?, ?, ?)').run(uid, licence, revoked);
  return { db, add, lic };
}

async function eligible(db: DatabaseSync): Promise<number[]> {
  const sql = await withMentorEligible(envFor(db), `SELECT u.id FROM users u WHERE ${ELIGIBLE_PLACEHOLDER} ORDER BY u.id`);
  return (db.prepare(sql).all() as any[]).map((r) => r.id);
}

test('primary Advisor, secondary Advisor licence: both eligible; others not', async () => {
  const { db, add, lic } = build(true);
  add(1, 'advisor'); add(2, 'founder'); add(3, 'Advisor'); add(4, null);
  lic(2, 'advisor');
  lic(4, 'investor');
  assert.deepEqual(await eligible(db), [1, 2, 3]);
});

test('a revoked licence, a changed role and a deactivated account each remove eligibility', async () => {
  const { db, add, lic } = build(true);
  add(1, 'founder'); add(2, 'advisor'); add(3, 'founder');
  lic(1, 'advisor'); lic(3, 'advisor');
  assert.deepEqual(await eligible(db), [1, 2, 3]);
  db.prepare("UPDATE account_licences SET revoked_at = '2026-01-01' WHERE user_id = 1").run();
  assert.deepEqual(await eligible(db), [2, 3]);
  db.prepare("UPDATE users SET role = 'founder' WHERE id = 2").run();
  assert.deepEqual(await eligible(db), [3]);
  db.prepare('UPDATE users SET is_active = 0 WHERE id = 3').run();
  assert.deepEqual(await eligible(db), []);
});

test('a database built before D4472 has no licence table: the rule is the primary role alone', async () => {
  const { db, add } = build(false);
  add(1, 'advisor'); add(2, 'founder'); add(3, 'advisor', 0);
  assert.deepEqual(await eligible(db), [1]);
});

test('a statement without the placeholder is returned untouched; every placeholder is swapped', async () => {
  const { db } = build(true);
  const env = envFor(db);
  assert.equal(await withMentorEligible(env, 'SELECT 1'), 'SELECT 1');
  const twice = await withMentorEligible(env, `SELECT ${ELIGIBLE_PLACEHOLDER}, ${ELIGIBLE_PLACEHOLDER}`);
  assert.equal(twice.includes(ELIGIBLE_PLACEHOLDER), false);
  assert.equal(twice, `SELECT ${mentorEligibleSql()}, ${mentorEligibleSql()}`);
});

test('every reader asks the one rule: no route or service tests the primary role alone', () => {
  for (const f of [
    'cloudflare-worker/src/services/programCatalogue.ts',
    // #4715: the advisor routes split into routes/advisors_*.ts; this code lives in advisors_cohorts.ts.
    'cloudflare-worker/src/routes/advisors_cohorts.ts',
    'cloudflare-worker/src/services/cohortAdvisorAccess.ts',
  ]) {
    const text = src(f);
    assert.ok(text.includes(ELIGIBLE_PLACEHOLDER), `${f} uses the shared rule`);
    assert.ok(text.includes('withMentorEligible'), `${f} swaps it through withMentorEligible`);
    // A bare `role` (or `u.role`) column only: `reviewer_role = 'advisor'` (who filed a review, #4702) is not eligibility.
    assert.equal(/(?<!\w)role\s*=\s*'advisor'/i.test(text), false, `${f} has no primary-role-only test`);
  }
});
