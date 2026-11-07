/**
 * D4856 (#4856): the Platform catalogue summary counts the catalogue anyone can
 * buy from, by the one mode rule `getCatalog` reads with; other-mode and
 * unknown-mode rows are counted apart.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/catalog_modes_4856.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { catalogRowScope, getCatalog, readCatalogMirrorSummary } from '../src/services/catalog.ts';
import { d1Over } from './_d1_sqlite.mjs';

function mirror() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE stripe_products (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'alacarte',
    active INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}', prices_json TEXT NOT NULL DEFAULT '[]',
    synced_at TEXT NOT NULL DEFAULT (datetime('now')), livemode INTEGER)`);
  const ins = db.prepare('INSERT INTO stripe_products (id, name, active, prices_json, synced_at, livemode) VALUES (?,?,?,?,?,?)');
  const prices = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: `p${i}`, active: true })));
  ins.run('live_1', 'Live one', 1, prices(2), '2026-11-01 10:00:00', 1);
  ins.run('live_2', 'Live two', 0, prices(1), '2026-11-02 10:00:00', 1);
  ins.run('test_1', 'Test one', 1, prices(4), '2026-11-06 10:00:00', 0);
  ins.run('test_2', 'Test two', 1, prices(1), '2026-11-06 11:00:00', 0);
  ins.run('test_3', 'Test three', 1, prices(1), '2026-11-06 12:00:00', 0);
  ins.run('null_1', 'Null mode', 1, prices(8), '2026-11-07 10:00:00', null);
  ins.run('odd_1', 'Odd mode', 1, prices(16), '2026-11-07 11:00:00', 7);
  return db;
}
const envOf = (db: DatabaseSync, key?: string) => ({ DB: d1Over(db), STRIPE_SECRET_KEY: key } as any);

for (const [key, current, other, otherMode] of [['sk_live_x', 2, 3, 'test'], ['sk_test_x', 3, 2, 'live']] as const) {
  test(`${key.slice(3, 7)} mode: the summary's current-mode counts are exactly the catalogue's, and other and unknown rows are apart`, async () => {
    // Mutation checked: mode predicate dropped from the summary → all seven rows count as current.
    // Mutation checked: unknown rows folded into other → unknown_mode reads 0.
    const env = envOf(mirror(), key);
    const catalogue = await getCatalog(env, undefined, undefined, { sync: false });
    const s: any = await readCatalogMirrorSummary(env);
    assert.equal(catalogue.length, current);
    assert.equal(s.products.all, catalogue.length, 'product count matches the catalogue');
    assert.equal(s.products.active, catalogue.filter((p) => p.active).length);
    assert.equal(s.prices.all, catalogue.reduce((n, p) => n + p.prices.length, 0), 'price count matches the catalogue');
    assert.equal(s.prices.active, catalogue.reduce((n, p) => n + p.prices.filter((x) => x.active).length, 0));
    assert.deepEqual(s.other_mode, { mode: otherMode, products: other });
    assert.deepEqual(s.unknown_mode, { products: 2 });
    assert.equal(s.stripe_mode, key.startsWith('sk_live') ? 'live' : 'test');
    assert.equal(s.products.all + s.other_mode.products + s.unknown_mode.products, 7, 'every row is in exactly one population');
  });
}

test('the summary and getCatalog take the same rows, row by row, for every livemode value', async () => {
  // Mutation checked: catalogRowScope treating 7 as current → the odd row is in the summary but not the catalogue.
  for (const key of ['sk_live_x', 'sk_test_x']) {
    const env = envOf(mirror(), key);
    const ids = (await getCatalog(env, undefined, undefined, { sync: false })).map((p) => p.id).sort();
    const rows = (env.DB as any).prepare ? await env.DB.prepare('SELECT id, livemode FROM stripe_products').all() : { results: [] };
    const scoped = (rows.results as any[]).filter((r) => catalogRowScope(r.livemode, key.startsWith('sk_live') ? 'live' : 'test') === 'current').map((r) => r.id).sort();
    assert.deepEqual(scoped, ids);
  }
  assert.deepEqual([null, undefined, '', 2, 'x'].map((v) => catalogRowScope(v, 'live')), Array(5).fill('unknown'));
  assert.deepEqual([catalogRowScope(1, 'live'), catalogRowScope(0, 'live'), catalogRowScope(0, 'test'), catalogRowScope(1, 'test')], ['current', 'other', 'current', 'other']);
});

test('with no Stripe key nothing is current, as the catalogue is empty; freshness is of current rows, and a sync outcome is not recorded', async () => {
  // Mutation checked: last_written_at taken over every row → it reads the unknown row's later stamp.
  const none: any = await readCatalogMirrorSummary(envOf(mirror()));
  assert.deepEqual([none.stripe_mode, none.products.all, none.other_mode.mode, none.other_mode.products, none.unknown_mode.products], ['unconfigured', 0, null, 5, 2]);
  assert.equal(none.last_written_at, null, 'no current rows: not recorded, never a time');
  assert.equal(await getCatalog(envOf(mirror()), undefined, undefined, { sync: false }).then((c) => c.length), 0);
  const live: any = await readCatalogMirrorSummary(envOf(mirror(), 'sk_live_x'));
  assert.equal(live.last_written_at, '2026-11-02 10:00:00');
  assert.equal(live.sync_state, 'not_recorded');
  const test: any = await readCatalogMirrorSummary(envOf(mirror(), 'sk_test_x'));
  assert.equal(test.last_written_at, '2026-11-06 12:00:00');
});

test('an unreadable price list is counted for current rows only; other rows’ lists do not make the catalogue incomplete', async () => {
  // Mutation checked: unreadable counted before the mode check → complete turns false.
  const db = mirror();
  db.exec(`INSERT INTO stripe_products (id, name, prices_json, livemode) VALUES ('bad_other', 'Bad', 'nope', 0)`);
  const s: any = await readCatalogMirrorSummary(envOf(db, 'sk_live_x'));
  assert.deepEqual([s.complete, s.unreadable_price_rows], [true, 0]);
  db.exec(`INSERT INTO stripe_products (id, name, prices_json, livemode) VALUES ('bad_cur', 'Bad', 'nope', 1)`);
  const t: any = await readCatalogMirrorSummary(envOf(db, 'sk_live_x'));
  assert.deepEqual([t.complete, t.unreadable_price_rows, t.products.all], [false, 1, 3]);
});
