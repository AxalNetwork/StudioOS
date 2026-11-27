// D8936 (#8936) — the migration runner adopts columns the Worker's runtime DDL
// already added, and nothing else.
//
// Production deploys from 2026-11-21 on failed at
// `202611191833_7707_market_intel_row_dates_runs.sql` with
// `duplicate column name: observed_period`: services/market_intel/schema.ts had
// added the file's six columns at runtime, and the ledger did not record the
// file. 7708 (market_intel_indexes) and 8522 (ai_usage_logs) wait behind it in
// the same shape. These tests run the three real files, byte for byte, through
// the same `planActions` → `applyPlan` loop the CLI ships, with the same
// `withPresentColumnAdoption` wrapper, against a real SQLite engine.
//
// The engine's `exec` mirrors D1's `--file`: the file runs inside one
// savepoint and rolls back whole on its first error, so after a failure
// nothing of the file has landed (DEPLOY.md §4(c)). Without that, a node:sqlite
// `exec` would leave the statements before the failing one applied, which D1
// never does, and the tests would model the wrong database.
//
// Run:
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/migrate_d1_present_columns_8936.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LEDGER_DDL,
  LEDGER_TABLE,
  listMigrationFiles,
  planActions,
  applyPlan,
  expectedEffects,
} from '../../scripts/lib/migrationPlan.mjs';
import {
  withPresentColumnAdoption,
  planAdoption,
  predictAdoptions,
  splitMigration,
  parseAddColumn,
  isDuplicateColumnError,
} from '../../scripts/lib/migrationAdopt.mjs';
import { tableFromBaseline } from './_baseline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SQL = path.join(HERE, '..', 'sql');
const REAL_MIGRATIONS = path.join(SQL, 'migrations');
const BASELINE = fs.readFileSync(path.join(SQL, 'schema_baseline.sql'), 'utf8');

const F7707 = '202611191833_7707_market_intel_row_dates_runs.sql';
const F7708 = '202611220337_7708_market_intel_index_window.sql';
const F8522 = '202611250054_8522_usage_contract_columns.sql';
const real = (name: string) => fs.readFileSync(path.join(REAL_MIGRATIONS, name), 'utf8');

// What the Worker ran at runtime: services/market_intel/schema.ts (7707, 7708)
// and services/aiRouter.ts (8522) issue these exact statements.
const RUNTIME_DDL: Record<string, string[]> = {
  [F7707]: [
    'ALTER TABLE market_intel_rows ADD COLUMN observed_period TEXT',
    'ALTER TABLE market_intel_rows ADD COLUMN observed_period_end TEXT',
    'ALTER TABLE market_intel_rows ADD COLUMN published_at TEXT',
    'ALTER TABLE market_intel_rows ADD COLUMN retrieved_at TEXT',
    'ALTER TABLE market_intel_rows ADD COLUMN coverage_area TEXT',
    "ALTER TABLE market_intel_rows ADD COLUMN scope TEXT CHECK (scope IS NULL OR scope IN ('sector', 'context'))",
  ],
  [F7708]: [
    'ALTER TABLE market_intel_indexes ADD COLUMN window_start TEXT',
    'ALTER TABLE market_intel_indexes ADD COLUMN window_end TEXT',
    'ALTER TABLE market_intel_indexes ADD COLUMN source_mix_json TEXT',
  ],
  [F8522]: [
    'ALTER TABLE ai_usage_logs ADD COLUMN provider TEXT',
    'ALTER TABLE ai_usage_logs ADD COLUMN request_id TEXT',
    'ALTER TABLE ai_usage_logs ADD COLUMN tokens_reported INTEGER CHECK (tokens_reported IS NULL OR tokens_reported IN (0, 1))',
  ],
};

function tmpMigrations(fileMap: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-8936-'));
  for (const [name, sql] of Object.entries(fileMap)) fs.writeFileSync(path.join(dir, name), sql);
  return { dir, files: listMigrationFiles(dir) };
}

/** The three tables as the baseline declares them, before any of the three files. */
function productionTables(db: InstanceType<typeof DatabaseSync>) {
  for (const t of ['market_intel_rows', 'market_intel_indexes', 'ai_usage_logs']) db.exec(tableFromBaseline(BASELINE, t));
}

/** A node:sqlite runner engine whose `exec` is atomic per file, as D1's `--file` is. */
function makeEngine(db: InstanceType<typeof DatabaseSync>) {
  db.exec(LEDGER_DDL);
  const atomic = (sql: string) => {
    db.exec('SAVEPOINT migration_file');
    try {
      db.exec(sql);
      db.exec('RELEASE migration_file');
    } catch (e) {
      db.exec('ROLLBACK TO migration_file');
      db.exec('RELEASE migration_file');
      throw e;
    }
  };
  const calls = { exec: [] as string[], tableColumns: [] as string[], execStatements: [] as string[][] };
  return {
    calls,
    appliedSet() {
      const rows = db.prepare(`SELECT filename, checksum FROM ${LEDGER_TABLE}`).all() as { filename: string; checksum: string }[];
      return new Map(rows.map((r) => [r.filename, r.checksum]));
    },
    exec(file: { name: string; sql: string }) {
      calls.exec.push(file.name);
      atomic(file.sql);
    },
    tableColumns(t: string) {
      calls.tableColumns.push(t);
      const rows = db.prepare(`PRAGMA table_info(${t})`).all() as any[];
      return new Map(rows.map((r) => [String(r.name).toLowerCase(), r]));
    },
    execStatements(statements: string[]) {
      calls.execStatements.push(statements);
      atomic(statements.join('\n'));
    },
    record(file: { name: string; checksum: string }) {
      db.prepare(`INSERT OR REPLACE INTO ${LEDGER_TABLE} (filename, checksum, applied_at) VALUES (?, ?, datetime('now'))`)
        .run(file.name, file.checksum);
    },
  };
}

const exists = (db: InstanceType<typeof DatabaseSync>, name: string) =>
  db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(name) !== undefined;

function adopting(engine: ReturnType<typeof makeEngine>, logs: string[] = []) {
  return withPresentColumnAdoption(engine.exec, {
    tableColumns: engine.tableColumns,
    execStatements: engine.execStatements,
    log: (l: string) => logs.push(l),
  });
}

/** Production as of 2026-11-27: the runtime DDL ran, the ledger lacks all three files. */
function productionShape({ skip = [] as string[] } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  productionTables(db);
  for (const stmts of Object.values(RUNTIME_DDL)) for (const s of stmts) if (!skip.some((c) => s.includes(` ${c} `))) db.exec(s);
  // A value the Worker already wrote into an adopted column must survive.
  if (skip.length === 0) {
    db.exec("INSERT INTO ai_usage_logs (task, model, provider, request_id, tokens_reported) VALUES ('t', 'm', 'workers-ai', 'req-1', 1)");
  }
  const { dir, files } = tmpMigrations({ [F7707]: real(F7707), [F7708]: real(F7708), [F8522]: real(F8522) });
  return { db, dir, files, engine: makeEngine(db) };
}

test('reproduction: the plain runner fails on 7707 exactly as the production deploy did', () => {
  const { db, dir, files, engine } = productionShape();
  try {
    const res = applyPlan(planActions(files, engine.appliedSet(), { mode: 'apply' }), engine);
    assert.ok(res.failure, 'the unadopting runner must fail');
    assert.equal(res.failure!.file.name, F7707);
    assert.equal(res.failure!.phase, 'exec');
    assert.match(String(res.failure!.error.message), /duplicate column name: observed_period/);
    assert.equal(engine.appliedSet().size, 0, 'nothing is recorded');
    assert.equal(exists(db, 'market_intel_source_runs'), false, 'and nothing of the file landed');
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('adoption: 7707, 7708 and 8522 are adopted, the rest of 7707 runs, each is recorded like an apply', () => {
  const { db, dir, files, engine } = productionShape();
  try {
    const logs: string[] = [];
    const exec = adopting(engine, logs);
    const res = applyPlan(planActions(files, engine.appliedSet(), { mode: 'apply' }), { exec, record: engine.record });
    assert.equal(res.failure, null);
    assert.deepEqual(res.applied.map((a: any) => a.file.name), [F7707, F7708, F8522]);
    assert.deepEqual(exec.adopted.map((a: any) => [a.file.name, a.columns]), [
      [F7707, ['observed_period', 'observed_period_end', 'published_at', 'retrieved_at', 'coverage_area', 'scope'].map((c) => `market_intel_rows.${c}`)],
      [F7708, ['window_start', 'window_end', 'source_mix_json'].map((c) => `market_intel_indexes.${c}`)],
      [F8522, ['provider', 'request_id', 'tokens_reported'].map((c) => `ai_usage_logs.${c}`)],
    ]);
    // The rest of 7707 ran: the runs table and its index.
    assert.ok(exists(db, 'market_intel_source_runs'));
    assert.ok(exists(db, 'idx_mi_source_runs_source_started'));
    assert.deepEqual(engine.calls.execStatements.length, 1, 'only 7707 has statements beyond its ADD COLUMNs');
    assert.equal(engine.calls.execStatements[0].length, 2);
    assert.ok(engine.calls.execStatements[0].every((s) => !/ADD\s+COLUMN/i.test(s)), 'no ADD COLUMN is re-issued');
    // Recorded exactly as a normal apply records: the file's own checksum.
    const ledger = engine.appliedSet();
    for (const f of files) assert.equal(ledger.get(f.name), f.checksum, `${f.name} is recorded with its checksum`);
    // The Worker's values are untouched.
    assert.deepEqual({ ...(db.prepare('SELECT provider, request_id, tokens_reported FROM ai_usage_logs').get() as any) },
      { provider: 'workers-ai', request_id: 'req-1', tokens_reported: 1 });
    // The log names every present column.
    assert.match(logs.join('\n'), /market_intel_rows\.observed_period \(TEXT\)/);
    assert.match(logs.join('\n'), /ai_usage_logs\.tokens_reported \(INTEGER\)/);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a second run is a no-op: nothing is executed, read or adopted again', () => {
  const { db, dir, files, engine } = productionShape();
  try {
    applyPlan(planActions(files, engine.appliedSet(), { mode: 'apply' }), { exec: adopting(engine), record: engine.record });
    const before = { ...engine.calls, exec: [...engine.calls.exec], tableColumns: [...engine.calls.tableColumns] };
    const exec = adopting(engine);
    const res = applyPlan(planActions(files, engine.appliedSet(), { mode: 'apply' }), { exec, record: engine.record });
    assert.equal(res.failure, null);
    assert.equal(res.applied.length, 0);
    assert.equal(res.skipped.length, 3);
    assert.deepEqual(engine.calls.exec, before.exec);
    assert.deepEqual(engine.calls.tableColumns, before.tableColumns);
    assert.equal(exec.adopted.length, 0);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('partial state: one 7707 column absent fails exactly as before, nothing recorded or created', () => {
  const { db, dir, files, engine } = productionShape({ skip: ['observed_period_end'] });
  try {
    const exec = adopting(engine);
    const res = applyPlan(planActions(files, engine.appliedSet(), { mode: 'apply' }), { exec, record: engine.record });
    assert.ok(res.failure);
    assert.equal(res.failure!.file.name, F7707);
    const msg = String(res.failure!.error.message);
    assert.match(msg, /duplicate column name: observed_period/, 'the original error is kept');
    assert.match(msg, /partial state: market_intel_rows\.observed_period_end is absent/);
    assert.equal(engine.appliedSet().size, 0);
    assert.equal(exists(db, 'market_intel_source_runs'), false);
    assert.deepEqual(engine.calls.execStatements, [], 'no statement of the file ran');
    assert.equal(exec.adopted.length, 0);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('partial state on 7708 and 8522 shapes fails too', () => {
  for (const [skip, file, absent] of [
    ['source_mix_json', F7708, 'market_intel_indexes.source_mix_json'],
    ['tokens_reported', F8522, 'ai_usage_logs.tokens_reported'],
  ]) {
    const { db, dir, engine } = productionShape({ skip: [skip] });
    try {
      const plan = planAdoption(real(file), { tableColumns: engine.tableColumns });
      assert.equal(plan.ok, false, `${file} with ${skip} absent must not be adopted`);
      assert.deepEqual((plan as any).absent, [absent]);
    } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('a file that applies normally is untouched: no schema read, no statement batch', () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  productionTables(db); // no runtime DDL: the columns are genuinely new
  const { dir, files } = tmpMigrations({ [F7707]: real(F7707), [F7708]: real(F7708), [F8522]: real(F8522) });
  try {
    const engine = makeEngine(db);
    const exec = adopting(engine);
    const res = applyPlan(planActions(files, engine.appliedSet(), { mode: 'apply' }), { exec, record: engine.record });
    assert.equal(res.failure, null);
    assert.equal(res.applied.length, 3);
    assert.deepEqual(engine.calls.tableColumns, [], 'the live schema is never read for a file that applied');
    assert.deepEqual(engine.calls.execStatements, []);
    assert.equal(exec.adopted.length, 0);
    assert.ok(exists(db, 'market_intel_source_runs'));
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('any error other than duplicate column name is rethrown unchanged', () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const { dir, files } = tmpMigrations({
    '001_missing_table.sql': 'ALTER TABLE nowhere ADD COLUMN c TEXT;',
    '002_bad.sql': 'CREATE TABLE IF NOT EXISTS t (;',
  });
  try {
    const engine = makeEngine(db);
    for (const f of files) {
      let original: unknown;
      const exec = withPresentColumnAdoption((file: any) => {
        try { engine.exec(file); } catch (e) { original = e; throw e; }
      }, { tableColumns: engine.tableColumns, execStatements: engine.execStatements });
      const res = applyPlan(planActions([f], new Map(), { mode: 'apply' }), { exec, record: engine.record });
      assert.ok(res.failure, `${f.name} must fail`);
      assert.equal(res.failure!.error, original, 'the very same error object, no annotation');
      assert.equal(isDuplicateColumnError(res.failure!.error), false);
    }
    assert.deepEqual(engine.calls.tableColumns, []);
    assert.equal(engine.appliedSet().size, 0);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the rest of an adopted file runs as one batch: a failure there lands nothing and is not recorded', () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, c TEXT)');
  const { dir, files } = tmpMigrations({
    '001_rest_fails.sql':
      'ALTER TABLE t ADD COLUMN c TEXT;\nCREATE TABLE IF NOT EXISTS landed_first (id INTEGER);\nINSERT INTO no_such_table VALUES (1);',
  });
  try {
    const engine = makeEngine(db);
    const exec = adopting(engine);
    const res = applyPlan(planActions(files, new Map(), { mode: 'apply' }), { exec, record: engine.record });
    assert.ok(res.failure);
    assert.match(String(res.failure!.error.message), /no such table: no_such_table/);
    assert.match(String(res.failure!.error.message), /rest of the file FAILED/);
    assert.equal(exists(db, 'landed_first'), false, 'the batch is all or nothing');
    assert.equal(engine.appliedSet().size, 0);
    assert.equal(exec.adopted.length, 0);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a trigger with semicolons in its body runs whole', () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, c TEXT); CREATE TABLE audit (id INTEGER, note TEXT)');
  const { dir, files } = tmpMigrations({
    '001_trigger.sql':
      '-- a header; with a semicolon\nALTER TABLE t ADD COLUMN c TEXT;\n' +
      "CREATE TRIGGER IF NOT EXISTS t_audit AFTER INSERT ON t BEGIN\n  INSERT INTO audit VALUES (NEW.id, 'a;b');\n  INSERT INTO audit VALUES (NEW.id, CASE WHEN NEW.id > 0 THEN 'pos' END);\nEND;",
  });
  try {
    const engine = makeEngine(db);
    const res = applyPlan(planActions(files, new Map(), { mode: 'apply' }), { exec: adopting(engine), record: engine.record });
    assert.equal(res.failure, null);
    db.exec("INSERT INTO t (id, c) VALUES (1, 'x')");
    assert.deepEqual((db.prepare('SELECT note FROM audit ORDER BY rowid').all() as any[]).map((r) => r.note), ['a;b', 'pos']);
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('refusals: a different type, a data statement on an adopted column, a column the file does not add', () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, c INTEGER, d TEXT NOT NULL DEFAULT \'\')');
  const engine = makeEngine(db);
  const probe = { tableColumns: engine.tableColumns };
  const type = planAdoption('ALTER TABLE t ADD COLUMN c TEXT;', probe);
  assert.equal(type.ok, false);
  assert.match((type as any).reason, /t\.c is INTEGER on the target, the file declares TEXT/);
  const notNull = planAdoption('ALTER TABLE t ADD COLUMN d TEXT;', probe);
  assert.equal(notNull.ok, false, 'NOT NULL-ness must match too');
  const backfill = planAdoption("ALTER TABLE t ADD COLUMN c INTEGER;\nUPDATE t SET c = 0;", probe);
  assert.equal(backfill.ok, false);
  assert.match((backfill as any).reason, /mentions t\.c/);
  const other = planAdoption('ALTER TABLE t ADD COLUMN c INTEGER;', { ...probe, error: new Error('duplicate column name: zzz: SQLITE_ERROR') });
  assert.equal(other.ok, false);
  assert.match((other as any).reason, /\(zzz\) is not one this file adds/);
  const unreadable = planAdoption('ALTER TABLE t ADD COLUMN c INTEGER;\nALTER TABLE main.t ADD COLUMN d TEXT;', probe);
  assert.equal(unreadable.ok, false, 'an ADD the parser cannot read is never guessed at');
  assert.match((unreadable as any).reason, /cannot read this ALTER: ALTER TABLE main\.t ADD COLUMN d/);
  const none = planAdoption('CREATE TABLE IF NOT EXISTS u (id INTEGER);', probe);
  assert.equal(none.ok, false);
  const ok = planAdoption("ALTER TABLE t ADD COLUMN c INTEGER;\nCREATE INDEX IF NOT EXISTS t_c ON t(c);\nINSERT OR IGNORE INTO t (id) VALUES (9);", probe);
  assert.equal(ok.ok, true, 'a CREATE on the adopted column and an insert that does not name it are fine');
  assert.equal((ok as any).statements.length, 2);
  db.close();
});

test('dry-run prediction: adopt, apply, fail, and a column an earlier pending file adds', () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  productionTables(db);
  for (const s of RUNTIME_DDL[F7707]) db.exec(s);
  db.exec('ALTER TABLE ai_usage_logs ADD COLUMN provider TEXT'); // 8522 partial
  const engine = makeEngine(db);
  const { dir, files } = tmpMigrations({
    [F7707]: real(F7707),
    [F7708]: real(F7708),
    [F8522]: real(F8522),
    '202612010000_9999_again.sql': 'ALTER TABLE market_intel_indexes ADD COLUMN window_start TEXT;',
  });
  try {
    const actions = planActions(files, new Map([[F7708, 'x']]), { mode: 'apply' });
    // 7708 is already applied here, so its columns are NOT added by an earlier
    // pending file; the last file's column is absent and it applies.
    let p = predictAdoptions(actions, engine.tableColumns);
    assert.deepEqual(p.get(F7707)!.action, 'adopt');
    assert.equal(p.has(F7708), false, 'a skipped file is not predicted');
    assert.equal(p.get(F8522)!.action, 'fail');
    assert.match((p.get(F8522) as any).reason, /partial state/);
    assert.equal(p.get('202612010000_9999_again.sql')!.action, 'apply');
    // With 7708 pending, the later file finds window_start added by it.
    p = predictAdoptions(planActions(files, new Map(), { mode: 'apply' }), engine.tableColumns);
    assert.equal(p.get(F7708)!.action, 'apply');
    assert.equal(p.get('202612010000_9999_again.sql')!.action, 'adopt');
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('every ADD COLUMN in the real migration set is readable by the adoption parser', () => {
  const files = listMigrationFiles(REAL_MIGRATIONS);
  let withAdds = 0;
  for (const f of files) {
    const parsed = splitMigration(f.sql);
    assert.equal(parsed.error, null, `${f.name}: ${parsed.error}`);
    // The same columns the runner's verify-marked check reads from the file.
    const effects = expectedEffects(f.sql).columns.map(([t, c]: [string, string]) => `${t}.${c}`);
    assert.deepEqual(parsed.adds.map((a: any) => `${a.table}.${a.column}`), effects, f.name);
    if (parsed.adds.length) withAdds += 1;
  }
  assert.ok(withAdds > 200, `expected hundreds of ADD COLUMN files, read ${withAdds}`);
  assert.deepEqual(parseAddColumn("ALTER TABLE x ADD COLUMN \"Y\" VARCHAR ( 10 ) NOT NULL DEFAULT 'a'"),
    { table: 'x', column: 'y', type: 'VARCHAR(10)', notNull: true });
});

test('the CLI wires adoption into apply mode only, and the dry run predicts it', () => {
  const src = fs.readFileSync(path.join(HERE, '..', '..', 'scripts', 'migrate-d1.mjs'), 'utf8');
  assert.match(src, /mode === 'apply'\s*\?\s*withPresentColumnAdoption\(applyFile,/, 'apply mode wraps the --file apply');
  assert.match(src, /:\s*applyFile;/, 'baseline mode keeps the plain apply');
  assert.match(src, /applyPlan\(actions, \{ exec, record \}\)/);
  assert.match(src, /predictAdoptions\(dryActions,/, 'the dry run reads the live schema to predict adoption');
  assert.match(src, /wrangler\(target, \{ file: tmp \}\)/, 'the rest of an adopted file is one --file batch');
});
