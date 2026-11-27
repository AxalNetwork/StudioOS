/**
 * D4558 (#4558) — scripts/d1-backup-manifest.mjs: the manifest beside each D1
 * backup, and the checks the restore drill makes against it. Every case is a
 * made-up export; no row content may appear in a manifest or in the output.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/d1_backup_manifest_d4558.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  buildManifest, chunkTables, compareCounts, describe, manifestShapeOk, migrationOrder, verifyBackup,
} from '../../scripts/d1-backup-manifest.mjs';

const SCRIPT = resolve(process.cwd(), 'scripts/d1-backup-manifest.mjs');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const SECRET = 'SENTINEL-ROW-CONTENT';
const KEY = 'd1/studioos-db/backup-2026-11-06.sql';
const EXPORT = [
  'PRAGMA defer_foreign_keys=TRUE;',
  'CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, checksum TEXT, applied_at TEXT);',
  "INSERT INTO \"schema_migrations\" VALUES('002_user_settings.sql','c2','2026-01-02');",
  "INSERT INTO \"schema_migrations\" VALUES('202611011200_later.sql','c3','2026-11-01');",
  "INSERT INTO \"schema_migrations\" VALUES('001_progress_tables.sql','c1','2026-01-01');",
  'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);',
  `INSERT INTO "users" VALUES(1,'${SECRET}');`,
  "INSERT INTO \"users\" VALUES(2,'it''s; tricky');",
  'CREATE TABLE notes (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), parent_id INTEGER REFERENCES notes(id));',
  'INSERT INTO "notes" VALUES(1,1,NULL);',
  'CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB);',
  "INSERT INTO \"_cf_KV\" VALUES('x','y');",
].join('\n');

function files(sql = EXPORT) {
  const dir = mkdtempSync(join(tmpdir(), 'd4558-'));
  const sqlPath = join(dir, 'backup.sql');
  writeFileSync(sqlPath, sql);
  return { dir, sqlPath };
}
const NOW = new Date('2026-11-06T12:00:00Z');
const manifestOf = (sqlPath, over = {}) => buildManifest(sqlPath, { key: KEY, db: 'studioos-db', exportedAt: '2026-11-06T09:00:00Z', ...over });

test('describe: every table with its row count and parents, the ledger\'s last migration in applied order, no _cf_ table', () => {
  const d = describe(EXPORT);
  assert.deepEqual(d.tables.map((t) => [t.name, t.rows, t.references]), [
    ['notes', 1, ['users']], ['schema_migrations', 3, []], ['users', 2, []],
  ]);
  assert.deepEqual(d.migrations, { ledger: 'schema_migrations', count: 3, last: '202611011200_later.sql' });
  assert.ok(migrationOrder('799_x.sql', '202611011200_y.sql') < 0, 'a stamped migration sorts after every numbered one');
  assert.ok(migrationOrder('10_x.sql', '9_x.sql') > 0, 'numbers, not text');
});

test('build: hash, size, export time and bookmark; the manifest holds no row content', async () => {
  const { sqlPath } = files();
  const m = await manifestOf(sqlPath, { bookmark: '00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683' });
  assert.ok(manifestShapeOk(m));
  assert.equal(m.size_bytes, Buffer.byteLength(EXPORT));
  assert.match(m.sha256, /^[0-9a-f]{64}$/);
  assert.equal(m.time_travel_bookmark, '00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683');
  assert.ok(!JSON.stringify(m).includes(SECRET), 'a row value reached the manifest');
  assert.ok(!JSON.stringify(m).includes('tricky'));
});

test('verify: a matching backup passes; each way it can be wrong fails closed with its own reason', async () => {
  const { dir, sqlPath } = files();
  const m = await manifestOf(sqlPath, {});
  m.migrations.last = '001_progress_tables.sql'; // a migration this checkout has
  const opts = { key: KEY, migrationsDir: MIGRATIONS, now: NOW };
  assert.equal(await verifyBackup(sqlPath, m, opts), null);

  const tampered = join(dir, 'tampered.sql');
  writeFileSync(tampered, EXPORT.replace('(1,1,NULL)', '(1,2,NULL)'));
  assert.equal(await verifyBackup(tampered, m, opts), 'sha256_mismatch');
  const truncated = join(dir, 'truncated.sql');
  writeFileSync(truncated, EXPORT.slice(0, -40));
  assert.equal(await verifyBackup(truncated, m, opts), 'size_mismatch');
  assert.equal(await verifyBackup(sqlPath, m, { ...opts, key: 'd1/studioos-db/backup-2026-11-05.sql' }), 'key_mismatch');
  assert.equal(await verifyBackup(sqlPath, m, { ...opts, now: new Date('2026-11-07T22:00:01Z') }), 'stale', '37 h after the export');
  assert.equal(await verifyBackup(sqlPath, m, { ...opts, now: new Date('2026-11-07T22:00:01Z'), maxAgeHours: 48 }), null);
  assert.equal(await verifyBackup(sqlPath, { ...m, migrations: { ...m.migrations, last: '999_not_here.sql' } }, opts), 'migration_unknown');
  assert.equal(await verifyBackup(sqlPath, { ...m, migrations: { ...m.migrations, last: '../../etc/passwd' } }, opts), 'migration_unknown');
  for (const bad of [null, {}, { ...m, version: 2 }, { ...m, sha256: 'x' }, { ...m, exported_at: 'yesterday' }, { ...m, tables: [{ name: 'u' }] }]) {
    assert.equal(await verifyBackup(sqlPath, bad, opts), 'manifest_invalid', JSON.stringify(bad)?.slice(0, 60));
  }
});

test('compare: a table whose restored count differs, or that was not counted, is named; counts only', () => {
  const m = { tables: [{ name: 'users', rows: 2 }, { name: 'notes', rows: 1 }] };
  assert.deepEqual(compareCounts(m, [{ t: 'users', n: 2 }, { t: 'notes', n: 1 }]), []);
  assert.deepEqual(compareCounts(m, [{ t: 'users', n: 1 }, { t: 'notes', n: 1 }]), ['users']);
  assert.deepEqual(compareCounts(m, [{ t: 'users', n: 2 }]), ['notes']);
  assert.deepEqual(compareCounts(m, null), ['users', 'notes']);
});

test('chunk-tables: the tables one chunk writes', () => {
  assert.deepEqual(chunkTables(`PRAGMA defer_foreign_keys=TRUE;\nINSERT INTO "notes" VALUES(1,1,NULL);\nINSERT INTO users VALUES(3,'${SECRET}');`), ['notes', 'users']);
});

test('the command line: build then verify round-trips, a mismatch exits 1 with one reason, and nothing printed carries row content', async () => {
  const { dir, sqlPath } = files();
  const out = join(dir, 'manifest.json');
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  const b = run('build', sqlPath, out, '--key', KEY, '--db', 'studioos-db', '--exported-at', new Date().toISOString());
  assert.equal(b.status, 0, b.stderr);
  assert.match(b.stdout, /^manifest: \d+ bytes, sha256 [0-9a-f]{64}, 3 tables, 6 rows, last migration 202611011200_later\.sql$/m);
  const m = JSON.parse(readFileSync(out, 'utf8'));
  m.migrations.last = '002_user_settings.sql';
  writeFileSync(out, JSON.stringify(m));
  const ok = run('verify', sqlPath, out, '--key', KEY, '--migrations', MIGRATIONS);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  writeFileSync(sqlPath, EXPORT.replace('it', 'IT'));
  const bad = run('verify', sqlPath, out, '--key', KEY, '--migrations', MIGRATIONS);
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout.trim(), 'reason=sha256_mismatch');
  const counts = join(dir, 'counts.json');
  writeFileSync(counts, JSON.stringify([{ t: 'users', n: 2 }, { t: 'notes', n: 0 }, { t: 'schema_migrations', n: 3 }]));
  const cmp = run('compare', out, counts);
  assert.equal(cmp.status, 1);
  assert.equal(cmp.stdout.trim(), 'row counts differ in 1 of 3 tables: notes');
  const ct = run('chunk-tables', sqlPath, out);
  assert.match(ct.stdout, /^tables: notes, schema_migrations, users; their parents: users$/m);
  for (const r of [b, ok, bad, cmp, ct]) assert.ok(!(r.stdout + r.stderr).includes(SECRET));
});
