/**
 * D7142 (#7142) — the D1 export is read as a stream. `d1-backup-manifest.mjs`
 * (`buildManifest`) and `dr-drill-split.mjs` read the whole export into one
 * string, and Node refuses a string past 536,870,888 characters; at about
 * 4 MiB a day the export passes that around 2027-01-07. Both now stream it.
 *
 *   - golden: on every fixture, at read sizes down to one byte, the streamed
 *     manifest and chunk files are byte-identical to the frozen pre-D7142 code
 *     (fixtures/d7142_old_*.mjs);
 *   - a statement split across a read boundary, a `;` in a string literal, and
 *     a multi-line INSERT are each counted once;
 *   - an export bigger than the heap is described and split under a heap cap
 *     the old code cannot survive. The >600 MiB proof runs with
 *     D7142_LARGE=1 (it writes 600+ MiB to the temp directory and deletes it).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/d1_backup_stream_d7142.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closeSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildManifest, describe, describeFile } from '../../scripts/d1-backup-manifest.mjs';
import { StatementSplitter, planFile, planRestore, splitStatements } from '../../scripts/dr-drill-split.mjs';
import * as oldManifest from './fixtures/d7142_old_d1_backup_manifest.mjs';
import * as oldSplit from './fixtures/d7142_old_dr_drill_split.mjs';

const SPLIT = resolve(process.cwd(), 'scripts/dr-drill-split.mjs');
const MANIFEST = resolve(process.cwd(), 'scripts/d1-backup-manifest.mjs');
const OLD_SPLIT = resolve(process.cwd(), 'frontend/test/fixtures/d7142_old_dr_drill_split.mjs');
const OPTS = { key: 'd1/studioos-db/backup-2026-11-18.sql', db: 'studioos-db', exportedAt: '2026-11-18T02:00:00Z', bookmark: 'bm' };
const READ_SIZES = [1, 2, 3, 7, 64, 1 << 16];

// ------------------------------------------------------------ fixtures ----

/** D4558's manifest fixture. */
const MANIFEST_EXPORT = [
  'PRAGMA defer_foreign_keys=TRUE;',
  'CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, checksum TEXT, applied_at TEXT);',
  "INSERT INTO \"schema_migrations\" VALUES('002_user_settings.sql','c2','2026-01-02');",
  "INSERT INTO \"schema_migrations\" VALUES('202611011200_later.sql','c3','2026-11-01');",
  "INSERT INTO \"schema_migrations\" VALUES('001_progress_tables.sql','c1','2026-01-01');",
  'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);',
  "INSERT INTO \"users\" VALUES(1,'SENTINEL-ROW-CONTENT');",
  "INSERT INTO \"users\" VALUES(2,'it''s; tricky');",
  'CREATE TABLE notes (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), parent_id INTEGER REFERENCES notes(id));',
  'INSERT INTO "notes" VALUES(1,1,NULL);',
  'CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB);',
  "INSERT INTO \"_cf_KV\" VALUES('x','y');",
].join('\n');

/** D523's drill fixture (dr_drill_d263.test.mjs exportSql(40)). */
function drillExport(extraUsers = 40) {
  const users = ["INSERT INTO \"users\" VALUES(1,'S',2);", "INSERT INTO \"users\" VALUES(2,'b;c',NULL);"];
  for (let k = 0; k < extraUsers; k += 1) users.push(`INSERT INTO "users" VALUES(${k + 3},'row ${k} ''quoted''; -- not a comment',1);`);
  return [
    'PRAGMA defer_foreign_keys=TRUE;',
    'CREATE TABLE "projects" (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER NOT NULL REFERENCES "users"(id), name TEXT);',
    `INSERT INTO "projects" VALUES(1,${extraUsers + 2},'p1');`,
    'CREATE TABLE activity_logs (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), action TEXT);',
    "INSERT INTO \"activity_logs\" VALUES(1,1,'signed_in');",
    'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, referred_by INTEGER REFERENCES users(id));',
    ...users,
    '/* a block comment; with a semicolon */',
    'CREATE INDEX idx_projects_owner ON projects(owner_id); -- trailing comment',
    "CREATE TRIGGER trg_users_ai AFTER INSERT ON users BEGIN INSERT INTO activity_logs(user_id, action) VALUES (NEW.id, CASE WHEN NEW.referred_by IS NULL THEN 'joined;direct' ELSE 'joined;referred' END); END;",
    'CREATE VIEW v_owners AS SELECT u.id FROM users u JOIN projects p ON p.owner_id = u.id;',
    'DELETE FROM sqlite_sequence;',
    "INSERT INTO \"sqlite_sequence\" VALUES('projects',1);",
  ].join('\n') + '\n';
}

/** The FK-cycle fixture (run 41307767798), whose rows the planner rewrites. */
const CYCLE_EXPORT = [
  'PRAGMA defer_foreign_keys=TRUE;',
  'CREATE TABLE fund_lps (id INTEGER PRIMARY KEY, fund_id INTEGER NOT NULL REFERENCES vc_funds(id), name TEXT);',
  "INSERT INTO \"fund_lps\" (\"id\",\"fund_id\",\"name\") VALUES(1,7,'S');",
  'CREATE TABLE legal_documents (id TEXT PRIMARY KEY, fund_id INTEGER REFERENCES vc_funds(id), title TEXT NOT NULL);',
  "INSERT INTO \"legal_documents\" (\"id\",\"fund_id\",\"title\") VALUES('doc-1',7,'LPA, signed; v2');",
  "INSERT INTO \"legal_documents\" (\"id\",\"fund_id\",\"title\") VALUES('doc-2',NULL,'draft');",
  'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);',
  "INSERT INTO \"notes\" (\"id\",\"body\") VALUES(1,'n');",
  "CREATE TABLE vc_funds (id INTEGER PRIMARY KEY, name TEXT NOT NULL, lpa_doc_id TEXT REFERENCES legal_documents(id), CONSTRAINT ck CHECK (name <> 'not null'));",
  "INSERT INTO \"vc_funds\" (\"id\",\"name\",\"lpa_doc_id\") VALUES(7,'Fund I','doc-1');",
].join('\n') + '\n';

/**
 * Every boundary the splitter knows, in one export: a BOM, multi-byte text,
 * strings holding `;`, newlines, `--`, `/*` and doubled quotes, [], "" and ``
 * identifiers, comments of both kinds, a multi-line INSERT … VALUES, TEMP and
 * plain triggers with nested CASE, a ledger, and a last statement with no `;`.
 */
const TRICKY_EXPORT = [
  '﻿PRAGMA defer_foreign_keys=TRUE;',
  'CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, checksum TEXT, applied_at TEXT);',
  "INSERT INTO schema_migrations VALUES('001_a.sql','c','x');INSERT INTO schema_migrations VALUES('202611180000_7142_b.sql','c','y');",
  'CREATE TABLE [team members] (id INTEGER PRIMARY KEY, "full ""name""" TEXT, `note` TEXT);',
  'CREATE TABLE IF NOT EXISTS main."posts" (id INTEGER PRIMARY KEY, author INTEGER REFERENCES [team members](id), parent INTEGER REFERENCES posts(id));',
  "INSERT INTO [team members] VALUES(1,'Zoë ☕ 😀','a;b');",
  'CREATE TABLE "équipe ☕" (id INTEGER PRIMARY KEY, posts_id INTEGER REFERENCES "posts"(id));',
  "INSERT INTO \"équipe ☕\" VALUES(1,1);",
  "INSERT INTO \"team members\" VALUES(2,'it''s -- not a comment','/* nor this */ ;');",
  "INSERT INTO `posts` (\"id\",\"author\",\"parent\")\nVALUES(\n  1,\n  1,\n  NULL\n);",
  "INSERT OR REPLACE INTO posts VALUES(2,1,1); -- a comment; with ; semicolons\nINSERT INTO posts VALUES(3,2,'multi\nline;\nvalue');",
  "/* a block\n comment; */INSERT INTO posts VALUES(4,2,'''');",
  "REPLACE INTO posts VALUES(5,1,'x/*y*/z--w');",
  "CREATE TEMP TRIGGER t1 AFTER INSERT ON posts BEGIN SELECT CASE WHEN NEW.id > 1 THEN 'a;b' ELSE (CASE WHEN 1 THEN 'c;' END) END; END;",
  "CREATE TRIGGER t2 BEFORE DELETE ON posts BEGIN DELETE FROM posts WHERE parent = OLD.id; UPDATE posts SET author=NULL WHERE id=OLD.id; END;",
  'CREATE INDEX i1 ON posts(author);',
  "BEGIN TRANSACTION;COMMIT;",
  "INSERT INTO posts VALUES(6,1,'trailing, no semicolon')",
].join('\n');

const FIXTURES = {
  manifest: MANIFEST_EXPORT,
  drill: drillExport(40),
  cycle: CYCLE_EXPORT,
  tricky: TRICKY_EXPORT,
};

const made = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), `d7142-${p}-`)); made.push(d); return d; };
test.after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
function fixtureFile(sql) {
  const dir = tmp('in');
  const path = join(dir, 'backup.sql');
  writeFileSync(path, sql);
  return path;
}

/** The pre-D7142 manifest: the frozen describe() on readFileSync, the frozen streamed hash. */
async function oldBuildManifest(sqlPath, o) {
  return oldManifest.buildManifest(sqlPath, o);
}

/** Every file a split wrote, keyed by name, manifest.tsv with its directory made relative. */
function readSplit(dir) {
  const out = {};
  for (const f of readdirSync(dir).sort()) {
    let b = readFileSync(join(dir, f));
    if (f === 'manifest.tsv') b = Buffer.from(b.toString('utf8').split(`${dir}/`).join(''));
    out[f] = b;
  }
  return out;
}

function runSplit(script, input, chunkBytes) {
  const out = join(tmp('out'), 'chunks');
  const r = spawnSync(process.execPath, [script, input, out, String(chunkBytes)], { encoding: 'utf8' });
  return { out, r };
}

// ---------------------------------------------------------- golden ----

test('golden: the streamed manifest is byte-identical to the pre-D7142 manifest, at every read size', async () => {
  for (const [name, sql] of Object.entries(FIXTURES)) {
    const path = fixtureFile(sql);
    const want = JSON.stringify(await oldBuildManifest(path, OPTS), null, 2);
    for (const readBytes of READ_SIZES) {
      const got = JSON.stringify(await buildManifest(path, { ...OPTS, readBytes }), null, 2);
      assert.equal(got, want, `${name} at ${readBytes}-byte reads`);
    }
    assert.deepEqual(describe(sql), oldManifest.describe(sql), name);
  }
});

test('golden: the manifest CLI writes the same file the pre-D7142 CLI wrote', () => {
  for (const [name, sql] of Object.entries(FIXTURES)) {
    const path = fixtureFile(sql);
    const dir = tmp('m');
    const args = ['--key', OPTS.key, '--db', OPTS.db, '--exported-at', OPTS.exportedAt];
    const a = spawnSync(process.execPath, [MANIFEST, 'build', path, join(dir, 'new.json'), ...args], { encoding: 'utf8' });
    const b = spawnSync(process.execPath, [resolve(process.cwd(), 'frontend/test/fixtures/d7142_old_d1_backup_manifest.mjs'), 'build', path, join(dir, 'old.json'), ...args], { encoding: 'utf8' });
    assert.equal(a.status, 0, a.stderr);
    assert.equal(b.status, 0, b.stderr);
    assert.equal(a.stdout, b.stdout, name);
    assert.ok(readFileSync(join(dir, 'new.json')).equals(readFileSync(join(dir, 'old.json'))), `${name}: manifest bytes differ`);
  }
});

test('golden: the streamed split writes the same chunk files, in the same order, as the pre-D7142 split', async () => {
  for (const [name, sql] of Object.entries(FIXTURES)) {
    const path = fixtureFile(sql);
    for (const chunkBytes of [1024, 1_000_000]) {
      const old = runSplit(OLD_SPLIT, path, chunkBytes);
      const now = runSplit(SPLIT, path, chunkBytes);
      assert.equal(old.r.status, 0, old.r.stderr);
      assert.equal(now.r.status, 0, now.r.stderr);
      assert.equal(now.r.stdout, old.r.stdout, `${name}: the counts line differs`);
      const want = readSplit(old.out);
      assert.ok(Object.keys(want).length >= 3, `${name}: the old split wrote ${Object.keys(want).length} files`);
      assert.deepEqual(readSplit(now.out), want, `${name} at ${chunkBytes}-byte chunks`);
      // Every read size, through the same function the CLI calls.
      for (const readBytes of READ_SIZES) {
        const out = join(tmp('pf'), 'chunks');
        const { error } = await planFile(path, out, { chunkBytes, readBytes });
        assert.equal(error, null);
        assert.deepEqual(readSplit(out), want, `${name} at ${chunkBytes}-byte chunks, ${readBytes}-byte reads`);
      }
    }
    // The in-memory plan is still the old one, chunk for chunk.
    assert.deepEqual(planRestore(sql, { chunkBytes: 1024 }), oldSplit.planRestore(sql, { chunkBytes: 1024 }), name);
  }
});

test('golden: errors are reported at the same offset, in characters and bytes, and nothing is written', async () => {
  for (const sql of [
    "CREATE TABLE t (a);\nINSERT INTO t VALUES('é unterminated",
    'CREATE TABLE t (a);\n/* ☕ unterminated comment; ',
    'CREATE TABLE t (a);\nINSERT INTO [t VALUES(1);',
    "\uFEFFCREATE TABLE t (a);\nINSERT INTO t VALUES('a BOM before it",
  ]) {
    assert.deepEqual(splitStatements(sql), oldSplit.splitStatements(sql));
    assert.deepEqual(describe(sql), oldManifest.describe(sql));
    const path = fixtureFile(sql);
    const old = runSplit(OLD_SPLIT, path, 1024);
    const now = runSplit(SPLIT, path, 1024);
    assert.equal(now.r.status, 1);
    assert.equal(now.r.stderr, old.r.stderr);
    assert.match(now.r.stderr, /unterminated (quote|comment) at byte offset \d+/);
    assert.throws(() => readdirSync(now.out), /ENOENT/, 'a failed split wrote chunks');
    for (const readBytes of [1, 5]) {
      const r = await planFile(path, join(tmp('e'), 'chunks'), { readBytes });
      assert.equal(`dr-drill-split: ${r.error.reason} at byte offset ${r.errorByteOffset}\n`, old.r.stderr);
    }
  }
});

test('golden: bytes that are not UTF-8, and characters split between reads, decode as readFileSync decoded them', async () => {
  const bytes = Buffer.concat([
    Buffer.from('﻿CREATE TABLE t (a);\nINSERT INTO t VALUES(\'é😀'),
    Buffer.from([0xff, 0xc3, 0x28, 0xe2, 0x82, 0xf0, 0x9f, 0x98]),
    Buffer.from("');\nINSERT INTO t VALUES('ok');"),
  ]);
  const path = fixtureFile(bytes);
  const want = JSON.stringify(await oldBuildManifest(path, OPTS));
  const old = readSplit(runSplit(OLD_SPLIT, path, 1024).out);
  for (const readBytes of [1, 2, 3, 5]) {
    assert.equal(JSON.stringify(await buildManifest(path, { ...OPTS, readBytes })), want);
    const out = join(tmp('u'), 'chunks');
    await planFile(path, out, { chunkBytes: 1024, readBytes });
    assert.deepEqual(readSplit(out), old);
  }
});

/** A seeded generator, so a failure names the seed that found it. */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const PIECES = ["'", "''", '"', '""', '`', '[', ']', '-', '--', '/', '/*', '*/', '*', ';', '\n', ' ', 'a', 'é', '😀',
  'CREATE ', 'TEMP ', 'TRIGGER ', 'BEGIN ', 'CASE ', 'END ', 'END;', 'INSERT INTO t VALUES(', ')', ',', '1', 'x$_9'];

test('golden: random SQL fed in random pieces splits exactly as the old splitter split it', () => {
  for (let seed = 1; seed <= 3000; seed += 1) {
    const r = rng(seed);
    let sql = '';
    for (let k = Math.floor(r() * 60); k > 0; k -= 1) sql += PIECES[Math.floor(r() * PIECES.length)];
    const want = oldSplit.splitStatements(sql);
    const got = [];
    const s = new StatementSplitter((x) => got.push(x));
    for (let at = 0; at < sql.length;) { const n = 1 + Math.floor(r() * 6); s.push(sql.slice(at, at + n)); at += n; }
    const { error } = s.end();
    assert.deepEqual({ statements: got, error }, want, `seed ${seed}: ${JSON.stringify(sql)}`);
    if (error) assert.equal(s.errorByteOffset, Buffer.byteLength(sql.slice(0, error.offset)), `seed ${seed}`);
  }
});

// ------------------------------------------------ read boundaries ----

test('boundaries: a statement split across reads, and a ; inside a string, are each counted once', async () => {
  const sql = [
    'CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);',
    "INSERT INTO t VALUES(1,'a;b');",
    "INSERT INTO t VALUES(2,'it'';s');",
    "INSERT INTO t VALUES(3,'--;');",
    "INSERT INTO t (id, v)\nVALUES(\n  4,\n  'x;\ny'\n);",
  ].join('\n');
  const path = fixtureFile(sql);
  for (const readBytes of [1, 2, 3, 4, 5, 8, 13]) {
    const d = await describeFile(path, { readBytes });
    assert.equal(d.statements, 5, `${readBytes}-byte reads`);
    assert.deepEqual(d.tables.map((t) => [t.name, t.rows]), [['t', 4]], `${readBytes}-byte reads`);
  }
  // Each place a piece can end that needs the next piece to decide.
  const cut = (pieces) => {
    const out = [];
    const s = new StatementSplitter((x) => out.push(x));
    pieces.forEach((p) => s.push(p));
    return { out, ...s.end() };
  };
  assert.deepEqual(cut(["INSERT INTO t VALUES('it'", "'s; x');"]).out, ["INSERT INTO t VALUES('it''s; x');"], "a doubled quote split between reads");
  assert.deepEqual(cut(['SELECT 1;-', '- c;\nSELECT 2;']).out, ['SELECT 1;', 'SELECT 2;'], '-- split between reads');
  assert.deepEqual(cut(['SELECT 1;/', '* c; *', '/SELECT 2;']).out, ['SELECT 1;', 'SELECT 2;'], '/* and */ split between reads');
  assert.deepEqual(cut(['SELECT 1;/*', '/ c; */SELECT 2;']).out, ['SELECT 1;', 'SELECT 2;'], 'the opening * never closes its own comment');
  assert.deepEqual(cut(['CREATE TRIG', 'GER x AFTER INSERT ON t BEG', 'IN SELECT 1; END;']).out,
    ['CREATE TRIGGER x AFTER INSERT ON t BEGIN SELECT 1; END;'], 'a keyword split between reads');
  assert.deepEqual(cut(["SELECT 'a", ';', "b';"]).out, ["SELECT 'a;b';"], 'a ; inside a string, read on its own');
});

// ------------------------------------------------- bounded memory ----

/**
 * Write a synthetic export of at least `minBytes` to `path`, in pieces, and
 * return the manifest fields it must produce. Each round writes one user row
 * (a string holding ;, a newline, -- and a block comment), one multi-line note row of
 * about 1 KiB of multi-byte text, and a comment holding a semicolon.
 */
function writeExport(path, minBytes) {
  const fd = openSync(path, 'w');
  let size = 0;
  let statements = 0;
  const put = (text, n = 0) => { const b = Buffer.from(text); writeSync(fd, b); size += b.length; statements += n; };
  put('PRAGMA defer_foreign_keys=TRUE;\n', 1);
  put('CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, checksum TEXT, applied_at TEXT);\n', 1);
  put("INSERT INTO \"schema_migrations\" VALUES('001_a.sql','c','x');\nINSERT INTO \"schema_migrations\" VALUES('202611180000_7142_stream.sql','c','y');\n", 2);
  put('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\n', 1);
  put('CREATE TABLE notes (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), body TEXT);\n', 1);
  const body = 'Zoë; ☕ '.repeat(120);
  let rows = 0;
  let batch = [];
  let batchBytes = 0;
  while (size + batchBytes < minBytes) {
    rows += 1;
    const round = `INSERT INTO "users" VALUES(${rows},'it''s; row ${rows}\n-- not a comment /* nor this */');\n`
      + `INSERT INTO "notes" ("id","user_id","body")\nVALUES(\n  ${rows},\n  ${rows},\n  '${body}'\n);\n`
      + '-- a comment; with a semicolon\n';
    batch.push(round);
    batchBytes += Buffer.byteLength(round);
    if (batchBytes > 1 << 20) { put(batch.join(''), 2 * batch.length); batch = []; batchBytes = 0; }
  }
  put(batch.join(''), 2 * batch.length);
  put('CREATE INDEX idx_notes_user ON notes(user_id);\n', 1);
  put("CREATE TRIGGER trg AFTER INSERT ON users BEGIN INSERT INTO notes VALUES (NEW.id, NEW.id, 'x;y'); END;\n", 1);
  closeSync(fd);
  return {
    size,
    rows,
    statements,
    tables: [
      { name: 'notes', rows, references: ['users'] },
      { name: 'schema_migrations', rows: 2, references: [] },
      { name: 'users', rows, references: [] },
    ],
    migrations: { ledger: 'schema_migrations', count: 2, last: '202611180000_7142_stream.sql' },
  };
}

/** Run `code` (an ES module body) in a child Node with a heap cap; its last stdout line is JSON. */
function capped(heapMb, code) {
  const r = spawnSync(process.execPath, [`--max-old-space-size=${heapMb}`, '--input-type=module', '-e', code], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const last = r.stdout.trim().split('\n').at(-1) || 'null';
  return { status: r.status, stderr: r.stderr, out: r.status === 0 ? JSON.parse(last) : null };
}
const manifestIn = (path) => `const m = await import(${JSON.stringify(pathToFileURL(MANIFEST).href)});
const r = await m.buildManifest(${JSON.stringify(path)}, ${JSON.stringify(OPTS)});
console.log(JSON.stringify({ r, maxRssKb: process.resourceUsage().maxRSS }));`;
const splitIn = (path, out) => `const m = await import(${JSON.stringify(pathToFileURL(SPLIT).href)});
const r = await m.planFile(${JSON.stringify(path)}, ${JSON.stringify(out)});
console.log(JSON.stringify({ r, maxRssKb: process.resourceUsage().maxRSS }));`;
const oldManifestIn = (path) => `const m = await import(${JSON.stringify(pathToFileURL(resolve(process.cwd(), 'frontend/test/fixtures/d7142_old_d1_backup_manifest.mjs')).href)});
await m.buildManifest(${JSON.stringify(path)}, ${JSON.stringify(OPTS)});
console.log('null');`;

function proveBounded(minBytes, heapMb, { old = false } = {}) {
  const dir = tmp('big');
  const path = join(dir, 'backup.sql');
  try {
    const want = writeExport(path, minBytes);
    assert.equal(statSync(path).size, want.size);
    if (old) {
      const o = capped(heapMb, oldManifestIn(path));
      assert.notEqual(o.status, 0, 'the old manifest read this export under the cap, so the cap proves nothing');
    }
    const m = capped(heapMb, manifestIn(path));
    assert.equal(m.status, 0, m.stderr.slice(-2000));
    assert.equal(m.out.r.size_bytes, want.size);
    assert.equal(m.out.r.statements, want.statements);
    assert.deepEqual(m.out.r.tables, want.tables);
    assert.deepEqual(m.out.r.migrations, want.migrations);
    const out = join(dir, 'chunks');
    const s = capped(heapMb, splitIn(path, out));
    assert.equal(s.status, 0, s.stderr.slice(-2000));
    assert.equal(s.out.r.error, null);
    const c = s.out.r.counts;
    assert.deepEqual([c.statements, c.data, c.schema, c.post, c.dropped_pragma], [want.statements, 2 * want.rows + 2, 3, 2, 1]);
    const tsv = readFileSync(join(out, 'manifest.tsv'), 'utf8').trim().split('\n').map((l) => l.split('\t'));
    assert.equal(tsv.length, c.chunks);
    assert.equal(tsv.reduce((a, l) => a + Number(l[2]), 0), want.statements - 1, 'every statement but the PRAGMA is in a chunk');
    // users before notes: the parent's rows are restored first (the two may
    // share the one chunk where users ends and notes begins).
    const firstNote = tsv.findIndex((l) => readFileSync(l[0], 'utf8').includes('INSERT INTO "notes"'));
    const lastUser = tsv.findLastIndex((l) => readFileSync(l[0], 'utf8').includes('INSERT INTO "users"'));
    assert.ok(firstNote > 0 && lastUser <= firstNote, `the last users chunk is ${lastUser}, the first notes chunk ${firstNote}`);
    return { size: want.size, manifestRssKb: m.out.maxRssKb, splitRssKb: s.out.maxRssKb };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('bounded memory: a 96 MiB export is described and split under a 48 MiB heap the old code cannot fit it in', () => {
  const r = proveBounded(96 << 20, 48, { old: true });
  assert.ok(r.manifestRssKb < 160 << 10, `manifest peak RSS ${r.manifestRssKb} KiB`);
  assert.ok(r.splitRssKb < 160 << 10, `split peak RSS ${r.splitRssKb} KiB`);
});

test('bounded memory: a >600 MiB export, past Node\'s string limit, under --max-old-space-size=512 (D7142_LARGE=1)', { skip: process.env.D7142_LARGE !== '1' && 'set D7142_LARGE=1 to write and read a 600+ MiB export' }, () => {
  const r = proveBounded(601 << 20, 512);
  assert.ok(r.size > 600 << 20);
  assert.ok(r.size > 536_870_888, 'the export is past the longest string Node can hold');
  console.log(`D7142 large: ${r.size} bytes; peak RSS manifest ${r.manifestRssKb} KiB, split ${r.splitRssKb} KiB`);
});
