/**
 * D1589 (#3836) — stage norms (migration 746), through the mounted route on
 * SQLite (the baseline and every later migration).
 *
 *   1. A norm without a source is refused: by the route (400 source_missing),
 *      by the table's CHECK for any other writer, and on an edit that clears it.
 *      The same for a missing sample size.
 *   2. A stage with no row reads "No stage benchmark recorded", never an empty
 *      list; an as-of date not entered reads "Not recorded", never a date.
 *   3. Who: the founder and a cofounder write; an advisor reads only; another
 *      founder and nobody see nothing (another venture's row is a 404).
 *   4. What a critic may cite: the venture's rows for the stage and the
 *      investor type, or a founder benchmark with its source and sample size.
 *
 * Every name and figure is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckStageNorms from '../src/routes/deck_stage_norms.ts';
import decks from '../src/routes/decks.ts';
import { checkNorm, citableBenchmark, citableNorms, NO_BENCHMARK, NOT_RECORDED } from '../src/services/decks/stageNorms.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const M = resolve(SQL, 'migrations');
const JWT_SECRET = 'unit-test-jwt-secret-d1589-stage-norms-0123456789-abcdef';

const OWNER = 1, COFOUNDER = 2, ADVISOR = 3, ADMIN = 4, OTHER = 5;
const PID = 7, OTHER_PID = 8;

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const name of readdirSync(M).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()) {
    db.exec(readFileSync(resolve(M, name), 'utf8'));
  }
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Synthetic Founder', 'f@example.test'), (11, 'Synthetic Other', 'o@example.test');
    INSERT INTO users (id, email, name, role, founder_id) VALUES
      (${OWNER}, 'owner@example.test', 'Synthetic Owner', 'founder', 10),
      (${COFOUNDER}, 'co@example.test', 'Synthetic Cofounder', 'founder', NULL),
      (${ADVISOR}, 'adv@example.test', 'Synthetic Advisor', 'founder', NULL),
      (${ADMIN}, 'admin@example.test', 'Synthetic Admin', 'admin', NULL),
      (${OTHER}, 'other@example.test', 'Synthetic Other Founder', 'founder', 11);
    INSERT INTO projects (id, name, founder_id) VALUES (${PID}, 'Synthetic venture', 10), (${OTHER_PID}, 'Synthetic other venture', 11);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES
      (${PID}, ${OWNER}, 'owner', 'accepted'), (${PID}, ${COFOUNDER}, 'cofounder', 'accepted'), (${PID}, ${ADVISOR}, 'advisor', 'accepted');`);
  return db;
}

async function call(db: any, who: number | null, method: string, path: string, body?: unknown) {
  const app = new Hono<any>().route('/api/decks', deckStageNorms).route('/api/decks', decks);
  app.onError((err: any, c: any) => c.json({ error: err?.message === 'Unauthorized' ? 'unauthorized' : 'error', detail: String(err?.message) }, err?.message === 'Unauthorized' ? 401 : 500));
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (who) h.Authorization = 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const withBody = method === 'POST' || method === 'PUT';
  const res = await app.fetch(new Request(`http://t${path}`, { method, headers: h, ...(withBody ? { body: JSON.stringify(body ?? {}) } : {}) }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const NORM = {
  project_id: PID, stage: 'seed', metric: 'Month-on-month revenue growth', value: '15% MoM',
  source: 'Synthetic seed survey 2026', sample_size: 42, as_of: '2026-06-30',
};
const count = (db: any) => Number((db.prepare('SELECT COUNT(*) AS n FROM stage_norms').get() as any).n);

test('D1589: a norm without a source is refused, by the route and by the table', async () => {
  const db = fixture();
  for (const source of [undefined, '', '   ']) {
    const r = await call(db, OWNER, 'POST', '/api/decks/stage-norms', { ...NORM, source });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'source_missing');
    assert.match(r.body.message, /needs its source/);
  }
  for (const sample_size of [undefined, null, 0, -3, 2.5, 'many']) {
    const r = await call(db, OWNER, 'POST', '/api/decks/stage-norms', { ...NORM, sample_size });
    assert.equal(r.status, 400, `sample_size ${sample_size}`);
    assert.equal(r.body.error, 'sample_size_missing');
  }
  assert.equal(count(db), 0);

  // Any other writer meets the CHECK.
  const raw = db.prepare(`INSERT INTO stage_norms (uid, project_id, stage, metric, value, source, sample_size) VALUES (?, ?, 'seed', 'm', 'v', ?, ?)`);
  assert.throws(() => raw.run('u1', PID, '  ', 10), /CHECK constraint failed/);
  assert.throws(() => raw.run('u2', PID, 'Synthetic', 0), /CHECK constraint failed/);
  assert.throws(() => db.prepare(`INSERT INTO stage_norms (uid, project_id, stage, metric, value, sample_size) VALUES ('u3', ?, 'seed', 'm', 'v', 10)`).run(PID), /NOT NULL constraint failed/);
  assert.equal(count(db), 0);

  // An edit cannot clear it either.
  const made = await call(db, OWNER, 'POST', '/api/decks/stage-norms', NORM);
  assert.equal(made.status, 201);
  const cleared = await call(db, OWNER, 'PUT', `/api/decks/stage-norms/${made.body.norm.uid}`, { source: '' });
  assert.equal(cleared.status, 400);
  assert.equal(cleared.body.error, 'source_missing');
  assert.equal((db.prepare('SELECT source FROM stage_norms').get() as any).source, NORM.source);
});

test('D1589: an empty stage is "No stage benchmark recorded"; a missing date is "Not recorded"', async () => {
  const db = fixture();
  const empty = await call(db, OWNER, 'GET', `/api/decks/stage-norms?project_id=${PID}`);
  assert.equal(empty.status, 200);
  assert.deepEqual(Object.keys(empty.body.stages), ['pre_seed', 'seed', 'series_a', 'series_b_plus']);
  for (const s of Object.values(empty.body.stages) as any[]) assert.deepEqual(s.norms, { available: false, reason: NO_BENCHMARK });

  const made = await call(db, OWNER, 'POST', '/api/decks/stage-norms', { ...NORM, as_of: undefined });
  assert.equal(made.status, 201);
  assert.deepEqual(made.body.norm.as_of, { available: false, reason: NOT_RECORDED });
  assert.equal(made.body.norm.citation, 'Month-on-month revenue growth: 15% MoM (Synthetic seed survey 2026, 42 companies)');
  assert.equal((db.prepare('SELECT entered_by, origin FROM stage_norms').get() as any).entered_by, OWNER);

  const seed = await call(db, OWNER, 'GET', `/api/decks/stage-norms?project_id=${PID}&stage=seed`);
  assert.deepEqual(Object.keys(seed.body.stages), ['seed']);
  assert.equal(seed.body.stages.seed.norms.available, true);
  assert.equal(seed.body.stages.seed.norms.value.length, 1);
  assert.equal(seed.body.stages.seed.norms.value[0].origin, 'founder');
  const dated = await call(db, OWNER, 'PUT', `/api/decks/stage-norms/${made.body.norm.uid}`, { as_of: '2026-06-30' });
  assert.deepEqual(dated.body.norm.as_of, { available: true, value: '2026-06-30' });
  assert.match(dated.body.norm.citation, /as of 2026-06-30\)$/);

  const all = await call(db, OWNER, 'GET', `/api/decks/stage-norms?project_id=${PID}`);
  assert.deepEqual(all.body.stages.series_a.norms, { available: false, reason: NO_BENCHMARK });
  assert.equal((await call(db, OWNER, 'GET', `/api/decks/stage-norms?project_id=${PID}&stage=growth`)).body.error, 'stage_invalid');
});

test('D1589: the founder and a cofounder write, an advisor reads, others see nothing', async () => {
  const db = fixture();
  const mine = await call(db, OWNER, 'POST', '/api/decks/stage-norms', NORM);
  assert.equal(mine.status, 201);
  assert.equal((await call(db, COFOUNDER, 'POST', '/api/decks/stage-norms', { ...NORM, stage: 'series_a' })).status, 201);
  assert.equal((await call(db, ADVISOR, 'POST', '/api/decks/stage-norms', NORM)).status, 403);
  assert.equal((await call(db, ADVISOR, 'GET', `/api/decks/stage-norms?project_id=${PID}`)).status, 200);
  assert.equal((await call(db, ADVISOR, 'PUT', `/api/decks/stage-norms/${mine.body.norm.uid}`, { value: '99%' })).status, 403);
  assert.equal((await call(db, ADMIN, 'GET', `/api/decks/stage-norms?project_id=${PID}`)).status, 200);

  assert.equal((await call(db, OTHER, 'GET', `/api/decks/stage-norms?project_id=${PID}`)).status, 403);
  assert.equal((await call(db, OTHER, 'POST', '/api/decks/stage-norms', NORM)).status, 403);
  // Another venture's row is the same 404 as no row.
  for (const [m, b] of [['PUT', { value: '99%' }], ['DELETE', undefined]] as const) {
    const r = await call(db, OTHER, m, `/api/decks/stage-norms/${mine.body.norm.uid}`, b);
    assert.equal(r.status, 404, m);
  }
  assert.equal((await call(db, OWNER, 'PUT', '/api/decks/stage-norms/nope', { value: '1' })).status, 404);
  assert.equal((await call(db, null, 'GET', `/api/decks/stage-norms?project_id=${PID}`)).status, 401);
  assert.equal(count(db), 2);
  assert.equal((db.prepare('SELECT value FROM stage_norms WHERE uid = ?').get(mine.body.norm.uid) as any).value, '15% MoM');

  assert.deepEqual((await call(db, OWNER, 'DELETE', `/api/decks/stage-norms/${mine.body.norm.uid}`)).body, { deleted: true });
  assert.equal(count(db), 1);
});

test('D1589: a critic cites only the venture\'s rows for the stage, or a sourced founder benchmark', async () => {
  const db = fixture();
  await call(db, OWNER, 'POST', '/api/decks/stage-norms', NORM);
  await call(db, OWNER, 'POST', '/api/decks/stage-norms', { ...NORM, metric: 'Angel round size', value: '$400k', investor_type: 'angel' });
  db.prepare(`INSERT INTO stage_norms (uid, project_id, stage, metric, value, source, sample_size) VALUES ('other', ?, 'seed', 'Other venture norm', '1%', 'Synthetic', 3)`).run(OTHER_PID);
  const env = { DB: d1Over(db) } as any;

  const seedFund = await citableNorms(env, PID, 'seed', 'seed_fund');
  assert.equal(seedFund.available, true);
  assert.deepEqual((seedFund as any).value.map((n: any) => n.metric), ['Month-on-month revenue growth']);
  const angel = await citableNorms(env, PID, 'seed', 'angel');
  assert.deepEqual((angel as any).value.map((n: any) => n.metric).sort(), ['Angel round size', 'Month-on-month revenue growth']);
  assert.deepEqual(await citableNorms(env, PID, 'series_a', 'seed_fund'), { available: false, reason: NO_BENCHMARK });
  assert.deepEqual(await citableNorms(env, 999, 'seed'), { available: false, reason: NO_BENCHMARK });

  assert.deepEqual(citableBenchmark({ metric: 'TVPI', value: '1.4x', source: 'Synthetic peer set' }), { available: false, reason: NO_BENCHMARK });
  assert.deepEqual(citableBenchmark({ metric: 'TVPI', value: '1.4x', sample_size: 12 }), { available: false, reason: NO_BENCHMARK });
  assert.deepEqual(citableBenchmark({ metric: 'TVPI', value: '1.4x', source: 'Synthetic peer set', sample_size: 1 }),
    { available: true, value: 'TVPI: 1.4x (Synthetic peer set, 1 company)' });
});

test('D1589: checkNorm validates stage, investor type and date', () => {
  assert.equal((checkNorm({ ...NORM, stage: 'series_c' }) as any).code, 'stage_invalid');
  assert.equal((checkNorm({ ...NORM, investor_type: 'hedge_fund' }) as any).code, 'investor_type_invalid');
  assert.equal((checkNorm({ ...NORM, metric: ' ' }) as any).code, 'metric_missing');
  assert.equal((checkNorm({ ...NORM, value: '' }) as any).code, 'value_missing');
  assert.equal((checkNorm({ ...NORM, as_of: '30/06/2026' }) as any).code, 'as_of_invalid');
  const ok = checkNorm({ ...NORM, sample_size: '42', investor_type: '' });
  assert.equal(ok.ok, true);
  assert.equal((ok as any).norm.sample_size, 42);
  assert.equal((ok as any).norm.investor_type, null);
});
