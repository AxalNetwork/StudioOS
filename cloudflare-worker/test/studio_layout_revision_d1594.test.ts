// D1594 (#3863): a saved Studio layout's revision (migration 750), the 409
// `stale_layout` a save from a stale copy gets, and `dropped` naming every
// saved module that left — retired with its last title or null, plan-locked
// with its title and plan — so the member's Done never fails on it. Real
// SQLite from 687 plus 750, signed sessions.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/studio_layout_revision_d1594.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import studio, { RETIRED_TITLES } from '../src/routes/studio_layout.ts';
import { STUDIO_MODULES } from '../src/services/studioModules.ts';
import { PLAN_KEY as INVESTOR_PLAN_KEY } from '../src/middleware/requireInvestorTier.ts';

const JWT_SECRET = randomBytes(32).toString('hex');
const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const M687 = readFileSync(new URL('../sql/migrations/687_studio_layouts.sql', import.meta.url), 'utf8');
const M750 = readFileSync(new URL('../sql/migrations/750_studio_layout_revision.sql', import.meta.url), 'utf8');

function world({ before750 }: { before750?: (db: any) => void } = {}) {
  const fx = makeD1(stripForeignKeys(tableFromBaseline(baseline, 'users')));
  fx.db.exec(M687);
  for (const [id, role] of [[1, 'founder'], [2, 'investor'], [3, 'advisor'], [4, 'partner']] as const)
    fx.db.prepare("INSERT INTO users(id,name,email,role,is_active,investor_tier) VALUES(?,?,?,?,1,'free')").run(id, 'Synthetic', `s${id}@example.test`, role);
  before750?.(fx.db);
  fx.db.exec(M750);
  return { ...fx, env: { DB: fx.DB, JWT_SECRET, ENVIRONMENT: 'development' } as any };
}
const token = (id: number) => new SignJWT({ user_id: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
const seen: any[] = [];
async function call(env: any, id: number, path: string, method = 'GET', body?: unknown) {
  const res = await studio.fetch(new Request(`https://example.test${path}`, {
    method, headers: { 'content-type': 'application/json', authorization: `Bearer ${await token(id)}` }, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const out = { status: res.status, body: await res.json() as any };
  seen.push(out.body);
  return out;
}
const save = (env: any, id: number, layout: unknown, expected: unknown) => call(env, id, '/layout', 'PUT', { layout, expected_revision: expected });
const row = (db: any, id: number) => db.prepare('SELECT layout, revision FROM studio_layouts WHERE user_id = ?').get(id);
const A = [{ key: 'today', size: '1/2' }];
const B = [{ key: 'earnings', size: 'full' }];

test('migration 750 applies on top of 687, and a row saved before it reads revision 1', async () => {
  const w = world({ before750: (db) => db.prepare("INSERT INTO studio_layouts(user_id,profile,layout) VALUES(3,'advisor',?)").run(JSON.stringify(A)) });
  try {
    assert.equal(row(w.db, 3).revision, 1);
    const r = await call(w.env, 3, '/layout');
    assert.deepEqual([r.body.source, r.body.revision, r.body.layout], ['saved', 1, A]);
    assert.throws(() => w.db.prepare("INSERT INTO studio_layouts(user_id,profile,layout,revision) VALUES(4,'partner','[]',NULL)").run(), /NOT NULL/);
  } finally { w.db.close(); }
});

test('saving: null creates revision 1 once; each save names the revision it read; a stale copy is 409 and writes nothing; reset starts again', async () => {
  const w = world();
  try {
    const empty = await call(w.env, 3, '/layout');
    assert.deepEqual([empty.body.source, empty.body.revision, empty.body.dropped], ['default', null, []]);
    const first = await save(w.env, 3, A, null);
    assert.deepEqual([first.status, first.body.revision, first.body.layout], [200, 1, A]);
    const again = await save(w.env, 3, B, null);
    assert.deepEqual([again.status, again.body.error, again.body.revision], [409, 'stale_layout', 1]);
    assert.equal(again.body.message, 'Your layout changed in another tab. Reload it to see the latest.');
    assert.deepEqual([JSON.parse(row(w.db, 3).layout), row(w.db, 3).revision], [A, 1], 'the stale save wrote nothing');
    const second = await save(w.env, 3, B, 1);
    assert.deepEqual([second.status, second.body.revision, second.body.layout], [200, 2, B]);
    const stale = await save(w.env, 3, A, 1);
    assert.deepEqual([stale.status, stale.body.error, stale.body.revision], [409, 'stale_layout', 2]);
    assert.deepEqual([JSON.parse(row(w.db, 3).layout), row(w.db, 3).revision], [B, 2]);
    const reset = await call(w.env, 3, '/layout/reset', 'POST');
    assert.deepEqual([reset.body.source, reset.body.revision], ['default', null]);
    const afterReset = await save(w.env, 3, A, 2);
    assert.deepEqual([afterReset.status, afterReset.body.error, afterReset.body.revision], [409, 'stale_layout', null]);
    assert.equal(row(w.db, 3), undefined, 'nothing written');
    const fresh = await save(w.env, 3, A, null);
    assert.deepEqual([fresh.status, fresh.body.revision], [200, 1]);
    // Two saves from one copy at once: one wins, the other is told.
    const both = await Promise.all([save(w.env, 3, B, 1), save(w.env, 3, A, 1)]);
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
    assert.equal(row(w.db, 3).revision, 2);
  } finally { w.db.close(); }
});

test('expected_revision is required: missing, a string, a fraction or zero is 400 invalid_layout, and nothing is written', async () => {
  const w = world();
  try {
    for (const body of [{ layout: A }, { layout: A, expected_revision: '1' }, { layout: A, expected_revision: 1.5 }, { layout: A, expected_revision: 0 }, { layout: A, expected_revision: -1 }]) {
      const r = await call(w.env, 3, '/layout', 'PUT', body);
      assert.deepEqual([r.status, r.body.error], [400, 'invalid_layout'], JSON.stringify(body));
    }
    assert.equal(row(w.db, 3), undefined);
  } finally { w.db.close(); }
});

test('a saved module the plan now locks leaves layout for dropped, with its title and plan; the row is not rewritten; the returned layout saves', async () => {
  const w = world();
  const pipeline = { key: 'synthetic_pipeline', profile: 'investor', title: 'Pipeline', group: 'Deals', reads: ['/api/deals/pipeline'], default_size: '1/2' };
  (STUDIO_MODULES as any[]).push(pipeline);
  try {
    w.db.prepare("UPDATE users SET investor_tier = 'professional', investor_subscription_status = 'active' WHERE id = 2").run();
    const saved = [{ key: 'synthetic_pipeline', size: '1/2' }, { key: 'usage_quota', size: '1/3' }];
    assert.equal((await save(w.env, 2, saved, null)).status, 200);
    w.db.prepare("UPDATE users SET investor_tier = 'free' WHERE id = 2").run();
    const r = await call(w.env, 2, '/layout');
    assert.deepEqual(r.body.layout, [{ key: 'usage_quota', size: '1/3' }]);
    assert.deepEqual(r.body.dropped, [{ key: 'synthetic_pipeline', title: 'Pipeline', reason: 'plan', plan: r.body.dropped[0].plan }]);
    assert.equal(r.body.dropped[0].plan.plan_key, INVESTOR_PLAN_KEY.professional);
    assert.deepEqual(JSON.parse(row(w.db, 2).layout), saved, 'a read never rewrites the row');
    // Done with the layout the read returned succeeds: the locked module never blocks it.
    const done = await save(w.env, 2, r.body.layout, r.body.revision);
    assert.deepEqual([done.status, done.body.revision, done.body.dropped], [200, 2, []]);
    // Adding the locked module is still 402.
    const add = await save(w.env, 2, [{ key: 'synthetic_pipeline', size: '1/2' }], 2);
    assert.deepEqual([add.status, add.body.error], [402, 'module_locked']);
  } finally { (STUDIO_MODULES as any[]).splice(-1); w.db.close(); }
});

test('after an upgrade the locked module comes back, because the read never dropped it from the row', async () => {
  const w = world();
  const pipeline = { key: 'synthetic_pipeline', profile: 'investor', title: 'Pipeline', group: 'Deals', reads: ['/api/deals/pipeline'], default_size: '1/2' };
  (STUDIO_MODULES as any[]).push(pipeline);
  try {
    w.db.prepare("INSERT INTO studio_layouts(user_id,profile,layout) VALUES(2,'investor',?)").run(JSON.stringify([{ key: 'synthetic_pipeline', size: '1/2' }]));
    assert.equal((await call(w.env, 2, '/layout')).body.dropped[0].reason, 'plan');
    w.db.prepare("UPDATE users SET investor_tier = 'professional', investor_subscription_status = 'active' WHERE id = 2").run();
    const back = await call(w.env, 2, '/layout');
    assert.deepEqual([back.body.layout, back.body.dropped], [[{ key: 'synthetic_pipeline', size: '1/2' }], []]);
  } finally { (STUDIO_MODULES as any[]).splice(-1); w.db.close(); }
});

test('a saved key the catalogue no longer offers: a retired one by its last title, an unknown one with null, never a bare key', async () => {
  const w = world();
  try {
    w.db.prepare("INSERT INTO studio_layouts(user_id,profile,layout) VALUES(1,'founder',?)").run(JSON.stringify([
      { key: 'founder_actions', size: '1/2' }, { key: 'chat', size: 'full' }, { key: 'mystery_tile', size: '1/3' }, { key: 'company_progress', size: 'full' },
    ]));
    const r = await call(w.env, 1, '/layout');
    assert.deepEqual(r.body.layout, [{ key: 'company_progress', size: 'full' }]);
    assert.deepEqual(r.body.dropped, [
      { key: 'founder_actions', title: 'Do these next', reason: 'not_offered', plan: null },
      { key: 'chat', title: 'Chat', reason: 'not_offered', plan: null },
      { key: 'mystery_tile', title: null, reason: 'not_offered', plan: null },
    ]);
    for (const t of Object.values(RETIRED_TITLES)) assert.doesNotMatch(t, /_/, 'a title is never a key');
    // D1418 (#3862) renames these two; a row still holding one is named by its old title.
    assert.deepEqual([RETIRED_TITLES.module_map, RETIRED_TITLES.firm_standing], ['Module map', 'Firm standing']);
    // Saving without them succeeds.
    assert.equal((await save(w.env, 1, r.body.layout, r.body.revision)).status, 200);
  } finally { w.db.close(); }
});

test('no response anywhere has a dropped entry that is a bare key or lacks a reason', () => {
  const all = seen.flatMap((b) => (Array.isArray(b?.dropped) ? b.dropped : []));
  assert.ok(all.length >= 5, 'the tests above produced dropped entries');
  for (const d of all) {
    assert.equal(typeof d, 'object');
    assert.ok(['not_offered', 'plan'].includes(d.reason), JSON.stringify(d));
    assert.ok('title' in d && 'plan' in d && 'key' in d);
  }
  for (const b of seen) for (const e of b?.layout ?? []) assert.ok(!('locked_by_plan' in e), 'a placed module carries no lock flag');
});

test('one bound write statement per save, with no interpolated SQL', () => {
  const src = readFileSync(new URL('../src/routes/studio_layout.ts', import.meta.url), 'utf8');
  for (const m of src.matchAll(/prepare\(\s*`([^`]*)`/g)) assert.doesNotMatch(m[1], /\$\{/);
  assert.doesNotMatch(src, /INSERT OR REPLACE/i);
  assert.match(src, /WHERE user_id = \?1 AND profile = \?2 AND revision = \?4/);
});
