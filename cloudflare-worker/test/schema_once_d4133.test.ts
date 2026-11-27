/**
 * D4133 (#4133) — the test schema built once per run (`_schema_once.mjs`).
 *
 *  · a database filled by `loadSchema` equals a fresh build: every
 *    `sqlite_schema` row, every table's rows and `sqlite_sequence`;
 *  · `copySchemaTo` gives a file equal to a fresh build;
 *  · a changed migration (or a different `below`) changes the key, so a stale
 *    file is never served;
 *  · two processes racing the first build both get a complete file.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/schema_once_d4133.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_OPTIONS, buildSchema, copySchemaTo, loadSchema, schemaKey, schemaPath } from './_schema_once.mjs';
import { compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HELPER = fileURLToPath(new URL('./_schema_once.mjs', import.meta.url));
const SQL = fileURLToPath(new URL('../sql/', import.meta.url));

/** Every schema object and every row, in an order that does not depend on how the file was built. */
function snapshot(db: InstanceType<typeof DatabaseSync>) {
  const objects = (db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_autoindex%' ORDER BY type, name").all() as any[]);
  const tables = objects.filter((o) => o.type === 'table').map((o) => o.name as string);
  const rows: Record<string, string> = {};
  for (const t of tables) {
    const all = db.prepare(`SELECT * FROM "${t.replace(/"/g, '""')}"`).all();
    rows[t] = JSON.stringify(all.map((r) => JSON.stringify(r)).sort());
  }
  return { objects: JSON.stringify(objects), rows };
}

test('a database filled by loadSchema equals a fresh build: every schema row, and every row the build wrote', () => {
  // Mutation checked: the row copy removed → the seeded tables differ; the trigger pass removed → the triggers differ;
  // the sqlite_sequence copy removed → sqlite_sequence differs.
  // Two builds never write identical rows: migrations stamp created_at with the clock and draw random uids. So the
  // schema is held to a fresh build, the rows to the cached file they were copied from, and each table's row count
  // to a fresh build.
  const dir = mkdtempSync(join(tmpdir(), 'schema-once-eq-'));
  try {
    const fresh = join(dir, 'fresh.sqlite');
    buildSchema(fresh);
    const a = new DatabaseSync(fresh, SCHEMA_OPTIONS);
    const cached = new DatabaseSync(schemaPath(), { readOnly: true });
    const b = loadSchema(new DatabaseSync(':memory:', SCHEMA_OPTIONS));
    const sa = snapshot(a);
    const sc = snapshot(cached);
    const sb = snapshot(b);
    assert.ok(JSON.parse(sa.objects).length > 500, 'the whole schema is there');
    assert.equal(sb.objects, sa.objects, 'the same sqlite_schema rows as a fresh build');
    assert.equal(sc.objects, sa.objects, 'the cached file is the same schema too');
    assert.ok(Object.values(sc.rows).some((v) => v !== '[]'), 'some migrations seed rows, and those rows are compared');
    assert.deepEqual(sb.rows, sc.rows, 'every row, sqlite_sequence included, as the cached build wrote it');
    const counts = (snap: { rows: Record<string, string> }) => Object.fromEntries(Object.entries(snap.rows).map(([k, v]) => [k, JSON.parse(v).length]));
    assert.deepEqual(counts(sb), counts(sa), 'the same number of rows in every table as a fresh build');
    // The file form is the cached build itself.
    const c = new DatabaseSync(copySchemaTo(join(dir, 'copy.sqlite')), SCHEMA_OPTIONS);
    assert.deepEqual(snapshot(c), sc);
    a.close(); b.close(); c.close(); cached.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('loadSchema keeps the options the test opened its handle with, and a copy is the test\'s own', () => {
  const a = loadSchema(new DatabaseSync(':memory:', { enableForeignKeyConstraints: true }));
  assert.equal((a.prepare('PRAGMA foreign_keys').get() as any).foreign_keys, 1);
  a.exec('CREATE TABLE only_in_this_copy (id INTEGER)');
  const b = loadSchema(new DatabaseSync(':memory:', SCHEMA_OPTIONS));
  assert.equal(b.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'only_in_this_copy'").get(), undefined);
  a.close(); b.close();
});

test('a changed migration, a new migration or another bound changes the key', () => {
  // Mutation checked: the migration bytes left out of the hash → the edited copy keeps the key.
  const dir = mkdtempSync(join(tmpdir(), 'schema-once-key-'));
  try {
    cpSync(SQL, dir, { recursive: true, filter: (p) => !p.includes('/historical') });
    const base = schemaKey({ sqlDir: dir });
    assert.equal(schemaKey({ sqlDir: dir }), base, 'the same inputs, the same key');
    const last = readdirSync(join(dir, 'migrations')).filter((n) => n.endsWith('.sql')).sort(compareMigrations).at(-1)!;
    appendFileSync(join(dir, 'migrations', last), '\n-- one more line\n');
    const edited = schemaKey({ sqlDir: dir });
    assert.notEqual(edited, base, 'an edited migration is a new build');
    writeFileSync(join(dir, 'migrations', '202611021015_probe.sql'), 'CREATE TABLE IF NOT EXISTS probe_4133 (id INTEGER);');
    assert.notEqual(schemaKey({ sqlDir: dir }), edited, 'an added migration is a new build');
    assert.notEqual(schemaKey({ below: 400 }), schemaKey(), 'a bounded schema is its own file');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('two processes racing the first build both get a complete file', async () => {
  // Mutation checked: writing in place instead of tmp + rename → a waiter can open a half-written file.
  const cache = mkdtempSync(join(tmpdir(), 'schema-once-race-'));
  try {
    const script = `import { schemaPath } from ${JSON.stringify(HELPER)};
      import { DatabaseSync } from 'node:sqlite';
      const p = schemaPath({ below: 300, cacheDir: ${JSON.stringify(cache)} });
      const db = new DatabaseSync(p, { readOnly: true });
      const ok = db.prepare('PRAGMA integrity_check').get().integrity_check;
      const n = db.prepare('SELECT COUNT(*) AS n FROM sqlite_schema').get().n;
      console.log(JSON.stringify({ p, ok, n }));`;
    const run = () => new Promise<any>((res, rej) => {
      const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; let err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('close', (code) => (code === 0 ? res(JSON.parse(out.trim().split('\n').at(-1)!)) : rej(new Error(err))));
    });
    const [x, y] = await Promise.all([run(), run()]);
    assert.equal(x.p, y.p, 'one file for one key');
    assert.equal(x.ok, 'ok');
    assert.equal(y.ok, 'ok');
    assert.equal(x.n, y.n);
    assert.ok(x.n > 100);
    assert.deepEqual(readdirSync(cache).filter((n) => n.startsWith('build-') || n.endsWith('.lock')), [], 'no build directory or lock is left behind');
    assert.equal(schemaPath({ below: 300, cacheDir: cache }), x.p, 'a later call reuses it');
  } finally { rmSync(cache, { recursive: true, force: true }); }
});
