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
