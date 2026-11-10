/**
 * #4603 part 3 (D4603) — D1's rows READ for the Build reads, on a local D1.
 *
 * `_build_rows_read.ts` copies the Build read harness's seeded venture into a
 * local D1 (Miniflare, workerd's SQLite), which reports `meta.rows_read` per
 * statement. This checks the copy and the counting, and records what part 2b
 * left in rows read:
 *   1. the copy drops foreign keys and nothing else;
 *   2. on the local D1 the Build overview and every module page answer exactly
 *      what they answer on node:sqlite, with the same statements and rows
 *      returned, and every statement reports the rows it read;
 *   3. recorded, not endorsed: a module page paged in SQL returns a page but
 *      still scans the venture's rows several times (aggregates, the sorted
 *      page, its count), so it reads more D1 rows than the old full read.
 *
 * Local engine numbers, not production D1's. Every row is synthetic.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/build_rows_read_4603.test.ts
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildReads, seedHolders, seedFilings, seedTools, PROJECT, MODULE_SLUGS } from './_build_reads.ts';
import { toLocalD1, countingLocalD1, withoutForeignKeys } from './_build_rows_read.ts';

let h: Awaited<ReturnType<typeof buildReads>>;
let local: Awaited<ReturnType<typeof toLocalD1>>;
const PATHS = [`/api/cycles/build/overview?project=${PROJECT}`, ...MODULE_SLUGS.map((s) => `/api/cycles/build/modules/${s}?project=${PROJECT}`),
  `/api/cycles/build/modules/product-roadmap?project=${PROJECT}&filter=column%3Anow&page=2`, `/api/cycles/build/modules/prototype-mvp?project=${PROJECT}&q=feature%201`];
const onSqlite: Record<string, Awaited<ReturnType<typeof h.get>>> = {};

before(async () => {
  h = await buildReads(100); seedHolders(h.db, 100); seedFilings(h.db); seedTools(h.db, 100);
  for (const p of PATHS) onSqlite[p] = await h.get(p);
  local = await toLocalD1(h.db);
  h.useD1((log) => countingLocalD1(local.d1, log));
}, { timeout: 300000 });
after(async () => { await local?.dispose(); h?.close(); });

test('1. the copy drops foreign keys and nothing else', () => {
  // Mutation checked: the table-level FOREIGN KEY left in → the second case keeps it; the column CHECK dropped → the first loses it.
  assert.equal(withoutForeignKeys('CREATE TABLE a (id INTEGER PRIMARY KEY, b INTEGER NOT NULL REFERENCES b(id) ON DELETE CASCADE, c TEXT CHECK (c IN (\'x\')))'),
    'CREATE TABLE a (id INTEGER PRIMARY KEY, b INTEGER NOT NULL, c TEXT CHECK (c IN (\'x\')))');
  assert.equal(withoutForeignKeys('CREATE TABLE a (id INTEGER, b INTEGER, UNIQUE (b), FOREIGN KEY (b) REFERENCES "b" (id) ON UPDATE SET NULL DEFERRABLE INITIALLY DEFERRED)'),
    'CREATE TABLE a (id INTEGER, b INTEGER, UNIQUE (b))');
});

test('2. on the local D1 every Build read answers exactly as on node:sqlite, and reports the rows it read', async () => {
  // Mutation checked: first() not logging rows read → a statement has none; the copy skipping a table's rows → a body differs.
  for (const p of PATHS) {
    const r = await h.get(p);
    assert.equal(r.status, 200, p);
    assert.deepEqual(r.body, onSqlite[p].body, p);
    assert.equal(r.statements, onSqlite[p].statements, p);
    assert.equal(r.rows, onSqlite[p].rows, p);
    assert.ok(r.log.every((s) => typeof s.rowsRead === 'number' && s.rowsRead >= 0), `${p}: every statement reports rows read`);
    assert.ok(r.rowsRead! >= r.rows - r.log.filter((s) => s.rowsRead === 0).length, `${p}: ${r.rowsRead} rows read for ${r.rows} returned`);
  }
}, { timeout: 300000 });

test('3. recorded, not endorsed: a page paged in SQL reads more D1 rows than it returns', async () => {
  // At 100 records the Prototype page returns 30 rows and scans the 100 features several times (D4603 part 3).
  const r = await h.get(`/api/cycles/build/modules/prototype-mvp?project=${PROJECT}`);
  assert.ok(r.rows <= 35, `${r.rows} rows returned`);
  assert.ok(r.rowsRead! > 4 * 100, `${r.rowsRead} rows read: the aggregates, the sorted page and its options each scan the venture's features`);
}, { timeout: 300000 });
