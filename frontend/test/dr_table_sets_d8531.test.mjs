/**
 * D8531 (#8531) — the restore's three table sets, compared before any count.
 *
 * No monthly drill had passed. Run 7 (2026-11-20) imported every chunk, then
 * stopped on a row-count query with "a table in the manifest is missing from
 * the restore", a guess the code made without looking. Rebuilt offline (a
 * fresh schema from the migrations in wrangler's local D1, `wrangler d1
 * export`, the manifest, the split, the import, the compare), run 7's code
 * failed the same way on a restore whose table sets agree: it counted with a
 * 40-term UNION ALL, and D1 refuses a compound SELECT of more than five terms.
 * The same rebuild found the kinds the manifest lists as tables though the
 * export never creates them: sqlite_sequence, and the statistics
 * (sqlite_stat1) once the source has run ANALYZE, whose rows the old split
 * replayed before their table existed.
 *
 * These tests run scripts/restore-d1.sh (the drill's own restore path,
 * scripts/dr-restore-lib.sh) with a fake `wrangler` whose target is REAL
 * SQLite and which refuses compound SELECTs of more than five terms, as D1
 * does, and test compareTableSets on its own for each kind.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/dr_table_sets_d8531.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, chmodSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  describe, compareTableSets, createdTables, countedTables, compareCounts, RESTORED_TABLES_SQL,
} from '../../scripts/d1-backup-manifest.mjs';
import { planRestore, chunkText } from '../../scripts/dr-drill-split.mjs';

const RESTORE = resolve(process.cwd(), 'scripts/restore-d1.sh');
const KEY = 'd1/studioos-db/backup-2026-11-25.sql';
const TARGET = 'studioos-db-restore';
const SENTINEL = 'SENTINEL-D8531-CONTENT';
const sha = (b) => createHash('sha256').update(b).digest('hex');

/**
 * An export in `wrangler d1 export`'s shape (miniflare's dumpSql, as wrangler
 * 4.162 wrote it locally): an AUTOINCREMENT table and its sqlite_sequence
 * rows, a view, and the statistics ANALYZE left, written as
 * `ANALYZE sqlite_schema;` and then sqlite_stat1's rows.
 */
const EXPORT = [
  'PRAGMA defer_foreign_keys=TRUE;',
  'CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT);',
  `INSERT INTO "users" ("id","email") VALUES(1,'${SENTINEL}');`,
  `INSERT INTO "users" ("id","email") VALUES(2,'b@example.test');`,
  'CREATE TABLE projects (id INTEGER PRIMARY KEY, owner_id INTEGER REFERENCES users(id), name TEXT);',
  `INSERT INTO "projects" ("id","owner_id","name") VALUES(1,2,'p');`,
  'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);',
  'ANALYZE sqlite_schema;',
  `INSERT INTO "sqlite_stat1" ("tbl","idx","stat") VALUES('projects','idx_projects_owner','1 1');`,
  `INSERT INTO "sqlite_stat1" ("tbl","idx","stat") VALUES('users',NULL,'2');`,
  'DELETE FROM sqlite_sequence;',
  `INSERT INTO "sqlite_sequence" ("name","seq") VALUES('users',2);`,
  'CREATE INDEX idx_projects_owner ON projects(owner_id);',
  'CREATE VIEW owners AS SELECT u.id FROM users u JOIN projects p ON p.owner_id = u.id;',
].join('\n') + '\n';

function manifestOf(sql, tables = null) {
  const d = describe(sql);
  return {
    version: 1, key: KEY, database: 'studioos-db',
    exported_at: '2026-11-25T00:00:00Z', time_travel_bookmark: null,
    size_bytes: Buffer.byteLength(sql), sha256: sha(sql), statements: d.statements,
    tables: tables ?? d.tables, migrations: d.migrations,
  };
}

/**
 * A fake wrangler whose target is a real SQLite file. Like D1, it refuses a
 * compound SELECT of more than five terms (wrangler 4.162's local D1: five
 * pass, six answer "too many terms in compound SELECT"). STRAY_TABLE creates
 * a table in the target just before its table list is read; UNREADABLE_TABLE
 * refuses any count of that table.
 */
function fakeWrangler(dir) {
  const src = `#!/usr/bin/env node
process.removeAllListeners('warning');
const fs = require('fs'); const { DatabaseSync } = require('node:sqlite');
const a = process.argv.slice(2); const e = process.env;
fs.appendFileSync(${JSON.stringify(join(dir, 'wcalls.log'))}, JSON.stringify(a) + '\\n');
const fileArg = () => a[a.indexOf('--file') + 1];
const dbPath = ${JSON.stringify(join(dir, 'target.db'))};
if (a[0] === 'r2' && a[2] === 'get' && a[3].endsWith('.manifest.json')) { fs.writeFileSync(fileArg(), e.MANIFEST_JSON); process.exit(0); }
if (a[0] === 'r2' && a[2] === 'get') { fs.writeFileSync(fileArg(), e.BACKUP_SQL); process.exit(0); }
if (a[0] === 'd1' && a[1] === 'info') { console.log(JSON.stringify({ uuid: '0b7c1e8a-0000-4000-8000-000000008531', name: a[2], jurisdiction: 'eu' })); process.exit(0); }
if (a[0] === 'd1' && a[1] === 'execute' && a.includes('--file')) {
  const db = new DatabaseSync(dbPath); db.exec('PRAGMA foreign_keys = ON;');
  db.exec('BEGIN');
  try { db.exec(fs.readFileSync(fileArg(), 'utf8')); db.exec('COMMIT'); } catch (err) { db.exec('ROLLBACK'); console.error('✘ [ERROR] ' + err.message + ': SQLITE_ERROR'); process.exit(1); }
  console.log('🚣 Executed 3 queries in 1.00ms (0 rows read, 3 rows written)'); process.exit(0);
}
if (a[0] === 'd1' && a[1] === 'execute' && a.includes('--command')) {
  const sql = a[a.indexOf('--command') + 1];
  if ((sql.match(/\\b(?:UNION|INTERSECT|EXCEPT)\\b/gi) || []).length >= 5) { console.error('✘ [ERROR] too many terms in compound SELECT: SQLITE_ERROR'); process.exit(1); }
  if (e.UNREADABLE_TABLE && sql.includes('FROM "' + e.UNREADABLE_TABLE + '"')) { console.error('✘ [ERROR] not authorized: SQLITE_AUTH'); process.exit(1); }
  try {
    const db = new DatabaseSync(dbPath);
    if (e.STRAY_TABLE && sql.startsWith('SELECT type, name')) db.exec('CREATE TABLE ' + e.STRAY_TABLE + ' (id INTEGER)');
    console.log(JSON.stringify([{ results: db.prepare(sql).all() }])); process.exit(0);
  } catch (err) { console.error('✘ [ERROR] ' + err.message + ': SQLITE_ERROR'); process.exit(1); }
}
console.error('fake wrangler: unexpected ' + a.join(' ')); process.exit(64);
`;
  writeFileSync(join(dir, 'wrangler'), src);
  chmodSync(join(dir, 'wrangler'), 0o755);
}

function restore(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'd8531-'));
  fakeWrangler(dir);
  writeFileSync(join(dir, 'wcalls.log'), '');
  mkdirSync(join(dir, 'tmp'));
  const sql = env.BACKUP_SQL ?? EXPORT;
  const r = spawnSync('bash', [RESTORE, `r2://studioos-backups/${KEY}`, TARGET], {
    env: {
      PATH: `${dir}:${process.env.PATH}`, HOME: dir, TMPDIR: join(dir, 'tmp'), BACKUP_BUCKET: 'studioos-backups',
      DR_DRILL_CHUNK_BYTES: '1024', DR_MAX_BACKUP_AGE_HOURS: '1000000',
      BACKUP_SQL: sql, MANIFEST_JSON: JSON.stringify(manifestOf(sql)), ...env,
    },
    input: `${TARGET}\n`, encoding: 'utf8',
  });
  const wcalls = readFileSync(join(dir, 'wcalls.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const out = r.stdout + r.stderr;
  const commands = wcalls.filter((c) => c.includes('--command')).map((c) => c[c.indexOf('--command') + 1]);
  return {
    dir, status: r.status, out, reason: (/reason=(\S+)/.exec(out) || [])[1] ?? null,
    counts: commands.filter((q) => /COUNT\(\*\)/.test(q)),
  };
}

// ── The kinds behind run 7, end to end ─────────────────────────────────────

test('run 7: the statistics and sqlite_sequence the manifest lists as tables restore cleanly, and the counts never use a compound SELECT', () => {
  const r = restore();
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /engine-owned: sqlite_sequence \(counted\)/);
  assert.match(r.out, /engine-owned: sqlite_stat1 \(not restored \(statistics\)\)/);
  assert.match(r.out, /table sets agree/);
  assert.match(r.out, /row counts match in all 4 tables/);
  // sqlite_stat1 is never counted; sqlite_sequence is, and agrees.
  assert.ok(!r.counts.some((q) => q.includes('"sqlite_stat1"')), 'the statistics were counted');
  assert.ok(r.counts.some((q) => q.includes('"sqlite_sequence"')), 'sqlite_sequence was not counted');
  // D1 refuses more than five compound terms; run 7's 40-term UNION ALL failed on that alone.
  for (const q of r.counts) assert.doesNotMatch(q, /\bUNION\b/i);
  const db = new DatabaseSync(join(r.dir, 'target.db'));
  assert.deepEqual(db.prepare('SELECT name, seq FROM sqlite_sequence').all().map((x) => ({ ...x })), [{ name: 'users', seq: 2 }]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='view' AND name='owners'").get().n, 1);
  assert.ok(!r.out.includes(SENTINEL), 'a row was printed');
});

test('run 7: the old count shape (40 COUNT(*) terms joined by UNION ALL) is what this D1 refuses, whatever the schema', () => {
  // The query run 7 sent, for these four tables: refused before any table is read.
  const dir = mkdtempSync(join(tmpdir(), 'd8531-q-'));
  fakeWrangler(dir);
  writeFileSync(join(dir, 'wcalls.log'), '');
  new DatabaseSync(join(dir, 'target.db')).exec('CREATE TABLE t (id INTEGER);');
  const terms = Array.from({ length: 40 }, () => `SELECT 't' AS t, COUNT(*) AS n FROM "t"`).join(' UNION ALL ');
  const ask = (sql) => spawnSync(join(dir, 'wrangler'), ['d1', 'execute', TARGET, '--remote', '--command', sql, '--json'], { encoding: 'utf8' });
  assert.match(ask(`${terms};`).stderr, /too many terms in compound SELECT/);
  assert.equal(ask(`SELECT 't' AS t, COUNT(*) AS n FROM "t" UNION ALL SELECT 't', COUNT(*) FROM "t";`).status, 0, 'a short compound is fine');
});

test('the split drops the statistics: ANALYZE and the sqlite_stat rows never reach the import', () => {
  const plan = planRestore(EXPORT, { chunkBytes: 1_000_000 });
  const texts = plan.chunks.map(chunkText);
  assert.ok(!texts.some((t) => /sqlite_stat1|^ANALYZE/m.test(t)), 'statistics were replayed');
  assert.equal(plan.counts.dropped_internal, 3, 'ANALYZE and two sqlite_stat1 rows');
  // Replayed in order, one transaction a chunk, the import goes through.
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const t of texts) { db.exec('BEGIN'); db.exec(t); db.exec('COMMIT'); }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
});

// ── The four outcomes ──────────────────────────────────────────────────────

test('missing: a table the manifest lists and the restore lacks fails table_set_differs with its kind, before any count', () => {
  const m = manifestOf(EXPORT);
  const r = restore({ MANIFEST_JSON: JSON.stringify({ ...m, tables: [...m.tables, { name: 'ghost', rows: 1, references: [] }] }) });
  assert.deepEqual([r.status, r.reason], [3, 'table_set_differs'], r.out);
  assert.match(r.out, /missing: ghost \(kind: rows only\)/);
  assert.match(r.out, /manifest tables the export never creates: ghost/);
  assert.deepEqual(r.counts, [], 'a row was counted before the table sets were compared');
});

test('extra: a table the restore holds that the manifest does not list fails table_set_differs, before any count', () => {
  const r = restore({ STRAY_TABLE: 'stray' });
  assert.deepEqual([r.status, r.reason], [3, 'table_set_differs'], r.out);
  assert.match(r.out, /extra: stray \(kind: in neither the manifest nor the export\)/);
  assert.deepEqual(r.counts, []);
});

test('unreadable: a table that is there but cannot be counted is named with wrangler\'s error code', () => {
  const r = restore({ UNREADABLE_TABLE: 'projects' });
  assert.deepEqual([r.status, r.reason], [3, 'row_counts_unreadable'], r.out);
  assert.match(r.out, /row count unreadable: projects \(wrangler's error codes: SQLITE_AUTH not authorized\)/);
  assert.match(r.out, /table sets agree/, 'the table sets were compared first, and agreed');
});

test('mismatched: a counted table with a different number is named, and nothing else', () => {
  const m = manifestOf(EXPORT);
  const r = restore({ MANIFEST_JSON: JSON.stringify({ ...m, tables: m.tables.map((t) => (t.name === 'projects' ? { ...t, rows: 5 } : t)) }) });
  assert.deepEqual([r.status, r.reason], [3, 'row_counts_differ'], r.out);
  assert.match(r.out, /row counts differ in 1 of 4 tables: projects/);
});

// ── compareTableSets, kind by kind ─────────────────────────────────────────

const T = (name, type = 'table', virtual = 0) => ({ type, name, virtual });

test('engine-owned tables are never missing or extra: sqlite_sequence with or without rows, statistics, D1\'s _cf_KV', () => {
  // The manifest lists sqlite_sequence and sqlite_stat1 (rows only); the restore holds sqlite_sequence and _cf_KV.
  const listed = { tables: [{ name: 'users', rows: 2 }, { name: 'sqlite_sequence', rows: 1 }, { name: 'sqlite_stat1', rows: 2 }] };
  const r = compareTableSets(listed, { tables: ['users'], virtual: [] }, [T('users'), T('sqlite_sequence'), T('_cf_KV')]);
  assert.deepEqual([r.missing, r.extra, r.differs], [[], [], false]);
  assert.deepEqual(r.engine, [{ name: 'sqlite_sequence', handled: 'counted' }, { name: 'sqlite_stat1', handled: 'not restored (statistics)' }]);
  // An AUTOINCREMENT table with no rows: the export writes no sqlite_sequence row, the restore still has the table.
  const empty = compareTableSets({ tables: [{ name: 'users', rows: 0 }] }, { tables: ['users'], virtual: [] }, [T('users'), T('sqlite_sequence')]);
  assert.deepEqual([empty.missing, empty.extra], [[], []]);
  assert.deepEqual(countedTables(listed).map((t) => t.name), ['users', 'sqlite_sequence']);
  assert.deepEqual(compareCounts(listed, [{ t: 'users', n: 2 }, { t: 'sqlite_sequence', n: 1 }]), [], 'the statistics are not a count to compare');
});

test('a view where the manifest expects a table is missing, with kind "restored as a view"; a view is never extra', () => {
  const r = compareTableSets({ tables: [{ name: 'users', rows: 1 }, { name: 'notifications', rows: 3 }] }, { tables: ['users'], virtual: [] },
    [T('users'), T('notifications', 'view'), T('owners', 'view')]);
  assert.deepEqual(r.missing, [{ name: 'notifications', kind: 'restored as a view' }]);
  assert.deepEqual(r.extra, []);
});

test('a virtual table and its shadow tables: the shadows are never extra, a missing virtual table says so', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY); CREATE VIRTUAL TABLE docs_fts USING fts5(body);');
  const restored = db.prepare(RESTORED_TABLES_SQL).all().map((x) => ({ ...x }));
  assert.ok(restored.some((x) => x.name === 'docs_fts_data'), 'SQLite made no shadow tables');
  const created = createdTables('CREATE TABLE users (id INTEGER PRIMARY KEY);\nCREATE VIRTUAL TABLE docs_fts USING fts5(body);\n');
  assert.deepEqual(created, { tables: ['users'], virtual: ['docs_fts'] });
  const ok = compareTableSets({ tables: [{ name: 'users', rows: 0 }, { name: 'docs_fts', rows: 0 }] }, created, restored);
  assert.deepEqual([ok.missing, ok.extra], [[], []]);
  const gone = compareTableSets({ tables: [{ name: 'users', rows: 0 }, { name: 'docs_fts', rows: 0 }] }, created, restored.filter((x) => x.name === 'users'));
  assert.deepEqual(gone.missing, [{ name: 'docs_fts', kind: 'virtual table' }]);
  // A table named like a shadow, with no virtual table behind it, is extra.
  const stray = compareTableSets({ tables: [{ name: 'users', rows: 0 }] }, { tables: ['users'], virtual: [] }, [T('users'), T('notes_data')]);
  assert.deepEqual(stray.extra, [{ name: 'notes_data', kind: 'in neither the manifest nor the export' }]);
});

test('names compare without case, as SQLite does, and a table the export creates but the manifest omits is extra', () => {
  const r = compareTableSets({ tables: [{ name: 'Users', rows: 1 }] }, { tables: ['Users', 'late'], virtual: [] }, [T('users'), T('late')]);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.extra, [{ name: 'late', kind: 'created by the export, not in the manifest' }]);
  assert.equal(r.differs, true);
});
