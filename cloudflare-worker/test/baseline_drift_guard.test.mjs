/**
 * `scripts/check-baseline-drift.mjs` — the guard that keeps `schema_baseline.sql`
 * honest, kept honest itself.
 *
 * The guard runs in the deploy workflow, where a Cloudflare token exists and
 * this suite has none. So the half that talks to production cannot be exercised
 * here; the half that DECIDES can, and it is the half worth testing. A checker
 * whose comparison silently stops comparing prints ✓ over anything — which is
 * the exact failure `schema.sql` had for four months, and the reason the guard
 * exists at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  addColumnDdl,
  baselineObjects,
  buildFresh,
  columnsFromDdl,
  columnsOf,
  compareColumns,
  compareObjects,
  missingDdl,
  rowsFromWranglerJson,
} from '../../scripts/check-baseline-drift.mjs';

const set = (...names) => new Set(names);

test('the baseline is read by building it, so it reports what it really creates', () => {
  const objects = baselineObjects(`
    CREATE TABLE widgets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE);
    CREATE INDEX idx_widgets_name ON widgets(name);
    CREATE VIEW v_widgets AS SELECT id FROM widgets;
  `);
  assert.ok(objects.has('table:widgets'));
  assert.ok(objects.has('index:idx_widgets_name'));
  assert.ok(objects.has('view:v_widgets'));
});

test('post-cutoff migrations are applied on top, or the check goes stale at 220', () => {
  // THE INVARIANT IS baseline + post-cutoff migrations == production, not
  // baseline == production. Had it been the latter, the first migration anyone
  // shipped would have turned the step red until someone re-dumped by hand —
  // a chore nobody does twice, so the guard would be switched off and the drift
  // it exists to catch would come straight back.
  const withLater = baselineObjects(
    'CREATE TABLE widgets (id INTEGER PRIMARY KEY);',
    ['CREATE TABLE gadgets (id INTEGER PRIMARY KEY);',
     'CREATE INDEX idx_gadgets ON gadgets(id);'],
  );
  assert.deepEqual([...withLater].sort(),
    ['index:idx_gadgets', 'table:gadgets', 'table:widgets']);

  // And they apply in the order given, on top of the baseline — a migration
  // that ALTERs a baseline table has to see that table.
  const altering = baselineObjects(
    'CREATE TABLE t (id INTEGER PRIMARY KEY);',
    ['ALTER TABLE t ADD COLUMN added TEXT;', 'CREATE INDEX idx_t_added ON t(added);'],
  );
  assert.ok(altering.has('index:idx_t_added'),
    'a post-cutoff migration must build on the baseline, not beside it');
});

test('names the engine owns are excluded, or every comparison is noise', () => {
  // AUTOINCREMENT makes `sqlite_sequence`; UNIQUE makes an autoindex. Neither is
  // anybody's schema. `_cf_KV` is Cloudflare's — present on production, absent
  // from every dump because local workerd refuses to let a file create it — and
  // leaving it in would report drift on a byte-perfect baseline forever.
  const objects = baselineObjects(
    'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT UNIQUE);',
  );
  assert.deepEqual([...objects], ['table:t']);

  const withCf = compareObjects(set('table:t'), set('table:t', 'table:_cf_KV'));
  assert.equal(withCf.ok, true, '_cf_KV on the live side must not read as drift');
});

test('a difference is reported in both directions, because either one is drift', () => {
  // Missing = production has an object the repo's baseline would not build, so a
  // fresh database comes up short. Extra = the baseline carries something
  // production does not, which is how `schema.sql` came to promise five
  // cascades that never existed (DECISIONS D60).
  const missing = compareObjects(set('table:a'), set('table:a', 'table:b'));
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, ['table:b']);
  assert.deepEqual(missing.extra, []);

  const extra = compareObjects(set('table:a', 'table:ghost'), set('table:a'));
  assert.equal(extra.ok, false);
  assert.deepEqual(extra.extra, ['table:ghost']);
  assert.deepEqual(extra.missing, []);

  assert.equal(compareObjects(set('table:a'), set('table:a')).ok, true);
});

test('type is part of the identity, so a table and an index cannot cancel out', () => {
  // Comparing bare names would let a missing table be "made up for" by an index
  // that happens to share it — the same class of error as gating on a count.
  const r = compareObjects(set('index:x'), set('table:x'));
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['table:x']);
  assert.deepEqual(r.extra, ['index:x']);
});

test('wrangler output is parsed defensively, and an auth failure is not an empty schema', () => {
  // THE FAILURE THAT MUST NEVER LOOK LIKE SUCCESS: wrangler answering with an
  // error object. Read loosely, `results ?? []` would make "no token" mean "the
  // database has no objects", and the guard would then report the entire
  // baseline as drift — or, with the comparison the other way round, pass.
  assert.deepEqual(rowsFromWranglerJson('[{"results":[{"type":"table","name":"t"}]}]'),
    [{ type: 'table', name: 't' }]);
  assert.deepEqual(rowsFromWranglerJson('{"result":[{"results":[{"type":"table","name":"t"}]}]}'),
    [{ type: 'table', name: 't' }]);

  assert.throws(() => rowsFromWranglerJson('{"error":{"text":"needs CLOUDFLARE_API_TOKEN"}}'),
    /CLOUDFLARE_API_TOKEN/, 'an error object must throw, never yield zero rows');
  assert.throws(() => rowsFromWranglerJson('not json at all'), /did not return JSON/);
  assert.throws(() => rowsFromWranglerJson('{}'), /no result set/);
});

test('a red run prints the DDL of what production has and the repo lacks, so the fix can be pasted', () => {
  const rows = [
    { type: 'table', name: 'company_sources', sql: 'CREATE TABLE company_sources (id INTEGER PRIMARY KEY, url TEXT)' },
    { type: 'index', name: 'idx_x', sql: null },
    { type: 'table', name: 'declared', sql: 'CREATE TABLE declared (id INTEGER)' },
  ];
  assert.deepEqual(missingDdl(rows, ['table:company_sources', 'index:idx_x']), [
    'CREATE TABLE company_sources (id INTEGER PRIMARY KEY, url TEXT);',
    '-- index:idx_x: production returned no DDL for it',
  ]);
  // Only what is missing is printed, and type is part of the identity.
  assert.deepEqual(missingDdl(rows, ['index:company_sources']), ['-- index:company_sources: production returned no DDL for it']);
});

// ---------------------------------------------------------------------------
// Columns (D359). Comparing names alone let a column added by hand, or by a
// runtime ALTER, through every run: it changes no name.

/** Production's `sqlite_master` rows for a database built from `sql`. */
const rowsOf = (sql) => {
  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  return db.prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','index','trigger','view')").all();
};

test('columns are read with their declared types, including one a later ALTER added', () => {
  const cols = columnsOf(buildFresh(
    'CREATE TABLE Widgets (id INTEGER PRIMARY KEY AUTOINCREMENT, name text  not null);',
    ["ALTER TABLE Widgets ADD COLUMN note TEXT DEFAULT 'x';"],
  ));
  assert.deepEqual([...cols.keys()], ['widgets.id', 'widgets.name', 'widgets.note'],
    'keys are table.column in lower case, and engine-owned sqlite_sequence is not read');
  assert.equal(cols.get('widgets.name').type, 'TEXT', 'a type is compared upper case');
  assert.equal(cols.get('widgets.name').notnull, 1);
  assert.equal(cols.get('widgets.note').dflt, "'x'");
});

test('a column production has and the repo lacks is drift, though every name matches', () => {
  // The kind of drift #971 found as whole tables (four company_* tables made by
  // hand), one level down: a column added by hand to a declared table.
  const repo = 'CREATE TABLE company_sources (id INTEGER PRIMARY KEY, url TEXT);';
  const live = rowsOf(`${repo} ALTER TABLE company_sources ADD COLUMN fetched_at TEXT NOT NULL DEFAULT '';`);
  assert.equal(compareObjects(baselineObjects(repo), new Set(live.map((r) => `${r.type}:${r.name}`))).ok, true,
    'the names agree, which is why the old step passed');
  const { columns, unreadable } = columnsFromDdl(live);
  assert.deepEqual(unreadable, []);
  const r = compareColumns(columnsOf(buildFresh(repo)), columns);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.map((c) => c.key), ['company_sources.fetched_at']);
  assert.deepEqual(r.extra, []);
  assert.deepEqual(r.retyped, []);
  // And the red run prints the statement that declares it, which runs.
  const ddl = addColumnDdl(r.missing[0]);
  assert.equal(ddl, "ALTER TABLE company_sources ADD COLUMN fetched_at TEXT NOT NULL DEFAULT '';");
  const fixed = buildFresh(repo, [ddl]);
  assert.equal(compareColumns(columnsOf(fixed), columns).ok, true, 'pasting the printed statement closes the drift');
});

test('columns are compared in both directions, and a changed type is drift', () => {
  const cols = (sql) => columnsOf(buildFresh(sql));
  const extra = compareColumns(cols('CREATE TABLE t (id INTEGER, ghost TEXT);'), cols('CREATE TABLE t (id INTEGER);'));
  assert.deepEqual(extra.extra.map((c) => c.key), ['t.ghost']);
  assert.deepEqual(extra.missing, []);
  assert.equal(extra.ok, false);

  const retyped = compareColumns(cols('CREATE TABLE t (id INTEGER, amount INTEGER);'), cols('CREATE TABLE t (id INTEGER, amount REAL);'));
  assert.deepEqual(retyped.retyped, [{ key: 't.amount', baseline: 'INTEGER', live: 'REAL' }]);
  assert.equal(retyped.ok, false);

  // Case and spacing in a name or a type are not drift: SQLite ignores both.
  assert.equal(compareColumns(cols('CREATE TABLE T (Id integer,  N  varchar(10));'),
    cols('CREATE TABLE t (id INTEGER, n VARCHAR(10));')).ok, true);
});

test('a table only one side has is a name difference, not a list of its columns', () => {
  const r = compareColumns(columnsOf(buildFresh('CREATE TABLE a (id INTEGER);')),
    columnsOf(buildFresh('CREATE TABLE a (id INTEGER); CREATE TABLE b (id INTEGER, x TEXT);')));
  assert.equal(r.ok, true, 'table:b is already reported by compareObjects');
});

test("production's columns come from its own DDL; a table that cannot be read is reported, never skipped", () => {
  const rows = [
    ...rowsOf('CREATE TABLE t (id INTEGER PRIMARY KEY, n TEXT); CREATE INDEX idx_t ON t(n);'),
    { type: 'table', name: '_cf_KV', sql: 'CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB)' },
    { type: 'table', name: 'no_ddl', sql: null },
    { type: 'table', name: 'broken', sql: 'CREATE TABLE broken (' },
  ];
  const { columns, unreadable } = columnsFromDdl(rows);
  assert.deepEqual([...columns.keys()], ['t.id', 't.n'], 'the index is not a table and _cf_KV is engine-owned');
  assert.equal(unreadable.length, 2);
  assert.match(unreadable[0], /^table:no_ddl — no DDL/);
  assert.match(unreadable[1], /^table:broken — /);
});

test('the step itself compares columns, and an unreadable table fails it', () => {
  // The decision half is tested above; this pins that the deploy step calls it.
  const src = readFileSync(new URL('../../scripts/check-baseline-drift.mjs', import.meta.url), 'utf8');
  const main = src.slice(src.indexOf('if (import.meta.url ==='));
  assert.match(main, /columnsFromDdl\(liveRows\)/);
  assert.match(main, /compareColumns\(baseCols, liveCols\)/);
  assert.match(main, /if \(!ok \|\| !cols\.ok \|\| unreadable\.length\)/);
});
