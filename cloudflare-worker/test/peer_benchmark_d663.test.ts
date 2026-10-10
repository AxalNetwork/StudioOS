/**
 * #1524 item 1 — the peer-group benchmark (D663 follow-up), on real SQLite.
 *
 *   · a founder outside the Lab is benchmarked against every venture at their stage;
 *   · a Lab member's group is their D589 cohort at their week, with D589's median;
 *   · a group under the minimum size is `too_little`, with the size named;
 *   · no other venture's id, name or score reaches the read;
 *   · Fundraising readiness draws it beside the founder's own score.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/peer_benchmark_d663.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import scoring from '../src/routes/scoring.ts';
import cycleRaise from '../src/routes/cycle_raise.ts';
import { signScore } from '../src/services/scoreIntegrity.ts';
import { peerBenchmark, quantileOf } from '../src/services/peerBenchmark.ts';
import { benchmarkRows } from '../src/services/raiseCycle.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SCORING_HMAC_SECRET = 'unit-test-scoring-hmac-secret';
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const sqlOf = (file: string) => readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${file}`), 'utf8');
const ENV = (db: any) => ({ JWT_SECRET, SCORING_HMAC_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);

const OWN = 1; // project 1, founder 1001, user 10

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'score_snapshots', 'user_spinout_flags', 'activity_logs']) db.exec(tableFromBaseline(BASELINE, t));
  db.prepare("INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (10, 'founder', 'Fay', 'fay@example.test', 1, 1001)").run();
  venture(db, OWN, 1001, 'Own Co', 'seed');
  return db;
}
function venture(db: any, id: number, founderId: number | null, name: string, stage: string, deleted = false) {
  db.prepare('INSERT INTO projects (id, name, founder_id, stage, deleted_at) VALUES (?, ?, ?, ?, ?)').run(id, name, founderId, stage, deleted ? '2026-01-01' : null);
}
async function official(db: any, projectId: number, score: number, when = '2026-10-01 12:00:00', o: { sandbox?: number; review?: string; badHash?: boolean } = {}) {
  const hash = o.badHash ? 'x'.repeat(64) : await signScore({ SCORING_HMAC_SECRET } as any, projectId, score, when);
  db.prepare(
    `INSERT INTO score_snapshots (project_id, total_score, tier, created_at, is_sandbox, integrity_hash, admin_review_status)
     VALUES (?, ?, 'TIER_2', ?, ?, ?, ?)`,
  ).run(projectId, score, when, o.sandbox ?? 0, hash, o.review ?? 'auto_approved');
}
/** Peers at a stage, each its own founder, with these scores. */
async function peers(db: any, stage: string, scores: number[], from = 100) {
  for (const [i, s] of scores.entries()) {
    venture(db, from + i, 5000 + from + i, `Peer ${from + i} Secret Name`, stage);
    await official(db, from + i, s);
  }
}

test('quantileOf is linear between neighbours, and its middle is D589\'s median', () => {
  assert.equal(quantileOf([10, 20, 30, 40, 50], 0.5), 30);
  assert.equal(quantileOf([10, 20, 30, 40], 0.5), 25);
  assert.equal(quantileOf([10, 20, 30, 40, 50], 0.25), 20);
  assert.equal(quantileOf([10, 20, 30, 40, 50], 0.75), 40);
  assert.equal(quantileOf([7], 0.25), 7);
});

test('a founder outside the Lab is benchmarked against every venture at their stage; under five is too_little with the size named', async () => {
  const db = fixture();
  await official(db, OWN, 60);
  await peers(db, 'seed', [40, 50, 70]);
  await peers(db, 'series_a', [90, 95, 99, 98], 200); // another stage: not peers
  const small = await peerBenchmark(ENV(db), OWN);
  assert.equal(small.state, 'too_little');
  assert.deepEqual(small.group, { kind: 'stage', label: 'ventures at the seed stage', size: 4 });
  assert.equal(small.own_score, 60);
  assert.equal(small.p50, null, 'never a median of a small group');
  assert.equal(small.percentile, null);
  assert.match(small.reason!, /^Only 4 of ventures at the seed stage have a verified score; a benchmark needs 5\.$/);

  await peers(db, 'seed', [80], 300);
  const ok = await peerBenchmark(ENV(db), OWN);
  assert.equal(ok.state, 'ok');
  assert.equal(ok.group!.size, 5);
  // Scores 40 50 60 70 80: median 60, quartiles 50 and 70, own rank 50th.
  assert.deepEqual([ok.p25, ok.p50, ok.p75, ok.percentile], [50, 60, 70, 50]);
});

test('the group counts one verified official run per founder, and never the founder\'s other projects', async () => {
  const db = fixture();
  await official(db, OWN, 60);
  await peers(db, 'seed', [40, 50, 70, 80]);
  // Not peers: a deleted venture, a practice run, a rejected run, an unverifiable run, the founder's other project.
  venture(db, 400, 9400, 'Deleted', 'seed', true); await official(db, 400, 10);
  venture(db, 401, 9401, 'Practice', 'seed'); await official(db, 401, 10, undefined, { sandbox: 1 });
  venture(db, 402, 9402, 'Rejected', 'seed'); await official(db, 402, 10, undefined, { review: 'rejected' });
  venture(db, 403, 9403, 'Tampered', 'seed'); await official(db, 403, 10, undefined, { badHash: true });
  venture(db, 404, 1001, 'Own other', 'seed'); await official(db, 404, 10);
  // A peer with an older verified run and a newer tampered one counts once, at the verified score.
  await official(db, 100, 99, '2026-10-05 12:00:00', { badHash: true });
  // The same peer founder's second venture: one score per founder, the latest.
  venture(db, 405, 5100, 'Peer second', 'seed'); await official(db, 405, 45, '2026-10-06 12:00:00');
  const b = await peerBenchmark(ENV(db), OWN);
  assert.equal(b.group!.size, 5, 'own + four peers; nothing else counted');
  // Peer 100's founder now counts by their latest verified run (45), not 40 and not 99.
  assert.deepEqual([b.p25, b.p50, b.p75], [50, 60, 70]);
});

test('no other venture\'s id, name or score reaches the read', async () => {
  const db = fixture();
  await official(db, OWN, 60);
  await peers(db, 'seed', [41, 52, 73, 84]);
  const b = await peerBenchmark(ENV(db), OWN);
  assert.deepEqual(Object.keys(b).sort(), ['group', 'own_score', 'p25', 'p50', 'p75', 'percentile', 'reason', 'state']);
  assert.deepEqual(Object.keys(b.group!).sort(), ['kind', 'label', 'size']);
  const out = JSON.stringify(b);
  for (const leak of ['Secret Name', '"100"', '41', '52', '73', '84', 'project_id', 'founder']) assert.ok(!out.includes(leak), `${leak} reached the read`);
});

test('a Lab member\'s group is their D589 cohort and week, with D589\'s median', async () => {
  const db = fixture();
  db.exec("UPDATE users SET spinout_lab_week = 3, spinout_lab_active = 1 WHERE id = 10");
  db.exec("INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted, spinout_lab_cohort) VALUES (10, 1, 'C1')");
  await official(db, OWN, 61);
  for (const [i, s] of [33, 48, 72, 90].entries()) {
    const id = 20 + i;
    db.prepare("INSERT INTO users (id, role, name, email, is_active, founder_id, spinout_lab_week, spinout_lab_active) VALUES (?, 'founder', ?, ?, 1, ?, 3, 1)").run(id, `L${id}`, `l${id}@example.test`, 2000 + id);
    db.prepare("INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted, spinout_lab_cohort) VALUES (?, 1, 'C1')").run(id);
    venture(db, 500 + i, 2000 + id, `Lab ${id}`, 'idea');
    await official(db, 500 + i, s);
  }
  await peers(db, 'seed', [1, 2, 3, 4, 5]); // same stage, not the cohort: not peers for a Lab member
  const b = await peerBenchmark(ENV(db), OWN);
  assert.deepEqual(b.group, { kind: 'lab_cohort', label: 'Lab cohort C1, week 3', size: 5 });
  const app = new Hono<any>(); app.route('/scoring', scoring);
  const jwt = await new SignJWT({ user_id: 10, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const d589 = await (await app.request(`/scoring/cohort-benchmark/${OWN}`, { headers: { Authorization: `Bearer ${jwt}` } }, ENV(db))).json() as any;
  assert.equal(d589.available, true);
  assert.equal(b.p50, d589.median, 'the Lab page and Fundraising readiness give one answer');
  assert.equal(b.percentile, d589.percentile);
});

test('Fundraising readiness draws the benchmark beside the founder\'s own score, and survives it failing', async () => {
  const db = fixture();
  for (const t of ['spinout_deck_overrides', 'pitch_decks', 'pitch_deck_share_tokens', 'deck_share_views', 'data_room_folders', 'data_room_files',
    'data_room_access_log', 'cap_table_scenarios', 'raise_prospects', 'raise_rounds', 'contacts']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(sqlOf('442_raise_cycle_stores.sql'));
  db.exec("INSERT INTO readiness_items (id, project_id, item_key, label) VALUES (1, 1, 'team', 'Team')");
  db.exec("INSERT INTO readiness_scores (item_id, project_id, score, evidence, source) VALUES (1, 1, 7, 'pattern', 'manual')");
  await official(db, OWN, 60);
  await peers(db, 'seed', [40, 50, 70, 80]);
  const app = new Hono<any>(); app.route('/api/cycles/raise', cycleRaise);
  const jwt = await new SignJWT({ user_id: 10, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const read = async () => (await (await app.request(`/api/cycles/raise/modules/fundraising-readiness?project=${OWN}`, { headers: { Authorization: `Bearer ${jwt}` } }, ENV(db))).json() as any).card;
  const card = await read();
  const rows = card.series.find((s: any) => s.kind === 'rows').items;
  assert.deepEqual(rows.map((r: any) => [r.label, r.value]), [
    ['Your venture score', 60], ['Peer median · 5 ventures at the seed stage', 60], ['Middle half of peers', '50–70'], ['Your percentile', '50th'],
  ]);
  db.exec('DROP TABLE score_snapshots');
  const broken = await read();
  assert.notEqual(broken.state, 'unreadable', 'the readiness card does not fall with the benchmark');
  assert.deepEqual(broken.series.find((s: any) => s.kind === 'rows').items, [{ label: 'Peer benchmark', value: 'The peer benchmark could not be read.', tone: 'bad' }]);
});

test('benchmarkRows: too_little and not_recorded say why, beside the own score (or Not recorded)', () => {
  assert.deepEqual(benchmarkRows({ state: 'too_little', group: { kind: 'stage', label: 'x', size: 3 }, own_score: 55, percentile: null, p25: null, p50: null, p75: null, reason: 'Only 3.' }),
    [{ label: 'Your venture score', value: 55 }, { label: 'Peer benchmark', value: 'Only 3.', tone: 'muted' }]);
  assert.deepEqual(benchmarkRows({ state: 'not_recorded', group: null, own_score: null, percentile: null, p25: null, p50: null, p75: null, reason: 'No score.' })[0], { label: 'Your venture score', value: null });
});

test('the quartiles are the 25th and 75th, and every figure is coarsened (median and quartiles to 5, rank to 10)', async () => {
  const db = fixture();
  await official(db, OWN, 30);
  await peers(db, 'seed', [10, 20, 40, 50, 60]);
  const b = await peerBenchmark(ENV(db), OWN);
  // 10 20 30 40 50 60: q25 = 22.5 → 25, median 35, q75 = 47.5 → 50; own rank = (2 + 0.5) / 6 = 42 → 40.
  assert.deepEqual([b.p25, b.p50, b.p75, b.percentile], [25, 35, 50, 40]);
});
