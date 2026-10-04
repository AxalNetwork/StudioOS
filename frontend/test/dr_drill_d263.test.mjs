/**
 * D263 — the restore drill, run against a fake `wrangler`.
 *
 * The drill failed four runs out of four and was about to fail a fifth on its
 * first command: it called `wrangler r2 object list`, which wrangler 4.131
 * does not have, and hid the error. Nothing it did was visible to the
 * platform, because it wrote nothing. These tests RUN scripts/dr-drill.sh
 * with a fake `wrangler` first on PATH that records every argument list and
 * answers like the real one, then assert what the script did: the marker it
 * wrote on every exit, `--remote` on every R2 call, the throwaway database
 * deleted on failure, and the exit code the marker cannot change. Same shape
 * as magic_link_probe.test.mjs.
 *
 * D523 — the restore imports in chunks. The 2026-10-01 run got past every
 * step above and then D1 reset mid-import (`{"D1_RESET_DO":true}`). The
 * splitter (scripts/dr-drill-split.mjs) is tested by replaying its chunks in
 * real SQLite with foreign keys ON, one transaction per chunk the way D1
 * imports one file, and comparing every row with the export run whole. The
 * drill tests check one import per chunk, in phase order, and that nothing
 * wrangler or the backup says is printed beyond counts and error codes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, existsSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { planRestore, splitStatements, chunkText, DEFER_FK, D1_STATEMENT_LIMIT } from '../../scripts/dr-drill-split.mjs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const SCRIPT = resolve(process.cwd(), 'scripts/dr-drill.sh');
const SRC = readFileSync(SCRIPT, 'utf8');
const WF = readFileSync(resolve(process.cwd(), '.github/workflows/dr-drill.yml'), 'utf8');
const KEY = 'd1/studioos-db/backup-2026-09-30.sql';
const SENTINEL = 'SENTINEL-BACKUP-CONTENT';

/**
 * A small export shaped like `wrangler d1 export`'s: its PRAGMA first, each
 * table's rows straight after its CREATE, a child table before its parent, a
 * self-referencing table, a trigger that would write a row if it fired during
 * the restore, and the sqlite_sequence rows.
 */
function exportSql(extraUsers = 0) {
  // User 1 names user 2, a row later: only the deferral lets that import.
  const users = [`INSERT INTO "users" VALUES(1,'${SENTINEL}',2);`, `INSERT INTO "users" VALUES(2,'b;c',NULL);`];
  for (let k = 0; k < extraUsers; k += 1) users.push(`INSERT INTO "users" VALUES(${k + 3},'row ${k} ''quoted''; -- not a comment',1);`);
  return [
    'PRAGMA defer_foreign_keys=TRUE;',
    'CREATE TABLE "projects" (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER NOT NULL REFERENCES "users"(id), name TEXT);',
    // Owned by the LAST user, who lands in a later chunk than the project in
    // the export's own order.
    `INSERT INTO "projects" VALUES(1,${extraUsers + 2},'p1');`,
    'CREATE TABLE activity_logs (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), action TEXT);',
    `INSERT INTO "activity_logs" VALUES(1,1,'signed_in');`,
    // Self-referencing.
    'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, referred_by INTEGER REFERENCES users(id));',
    ...users,
    '/* a block comment; with a semicolon */',
    'CREATE INDEX idx_projects_owner ON projects(owner_id); -- trailing comment',
    "CREATE TRIGGER trg_users_ai AFTER INSERT ON users BEGIN INSERT INTO activity_logs(user_id, action) VALUES (NEW.id, CASE WHEN NEW.referred_by IS NULL THEN 'joined;direct' ELSE 'joined;referred' END); END;",
    'CREATE VIEW v_owners AS SELECT u.id FROM users u JOIN projects p ON p.owner_id = u.id;',
    'DELETE FROM sqlite_sequence;',
    `INSERT INTO "sqlite_sequence" VALUES('projects',1);`,
  ].join('\n') + '\n';
}

/** Every row of every table, for comparing two databases. */
function snapshot(db) {
  const out = {};
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()) {
    out[name] = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map((r) => ({ ...r }));
  }
  out.__objects = db.prepare("SELECT type, name FROM sqlite_master WHERE type IN ('index','trigger','view') ORDER BY name").all().map((r) => ({ ...r }));
  return out;
}

/**
 * Import files the way D1 does: foreign keys on, one transaction each. The
 * reference build (`fk: false`) runs the export as plain SQLite would, which
 * is the content a restore must reproduce.
 */
function importFiles(texts, { fk = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys = ${fk ? 'ON' : 'OFF'};`);
  for (const t of texts) {
    db.exec('BEGIN');
    try { db.exec(t); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); db.close(); throw e; }
  }
  return db;
}

/**
 * A fake wrangler. Behaviour is chosen by env: FAIL_HEARTBEAT, FAIL_RESTORE,
 * FAIL_MARKER, ZERO_USERS. Every call is appended to calls.log as one
 * JSON array; the marker put copies its --file to marker.json.
 */
function fakeWrangler(dir) {
  const src = `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(join(dir, 'calls.log'))}, JSON.stringify(a) + '\\n');
const has = (x) => a.includes(x);
const fileArg = () => a[a.indexOf('--file') + 1];
const e = process.env;
if (a[0] === 'r2' && a[2] === 'get' && a[3].endsWith('/heartbeat-d1.json')) {
  if (e.FAIL_HEARTBEAT) { console.error('✘ [ERROR] The specified key does not exist.'); process.exit(1); }
  process.stdout.write(JSON.stringify({ at: '2026-09-30T02:10:00Z', source: 'gha', kind: 'd1', key: ${JSON.stringify(KEY)}, size_bytes: 4096 }));
  process.exit(0);
}
if (a[0] === 'r2' && a[2] === 'get') { fs.writeFileSync(fileArg(), e.BACKUP_SQL || 'CREATE TABLE users(id);'); process.exit(0); }
if (a[0] === 'r2' && a[2] === 'put') {
  if (e.FAIL_MARKER) { console.error('✘ [ERROR] put refused'); process.exit(1); }
  fs.copyFileSync(fileArg(), ${JSON.stringify(join(dir, 'marker.json'))});
  process.exit(0);
}
if (a[0] === 'd1' && a[1] === 'create') process.exit(0);
if (a[0] === 'd1' && a[1] === 'delete') process.exit(0);
if (a[0] === 'd1' && a[1] === 'execute' && has('--file')) {
  const imports = ${JSON.stringify(join(dir, 'imports'))};
  fs.mkdirSync(imports, { recursive: true });
  const n = fs.readdirSync(imports).length + 1;
  fs.copyFileSync(fileArg(), imports + '/' + String(n).padStart(3, '0') + '.sql');
  if (e.FAIL_RESTORE || Number(e.FAIL_CHUNK) === n) {
    // What D1 says can quote the backup; the drill must not repeat it.
    console.error('✘ [ERROR] {"D1_RESET_DO":true} near "' + fs.readFileSync(fileArg(), 'utf8').slice(0, 200) + '"');
    process.exit(1);
  }
  console.log('🌀 Executing on remote database (uuid):');
  console.log('🚣 Executed 7 queries in 1.25ms (0 rows read, 9 rows written)');
  process.exit(0);
}
if (a[0] === 'd1' && a[1] === 'execute' && has('--command')) {
  const sql = a[a.indexOf('--command') + 1];
  if (/COUNT/.test(sql)) { console.log(JSON.stringify([{ results: [{ users: e.ZERO_USERS ? 0 : 3, projects: 2 }] }])); process.exit(0); }
  const names = ['users', 'projects', 'deals', 'score_snapshots', 'activity_logs', 'documents'];
  console.log(JSON.stringify([{ results: names.map((name) => ({ name })) }]));
  process.exit(0);
}
console.error('fake wrangler: unexpected call ' + a.join(' '));
process.exit(64);
`;
  writeFileSync(join(dir, 'wrangler'), src);
  chmodSync(join(dir, 'wrangler'), 0o755);
}

function drill(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'd263-'));
  fakeWrangler(dir);
  writeFileSync(join(dir, 'calls.log'), '');
  const r = spawnSync('bash', [SCRIPT], {
    env: { PATH: `${dir}:${process.env.PATH}`, HOME: dir, BACKUP_BUCKET: 'studioos-backups', DR_DRILL_PREVIEW: '0', ...env },
    encoding: 'utf8',
  });
  const calls = readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const markerPath = join(dir, 'marker.json');
  const marker = existsSync(markerPath) ? JSON.parse(readFileSync(markerPath, 'utf8')) : null;
  const importsDir = join(dir, 'imports');
  const imports = existsSync(importsDir) ? readdirSync(importsDir).sort().map((f) => readFileSync(join(importsDir, f), 'utf8')) : [];
  return { status: r.status, out: r.stdout + r.stderr, calls, marker, imports };
}

test('D263 drill: a passing run writes a passed marker with the backup it restored, and exits 0', () => {
  const r = drill({ DRILL_SOURCE: 'gha', GITHUB_RUN_ID: '98765' });
  assert.equal(r.status, 0, r.out);
  assert.ok(r.marker, 'a passing run wrote no marker');
  assert.deepEqual(
    [r.marker.outcome, r.marker.exit_code, r.marker.step, r.marker.backup_key, r.marker.source, r.marker.run_id],
    ['passed', 0, 'teardown', KEY, 'gha', '98765'],
  );
  assert.match(r.marker.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(typeof r.marker.duration_s, 'number');
  assert.ok(r.calls.some((c) => c[0] === 'd1' && c[1] === 'delete'), 'the throwaway database was not deleted');
});

test('D263 drill: every R2 call names --remote, and the marker goes to drill-d1.json', () => {
  const r = drill();
  const r2 = r.calls.filter((c) => c[0] === 'r2');
  assert.ok(r2.length >= 3, 'the heartbeat read, the backup download and the marker put');
  for (const c of r2) assert.ok(c.includes('--remote'), `an R2 call without --remote reads local storage: ${c.join(' ')}`);
  const put = r2.filter((c) => c[2] === 'put');
  assert.deepEqual(put.map((c) => c[3]), ['studioos-backups/drill-d1.json']);
  // The key came from the heartbeat, not from a subcommand wrangler lacks.
  assert.equal(r2[0][3], 'studioos-backups/heartbeat-d1.json');
});

test('D263 drill: a failed restore exits 2, writes a failed marker naming the step, and still deletes the throwaway database', () => {
  const r = drill({ FAIL_RESTORE: '1' });
  assert.equal(r.status, 2, r.out);
  assert.deepEqual([r.marker?.outcome, r.marker?.step, r.marker?.exit_code, r.marker?.backup_key], ['failed', 'restore', 2, KEY]);
  assert.ok(r.calls.some((c) => c[0] === 'd1' && c[1] === 'delete'), 'a failed drill leaked its throwaway database');
});

test('D263 drill: an unreadable heartbeat fails at the first step, with no key and no database created', () => {
  const r = drill({ FAIL_HEARTBEAT: '1' });
  assert.equal(r.status, 1, r.out);
  assert.deepEqual([r.marker?.outcome, r.marker?.step, r.marker?.exit_code, r.marker?.backup_key], ['failed', 'find_backup', 1, null]);
  assert.ok(!r.calls.some((c) => c[0] === 'd1'), 'the drill went on past a missing key');
  assert.match(r.out, /The specified key does not exist/, 'wrangler\'s own error was thrown away');
});

test('D263 drill: a smoke failure exits 3 with a failed marker', () => {
  const r = drill({ ZERO_USERS: '1' });
  assert.equal(r.status, 3, r.out);
  assert.deepEqual([r.marker?.outcome, r.marker?.step], ['failed', 'smoke']);
});

test('D263 drill: a marker that cannot be written never changes the exit code', () => {
  assert.equal(drill({ FAIL_MARKER: '1' }).status, 0);
  assert.equal(drill({ FAIL_MARKER: '1', FAIL_RESTORE: '1' }).status, 2);
});

test('D263 drill: the script and its workflow no longer carry the four defects', () => {
  const code = SRC.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(code, /wrangler r2 object list/, 'a subcommand wrangler does not have');
  assert.doesNotMatch(code, /wrangler r2[^\n]*2>\/dev\/null/, 'wrangler\'s own error thrown away');
  assert.doesNotMatch(code, /npm run test:drift/, 'step 4c ran the whole repo suite against nothing restored');
  assert.doesNotMatch(code, /trap - EXIT/, 'the success path cleared the trap that writes the marker');
  assert.match(WF, /^\s+DR_DRILL_PREVIEW: '0'$/m, 'the preview step stays off until the preview env has real ids');
  // The pager step's `if:` reads a job-level flag it can see, not its own env.
  const notify = WF.slice(WF.indexOf('- name: Notify on failure'));
  assert.doesNotMatch(notify.split('\n')[1], /env\.PAGER_WEBHOOK_URL/, 'the pager step tests a variable its own if: cannot see');
  assert.match(WF, /^\s+PAGER_CONFIGURED: \$\{\{ secrets\.PAGER_WEBHOOK_URL != '' \}\}$/m);
});

// ---------------------------------------------------------------- D523 ----

test('D523 split: statements survive quotes, comments and trigger bodies holding semicolons', () => {
  const { statements, error } = splitStatements(exportSql());
  assert.equal(error, null);
  assert.equal(statements.length, 13);
  const trigger = statements.find((s) => s.startsWith('CREATE TRIGGER'));
  assert.match(trigger, /'joined;referred' END\); END;$/, 'the trigger body was cut at an inner semicolon');
  assert.ok(statements.includes(`INSERT INTO "users" VALUES(2,'b;c',NULL);`), 'a semicolon inside a string ended a statement');
  assert.ok(!statements.some((s) => /block comment|trailing comment/.test(s)), 'comments are dropped');
});

test('D523 split: an unterminated quote is an error with an offset, never the text there', () => {
  const sql = `CREATE TABLE users (id);\nINSERT INTO users VALUES('${SENTINEL}`;
  const { error } = splitStatements(sql);
  assert.deepEqual(error, { offset: sql.indexOf("'"), reason: 'unterminated quote' });
  const dir = mkdtempSync(join(tmpdir(), 'd523-'));
  writeFileSync(join(dir, 'in.sql'), sql);
  const r = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/dr-drill-split.mjs'), join(dir, 'in.sql'), join(dir, 'out')], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unterminated quote at byte offset \d+/);
  assert.ok(!(r.stdout + r.stderr).includes(SENTINEL), 'the splitter printed backup content');
});

test('D523 split: the chunks, imported one transaction each with foreign keys on, rebuild the export exactly', () => {
  const sql = exportSql(40);
  const whole = importFiles([sql], { fk: false });
  const { chunks, counts, error } = planRestore(sql, { chunkBytes: 1024 });
  assert.equal(error, null);
  assert.ok(chunks.filter((c) => c.phase === 'data').length >= 2, 'the test must cross a data chunk boundary');
  const restored = importFiles(chunks.map(chunkText));
  assert.deepEqual(snapshot(restored), snapshot(whole));
  assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM users').get().n, 42);
  assert.deepEqual(
    [counts.schema, counts.data, counts.post, counts.dropped_pragma, counts.tables, counts.cyclic_tables],
    [3, 46, 3, 1, 3, 0],
  );
});

test('D523 split: phases run schema, data, post; data is parents first and every data chunk defers foreign keys', () => {
  const { chunks } = planRestore(exportSql(40), { chunkBytes: 1024 });
  const phases = chunks.map((c) => c.phase);
  assert.deepEqual([...new Set(phases)], ['schema', 'data', 'post']);
  assert.deepEqual(phases, [...phases].sort((a, b) => ['schema', 'data', 'post'].indexOf(a) - ['schema', 'data', 'post'].indexOf(b)));
  const data = chunks.filter((c) => c.phase === 'data');
  for (const c of data) assert.ok(chunkText(c).startsWith(`${DEFER_FK}\n`), 'a data chunk without the deferral');
  for (const c of chunks.filter((c) => c.phase !== 'data')) assert.ok(!chunkText(c).includes('PRAGMA'), 'schema and post need no pragma');
  const tablesInOrder = [...new Set(data.flatMap((c) => c.statements).map((s) => (/INTO "?(\w+)"?/.exec(s) || /FROM (\w+)/.exec(s))[1]))];
  assert.deepEqual(tablesInOrder, ['users', 'projects', 'activity_logs', 'sqlite_sequence']);
  // The triggers come after every row, so restoring a user writes no log row.
  const post = chunks.filter((c) => c.phase === 'post').flatMap((c) => c.statements);
  assert.ok(post.some((s) => s.startsWith('CREATE TRIGGER')) && post.some((s) => s.startsWith('CREATE INDEX')));
});

test('D523 split: the export order itself fails a per-chunk import, which is why the data is reordered', () => {
  // The same chunks in the export's order: projects' rows before users exist.
  const sql = exportSql();
  const naive = splitStatements(sql).statements.filter((s) => !s.startsWith('PRAGMA'));
  assert.throws(() => importFiles(naive.map((s) => `${DEFER_FK}\n${s}\n`)), /FOREIGN KEY|no such table: main.users/);
});

test('D523 split: chunks respect the budget, a table that fits never straddles two, and big statements are counted', () => {
  const big = `INSERT INTO "users" VALUES(99,'${'x'.repeat(D1_STATEMENT_LIMIT)}',NULL);`;
  const sql = exportSql(40).replace(`INSERT INTO "projects" VALUES(1,42,'p1');`, `INSERT INTO "projects" VALUES(1,42,'p1');\n${big}`);
  const { chunks, counts } = planRestore(sql, { chunkBytes: 2048 });
  for (const c of chunks) {
    if (c.statements.length > 1) assert.ok(c.bytes <= 2048, `a ${c.phase} chunk of ${c.bytes} bytes`);
  }
  assert.equal(counts.over_limit, 1);
  assert.equal(chunks.reduce((a, c) => a + c.overLimit, 0), 1);
  assert.ok(counts.largest_statement_bytes > D1_STATEMENT_LIMIT);
  assert.equal(counts.split_tables, 1, 'only users, bigger than one chunk, is split');
  // Two tables of ~600 bytes under a 1024-byte budget: the second starts a
  // fresh chunk rather than straddling the first one's.
  const rowsOf = (t) => Array.from({ length: 10 }, (_, k) => `INSERT INTO "${t}" VALUES(${k},'${'y'.repeat(40)}');`);
  const two = ['CREATE TABLE a (id, v);', ...rowsOf('a'), 'CREATE TABLE b (id, v);', ...rowsOf('b')].join('\n');
  const plan = planRestore(two, { chunkBytes: 1024 });
  const dataChunks = plan.chunks.filter((c) => c.phase === 'data').map((c) => c.statements.map((x) => /INTO "(\w)"/.exec(x)[1]).join(''));
  assert.deepEqual(dataChunks, ['a'.repeat(10), 'b'.repeat(10)]);
  assert.equal(plan.counts.split_tables, 0);
});

test('D523 split: D1-internal tables and transaction control are dropped and counted', () => {
  const sql = `BEGIN TRANSACTION;\nCREATE TABLE _cf_KV (k TEXT);\nINSERT INTO "_cf_KV" VALUES('k');\nCREATE TABLE sqlite_sequence(name,seq);\n${exportSql()}COMMIT;\n`;
  const { chunks, counts } = planRestore(sql);
  assert.deepEqual([counts.dropped_internal, counts.dropped_txn], [3, 2]);
  assert.ok(!chunks.flatMap((c) => c.statements).some((s) => /_cf_KV|TRANSACTION|^COMMIT|TABLE sqlite_/.test(s)));
  importFiles(chunks.map(chunkText));
});

test('D523 drill: the restore imports one chunk per call, in phase order, never the whole export', () => {
  const r = drill({ BACKUP_SQL: exportSql(40), DR_DRILL_CHUNK_BYTES: '1024' });
  assert.equal(r.status, 0, r.out);
  const files = r.calls.filter((c) => c[0] === 'd1' && c[1] === 'execute' && c.includes('--file')).map((c) => c[c.indexOf('--file') + 1]);
  assert.ok(files.length >= 4, `expected several chunk imports, got ${files.length}`);
  assert.ok(files.every((f) => /\/chunks\/\d{3}-(schema|data|post)\.sql$/.test(f)), 'the whole export was imported in one call');
  assert.deepEqual([...new Set(files.map((f) => /-(\w+)\.sql$/.exec(f)[1]))], ['schema', 'data', 'post']);
  assert.ok(r.calls.filter((c) => c.includes('--file')).every((c) => c.includes('--remote')));
  // What was imported, replayed, is the export.
  assert.deepEqual(snapshot(importFiles(r.imports)), snapshot(importFiles([exportSql(40)], { fk: false })));
  assert.match(r.out, new RegExp(`restore ok: ${files.length} chunks imported`));
  assert.match(r.out, /chunk 1\/\d+ imported: Executed 7 queries in 1\.25ms \(0 rows read, 9 rows written\)/);
  assert.ok(!r.out.includes(SENTINEL), 'the drill printed backup content');
});

test('D523 drill: a failed chunk stops the restore, exits 2, names the chunk and the error code, and repeats none of wrangler\'s text', () => {
  const r = drill({ BACKUP_SQL: exportSql(40), DR_DRILL_CHUNK_BYTES: '1024', FAIL_CHUNK: '2' });
  assert.equal(r.status, 2, r.out);
  assert.equal(r.imports.length, 2, 'the restore went on past a failed chunk');
  assert.match(r.out, /FATAL: restore failed at chunk 2\/\d+ \(data\); wrangler's error codes: D1_RESET_DO/);
  assert.ok(!r.out.includes(SENTINEL), 'wrangler\'s error quoted the backup and the drill printed it');
  assert.deepEqual([r.marker?.outcome, r.marker?.step, r.marker?.exit_code], ['failed', 'restore', 2]);
  assert.ok(r.calls.some((c) => c[0] === 'd1' && c[1] === 'delete'), 'a failed drill leaked its throwaway database');
});

test('D523 drill: an export that cannot be split fails the restore before any import', () => {
  const r = drill({ BACKUP_SQL: `CREATE TABLE users (id);\nINSERT INTO users VALUES('${SENTINEL}` });
  assert.equal(r.status, 2, r.out);
  assert.equal(r.imports.length, 0);
  assert.match(r.out, /FATAL: could not split the backup into import chunks/);
  assert.ok(!r.out.includes(SENTINEL));
});
