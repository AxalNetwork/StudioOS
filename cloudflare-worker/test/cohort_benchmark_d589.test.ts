/**
 * D589 (#1216) — cohort median and the founder's percentile, on real SQLite.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cohort_benchmark_d589.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import scoring from '../src/routes/scoring.ts';
import { signScore } from '../src/services/scoreIntegrity.ts';
import { COHORT_BENCHMARK_MIN, medianOf, percentileRank } from '../src/services/cohortBenchmark.ts';
import { SMALL_CELL_MIN } from '../src/services/profileEvolution.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SCORING_HMAC_SECRET = 'unit-test-scoring-hmac-secret';
const ENV = { JWT_SECRET, SCORING_HMAC_SECRET } as any;

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'projects', 'score_snapshots', 'user_spinout_flags']) db.exec(ddl(t));
  return db;
}

function member(db: any, id: number, founderId: number, email: string, week: number, cohort: string) {
  db.prepare(
    `INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_week, spinout_lab_active)
     VALUES (?, 'founder', ?, ?, 1, ?, ?, 1)`,
  ).run(id, `Founder ${id}`, email, founderId, week);
  db.prepare(
    `INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted, spinout_lab_cohort) VALUES (?, 1, ?)`,
  ).run(id, cohort);
  db.prepare(`INSERT INTO projects (id, name, founder_id) VALUES (?, ?, ?)`).run(founderId, `Venture ${founderId}`, founderId);
}

async function official(db: any, projectId: number, score: number, when = '2026-10-01 12:00:00', sandbox = 0) {
  const hash = sandbox ? null : await signScore(ENV, projectId, score, when);
  db.prepare(
    `INSERT INTO score_snapshots (project_id, total_score, tier, created_at, is_sandbox, integrity_hash)
     VALUES (?, ?, 'TIER_2', ?, ?, ?)`,
  ).run(projectId, score, when, sandbox, hash);
}

const app = new Hono<any>();
app.route('/scoring', scoring);
app.onError((err: any, c) => c.json({ error: 'unhandled', message: String(err?.message || '') }, 500));

async function call(db: any, who: number, projectId: number) {
  const jwt = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(`/scoring/cohort-benchmark/${projectId}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  }, { ...ENV, ENVIRONMENT: 'development', DB: d1Over(db) });
  return { status: res.status, body: await res.json() as any };
}

test('the threshold is D358, and the median and percentile are the stated formulas', () => {
  assert.equal(COHORT_BENCHMARK_MIN, SMALL_CELL_MIN);
  assert.equal(COHORT_BENCHMARK_MIN, 5);
  assert.equal(medianOf([11, 55, 33, 22, 44]), 33);
  assert.equal(medianOf([11, 22, 33, 44, 55, 66]), 38.5);
  assert.equal(percentileRank([11, 22, 33, 44, 55], 33), 50);
  assert.equal(percentileRank([11, 22, 33, 44, 55], 55), 90);
});

test('five official same-week cohort runs return the median and percentile, and name nobody else', async () => {
  const db = fixture();
  const scores = [11, 22, 33, 44, 55];
  for (let i = 0; i < 5; i += 1) {
    member(db, 10 + i, 100 + i, `f${i}@example.test`, 3, 'Cohort 3');
    await official(db, 100 + i, scores[i]);
  }
  const r = await call(db, 12, 102);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, {
    available: true, cohort: 'Cohort 3', week: 3, median: 33, percentile: 50,
  });
  const text = JSON.stringify(r.body);
  for (const hidden of [11, 22, 44, 55]) assert.equal(text.includes(String(hidden)), false, String(hidden));
  assert.equal(text.includes('Venture'), false);
  assert.equal('project_id' in r.body, false);
  assert.equal('scores' in r.body, false);
});

test('below five, a practice run, a bad hash, another week and another cohort add no figure', async () => {
  const db = fixture();
  for (let i = 0; i < 4; i += 1) {
    member(db, 10 + i, 100 + i, `f${i}@example.test`, 3, 'Cohort 3');
    await official(db, 100 + i, 10 + i);
  }
  const small = await call(db, 10, 100);
  assert.equal(small.body.available, false);
  assert.equal(small.body.reason, 'There are not enough scored ventures in this cohort at this week yet.');
  assert.equal('median' in small.body, false);
  assert.equal('percentile' in small.body, false);

  member(db, 20, 200, 'sand@example.test', 3, 'Cohort 3');
  await official(db, 200, 99, '2026-10-02 12:00:00', 1);
  member(db, 21, 201, 'week@example.test', 2, 'Cohort 3');
  await official(db, 201, 98);
  member(db, 22, 202, 'other@example.test', 3, 'Cohort 9');
  await official(db, 202, 97);
  member(db, 23, 203, 'bad@example.test', 3, 'Cohort 3');
  db.prepare(
    `INSERT INTO score_snapshots (project_id, total_score, tier, created_at, is_sandbox, integrity_hash)
     VALUES (203, 96, 'TIER_2', '2026-10-01 12:00:00', 0, 'not-a-real-hash')`,
  ).run();
  const still = await call(db, 10, 100);
  assert.equal(still.body.available, false);
  assert.equal('median' in still.body, false);

  member(db, 24, 204, 'fifth@example.test', 3, 'Cohort 3');
  await official(db, 204, 55);
  const ready = await call(db, 10, 100);
  assert.equal(ready.body.available, true);
  assert.equal(ready.body.median, medianOf([10, 11, 12, 13, 55]));
  assert.equal(JSON.stringify(ready.body).includes('98'), false);
  assert.equal(JSON.stringify(ready.body).includes('97'), false);
  assert.equal(JSON.stringify(ready.body).includes('96'), false);
  assert.equal(JSON.stringify(ready.body).includes('99'), false);
});

test('another founder cannot read this project, and a project with no official run gets the reason', async () => {
  const db = fixture();
  for (let i = 0; i < 5; i += 1) {
    member(db, 10 + i, 100 + i, `f${i}@example.test`, 3, 'Cohort 3');
    if (i > 0) await official(db, 100 + i, 20 + i);
  }
  db.prepare(`INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (40, 'founder', 'Outsider', 'out@example.test', 1, 400)`).run();
  db.prepare(`INSERT INTO projects (id, name, founder_id) VALUES (400, 'Elsewhere', 400)`).run();
  const outsider = await call(db, 40, 101);
  assert.equal(outsider.status, 403);
  const none = await call(db, 10, 100);
  assert.equal(none.status, 200);
  assert.equal(none.body.available, false);
  assert.equal(none.body.reason, 'This project has no official scoring run yet, so there is no percentile to place.');
  assert.equal('median' in none.body, false);
});
