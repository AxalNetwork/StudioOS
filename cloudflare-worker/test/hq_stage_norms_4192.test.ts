/**
 * D4155 K5 (#4192) — HQ's stage norms (migration 202611022230), through the
 * mounted routes on SQLite (the baseline and every migration).
 *
 *   1. `source` is required: by the route (400 source_missing), on an edit that
 *      clears it, and by the table's CHECK for any other writer.
 *   2. Every write takes a reason of ten characters or more (400
 *      reason_required), writes nothing without one, and writes one admin
 *      audit row with before and after.
 *   3. A retired norm is kept with who retired it and why, cannot be edited,
 *      and is not cited from that moment.
 *   4. What the critic cites: the venture's own norms first, then HQ's active
 *      ones, each quoting the norm, its range and its source.
 *   5. HQ reads a venture's norms, read-only, and cannot write them.
 *   6. Who: an HQ admin and the Super Admin; never a branch admin or a founder.
 *   7. No email in any answer.
 *
 * Every name and figure is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import adminDeckStageNorms, { mount } from '../src/routes/admin_deck_stage_norms.ts';
import deckStageNorms from '../src/routes/deck_stage_norms.ts';
import decks from '../src/routes/decks.ts';
import { HQ_STAGES, checkHqNorm, rangeText } from '../src/services/decks/hqStageNorms.ts';
import { criticMessage, CRITIC_SYSTEM } from '../src/services/decks/critic.ts';
import { NO_BENCHMARK, STAGES, citableStageNorms } from '../src/services/decks/stageNorms.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-4192-hq-stage-norms-0123456789-abcdef';
const OWNER = 1, ADMIN = 4, SUPER = 6, OTHER = 5;
const PID = 7;
const BASE = '/api/admin/deck-stage-norms';
const REASON = 'Synthetic: the 2026 survey moved retention up.';

function fixture() {
  const db = new DatabaseSync(':memory:');
  loadSchema(db);
  db.exec(`INSERT INTO founders (id, name, email) VALUES (10, 'Synthetic Founder', 'f@example.test'), (11, 'Synthetic Other', 'o@example.test');
    INSERT INTO users (id, uid, email, name, role, founder_id) VALUES
      (${OWNER}, 'u-owner', 'owner@example.test', 'Synthetic Owner', 'founder', 10),
      (${ADMIN}, 'u-admin', 'admin@example.test', 'Synthetic Admin', 'admin', NULL),
      (${SUPER}, 'u-super', 'super@example.test', 'Synthetic Super Admin', 'admin', NULL),
      (${OTHER}, 'u-other', 'other@example.test', 'Synthetic Other Founder', 'founder', 11);
    INSERT OR IGNORE INTO super_admins (user_id) VALUES (${SUPER});
    INSERT INTO projects (id, name, founder_id) VALUES (${PID}, 'Synthetic venture', 10);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (${PID}, ${OWNER}, 'owner', 'accepted');`);
  return db;
}

async function call(db: any, who: number, method: string, path: string, body?: unknown, extraEnv: Record<string, unknown> = {}) {
  const app = new Hono<any>().route(BASE, adminDeckStageNorms).route('/api/decks', deckStageNorms).route('/api/decks', decks);
  app.onError((err: any, c: any) => {
    const m = String(err?.message || '');
    const status = m === 'Unauthorized' ? 401 : /admin|HQ|branch/i.test(m) ? 403 : 500;
    return c.json({ error: status === 403 ? 'forbidden' : status === 401 ? 'unauthorized' : 'error', detail: m }, status);
  });
  const h: Record<string, string> = { 'content-type': 'application/json' };
  h.Authorization = 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.fetch(new Request(`http://t${path}`, { method, headers: h, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...extraEnv } as any, { waitUntil() {}, passThroughOnException() {} } as any);
  const text = await res.text();
  let value: any; try { value = JSON.parse(text); } catch { value = text; }
  return { status: res.status, body: value, text };
}

const NORM = { stage: 'seed', metric: 'Net revenue retention', range: { low: 100, high: 120, unit: '%' }, source: 'Synthetic seed benchmarks report 2026', reason: REASON };
const count = (db: any) => Number((db.prepare('SELECT COUNT(*) AS n FROM hq_stage_norms').get() as any).n);
const audits = (db: any) => (db.prepare("SELECT admin_user_id, action, filters_json FROM admin_audit_log WHERE action LIKE 'deck_stage_norm_%' ORDER BY id").all() as any[])
  .map((r) => ({ by: r.admin_user_id, action: r.action, details: JSON.parse(r.filters_json) }));

test('K5: a source is required, by the route, on an edit and by the table', async () => {
  const db = fixture();
  for (const source of [undefined, '', '   ']) {
    const r = await call(db, ADMIN, 'POST', BASE, { ...NORM, source });
    assert.deepEqual([r.status, r.body.error], [400, 'source_missing']);
    assert.match(r.body.message, /needs its source/);
  }
  assert.equal(count(db), 0);
  const made = await call(db, ADMIN, 'POST', BASE, NORM);
  assert.equal(made.status, 201, made.text);
  const edit = await call(db, ADMIN, 'PUT', `${BASE}/${made.body.norm.uid}`, { source: ' ', reason: REASON });
  assert.deepEqual([edit.status, edit.body.error], [400, 'source_missing']);
  assert.throws(() => db.prepare("INSERT INTO hq_stage_norms (uid, stage, metric, range_low, source, last_reviewed) VALUES ('x', 'seed', 'm', 1, '  ', '2026-11-02')").run(), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO hq_stage_norms (uid, stage, metric, source, last_reviewed) VALUES ('y', 'seed', 'm', 's', '2026-11-02')").run(), /CHECK/, 'a range has a bound');
  assert.throws(() => db.prepare("INSERT INTO hq_stage_norms (uid, stage, metric, range_low, source, last_reviewed, status) VALUES ('z', 'seed', 'm', 1, 's', '2026-11-02', 'retired')").run(), /CHECK/, 'a retired row carries its reason');
  for (const range of [{}, { low: 'many' }, { low: 9, high: 3 }, null]) {
    assert.equal((await call(db, ADMIN, 'POST', BASE, { ...NORM, range })).body.error, 'range_invalid', JSON.stringify(range));
  }
  assert.equal((await call(db, ADMIN, 'POST', BASE, { ...NORM, stage: 'series_z' })).body.error, 'stage_invalid');
  assert.equal((await call(db, ADMIN, 'POST', BASE, { ...NORM, last_reviewed: '2026-02-30' })).body.error, 'last_reviewed_invalid');
});

test('K5: every write takes a reason and writes one audit row with before and after', async () => {
  const db = fixture();
  for (const reason of [undefined, '', 'too short', '    padded    ']) {
    const r = await call(db, ADMIN, 'POST', BASE, { ...NORM, reason });
    assert.deepEqual([r.status, r.body.error], [400, 'reason_required'], JSON.stringify(reason));
  }
  assert.equal(count(db), 0);
  const made = (await call(db, ADMIN, 'POST', BASE, NORM)).body.norm;
  const uid = made.uid;
  assert.equal((await call(db, ADMIN, 'PUT', `${BASE}/${uid}`, { range: { low: 105, high: 125, unit: '%' } })).body.error, 'reason_required');
  assert.equal((await call(db, ADMIN, 'POST', `${BASE}/${uid}/retire`, { reason: 'short' })).body.error, 'reason_required');
  assert.deepEqual((await call(db, ADMIN, 'GET', `${BASE}?stage=seed`)).body.norms.map((n: any) => [n.range.low, n.status]), [[100, 'active']], 'nothing changed without a reason');
  const edited = await call(db, SUPER, 'PUT', `${BASE}/${uid}`, { range: { low: 105, high: 125, unit: '%' }, reason: 'Synthetic: the newer report reads higher.' });
  assert.equal(edited.status, 200, edited.text);
  assert.deepEqual(edited.body.norm.updated_by, { uid: 'u-super', name: 'Synthetic Super Admin' }, 'the last to change it is named');
  assert.deepEqual((await call(db, ADMIN, 'GET', `${BASE}?stage=seed`)).body.norms[0].updated_by, { uid: 'u-super', name: 'Synthetic Super Admin' }, 'and so on the list');
  await call(db, ADMIN, 'POST', `${BASE}/${uid}/retire`, { reason: 'Synthetic: not a stage signal for seed.' });
  const fields = (low: number, high: number, status: string) => ({ stage: 'seed', metric: 'Net revenue retention', range: { low, high, unit: '%' }, source: NORM.source, last_reviewed: made.last_reviewed, status });
  assert.deepEqual(audits(db), [
    { by: ADMIN, action: 'deck_stage_norm_added', details: { norm_uid: uid, reason: REASON, before: null, after: fields(100, 120, 'active') } },
    { by: SUPER, action: 'deck_stage_norm_edited', details: { norm_uid: uid, reason: 'Synthetic: the newer report reads higher.', before: fields(100, 120, 'active'), after: fields(105, 125, 'active') } },
    { by: ADMIN, action: 'deck_stage_norm_retired', details: { norm_uid: uid, reason: 'Synthetic: not a stage signal for seed.', before: fields(105, 125, 'active'), after: fields(105, 125, 'retired') } },
  ]);
});

test('K5: a retired norm keeps who retired it and why, cannot be edited, and is never cited', async () => {
  const db = fixture();
  const a = (await call(db, ADMIN, 'POST', BASE, NORM)).body.norm;
  const b = (await call(db, ADMIN, 'POST', BASE, { ...NORM, metric: 'Logo count', range: { low: 5, high: null, unit: 'logos' } })).body.norm;
  const before = await citableStageNorms({ DB: d1Over(db) } as any, PID, 'seed');
  assert.deepEqual(before.available && before.value.map((c) => c.uid).sort(), [a.uid, b.uid].sort());
  const retired = await call(db, SUPER, 'POST', `${BASE}/${b.uid}/retire`, { reason: 'Synthetic: not a stage signal.' });
  assert.equal(retired.status, 200, retired.text);
  assert.deepEqual([retired.body.norm.status, retired.body.norm.retired_by, retired.body.norm.retired_reason], ['retired', { uid: 'u-super', name: 'Synthetic Super Admin' }, 'Synthetic: not a stage signal.']);
  assert.ok(retired.body.norm.retired_at);
  const after = await citableStageNorms({ DB: d1Over(db) } as any, PID, 'seed');
  assert.deepEqual(after.available && after.value.map((c) => c.uid), [a.uid], 'retiring stops citations at once');
  assert.deepEqual((await call(db, ADMIN, 'PUT', `${BASE}/${b.uid}`, { metric: 'x', reason: REASON })).body.error, 'norm_retired');
  assert.deepEqual((await call(db, ADMIN, 'POST', `${BASE}/${b.uid}/retire`, { reason: REASON })).body.error, 'already_retired');
  const list = (await call(db, ADMIN, 'GET', `${BASE}?stage=seed`)).body.norms;
  assert.deepEqual(list.map((n: any) => [n.metric, n.status]), [['Net revenue retention', 'active'], ['Logo count', 'retired']], 'active first, the retired one still listed');
  assert.deepEqual((await call(db, ADMIN, 'GET', `${BASE}?stage=seed&status=active`)).body.norms.map((n: any) => n.uid), [a.uid]);
  await call(db, ADMIN, 'POST', `${BASE}/${a.uid}/retire`, { reason: 'Synthetic: replaced by a newer source.' });
  assert.deepEqual(await citableStageNorms({ DB: d1Over(db) } as any, PID, 'seed'), { available: false, reason: NO_BENCHMARK });
});

test('K5: the critic cites the venture\'s own norms first, then HQ\'s, quoting norm, range and source and never rating', async () => {
  const db = fixture();
  await call(db, ADMIN, 'POST', BASE, NORM);
  await call(db, ADMIN, 'POST', BASE, { ...NORM, stage: 'series_a', metric: 'Burn multiple', range: { low: null, high: 2, unit: 'x' } });
  const mine = await call(db, OWNER, 'POST', '/api/decks/stage-norms', { project_id: PID, stage: 'seed', metric: 'Month-on-month growth', value: '15% MoM', source: 'Synthetic founder survey', sample_size: 40 });
  assert.equal(mine.status, 201, mine.text);
  const cited = await citableStageNorms({ DB: d1Over(db) } as any, PID, 'seed');
  assert.ok(cited.available);
  assert.deepEqual(cited.value.map((c) => c.origin), ['project', 'hq']);
  assert.match(cited.value[0].citation, /^Month-on-month growth: 15% MoM \(Synthetic founder survey, 40 companies\)$/);
  assert.match(cited.value[1].citation, /^Net revenue retention: typically 100–120% \(Synthetic seed benchmarks report 2026; Axal HQ norm, reviewed \d{4}-\d{2}-\d{2}\)$/);
  assert.deepEqual((await citableStageNorms({ DB: d1Over(db) } as any, 999, 'seed') as any).value.map((c: any) => c.origin), ['hq'], 'HQ\'s norms stand when a venture has none');
  assert.deepEqual([rangeText(5, null, 'logos'), rangeText(null, 18, 'months'), rangeText(null, 2, 'x'), rangeText(3, 3, '')], ['5+ logos', 'up to 18 months', 'up to 2x', '3']);
  const critic = readFileSync(new URL('../src/routes/deck_critic.ts', import.meta.url), 'utf8');
  assert.match(critic, /await citableStageNorms\(c\.env, a\.projectId, plan\.stage, plan\.investor_type\)/, 'the critic reads both, in order');
  assert.doesNotMatch(critic, /\bcitableNorms\(/, 'never the venture\'s alone');
  assert.match(CRITIC_SYSTEM, /quote the norm, its range and its source/);
  assert.match(CRITIC_SYSTEM, /Never rate, score or grade the company/);
  assert.match(criticMessage({ persona: 'x', stageLabel: 'Seed', cards: [], already: [], benchmarks: cited.value.map((c) => c.citation) }), /the venture's own first and then Axal HQ's/);
});

test('K5: HQ reads a venture\'s norms read-only, by name, and cannot write them', async () => {
  const db = fixture();
  const mine = (await call(db, OWNER, 'POST', '/api/decks/stage-norms', { project_id: PID, stage: 'seed', metric: 'Gross margin', value: '72%', source: 'Synthetic own books', sample_size: 1 })).body.norm;
  const read = await call(db, ADMIN, 'GET', `${BASE}/projects/${PID}`);
  assert.equal(read.status, 200, read.text);
  assert.equal(read.body.read_only, true);
  assert.deepEqual(read.body.project, { id: PID, name: 'Synthetic venture' });
  assert.deepEqual(read.body.norms.map((n: any) => [n.metric, n.value, n.set_by]), [['Gross margin', '72%', { uid: 'u-owner', name: 'Synthetic Owner' }]]);
  assert.deepEqual(read.body.last_changed.by, { uid: 'u-owner', name: 'Synthetic Owner' });
  assert.equal((await call(db, ADMIN, 'GET', `${BASE}/projects/999`)).status, 404);
  for (const who of [ADMIN, SUPER]) {
    const add = await call(db, who, 'POST', '/api/decks/stage-norms', { project_id: PID, stage: 'seed', metric: 'x', value: '1', source: 's', sample_size: 2 });
    assert.deepEqual([add.status, add.body.error], [403, 'hq_read_only']);
    assert.deepEqual((await call(db, who, 'PUT', `/api/decks/stage-norms/${mine.uid}`, { value: '90%' })).body.error, 'hq_read_only');
    assert.deepEqual((await call(db, who, 'DELETE', `/api/decks/stage-norms/${mine.uid}`)).body.error, 'hq_read_only');
  }
  assert.deepEqual((db.prepare('SELECT metric, value FROM stage_norms').all() as any[]).map((r) => [r.metric, r.value]), [['Gross margin', '72%']]);
  assert.equal((await call(db, ADMIN, 'GET', `/api/decks/stage-norms?project_id=${PID}`)).status, 200, 'an admin still reads them there');
  for (const [m, p] of [['POST', `${BASE}/projects/${PID}`], ['PUT', `${BASE}/projects/${PID}`], ['DELETE', `${BASE}/projects/${PID}`]]) {
    assert.equal((await call(db, ADMIN, m, p, { reason: REASON })).status, 404, `${m} has no project write here`);
  }
});

test('K5: an HQ admin and the Super Admin; never a branch admin or a founder', async () => {
  const db = fixture();
  assert.equal((await call(db, OWNER, 'GET', BASE)).status, 403);
  assert.equal((await call(db, OWNER, 'POST', BASE, NORM)).status, 403);
  assert.equal((await call(db, OWNER, 'GET', `${BASE}/projects/${PID}`)).status, 403);
  assert.equal((await call(db, ADMIN, 'POST', BASE, NORM, { BRANCH_CODE: 'lisbon' })).status, 403);
  assert.equal((await call(db, ADMIN, 'GET', BASE, undefined, { BRANCH_CODE: 'lisbon' })).status, 403);
  assert.equal(count(db), 0);
  assert.equal((await call(db, ADMIN, 'POST', BASE, NORM)).status, 201);
  assert.equal((await call(db, SUPER, 'POST', BASE, { ...NORM, metric: 'Runway' })).status, 201);
  assert.equal((await call(db, ADMIN, 'GET', `${BASE}?stage=nope`)).body.error, 'stage_invalid');
  assert.deepEqual([mount.path], [BASE]);
  assert.deepEqual(HQ_STAGES, STAGES, 'HQ\'s restated stages are D1589\'s');
});

test('K5: no email in any answer, and people by uid and name', async () => {
  const db = fixture();
  const made = await call(db, ADMIN, 'POST', BASE, NORM);
  const retired = await call(db, SUPER, 'POST', `${BASE}/${made.body.norm.uid}/retire`, { reason: REASON });
  await call(db, OWNER, 'POST', '/api/decks/stage-norms', { project_id: PID, stage: 'seed', metric: 'Gross margin', value: '72%', source: 'Synthetic own books', sample_size: 1 });
  const list = await call(db, ADMIN, 'GET', BASE);
  const proj = await call(db, ADMIN, 'GET', `${BASE}/projects/${PID}`);
  assert.deepEqual(made.body.norm.updated_by, { uid: 'u-admin', name: 'Synthetic Admin' });
  assert.deepEqual(Object.keys(list.body.norms[0]).sort(), ['citation', 'last_reviewed', 'metric', 'range', 'retired_at', 'retired_by', 'retired_reason', 'source', 'stage', 'status', 'uid', 'updated_by']);
  for (const r of [made, retired, list, proj]) assert.doesNotMatch(r.text, /@|email/i);
  const svc = readFileSync(new URL('../src/services/decks/hqStageNorms.ts', import.meta.url), 'utf8');
  for (const sql of [...svc.matchAll(/`([^`]*)`/g)].map((m) => m[1]).filter((b) => /\bSELECT\b/.test(b))) assert.doesNotMatch(sql, /email/i);
  assert.equal(checkHqNorm({ ...NORM, range: { low: '100', high: '120', unit: '%' } }, '2026-11-02').ok, true, 'a bound typed as text is read as its number');
});
