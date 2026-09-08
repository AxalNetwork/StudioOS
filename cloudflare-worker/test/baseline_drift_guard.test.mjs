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
import {
  baselineObjects,
  compareObjects,
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
