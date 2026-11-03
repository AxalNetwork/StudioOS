/**
 * D4155 K4 (#4191) — HQ › Decks › Default templates, through the real mounted
 * routes on SQLite.
 *
 *   1. Every write takes a reason of ten characters or more, else 400
 *      `reason_required`, and nothing is written.
 *   2. Each write is one admin audit row with its before, its after and the
 *      reason.
 *   3. The Super Admin writes; any admin reads; a branch admin and a founder
 *      write nothing.
 *   4. `defaults` is the engine's own pick for every cell of HQ's grid, the
 *      same function `recommendMethod` uses.
 *   5. `updated_by` names the setter by uid and name, never an email.
 *
 * Every principal is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/deck_default_templates_4191.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import decks from '../src/routes/decks.ts';
import { engineDefault, GRID_SECTORS, GRID_STAGES, recommendMethod } from '../src/services/decks/recommend.ts';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { __resetForTest } from '../src/services/aiRouter.ts';

const SECRET = 'synthetic-deck-templates-secret-4191'.repeat(2);
const SUPER = 1, ADMIN = 21, FOUNDER = 2;
const PATH = '/api/decks/admin/recommend-overrides';
const REASON = 'Synthetic: fintech seed decks lead with traction.';

async function call(f: any, who: number, method: string, path: string, body?: unknown, env = f.env) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  headers.Authorization = 'Bearer ' + await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await f.app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const text = await res.text();
  let value: any; try { value = JSON.parse(text); } catch { value = text; }
  return { status: res.status, body: value, text };
}

function fixture() {
  __resetForTest();
  const f = aiBudgetFixture();
  f.db.exec('ALTER TABLE users ADD COLUMN uid TEXT;');
  f.db.prepare("INSERT OR IGNORE INTO users(id,email,name,role) VALUES(?,?,?,?)").run(ADMIN, 'synthetic21@example.test', 'Synthetic Admin', 'admin');
  f.db.exec(`UPDATE users SET role = 'admin', name = 'Synthetic Admin' WHERE id = ${ADMIN};
    UPDATE users SET name = 'Synthetic Super Admin', email = 'synthetic-super@example.test' WHERE id = ${SUPER};
    UPDATE users SET uid = 'u-' || id;`);
  const env: any = { DB: f.DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route('/api/decks', decks);
  app.onError((err: any, c: any) => c.json({ error: err?.message === 'Unauthorized' ? 'unauthorized' : 'error' }, err?.message === 'Unauthorized' ? 401 : 500));
  return { ...f, app, env };
}
const audit = (f: any) => {
  try {
    return (f.db.prepare("SELECT admin_user_id, action, filters_json FROM admin_audit_log WHERE action LIKE 'deck_default_template_%' ORDER BY id").all() as any[])
      .map((r) => ({ by: r.admin_user_id, action: r.action, details: JSON.parse(r.filters_json) }));
  } catch { return []; }
};
const overrides = (f: any) => {
  try { return (f.db.prepare('SELECT sector, stage, method_id FROM deck_recommendation_overrides ORDER BY id').all() as any[]).map((r) => ({ ...r })); } catch { return []; }
};

test('every write takes a reason of ten characters or more, else 400 reason_required and nothing is written', async () => {
  const f = fixture();
  for (const reason of [undefined, '', 'too short', '         x         ', 42]) {
    const put = await call(f, SUPER, 'PUT', PATH, { sector: 'Fintech', stage: 'seed', method_id: 'yc_seed', reason });
    assert.deepEqual([put.status, put.body.error], [400, 'reason_required'], `PUT ${JSON.stringify(reason)}`);
  }
  assert.deepEqual(overrides(f), []);
  assert.equal((await call(f, SUPER, 'PUT', PATH, { sector: 'Fintech', stage: 'seed', method_id: 'yc_seed', reason: REASON })).status, 200);
  for (const body of [undefined, {}, { reason: 'too short' }]) {
    const del = await call(f, SUPER, 'DELETE', `${PATH}?sector=Fintech&stage=seed`, body);
    assert.deepEqual([del.status, del.body.error], [400, 'reason_required'], `DELETE ${JSON.stringify(body)}`);
  }
  const viaQuery = await call(f, SUPER, 'DELETE', `${PATH}?sector=Fintech&stage=seed&reason=${encodeURIComponent(REASON)}`);
  assert.deepEqual([viaQuery.status, viaQuery.body.error], [400, 'reason_required'], 'a reason in the URL is not read');
  assert.deepEqual(overrides(f), [{ sector: 'Fintech', stage: 'seed', method_id: 'yc_seed' }], 'nothing reset without a reason');
  assert.equal(audit(f).length, 1, 'a refused write records nothing');
});

test('each write is one admin audit row with before, after and the reason', async () => {
  const f = fixture();
  await call(f, SUPER, 'PUT', PATH, { sector: 'Fintech', stage: 'seed', method_id: 'yc_seed', reason: REASON });
  await call(f, SUPER, 'PUT', PATH, { sector: 'Fintech', stage: 'seed', method_id: 'narrative_brand', reason: 'Synthetic: a second thought on fintech.' });
  await call(f, SUPER, 'DELETE', `${PATH}?sector=Fintech&stage=seed`, { reason: 'Synthetic: back to the engine pick.' });
  const engine = engineDefault('Fintech', 'seed').method_id;
  assert.deepEqual(audit(f), [
    { by: SUPER, action: 'deck_default_template_set', details: { sector: 'Fintech', stage: 'seed', before: { method_id: null, engine_default: engine }, after: { method_id: 'yc_seed' }, reason: REASON } },
    { by: SUPER, action: 'deck_default_template_set', details: { sector: 'Fintech', stage: 'seed', before: { method_id: 'yc_seed', engine_default: engine }, after: { method_id: 'narrative_brand' }, reason: 'Synthetic: a second thought on fintech.' } },
    { by: SUPER, action: 'deck_default_template_reset', details: { sector: 'Fintech', stage: 'seed', before: { method_id: 'narrative_brand' }, after: { method_id: null, engine_default: engine }, reason: 'Synthetic: back to the engine pick.' } },
  ]);
  assert.deepEqual(overrides(f), []);
  assert.doesNotMatch(JSON.stringify(audit(f)), /@example\.test/, 'the audit details carry no email');
});

test('the Super Admin writes; any admin reads; a branch admin and a founder write nothing', async () => {
  const f = fixture();
  const body = { sector: 'Health', stage: 'series_a', method_id: 'yc_seed', reason: REASON };
  for (const [who, env] of [[ADMIN, f.env], [SUPER, { ...f.env, BRANCH_CODE: 'lisbon' }]] as const) {
    const put = await call(f, who, 'PUT', PATH, body, env);
    assert.deepEqual([put.status, put.body.error], [403, 'super_admin_required']);
    const del = await call(f, who, 'DELETE', `${PATH}?sector=Health&stage=series_a`, { reason: REASON }, env);
    assert.deepEqual([del.status, del.body.error], [403, 'super_admin_required']);
  }
  assert.equal((await call(f, FOUNDER, 'PUT', PATH, body)).status, 403);
  assert.equal((await call(f, FOUNDER, 'GET', PATH)).status, 403, 'a founder does not read HQ\'s grid');
  assert.deepEqual([overrides(f), audit(f)], [[], []]);
  assert.equal((await call(f, SUPER, 'PUT', PATH, body)).status, 200);
  for (const who of [ADMIN, SUPER]) {
    const read = await call(f, who, 'GET', PATH);
    assert.equal(read.status, 200);
    assert.deepEqual(read.body.overrides.map((o: any) => [o.sector, o.stage, o.method_id]), [['Health', 'series_a', 'yc_seed']]);
  }
});

test('defaults is the engine\'s own pick for every cell of the grid, and the engine follows an override first', async () => {
  const f = fixture();
  const read = await call(f, ADMIN, 'GET', PATH);
  assert.equal(read.body.defaults.length, GRID_SECTORS.length * GRID_STAGES.length);
  for (const sector of GRID_SECTORS) for (const stage of GRID_STAGES) {
    const cell = read.body.defaults.find((d: any) => d.sector === sector && d.stage === stage);
    const project = await recommendMethod(f.env, { sector, stage });
    assert.deepEqual([cell.method_id, cell.source], [project.method_id, project.source], `${sector} · ${stage}`);
  }
  assert.deepEqual(read.body.defaults.find((d: any) => d.sector === 'Consumer' && d.stage === 'seed'), { sector: 'Consumer', stage: 'seed', method_id: 'narrative_brand', source: 'sector' });
  assert.deepEqual(read.body.defaults.find((d: any) => d.sector === 'Fintech' && d.stage === 'pre_seed'), { sector: 'Fintech', stage: 'pre_seed', method_id: 'yc_seed', source: 'stage_default' });
  // Owner decision: "Deep tech", as the grid writes it, is deep tech.
  assert.deepEqual(['seed', 'series_a', 'series_b', 'pre_seed'].map((stage) => read.body.defaults.find((d: any) => d.sector === 'Deep tech' && d.stage === stage)).map((d: any) => [d.method_id, d.source]),
    [['sequoia_classic', 'sector'], ['investor_appendix', 'sector'], ['series_b_diligence', 'sector'], ['yc_seed', 'stage_default']]);
  for (const spelling of ['deeptech', 'Deep-tech', 'DEEP TECH']) assert.equal((await recommendMethod(f.env, { sector: spelling, stage: 'series_a' })).method_id, 'investor_appendix', spelling);
  assert.equal((await recommendMethod(f.env, { sector: 'Deep sea fishing tech', stage: 'series_a' })).method_id, 'series_a_growth', 'only deep tech, not any phrase with both words');
  await call(f, SUPER, 'PUT', PATH, { sector: 'Consumer', stage: 'seed', method_id: 'yc_seed', reason: REASON });
  assert.deepEqual(await recommendMethod(f.env, { sector: 'Consumer', stage: 'Seed' }), { method_id: 'yc_seed', sector: 'Consumer', stage: 'seed', source: 'override' });
  const after = await call(f, ADMIN, 'GET', PATH);
  assert.equal(after.body.defaults.find((d: any) => d.sector === 'Consumer' && d.stage === 'seed').method_id, 'narrative_brand', 'defaults stay the engine\'s pick under an override');
});

test('updated_by names the setter by uid and name, never an email', async () => {
  const f = fixture();
  const put = await call(f, SUPER, 'PUT', PATH, { sector: 'Climate', stage: 'seed', method_id: 'yc_seed', reason: REASON });
  assert.deepEqual(put.body.overrides[0].updated_by, { uid: `u-${SUPER}`, name: 'Synthetic Super Admin' });
  const read = await call(f, ADMIN, 'GET', PATH);
  assert.deepEqual(Object.keys(read.body.overrides[0]).sort(), ['method_id', 'sector', 'stage', 'updated_at', 'updated_by']);
  assert.deepEqual(read.body.overrides[0].updated_by, { uid: `u-${SUPER}`, name: 'Synthetic Super Admin' });
  for (const r of [put, read]) assert.doesNotMatch(r.text, /@|email/i);
  f.db.exec(`PRAGMA foreign_keys=OFF; DELETE FROM users WHERE id = ${SUPER};`);
  assert.equal((await call(f, ADMIN, 'GET', PATH)).body.overrides[0].updated_by, null, 'a setter no longer on file reads null, never a guess');
});

test('the grid\'s SQL never selects an email', () => {
  const src = readFileSync(new URL('../src/services/decks/recommend.ts', import.meta.url), 'utf8');
  const sql = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]).filter((b) => /\bSELECT\b/i.test(b));
  assert.ok(sql.some((b) => /LEFT JOIN users u/.test(b)), 'the setter is joined');
  for (const b of sql) assert.doesNotMatch(b, /email/i);
});
