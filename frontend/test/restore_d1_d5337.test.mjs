/**
 * D5337 (#5337) — scripts/restore-d1.sh, the operator's restore, run.
 *
 * Until D5337 the operator's script imported the whole export with one
 * `wrangler d1 execute --file`, which fails on D1's side at production's size
 * (#1007), checked nothing against the manifest, and could not read the
 * independent copy. A green drill said nothing about it. It now runs the
 * drill's own code (scripts/dr-restore-lib.sh), and these tests run it with a
 * fake `wrangler` first on PATH whose target database is REAL SQLite: every
 * chunk is executed with foreign keys on, one transaction per file the way D1
 * imports one, and the row counts the script compares are read back from it.
 * The independent copy is written by the real dr-second-copy.sh into the fake
 * store (`_dr_fakes.mjs`) and decrypted with the real `age`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/restore_d1_d5337.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, chmodSync, existsSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe } from '../../scripts/d1-backup-manifest.mjs';
import { keypair, fakeAws } from './_dr_fakes.mjs';

const RESTORE = resolve(process.cwd(), 'scripts/restore-d1.sh');
const DRILL = resolve(process.cwd(), 'scripts/dr-drill.sh');
const LIB = resolve(process.cwd(), 'scripts/dr-restore-lib.sh');
const COPY = resolve(process.cwd(), 'scripts/dr-second-copy.sh');
const KEY = 'd1/studioos-db/backup-2026-11-09.sql';
const TARGET = 'studioos-db-restore';
const SENTINEL = 'SENTINEL-RESTORE-CONTENT';
const PROD_ID = /database_name = "studioos-db"\ndatabase_id\s*=\s*"([0-9a-f-]+)"/.exec(readFileSync(resolve(process.cwd(), 'wrangler.toml'), 'utf8'))[1];
const sha = (b) => createHash('sha256').update(b).digest('hex');
const code = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

/**
 * Production's shape where it bit: a foreign-key cycle (legal_documents ⇄
 * vc_funds, one row each pointing at the other), a child exported before its
 * parent, and a self-reference a row later. Enough users to cross chunks.
 */
function exportSql(extra = 40) {
  const users = [`INSERT INTO "users" ("id","email","referred_by") VALUES(1,'${SENTINEL}',2);`, `INSERT INTO "users" ("id","email","referred_by") VALUES(2,'b;c',NULL);`];
  for (let k = 0; k < extra; k += 1) users.push(`INSERT INTO "users" ("id","email","referred_by") VALUES(${k + 3},'u${k}@example.test',1);`);
  return [
    'PRAGMA defer_foreign_keys=TRUE;',
    'CREATE TABLE fund_lps (id INTEGER PRIMARY KEY, fund_id INTEGER NOT NULL REFERENCES vc_funds(id), name TEXT);',
    `INSERT INTO "fund_lps" ("id","fund_id","name") VALUES(1,7,'lp');`,
    'CREATE TABLE legal_documents (id TEXT PRIMARY KEY, fund_id INTEGER REFERENCES vc_funds(id), title TEXT NOT NULL);',
    `INSERT INTO "legal_documents" ("id","fund_id","title") VALUES('doc-1',7,'LPA, signed; v2');`,
    'CREATE TABLE projects (id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), name TEXT);',
    `INSERT INTO "projects" ("id","owner_id","name") VALUES(1,${extra + 2},'p1');`,
    'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, referred_by INTEGER REFERENCES users(id));',
    ...users,
    'CREATE TABLE vc_funds (id INTEGER PRIMARY KEY, name TEXT NOT NULL, lpa_doc_id TEXT REFERENCES legal_documents(id));',
    `INSERT INTO "vc_funds" ("id","name","lpa_doc_id") VALUES(7,'Fund I','doc-1');`,
    'CREATE INDEX idx_projects_owner ON projects(owner_id);',
  ].join('\n') + '\n';
}
const SQL = exportSql();

function manifestOf(sql, { key = KEY, migration = null, tables = null } = {}) {
  const d = describe(sql);
  return {
    version: 1, key, database: 'studioos-db',
    exported_at: new Date(Date.now() - 3 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    time_travel_bookmark: null, size_bytes: Buffer.byteLength(sql), sha256: sha(sql),
    statements: d.statements, tables: tables ?? d.tables, migrations: { ...d.migrations, last: migration ?? d.migrations.last },
  };
}

/**
 * A fake wrangler whose target is a real SQLite file (dir/target.db). R2
 * reads come from env (BACKUP_SQL, MANIFEST_JSON, NO_MANIFEST); `d1 info`
 * answers INFO_JSON or, with NO_TARGET, fails; FAIL_CHUNK fails that import
 * and quotes it, as D1 can. `d1 create` and `d1 delete` are never expected.
 */
function fakeWrangler(dir) {
  const src = `#!/usr/bin/env node
process.removeAllListeners('warning');
const fs = require('fs'); const { DatabaseSync } = require('node:sqlite');
const a = process.argv.slice(2); const e = process.env;
fs.appendFileSync(${JSON.stringify(join(dir, 'wcalls.log'))}, JSON.stringify(a) + '\\n');
const fileArg = () => a[a.indexOf('--file') + 1];
const dbPath = ${JSON.stringify(join(dir, 'target.db'))};
if (a[0] === 'r2' && a[2] === 'get' && a[3].endsWith('.manifest.json')) {
  if (e.NO_MANIFEST) { console.error('✘ [ERROR] The specified key does not exist.'); process.exit(1); }
  fs.writeFileSync(fileArg(), e.MANIFEST_JSON); process.exit(0);
}
if (a[0] === 'r2' && a[2] === 'get') { fs.writeFileSync(fileArg(), e.BACKUP_SQL); process.exit(0); }
if (a[0] === 'd1' && a[1] === 'info') {
  if (e.NO_TARGET) { console.error('✘ [ERROR] Couldn\\'t find DB with name'); process.exit(1); }
  console.log(e.INFO_JSON || JSON.stringify({ uuid: '0b7c1e8a-0000-4000-8000-000000000001', name: a[2], jurisdiction: 'eu' })); process.exit(0);
}
if (a[0] === 'd1' && a[1] === 'execute' && a.includes('--file')) {
  const n = fs.readdirSync(${JSON.stringify(join(dir, 'imports'))}).length + 1;
  const text = fs.readFileSync(fileArg(), 'utf8');
  fs.writeFileSync(${JSON.stringify(join(dir, 'imports'))} + '/' + String(n).padStart(3, '0') + '.sql', text);
  if (Number(e.FAIL_CHUNK) === n) { console.error('✘ [ERROR] SQLITE_CONSTRAINT_FOREIGNKEY near "' + text.slice(0, 300) + '"'); process.exit(1); }
  const db = new DatabaseSync(dbPath); db.exec('PRAGMA foreign_keys = ON;');
  db.exec('BEGIN');
  try { db.exec(text); db.exec('COMMIT'); } catch (err) { db.exec('ROLLBACK'); console.error('✘ [ERROR] ' + err.message); process.exit(1); }
  console.log('🚣 Executed 5 queries in 1.00ms (0 rows read, 5 rows written)'); process.exit(0);
}
if (a[0] === 'd1' && a[1] === 'execute' && a.includes('--command')) {
  try {
    const db = new DatabaseSync(dbPath);
    console.log(JSON.stringify([{ results: db.prepare(a[a.indexOf('--command') + 1]).all() }])); process.exit(0);
  } catch (err) { console.error('✘ [ERROR] ' + err.message); process.exit(1); }
}
console.error('fake wrangler: unexpected ' + a.join(' ')); process.exit(64);
`;
  writeFileSync(join(dir, 'wrangler'), src);
  chmodSync(join(dir, 'wrangler'), 0o755);
}

function world() {
  const dir = mkdtempSync(join(tmpdir(), 'd5337-'));
  fakeWrangler(dir);
  fakeAws(dir);
  for (const f of ['wcalls.log', 'calls.log']) writeFileSync(join(dir, f), '');
  mkdirSync(join(dir, 'imports'));
  mkdirSync(join(dir, 'tmp'));
  return dir;
}

/** Run restore-d1.sh. `input` answers the confirmation prompt. */
function restore(args, env = {}, { dir = world(), input = `${TARGET}\n` } = {}) {
  const r = spawnSync('bash', [RESTORE, ...args], {
    env: {
      PATH: `${dir}:${process.env.PATH}`, HOME: dir, TMPDIR: join(dir, 'tmp'), BACKUP_BUCKET: 'studioos-backups', DR_DRILL_CHUNK_BYTES: '1024',
      BACKUP_SQL: SQL, MANIFEST_JSON: JSON.stringify(manifestOf(SQL)), ...env,
    },
    input, encoding: 'utf8',
  });
  const wcalls = readFileSync(join(dir, 'wcalls.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const out = r.stdout + r.stderr;
  return {
    dir, status: r.status, out, wcalls,
    reason: (/reason=(\S+)/.exec(out) || [])[1] ?? null,
    imports: wcalls.filter((c) => c[1] === 'execute' && c.includes('--file')),
    touchedTarget: wcalls.some((c) => c[0] === 'd1'),
    tmpLeft: readdirSync(join(dir, 'tmp')),
  };
}
const R2 = [`r2://studioos-backups/${KEY}`, TARGET];

/** Every row of every table, for comparing the restored database with the export run whole. */
function snapshot(db) {
  const out = {};
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()) {
    out[name] = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map((r) => ({ ...r }));
  }
  return out;
}
function reference(sql) {
  // The export run whole, as plain SQLite would (node:sqlite turns foreign keys on by default).
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(sql);
  return snapshot(db);
}

// ── A clean restore ────────────────────────────────────────────────────────

test('a clean restore: verified, imported chunk by chunk with the FK cycle broken, every row count compared, temp removed', () => {
  const r = restore(R2);
  assert.equal(r.status, 0, r.out);
  assert.ok(r.imports.length >= 3, `expected several chunk imports, got ${r.imports.length}`);
  for (const c of r.imports) {
    assert.match(c[c.indexOf('--file') + 1], /\/chunks\/\d{3}-(schema|data|post)\.sql$/, 'the whole export was imported in one call');
    assert.ok(c.includes('--remote'));
  }
  // The rows are the export's, restored with foreign keys on.
  const db = new DatabaseSync(join(r.dir, 'target.db'));
  assert.deepEqual(snapshot(db), reference(SQL));
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.match(r.out, /cycle_edges_broken=1/);
  assert.match(r.out, /row counts match in all 5 tables/);
  assert.match(r.out, /restore complete/);
  // R2: the manifest first, then the backup, both --remote; no database created or deleted.
  const r2 = r.wcalls.filter((c) => c[0] === 'r2');
  assert.deepEqual(r2.map((c) => c[3]), [`studioos-backups/${KEY.replace(/\.sql$/, '.manifest.json')}`, `studioos-backups/${KEY}`]);
  assert.ok(r2.every((c) => c.includes('--remote')));
  assert.ok(!r.wcalls.some((c) => c[0] === 'd1' && (c[1] === 'create' || c[1] === 'delete')));
  assert.ok(!r.out.includes(SENTINEL), 'a row was printed');
  assert.deepEqual(r.tmpLeft, [], 'the run left its temp directory behind');
});

test('a local export restores with the manifest beside it', () => {
  const dir = world();
  writeFileSync(join(dir, 'backup-2026-11-09.sql'), SQL);
  writeFileSync(join(dir, 'backup-2026-11-09.manifest.json'), JSON.stringify(manifestOf(SQL)));
  const r = restore([join(dir, 'backup-2026-11-09.sql'), TARGET], {}, { dir });
  assert.equal(r.status, 0, r.out);
  assert.ok(!r.wcalls.some((c) => c[0] === 'r2'), 'a local export was downloaded');
  assert.deepEqual(snapshot(new DatabaseSync(join(dir, 'target.db'))), reference(SQL));
  const bare = world();
  writeFileSync(join(bare, 'backup.sql'), SQL);
  const none = restore([join(bare, 'backup.sql'), TARGET], {}, { dir: bare });
  assert.deepEqual([none.status, none.reason, none.touchedTarget], [2, 'manifest_missing', false], none.out);
});

// ── The target ─────────────────────────────────────────────────────────────

test('the target: unnamed, production by name or by id, missing, not EU or not empty is refused before any import', () => {
  const cases = [
    ['target_unnamed', [`r2://studioos-backups/${KEY}`], {}],
    ['target_is_production', [`r2://studioos-backups/${KEY}`, 'studioos-db'], {}],
    ['target_is_production', R2, { INFO_JSON: JSON.stringify({ uuid: PROD_ID, jurisdiction: 'eu' }) }],
    ['target_missing', R2, { NO_TARGET: '1' }],
    ['target_not_eu', R2, { INFO_JSON: JSON.stringify({ uuid: '0b7c1e8a-0000-4000-8000-000000000002', jurisdiction: null }) }],
    ['target_not_eu', R2, { INFO_JSON: JSON.stringify([{ uuid: '0b7c1e8a-0000-4000-8000-000000000002', jurisdiction: 'fedramp' }]) }],
  ];
  for (const [reason, args, env] of cases) {
    const r = restore(args, env);
    assert.deepEqual([r.status, r.reason], [1, reason], `${reason}: ${r.out}`);
    assert.equal(r.imports.length, 0, `${reason}: imported into a refused target`);
    assert.deepEqual(r.tmpLeft, [], reason);
  }
  // Named production never reaches wrangler at all.
  assert.deepEqual(restore([`r2://studioos-backups/${KEY}`, 'studioos-db']).wcalls, []);
});

test('the target: a database that already holds a table is refused and left as it was', () => {
  const dir = world();
  const db = new DatabaseSync(join(dir, 'target.db'));
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT); INSERT INTO users VALUES (99, 'kept');");
  db.close();
  const r = restore(R2, {}, { dir });
  assert.deepEqual([r.status, r.reason], [1, 'target_not_empty'], r.out);
  assert.equal(r.imports.length, 0);
  assert.deepEqual(new DatabaseSync(join(dir, 'target.db')).prepare('SELECT * FROM users').all().map((x) => ({ ...x })), [{ id: 99, email: 'kept' }]);
  // D1's own tables do not make a database non-empty.
  const fresh = world();
  new DatabaseSync(join(fresh, 'target.db')).exec('CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB);');
  assert.equal(restore(R2, {}, { dir: fresh }).status, 0);
});

test('the target: a confirmation that does not match the name imports nothing', () => {
  const r = restore(R2, {}, { input: 'studioos-db\n' });
  assert.deepEqual([r.status, r.reason], [1, 'confirmation_mismatch'], r.out);
  assert.equal(r.imports.length, 0);
});

// ── The backup ─────────────────────────────────────────────────────────────

test('the backup: one its manifest does not vouch for is refused before the target is touched, and says why', () => {
  const cases = [
    ['manifest_missing', { NO_MANIFEST: '1' }],
    ['manifest_invalid', { MANIFEST_JSON: '{"version":1}' }],
    ['sha256_mismatch', { MANIFEST_JSON: JSON.stringify(manifestOf(SQL.replace("'p1'", "'p2'"))) }],
    ['size_mismatch', { BACKUP_SQL: SQL.slice(0, -40) }],
    ['migration_unknown', { MANIFEST_JSON: JSON.stringify(manifestOf(SQL, { migration: '999_from_a_newer_checkout.sql' })) }],
    ['key_mismatch', { MANIFEST_JSON: JSON.stringify(manifestOf(SQL, { key: 'd1/studioos-db/backup-2026-11-08.sql' })) }],
  ];
  for (const [reason, env] of cases) {
    const r = restore(R2, env);
    assert.deepEqual([r.status, r.reason], [2, reason], `${reason}: ${r.out}`);
    assert.ok(!r.touchedTarget, `${reason}: the target was read or written for a backup that failed its manifest`);
    assert.deepEqual(r.tmpLeft, [], reason);
  }
});

test('the backup: an old export is restorable; recovering from one is this path\'s use', () => {
  const old = { ...manifestOf(SQL), exported_at: '2026-01-05T02:10:00Z' };
  const r = restore(R2, { MANIFEST_JSON: JSON.stringify(old) });
  assert.equal(r.status, 0, r.out);
});

test('the import: a failed chunk stops it, names the chunk and its tables, and quotes nothing', () => {
  const r = restore(R2, { FAIL_CHUNK: '2' });
  assert.equal(r.status, 2, r.out);
  assert.match(r.reason, /^chunk_2_of_\d+$/);
  assert.equal(r.imports.length, 2, 'the import went on past a failed chunk');
  assert.match(r.out, /restore failed at chunk 2\/\d+ \(data\); wrangler's error codes: SQLITE_CONSTRAINT_FOREIGNKEY/);
  assert.match(r.out, /chunk 2 tables: [a-z_, ]+; their parents: /);
  assert.ok(!r.out.includes(SENTINEL) && !r.out.includes('LPA, signed'), 'wrangler\'s quote of the chunk was printed');
});

test('the compare: restored row counts that differ from the manifest fail, naming the table only', () => {
  const m = manifestOf(SQL);
  const off = m.tables.map((t) => (t.name === 'users' ? { ...t, rows: t.rows + 1 } : t));
  const r = restore(R2, { MANIFEST_JSON: JSON.stringify({ ...m, tables: off }) });
  assert.deepEqual([r.status, r.reason], [3, 'row_counts_differ'], r.out);
  assert.match(r.out, /row counts differ in 1 of 5 tables: users/);
  // A table the manifest names and the restore lacks.
  const ghost = restore(R2, { MANIFEST_JSON: JSON.stringify({ ...m, tables: [...m.tables, { name: 'ghost', rows: 0, parents: [] }] }) });
  assert.deepEqual([ghost.status, ghost.reason], [3, 'row_counts_unreadable'], ghost.out);
});

// ── The independent copy ───────────────────────────────────────────────────

/** dr-second-copy.sh's real upload into the fake store; returns the daily point. */
function independent() {
  const dir = world();
  const { id, recipient } = keypair(dir);
  const m = manifestOf(SQL);
  writeFileSync(join(dir, 'export.sql'), SQL);
  writeFileSync(join(dir, 'export.manifest.json'), JSON.stringify(m));
  const up = spawnSync('bash', [COPY, 'upload', join(dir, 'export.sql'), join(dir, 'export.manifest.json')], {
    env: {
      PATH: `${dir}:${process.env.PATH}`, HOME: dir, DR_COPY_ENDPOINT: 'https://store.example.test', DR_COPY_BUCKET: 'axal-d1-recovery',
      DR_AGE_RECIPIENT: recipient, AWS_ACCESS_KEY_ID: 'AKIDFAKEWRITEONLY', AWS_SECRET_ACCESS_KEY: 'fake-secret-value',
    },
    encoding: 'utf8',
  });
  assert.equal(up.status, 0, up.stdout + up.stderr);
  const point = up.stdout.trim().split('\n').at(-1);
  const env = (extra = {}) => ({
    DR_SOURCE: 'independent', DR_AGE_IDENTITY_FILE: id, DR_COPY_ENDPOINT: 'https://store.example.test', DR_COPY_BUCKET: 'axal-d1-recovery',
    AWS_ACCESS_KEY_ID: 'AKIDFAKEREAD', AWS_SECRET_ACCESS_KEY: 'fake-read-secret', ...extra,
  });
  return { dir, id, point, env, store: (k) => join(dir, 'store', 'axal-d1-recovery', k) };
}

test('independent: a recovery point is checked, decrypted with the owner\'s key in the run\'s temp only, and restored', () => {
  const w = independent();
  const keyBefore = readFileSync(w.id, 'utf8');
  const r = restore([w.point, TARGET], w.env(), { dir: w.dir });
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(snapshot(new DatabaseSync(join(w.dir, 'target.db'))), reference(SQL));
  assert.match(r.out, /independent copy decrypted: the export of d1\/studioos-db\/backup-2026-11-09\.sql/);
  assert.ok(!r.wcalls.some((c) => c[0] === 'r2'), 'the independent mode read the primary bucket');
  assert.equal(readFileSync(w.id, 'utf8'), keyBefore, 'the owner\'s key file was changed');
  assert.ok(!r.out.includes(keyBefore.match(/AGE-SECRET-KEY-[0-9A-Z]+/)[0]), 'the key was printed');
  assert.ok(!r.out.includes(SENTINEL));
  assert.deepEqual(r.tmpLeft, [], 'the plaintext or the ciphertext outlived the run');
  // Nothing but the store, the owner's key and the fakes' own files sits beside the run.
  assert.ok(!readdirSync(w.dir).some((f) => /backup\.sql|\.age$/.test(f)));
});

test('independent: no key, a wrong key, a tampered ciphertext or a missing point is refused before the target is touched', () => {
  const w = independent();
  const other = keypair(mkdtempSync(join(tmpdir(), 'd5337k-')));
  const ct = w.store(`${w.point}/backup.sql.age`);
  const cases = [
    ['key_missing', 1, () => restore([w.point, TARGET], w.env({ DR_AGE_IDENTITY_FILE: join(w.dir, 'absent.key') }), { dir: w.dir })],
    ['decrypt_failed', 2, () => restore([w.point, TARGET], w.env({ DR_AGE_IDENTITY_FILE: other.id }), { dir: w.dir })],
    ['point_invalid', 1, () => restore(['d1/studioos-db/../x', TARGET], w.env(), { dir: w.dir })],
    ['manifest_missing', 2, () => restore(['d1/studioos-db/daily/2020-01-01T00-00-00Z', TARGET], w.env(), { dir: w.dir })],
    ['copy_unconfigured', 1, () => restore([w.point, TARGET], w.env({ DR_COPY_BUCKET: '' }), { dir: w.dir })],
    ['ciphertext_mismatch', 2, () => {
      const bytes = readFileSync(ct); bytes[bytes.length - 1] ^= 1; writeFileSync(ct, bytes);
      return restore([w.point, TARGET], w.env(), { dir: w.dir });
    }],
  ];
  for (const [reason, status, run] of cases) {
    const r = run();
    assert.deepEqual([r.status, r.reason], [status, reason], `${reason}: ${r.out}`);
    assert.ok(!r.wcalls.some((c) => c[0] === 'd1'), `${reason}: the target was touched`);
    assert.deepEqual(r.tmpLeft, [], `${reason}: the run left plaintext or ciphertext behind`);
  }
  assert.ok(!existsSync(join(w.dir, 'target.db')));
});

// ── One path ───────────────────────────────────────────────────────────────

test('the drill and the operator\'s restore share one verify, split, import and compare path', () => {
  for (const p of [DRILL, RESTORE]) {
    const c = code(p);
    assert.match(c, /^\. "\$\{REPO_ROOT\}\/scripts\/dr-restore-lib\.sh"$/m, `${p} does not source the shared path`);
    for (const fn of ['dr_verify', 'dr_import_chunks', 'dr_compare_counts', 'dr_fetch_independent']) {
      assert.match(c, new RegExp(`^\\s*${fn} `, 'm'), `${p} does not call ${fn}`);
    }
    // Neither keeps a copy of its own: no split, manifest check or file import outside the library.
    assert.doesNotMatch(c, /dr-drill-split\.mjs|d1-backup-manifest\.mjs|d1 execute[^\n]*--file|age -d/, `${p} carries its own copy of the restore path`);
  }
  const lib = code(LIB);
  assert.match(lib, /dr-drill-split\.mjs/);
  assert.match(lib, /d1-backup-manifest\.mjs" verify/);
  assert.match(lib, /d1-backup-manifest\.mjs" compare/);
  assert.match(lib, /wrangler d1 execute "\$\{db\}" --remote --file/);
});

test('the runbook\'s §3 names every reason the script can stop on, and the RTO row describes the script as it works', () => {
  const book = readFileSync(resolve(process.cwd(), 'documentation/operations/D1_RECOVERY.md'), 'utf8');
  const s3 = book.slice(book.indexOf('## 3. The nightly export'), book.indexOf('## 4. '));
  const reasons = new Set();
  for (const src of [code(RESTORE), code(LIB)]) {
    for (const m of src.matchAll(/\b(?:refuse|dr_fail [123]) ([a-z_]+)/g)) reasons.add(m[1]);
  }
  // The manifest check's own reasons, from its header.
  for (const m of readFileSync(resolve(process.cwd(), 'scripts/d1-backup-manifest.mjs'), 'utf8').matchAll(/^ \*\s+([a-z0-9_]+_(?:invalid|mismatch|unknown)|stale)\s/gm)) reasons.add(m[1]);
  assert.ok(reasons.size >= 25, `only ${reasons.size} reasons were read from the code`);
  for (const r of reasons) assert.ok(s3.includes(`\`${r}\``), `D1_RECOVERY.md §3 does not name ${r}`);
  assert.ok(s3.includes('`chunk_<n>_of_<total>`'));
  assert.match(s3, /DR_SOURCE=independent/);
  assert.match(s3, /--jurisdiction eu/);
  const ir = readFileSync(resolve(process.cwd(), 'documentation/operations/INCIDENT_RESPONSE.md'), 'utf8');
  const at = ir.indexOf('| **Recovery Time Objective (RTO)**');
  const rto = ir.slice(at, ir.indexOf('\n', at));
  assert.match(rto, /scripts\/restore-d1\.sh <backup> <target>/);
  assert.match(rto, /DR_SOURCE=independent/);
  assert.match(rto, /D5337/);
});
