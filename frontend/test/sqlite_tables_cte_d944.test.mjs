import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { referencedTables } from '../../scripts/check-sqlite-tables.mjs';

test('D944: a valid chained CTE with an explicit column list references its physical store only',()=>{
  const sql=`WITH weeks (idx, starts_at) AS (VALUES (0,'2026-11-02')),
    normalized AS (SELECT idx FROM weeks),
    filtered AS (SELECT idx FROM normalized),
    page AS (SELECT * FROM filtered)
    SELECT p.idx FROM page p JOIN actual_store a ON a.id = p.idx`;
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE actual_store (id INTEGER); INSERT INTO actual_store VALUES (0)');
  assert.equal(db.prepare(sql).get().idx,0);
  assert.deepEqual(referencedTables(sql),['actual_store']);db.close();
});
test('D5318: a CTE with a [NOT] MATERIALIZED hint is an alias, not a table',()=>{
  // Mutation checked: the hint dropped from the guard's CTE pattern → `sf` and `once` are reported as tables.
  const sql=`WITH sf AS MATERIALIZED (SELECT id FROM actual_store), once AS NOT MATERIALIZED (SELECT id FROM sf)
    SELECT COUNT(*) AS n FROM sf UNION ALL SELECT id FROM once`;
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE actual_store (id INTEGER); INSERT INTO actual_store VALUES (0)');
  assert.equal(db.prepare(sql).all().length,2);
  assert.deepEqual(referencedTables(sql),['actual_store']);db.close();
});
test('D944: a missing physical table inside a CTE remains a reference and fails SQLite',()=>{
  const sql=`WITH normalized AS (SELECT * FROM missing_physical_store),
    filtered AS (SELECT * FROM normalized) SELECT * FROM filtered`;
  assert.deepEqual(referencedTables(sql),['missing_physical_store']);
  const db=new DatabaseSync(':memory:');assert.throws(()=>db.prepare(sql),/no such table/);db.close();
});

test('trigger UPDATE OF columns are excluded while body table references remain', () => {
  const sql = `CREATE TRIGGER withdrawal AFTER UPDATE OF consent_given, withdrawn_at ON consents
    BEGIN UPDATE missing_proof_store SET published_consent_id = NULL; END`;
  assert.deepEqual(referencedTables(sql), ['missing_proof_store']);
  assert.deepEqual(referencedTables('UPDATE of SET enabled = 1'), ['of']);
});

test('D5581: a WITH RECURSIVE CTE is an alias, not a table', () => {
  // Mutation checked: RECURSIVE dropped from the guard's CTE pattern → `reach` is reported as a table.
  const sql = `WITH RECURSIVE reach(id, depth) AS (
      SELECT id, 0 FROM actual_store UNION SELECT reach.id + 1, reach.depth + 1 FROM reach WHERE reach.depth < 2)
    SELECT id FROM reach`;
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE actual_store (id INTEGER); INSERT INTO actual_store VALUES (0)');
  assert.equal(db.prepare(sql).all().length, 3);
  assert.deepEqual(referencedTables(sql), ['actual_store']); db.close();
});
