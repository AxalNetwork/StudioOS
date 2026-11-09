/**
 * #4591 — the schema rehearsal's rules, each a way a hosted rehearsal could
 * pass while proving nothing, or touch a database it must not.
 *
 *   node --test scripts/lib/schemaRehearsal.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  rehearsalNames, createdDatabaseId, rehearsalConfig, schemaMap, rowCountQueries, countMap, compareRestore, FIXTURE_TABLES,
} from './schemaRehearsal.mjs';
import { resolveTarget } from './migrationTargets.mjs';
import { seedStatements, toSqlFile } from './agentSyntheticFixtures.mjs';
import { buildFresh, postCutoffMigrations } from '../check-baseline-drift.mjs';

const UUID = '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';

test('a run names two throwaway databases, both rehearsal targets, neither production nor a branch', () => {
  const n = rehearsalNames('run0001');
  assert.equal(n.src.dbName, 'studioos-rehearsal-run0001-src');
  assert.equal(n.dst.dbName, 'studioos-rehearsal-run0001-dst');
  for (const side of [n.src, n.dst]) {
    const t = resolveTarget(['--rehearsal', side.id]);
    assert.equal(t.kind, 'rehearsal');
    assert.equal(t.dbName, side.dbName, 'the runner and the script must name the same database');
  }
  for (const bad of [undefined, '', 'short', 'UPPER0', 'has-dash', 'x'.repeat(21), 'db; drop']) {
    assert.throws(() => rehearsalNames(bad), /run id/, JSON.stringify(bad));
  }
});

test('the generated config declares one rehearsal database and nothing that could reach production', () => {
  const cfg = rehearsalConfig({ dbName: 'studioos-rehearsal-run0001-src', databaseId: UUID });
  assert.match(cfg, /database_name = "studioos-rehearsal-run0001-src"/);
  assert.match(cfg, new RegExp(`database_id = "${UUID}"`));
  assert.equal((cfg.match(/\[\[/g) || []).length, 1, 'exactly one binding table');
  for (const never of ['studioos-db"', 'routes', 'custom_domain', 'axal.vc', '[env.', 'kv_namespaces', 'r2_buckets', 'queues']) {
    assert.ok(!cfg.includes(never), `the rehearsal config must not carry ${never}`);
  }
  assert.throws(() => rehearsalConfig({ dbName: 'studioos-db', databaseId: UUID }), /not a rehearsal database/);
  assert.throws(() => rehearsalConfig({ dbName: 'studioos-fr', databaseId: UUID }), /not a rehearsal database/);
  assert.throws(() => rehearsalConfig({ dbName: 'studioos-rehearsal-run0001-src', databaseId: '' }), /database id/);
});

test('the created database id is read from either form wrangler prints, and its absence is an error', () => {
  assert.equal(createdDatabaseId(`[[d1_databases]]\nbinding = "DB"\ndatabase_name = "x"\ndatabase_id = "${UUID}"`), UUID);
  assert.equal(createdDatabaseId(`{ "d1_databases": [{ "binding": "DB", "database_id": "${UUID}" }] }`), UUID);
  assert.throws(() => createdDatabaseId('Successfully created DB'), /no database_id/);
});

test('objects D1 or SQLite make on their own are never compared', () => {
  // D1 adds _cf_KV and SQLite adds sqlite_sequence/sqlite_autoindex_* on its own;
  // either side having them must not read as a schema difference.
  const m = schemaMap([
    { type: 'table', name: 'users', sql: 'CREATE TABLE users (id)' },
    { type: 'table', name: '_cf_KV', sql: 'CREATE TABLE _cf_KV (k)' },
    { type: 'table', name: 'sqlite_sequence', sql: 'CREATE TABLE sqlite_sequence(name,seq)' },
    { type: 'index', name: 'sqlite_autoindex_users_1', sql: null },
  ]);
  assert.deepEqual([...m.keys()], ['table:users']);
});

test('counting refuses a table name it would have to quote its way around', () => {
  const [q, ...more] = rowCountQueries(['users', 'projects', '_cf_KV', 'sqlite_sequence']);
  assert.equal(more.length, 0);
  assert.match(q, /FROM "projects"/);
  assert.ok(!q.includes('_cf_KV') && !q.includes('sqlite_sequence'), 'engine-owned tables are never counted');
  assert.throws(() => rowCountQueries(['users"; DROP TABLE users; --']), /plain identifier/);
  assert.throws(() => rowCountQueries([]), /no tables/);
  // Batched below SQLite's compound-SELECT limit, which one query over every table exceeds.
  const many = Array.from({ length: 450 }, (_, i) => `t${i}`);
  const qs = rowCountQueries(many);
  assert.equal(qs.length, 5);
  for (const x of qs) assert.ok(x.split(' UNION ALL ').length <= 100);
});

/** A database built from the committed files in node:sqlite: the shape the hosted run compares. */
function committed() {
  const db = buildFresh(readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8'), postCutoffMigrations(process.cwd()).map((m) => m.sql));
  return db;
}
const snap = (db) => {
  const rows = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','index','view','trigger')").all();
  const tables = rows.filter((r) => r.type === 'table' && !/^(_cf_|sqlite_)/.test(r.name)).map((r) => r.name);
  return { schema: schemaMap(rows), counts: countMap(rowCountQueries(tables).flatMap((q) => db.prepare(q).all())) };
};

test('the synthetic seed applies to the committed schema, fills every fixture table and breaks no foreign key', () => {
  const db = committed();
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(toSqlFile(seedStatements({ run: 'run0001', tenants: 2, agentsPerTenant: 2, tasksPerAgent: 2 })));
  const counts = countMap(rowCountQueries(FIXTURE_TABLES).flatMap((q) => db.prepare(q).all()));
  for (const t of FIXTURE_TABLES) assert.ok(counts.get(t) > 0, `the seed wrote no ${t}`);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const text = toSqlFile(seedStatements({ run: 'run0001', tenants: 2, agentsPerTenant: 2, tasksPerAgent: 2 }));
  const emails = [...text.matchAll(/'([^'@\s/]+@[^'@\s]+\.[a-z]+)'/g)].map((m) => m[1]);
  assert.ok(emails.length > 0, 'the seed writes addresses');
  for (const e of emails) assert.match(e, /@synthetic\.invalid$/, `every address is synthetic: ${e}`);
});

test('a restore that lost a row, an object or a column is reported, and a faithful one passes', () => {
  const src = committed();
  src.exec(toSqlFile(seedStatements({ run: 'run0001', tenants: 1 })));
  const a = snap(src);
  assert.equal(compareRestore(a, snap(src)).ok, true, 'the same database compares equal to itself');

  const lostRow = snap(src); lostRow.counts.set('users', a.counts.get('users') - 1);
  assert.deepEqual(compareRestore(a, lostRow).countDiffers.map((d) => d.table), ['users']);

  const lostObject = snap(src); const k = [...lostObject.schema.keys()].find((x) => x.startsWith('index:'));
  lostObject.schema.delete(k);
  assert.deepEqual(compareRestore(a, lostObject).missing, [k]);

  const changed = snap(src); changed.schema.set('table:users', `${changed.schema.get('table:users')} -- changed`);
  assert.deepEqual(compareRestore(a, changed).sqlDiffers, ['table:users']);

  const extra = snap(src); extra.schema.set('table:surprise', 'CREATE TABLE surprise (x)');
  assert.deepEqual(compareRestore(a, extra).extra, ['table:surprise']);
});
