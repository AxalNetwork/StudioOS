/** D5503 (#5503): cache adoption retains migration failures and isolated rows. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BASELINE_CUTOFF } from '../../scripts/lib/migrationPlan.mjs';
import { loadSchema, openSchema, schemaPath } from './_schema_once.mjs';

const exec = promisify(execFile);
function fixture(duplicate = false) {
  const dir = mkdtempSync(join(tmpdir(), 'schema-adoption-5503-'));
  mkdirSync(join(dir, 'migrations'));
  writeFileSync(join(dir, 'schema_baseline.sql'), `CREATE TABLE sample (id INTEGER PRIMARY KEY, label TEXT${duplicate ? ', applied INTEGER DEFAULT 0' : ''}); INSERT INTO sample VALUES (1, 'seed'${duplicate ? ', 0' : ''});`);
  // A synthetic post-cutoff migration, never a production migration file.
  writeFileSync(join(dir, 'migrations', `${BASELINE_CUTOFF + 1}_fixture.sql`), 'ALTER TABLE sample ADD COLUMN applied INTEGER DEFAULT 0; UPDATE sample SET applied = applied + 1;');
  return { dir, opts: { sqlDir: dir, cacheDir: join(dir, 'cache') } };
}

test('a post-baseline migration applies once across warm loads; missing objects are errors', () => {
  const { dir, opts } = fixture();
  const a = new DatabaseSync(':memory:'); const b = new DatabaseSync(':memory:');
  try {
    loadSchema(a, opts); loadSchema(b, opts);
    assert.deepEqual([a, b].map(db => db.prepare('SELECT applied FROM sample').get()?.applied), [1, 1]);
    a.exec('ALTER TABLE sample DROP COLUMN applied');
    assert.throws(() => a.prepare('SELECT applied FROM sample').all(), /no such column/);
    a.exec('DROP TABLE sample');
    assert.throws(() => a.prepare('SELECT * FROM sample').all(), /no such table/);
    assert.equal(b.prepare('SELECT applied FROM sample').get()?.applied, 1);
  } finally { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('baseline/migration overlap fails rehearsal rather than being swallowed', () => {
  const { dir, opts } = fixture(true);
  try { assert.throws(() => schemaPath(opts), /duplicate column/); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('private cached handles preserve options and remove only their own file on close', () => {
  const { dir, opts } = fixture();
  const a = openSchema(opts, { enableForeignKeyConstraints: true });
  const b = openSchema(opts);
  const file = (db: DatabaseSync) => (db.prepare('PRAGMA database_list').get() as any).file;
  const aFile = file(a), bFile = file(b);
  try {
    assert.notEqual(aFile, bFile);
    assert.equal((a.prepare('PRAGMA foreign_keys').get() as any).foreign_keys, 1);
    a.exec("INSERT INTO sample(id,label) VALUES (2,'private')");
    assert.deepEqual(b.prepare('SELECT label FROM sample ORDER BY id').all().map(row => row.label), ['seed']);
    a.close();
    assert.equal(existsSync(aFile), false);
    assert.equal(existsSync(bFile), true);
    assert.equal(existsSync(schemaPath(opts)), true);
  } finally { if (existsSync(aFile)) a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('parallel processes load private row copies from the same cold cache', async () => {
  const { dir, opts } = fixture();
  try {
    const helper = new URL('./_schema_once.mjs', import.meta.url).href;
    const code = `import { DatabaseSync } from 'node:sqlite'; import { loadSchema } from ${JSON.stringify(helper)};
      const db = loadSchema(new DatabaseSync(':memory:'), ${JSON.stringify(opts)});
      db.prepare('INSERT INTO sample (id,label) VALUES (2,?)').run(process.argv[1]);
      console.log(JSON.stringify(db.prepare('SELECT label FROM sample ORDER BY id').all().map(row => row.label))); db.close();`;
    const rows = await Promise.all(['left', 'right'].map(async label => {
      const result = await exec(process.execPath, ['--no-warnings', '--input-type=module', '-e', code, label]);
      return JSON.parse(result.stdout);
    }));
    assert.deepEqual(rows, [['seed', 'left'], ['seed', 'right']]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('process teardown removes an unclosed fixture without deleting the cache', async () => {
  const { dir, opts } = fixture();
  try {
    const helper = new URL('./_schema_once.mjs', import.meta.url).href;
    const code = `import { openSchema } from ${JSON.stringify(helper)};
      const db = openSchema(${JSON.stringify(opts)}); console.log(db.prepare('PRAGMA database_list').get().file);`;
    const { stdout } = await exec(process.execPath, ['--no-warnings', '--input-type=module', '-e', code]);
    assert.equal(existsSync(stdout.trim()), false);
    assert.equal(existsSync(schemaPath(opts)), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
