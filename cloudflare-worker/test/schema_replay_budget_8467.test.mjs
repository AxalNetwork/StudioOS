/**
 * D8467 (#8467) — the schema replay budget: a Worker test file may execute one
 * migration chain's worth of whole migration files, and no more.
 *
 * Holds `_schema_budget.mjs` to its rule on a small chain of its own, checks
 * the list of files allowed over budget, and checks that the loader every
 * Worker test runs through installs it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/schema_replay_budget_8467.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHAINS, LIST, chain, install, overBudgetMessage, parseList, replayBudget, testFileOf } from './_schema_budget.mjs';
import { schemaInputs } from './_schema_once.mjs';
import { BASELINE_CUTOFF } from '../../scripts/lib/migrationPlan.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ME = 'cloudflare-worker/test/some_feature_d1.test.ts';
const above = (n) => BASELINE_CUTOFF + n;

/** A checkout in miniature: three migrations above the cutoff, one below, and the list. */
function world(t, { listed = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'schema-budget-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sqlDir = join(root, 'cloudflare-worker/sql');
  mkdirSync(join(sqlDir, 'migrations'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  const files = {
    [`${above(1)}_a.sql`]: 'CREATE TABLE a (id INTEGER);',
    [`${above(2)}_b.sql`]: 'CREATE TABLE b (id INTEGER);',
    [`${above(3)}_c.sql`]: "CREATE TABLE cc (n TEXT DEFAULT 'café');\n",
    [`${BASELINE_CUTOFF}_old.sql`]: 'CREATE TABLE old (id INTEGER PRIMARY KEY);',
    'notes.txt': 'CREATE TABLE notes (id INTEGER);',
  };
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(sqlDir, 'migrations', name), sql);
  writeFileSync(join(root, LIST), `# files over budget\n${listed.join('\n')}\n`);
  const sql = Object.fromEntries(Object.entries(files).map(([name, text]) => [name.replace(/^\d+_|\.\w+$/g, ''), text]));
  return { root, sqlDir, sql };
}

/** One whole build of the miniature chain. */
const full = (db, sql) => { for (const s of [sql.a, sql.b, sql.c]) db.exec(s); };

/** A stand-in for DatabaseSync that records what reached it. */
function fakeDatabase() {
  class Database {
    constructor() { this.ran = []; }
    exec(sql, extra) { this.ran.push(extra === undefined ? sql : [sql, extra]); return 'ran'; }
  }
  return Database;
}

function fakeProcess() {
  const handlers = [];
  return { exitCode: undefined, on(event, fn) { assert.equal(event, 'exit'); handlers.push(fn); }, exit() { for (const fn of handlers) fn(); } };
}

const setup = (t, { listed, env = {} } = {}) => {
  const w = world(t, { listed });
  const argv = ['node', join(w.root, ME)];
  const Database = fakeDatabase();
  const proc = fakeProcess();
  const logged = [];
  const budget = install({ Database, argv, env, root: w.root, sqlDir: w.sqlDir, proc, log: (line) => logged.push(line) });
  return { ...w, Database, proc, budget, logged, db: new Database() };
};

test('the chain is the numbered migrations above the cutoff, matched by exact text', (t) => {
  const { sqlDir, sql } = world(t);
  const { count, isMigration } = chain(sqlDir);
  assert.equal(count, 3);
  assert.equal(isMigration(sql.a), true);
  assert.equal(isMigration(sql.c), true, 'sizes are bytes: this one holds a two-byte character');
  assert.equal(isMigration('CREATE TABLE z (id INTEGER);'), false, 'the same length as a migration, a different text');
  assert.equal(isMigration(sql.old), false, 'at the cutoff: the baseline already holds it');
  assert.equal(isMigration(sql.notes), false, 'not a migration file');
  assert.equal(isMigration(''), false);
});

test('the real chain is the one the shared build applies', () => {
  const { migrations } = schemaInputs();
  const { count, isMigration } = chain();
  assert.equal(count, migrations.length);
  assert.ok(count > 500, 'the migrations directory was read');
  assert.equal(isMigration(migrations.at(-1).sql), true);
  assert.equal(isMigration(`${migrations.at(-1).sql} `), false);
});

test('two chains are allowed; every whole migration past them is refused', () => {
  assert.equal(CHAINS, 2, 'one build, and as much again for cuts and replayed migrations');
  const asked = [];
  const budget = replayBudget({ count: 3, isMigration: (sql) => sql.startsWith('M'), shared: () => false, listed: () => { asked.push(budget.replayed); return false; } });
  assert.deepEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6'].map((sql) => budget.note(sql)), [false, false, false, false, false, false]);
  assert.deepEqual(asked, [], 'the list is not read while the file is within budget');
  assert.equal(budget.note('SELECT 1'), false);
  assert.equal(budget.note(undefined), false);
  assert.equal(budget.note({ toString: () => 'M9' }), false, 'only strings are SQL');
  assert.equal(budget.replayed, 6);
  assert.equal(budget.note('M7'), true);
  assert.equal(budget.note('M8'), true, 'still refused after the first refusal');
  assert.deepEqual(asked, [7], 'the list is read once, on the first execution past the budget');
  assert.equal(budget.replayed, 8);
});

test('a listed file is counted and never refused; the shared build is not counted', () => {
  const listed = replayBudget({ count: 1, isMigration: () => true, shared: () => false, listed: () => true });
  assert.deepEqual([listed.note('M'), listed.note('M'), listed.note('M')], [false, false, false]);
  assert.equal(listed.replayed, 3);
  let shared = true;
  const budget = replayBudget({ count: 1, isMigration: () => true, shared: () => shared, listed: () => false });
  assert.deepEqual([budget.note('M'), budget.note('M'), budget.note('M')], [false, false, false]);
  assert.equal(budget.replayed, 0);
  shared = false;
  assert.deepEqual([budget.note('M'), budget.note('M'), budget.note('M')], [false, false, true]);
});

test('the test file is read from the command line, whatever form its path takes', () => {
  assert.equal(testFileOf(['node', ME], ROOT), ME);
  assert.equal(testFileOf(['node', join(ROOT, ME)], ROOT), ME);
  assert.equal(testFileOf(['node', '--test', 'cloudflare-worker/test/x.test.mjs'], ROOT), 'cloudflare-worker/test/x.test.mjs');
  assert.equal(testFileOf([ME], ROOT), null, 'the first argument is the executable');
  assert.equal(testFileOf(['node', 'frontend/test/x.test.mjs'], ROOT), null);
  assert.equal(testFileOf(['node', 'cloudflare-worker/test/deeper/x.test.ts'], ROOT), null);
  assert.equal(testFileOf(['node', 'scripts/d1-benchmark.mjs'], ROOT), null);
  assert.equal(testFileOf(['node', 'cloudflare-worker/test/_fixture.ts'], ROOT), null);
});

test('installed: SQL passes through untouched, and the call past two chains throws without running', (t) => {
  const { db, sql, proc, budget, logged } = setup(t);
  assert.equal(db.exec('SELECT 1'), 'ran');
  assert.equal(db.exec(sql.a, 'second argument'), 'ran');
  db.exec(sql.b); db.exec(sql.c);
  db.exec(sql.old); db.exec('CREATE TABLE z (id INTEGER);');
  assert.equal(budget.replayed, 3);
  full(db, sql);
  assert.equal(budget.replayed, 6);
  assert.throws(() => db.exec(sql.a), (error) => {
    assert.equal(error.message, overBudgetMessage({ file: ME, replayed: 7, count: 3 }));
    return true;
  });
  assert.throws(() => db.exec(sql.b), /has executed 8 whole migration files/);
  assert.deepEqual(db.ran, ['SELECT 1', [sql.a, 'second argument'], sql.b, sql.c, sql.old, 'CREATE TABLE z (id INTEGER);', sql.a, sql.b, sql.c]);
  assert.equal(db.exec('SELECT 2'), 'ran', 'other SQL still runs');
  assert.equal(proc.exitCode, undefined);
  assert.deepEqual(logged, []);
  proc.exit();
  assert.equal(proc.exitCode, 1, 'a fixture that swallowed the error still fails its file');
  assert.deepEqual(logged, [`✖ ${overBudgetMessage({ file: ME, replayed: 8, count: 3 })}`]);
});

test('the message says what the file did and what to do instead', () => {
  const message = overBudgetMessage({ file: ME, replayed: 769, count: 768 });
  assert.ok(message.startsWith(`${ME} has executed 769 whole migration files in this process; one build of the schema is 768.`));
  assert.match(message, /may execute 2 builds' worth/);
  for (const part of ['freshSchema()', 'loadSchema(db)', 'openSchema()', '{ below: N }', "'./_schema_once.mjs'", LIST, 'D8467']) assert.ok(message.includes(part), part);
});

test('a file within budget leaves the exit code alone', (t) => {
  const { db, sql, proc, logged } = setup(t);
  full(db, sql); full(db, sql);
  proc.exit();
  assert.equal(proc.exitCode, undefined);
  assert.deepEqual(logged, []);
});

test('a failing file keeps its own exit code', (t) => {
  const { db, sql, proc, logged } = setup(t);
  full(db, sql); full(db, sql);
  assert.throws(() => db.exec(sql.a));
  proc.exitCode = 7;
  proc.exit();
  assert.equal(proc.exitCode, 7);
  assert.deepEqual(logged, [], 'the test failure already says why');
});

test('a listed file may replay the chain as often as it does today', (t) => {
  const { db, sql, proc, budget } = setup(t, { listed: ['cloudflare-worker/test/other.test.ts', `${ME}  # about the build itself`] });
  for (let i = 0; i < 4; i += 1) for (const s of [sql.a, sql.b, sql.c]) assert.equal(db.exec(s), 'ran');
  assert.equal(budget.replayed, 12);
  assert.equal(db.ran.length, 12);
  proc.exit();
  assert.equal(proc.exitCode, undefined);
});

test('a file named only in a comment of the list is not listed', (t) => {
  const { db, sql } = setup(t, { listed: [`# ${ME}`, `cloudflare-worker/test/other.test.ts # not ${ME}`] });
  full(db, sql); full(db, sql);
  assert.throws(() => db.exec(sql.a), /whole migration files/);
});

test('report mode stops nothing and writes the count when the process ends', (t) => {
  const out = join(mkdtempSync(join(tmpdir(), 'schema-budget-report-')), 'report.jsonl');
  t.after(() => rmSync(join(out, '..'), { recursive: true, force: true }));
  const { db, sql, proc } = setup(t, { env: { SCHEMA_REPLAY_REPORT: out } });
  for (let i = 0; i < 3; i += 1) for (const s of [sql.a, sql.b, sql.c]) assert.equal(db.exec(s), 'ran');
  assert.equal(existsSync(out), false);
  proc.exit();
  assert.equal(proc.exitCode, undefined);
  assert.deepEqual(readFileSync(out, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)), [{ file: ME, replayed: 9, chain: 3 }]);
});

test('a process that executes no SQL reports nothing and reads no migration', (t) => {
  const out = join(mkdtempSync(join(tmpdir(), 'schema-budget-report-')), 'report.jsonl');
  t.after(() => rmSync(join(out, '..'), { recursive: true, force: true }));
  const { proc, budget } = setup(t, { env: { SCHEMA_REPLAY_REPORT: out } });
  assert.equal(budget.replayed, 0);
  proc.exit();
  assert.equal(existsSync(out), false);
});

test('it installs once, and only for a Worker test file', (t) => {
  const { Database, root, sqlDir, sql } = setup(t);
  const wrapped = Database.prototype.exec;
  assert.equal(install({ Database, argv: ['node', join(root, ME)], env: {}, root, sqlDir, proc: fakeProcess() }), null);
  assert.equal(Database.prototype.exec, wrapped, 'a second install does not wrap the wrapper');
  const Other = fakeDatabase();
  const plain = Other.prototype.exec;
  assert.equal(install({ Database: Other, argv: ['node', join(root, 'scripts/d1-benchmark.mjs')], env: {}, root, sqlDir, proc: fakeProcess() }), null);
  assert.equal(Other.prototype.exec, plain);
  const db = new Other();
  for (let i = 0; i < 3; i += 1) for (const s of [sql.a, sql.b, sql.c]) db.exec(s);
  assert.equal(db.ran.length, 9);
});

test('a build made by the shared helper is not counted against the file', async (t) => {
  const { db, sql, budget, root } = setup(t);
  // The exemption is by caller: a module with the helper's file name, executing the same texts.
  const helper = join(root, '_schema_once.mjs');
  writeFileSync(helper, 'export const build = (db, texts) => { for (const sql of texts) db.exec(sql); };\n');
  const { build } = await import(pathToFileURL(helper).href);
  for (let i = 0; i < 3; i += 1) build(db, [sql.a, sql.b, sql.c]);
  assert.equal(budget.replayed, 0);
  assert.equal(db.ran.length, 9);
  full(db, sql); full(db, sql);
  assert.throws(() => db.exec(sql.a), /whole migration files/, 'the file\'s own chains still count');
});

test('the list names Worker test files that exist, each once, in order', () => {
  const entries = parseList(readFileSync(join(ROOT, LIST), 'utf8'));
  assert.ok(entries.length > 0);
  assert.deepEqual(entries, [...new Set(entries)].sort(), 'sorted, no duplicates');
  for (const entry of entries) {
    assert.equal(testFileOf(['node', entry], ROOT), entry, `${entry} is not a Worker test file path`);
    assert.ok(existsSync(join(ROOT, entry)), `${entry} is listed in ${LIST} and does not exist`);
  }
});

test('every Worker test process carries the budget: the loader imports it', () => {
  const loader = readFileSync(join(ROOT, 'cloudflare-worker/test/_ts-loader.mjs'), 'utf8');
  assert.match(loader, /^import '\.\/_schema_budget\.mjs';$/m);
  assert.equal(DatabaseSync.prototype[Symbol.for('studioos.schemaReplayBudget')], true, 'installed in this process');
  assert.equal(DatabaseSync.prototype.exec.name, 'execWithinBudget');
});
