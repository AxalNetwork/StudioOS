// Task #9 — Tests for the D1 migration runner's planning + apply engine.
//
// The runner's I/O (wrangler) is injected, so the SAME apply loop that ships in
// scripts/migrate-d1.mjs is exercised here against a REAL SQLite engine
// (node:sqlite) — proving the loss-free contract end to end without needing
// wrangler or network:
//   - pending files are applied exactly once, in deterministic order;
//   - a second run is a no-op (everything skipped);
//   - a failing migration aborts loudly, names the file, and does NOT apply or
//     record anything after it;
//   - baseline records non-idempotent files WITHOUT executing them;
//   - the real migration set's idempotency audit flags the unsafe files.
//
// FK enforcement is OFF to mirror D1 (the rest of the suite does the same).
//
// Run via the strip-types loader (see package.json test:drift):
//   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/migrate_d1_plan.test.ts

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
  LEGACY_LEDGER_TABLE,
  compareMigrations,
  classifyIdempotency,
  auditMigrations,
  expectedEffects,
  ledgerShapeProblem,
  listMigrationFiles,
  planActions,
  applyPlan,
  needsBaseline,
  sqlQuote,
  verifyMarked,
} from '../../scripts/lib/migrationPlan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_MIGRATIONS = path.join(HERE, '..', 'sql', 'migrations');

// Build a throwaway migrations dir and return listMigrationFiles() over it.
function tmpMigrations(fileMap: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-test-'));
  for (const [name, sql] of Object.entries(fileMap)) {
    fs.writeFileSync(path.join(dir, name), sql);
  }
  return { dir, files: listMigrationFiles(dir) };
}

// A node:sqlite-backed { exec, record } pair mirroring the CLI's wrangler one.
function makeEngine(db: InstanceType<typeof DatabaseSync>) {
  db.exec(LEDGER_DDL);
  return {
    appliedSet() {
      const rows = db
        .prepare(`SELECT filename, checksum FROM ${LEDGER_TABLE}`)
        .all() as { filename: string; checksum: string }[];
      return new Map(rows.map((r) => [r.filename, r.checksum]));
    },
    exec(file: { name: string; sql: string }) {
      db.exec(file.sql);
    },
    record(file: { name: string; checksum: string }) {
      db.prepare(
        `INSERT OR REPLACE INTO ${LEDGER_TABLE} (filename, checksum, applied_at) ` +
          `VALUES (?, ?, datetime('now'))`,
      ).run(file.name, file.checksum);
    },
  };
}

test('compareMigrations sorts numerically with a stable tiebreak on duplicate prefixes', () => {
  const names = [
    '100_z.sql',
    '9_a.sql',
    '011_subscription_tiers.sql',
    '011_sms_2fa.sql',
    '10_b.sql',
  ];
  const sorted = [...names].sort(compareMigrations);
  assert.deepEqual(sorted, [
    '9_a.sql',
    '10_b.sql',
    // same numeric prefix -> lexicographic tiebreak (sms before subscription)
    '011_sms_2fa.sql',
    '011_subscription_tiers.sql',
    '100_z.sql',
  ]);
});

test('classifyIdempotency: guarded statements are safe, ALTER/bare-INSERT are not', () => {
  assert.equal(
    classifyIdempotency(
      'CREATE TABLE IF NOT EXISTS t (id INTEGER); INSERT OR IGNORE INTO t VALUES (1);',
    ).idempotent,
    true,
  );
  assert.equal(
    classifyIdempotency('ALTER TABLE t ADD COLUMN c TEXT;').idempotent,
    false,
  );
  assert.equal(
    classifyIdempotency('INSERT INTO t (id) VALUES (1);').idempotent,
    false,
  );
  // A header comment showing an example CREATE TABLE must not trip the scan.
  assert.equal(
    classifyIdempotency(
      '-- CREATE TABLE example (x);\nCREATE TABLE IF NOT EXISTS real (x);',
    ).idempotent,
    true,
  );
});

test('audit of the real migration set flags ALTER/bare-INSERT files and clears guarded ones', () => {
  const files = listMigrationFiles(REAL_MIGRATIONS);
  assert.ok(files.length > 100, 'expected the full historical migration set');
  const { report } = auditMigrations(files);
  const byName = new Map(report.map((r) => [r.name, r]));

  // Known guarded, genuinely-pending files must be classified safe-to-replay.
  for (const safe of [
    '067_telegram.sql',
    '089_skills_values_taxonomy.sql',
    '090_seed_skills_values_taxonomy.sql',
    '122_academy_lessons.sql',
  ]) {
    assert.equal(byName.get(safe)?.idempotent, true, `${safe} should be safe`);
  }
  // Known ALTER files must be flagged unsafe.
  for (const unsafe of [
    '121_waitlist_crm.sql',
    '118_project_product_demo.sql',
    '083_auth_blockers.sql',
  ]) {
    assert.equal(byName.get(unsafe)?.idempotent, false, `${unsafe} should be unsafe`);
  }
});

test('apply mode: pending files run exactly once, second run is a no-op', () => {
  const { files } = tmpMigrations({
    '001_a.sql': 'CREATE TABLE IF NOT EXISTS a (id INTEGER PRIMARY KEY);',
    '002_b.sql': 'CREATE TABLE IF NOT EXISTS b (id INTEGER PRIMARY KEY);',
    '003_seed.sql': "INSERT OR IGNORE INTO a (id) VALUES (1), (2);",
  });
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const engine = makeEngine(db);

  let execCount = 0;
  const wrappedExec = (f: any) => {
    execCount += 1;
    engine.exec(f);
  };

  // First run: empty ledger -> all three pending -> all applied.
  let actions = planActions(files, engine.appliedSet(), { mode: 'apply' });
  let res = applyPlan(actions, { exec: wrappedExec, record: engine.record });
  assert.equal(res.failure, null);
  assert.equal(res.applied.length, 3);
  assert.equal(execCount, 3);
  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS n FROM ${LEDGER_TABLE}`).get() as any).n,
    3,
  );
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM a').get() as any).n, 2);

  // Second run: ledger now full -> nothing pending, exec never called again.
  actions = planActions(files, engine.appliedSet(), { mode: 'apply' });
  res = applyPlan(actions, { exec: wrappedExec, record: engine.record });
  assert.equal(res.applied.length, 0);
  assert.equal(res.skipped.length, 3);
  assert.equal(execCount, 3, 'exec must not run again on a clean re-run');
});

test('a failing migration aborts loudly, names the file, and stops the run', () => {
  const { files } = tmpMigrations({
    '001_ok.sql': 'CREATE TABLE IF NOT EXISTS ok (id INTEGER);',
    '002_broken.sql': 'CREATE TABLE IF NOT EXISTS broken (this is not valid sql;',
    '003_after.sql': 'CREATE TABLE IF NOT EXISTS after (id INTEGER);',
  });
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const engine = makeEngine(db);

  const actions = planActions(files, engine.appliedSet(), { mode: 'apply' });
  const res = applyPlan(actions, { exec: engine.exec, record: engine.record });

  assert.ok(res.failure, 'expected a failure');
  assert.equal(res.failure!.file.name, '002_broken.sql');
  assert.equal(res.applied.length, 1, 'only the file before the failure applied');

  // The good first migration is recorded; the broken + later one are NOT.
  const applied = engine.appliedSet();
  assert.ok(applied.has('001_ok.sql'));
  assert.ok(!applied.has('002_broken.sql'));
  assert.ok(!applied.has('003_after.sql'));
  // The table from the never-reached third migration must not exist.
  const tbl = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='after'")
    .get();
  assert.equal(tbl, undefined);
});

test('baseline records non-idempotent files WITHOUT executing them', () => {
  const { files } = tmpMigrations({
    // Idempotent: safe to (re)apply -> baseline executes it.
    '001_guarded.sql': 'CREATE TABLE IF NOT EXISTS guarded (id INTEGER);',
    // Non-idempotent ALTER against a table that does NOT exist here: if baseline
    // tried to EXECUTE it, it would throw. It must instead be recorded only.
    '002_alter.sql': 'ALTER TABLE nonexistent ADD COLUMN c TEXT;',
  });
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const engine = makeEngine(db);

  const executed: string[] = [];
  const wrappedExec = (f: any) => {
    executed.push(f.name);
    engine.exec(f);
  };

  const actions = planActions(files, engine.appliedSet(), { mode: 'baseline' });
  const res = applyPlan(actions, { exec: wrappedExec, record: engine.record });

  assert.equal(res.failure, null, 'baseline must not execute the unsafe ALTER');
  assert.deepEqual(executed, ['001_guarded.sql'], 'only the guarded file executes');
  assert.equal(res.applied.length, 1);
  assert.equal(res.marked.length, 1);
  assert.equal(res.marked[0].file.name, '002_alter.sql');

  // Both end up in the ledger so a later normal run skips them.
  const applied = engine.appliedSet();
  assert.ok(applied.has('001_guarded.sql'));
  assert.ok(applied.has('002_alter.sql'));
});

test('needsBaseline trips on an existing DB with an empty ledger (apply mode)', () => {
  // Hand-migrated prod: app tables exist, ledger is empty -> must baseline.
  assert.equal(needsBaseline({ mode: 'apply', appliedCount: 0, appTableCount: 42 }), true);
  // Same situation but an empty ledger left behind by an aborted run: still trips
  // (guard keys on emptiness, not on ledger pre-existence).
  assert.equal(needsBaseline({ mode: 'apply', appliedCount: 0, appTableCount: 1 }), true);
  // Fresh DB (no app tables) -> safe to apply from scratch.
  assert.equal(needsBaseline({ mode: 'apply', appliedCount: 0, appTableCount: 0 }), false);
  // Ledger already has rows -> normal forward-only apply.
  assert.equal(needsBaseline({ mode: 'apply', appliedCount: 5, appTableCount: 42 }), false);
  // Baseline mode is exactly how the operator escapes the guard.
  assert.equal(needsBaseline({ mode: 'baseline', appliedCount: 0, appTableCount: 42 }), false);
});

test('sqlQuote wraps and doubles single quotes (no injection / no breakage)', () => {
  assert.equal(sqlQuote('012_plain.sql'), "'012_plain.sql'");
  assert.equal(sqlQuote("o'brien.sql"), "'o''brien.sql'");
  // A would-be injection payload is neutralised into a single string literal.
  assert.equal(sqlQuote("x'); DROP TABLE t;--"), "'x''); DROP TABLE t;--'");
});

test('applyPlan surfaces a record() failure after a successful exec', () => {
  const { files } = tmpMigrations({
    '001_ok.sql': 'CREATE TABLE IF NOT EXISTS ok (id INTEGER);',
  });
  const actions = planActions(files, new Map(), { mode: 'apply' });
  const executed: string[] = [];
  const res = applyPlan(actions, {
    exec: (f: any) => executed.push(f.name),
    record: () => {
      throw new Error('ledger write boom');
    },
  });
  assert.deepEqual(executed, ['001_ok.sql'], 'the SQL still ran');
  assert.ok(res.failure, 'a record failure must be reported');
  assert.equal(res.failure.phase, 'record-after-apply');
  assert.equal(res.failure.file.name, '001_ok.sql');
  assert.equal(res.applied.length, 0, 'not counted as cleanly applied');
});

/* ────────────────────────────────────────────────────────────────────────────
 * The foreign ledger. Production was found holding a `schema_migrations` with
 * columns (name, applied_at) that nothing in this repo wrote; against it the
 * DDL is a no-op and `SELECT filename, checksum` fails, so every mode died
 * before applying anything. These pin: the shape is named, not swallowed; the
 * adoption keeps the rows; and a baseline mark can be checked against reality.
 * ──────────────────────────────────────────────────────────────────────────── */

test('ledgerShapeProblem: absent and runner-shaped ledgers are fine, anything else is named', () => {
  assert.equal(ledgerShapeProblem([]), null, 'no table yet is not a problem');
  assert.equal(ledgerShapeProblem(['filename', 'checksum', 'applied_at']), null);
  assert.equal(ledgerShapeProblem(['FILENAME', 'CHECKSUM']), null, 'case-insensitive');
  const msg = ledgerShapeProblem(['name', 'applied_at']);
  assert.ok(msg, 'the production shape must be refused');
  assert.match(msg!, /name, applied_at/, 'the message names the columns found');
  assert.match(msg!, /filename/, 'and the column that is missing');
});

test('adopting a foreign ledger renames it aside with its rows intact', () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`CREATE TABLE ${LEDGER_TABLE} (name TEXT, applied_at TEXT)`);
  db.exec(`INSERT INTO ${LEDGER_TABLE} VALUES ('score_anti_cheat_v1', '2026-05-06')`);
  const cols = (db.prepare(`PRAGMA table_info(${LEDGER_TABLE})`).all() as any[]).map((r) => r.name);
  assert.ok(ledgerShapeProblem(cols), 'precondition: the shape is foreign');

  // The CLI's adoption is exactly this statement, then the normal DDL.
  db.exec(`ALTER TABLE ${LEDGER_TABLE} RENAME TO ${LEGACY_LEDGER_TABLE}`);
  db.exec(LEDGER_DDL);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${LEGACY_LEDGER_TABLE}`).get() as any).n, 1,
    'the foreign rows survive under the legacy name');
  const fresh = (db.prepare(`PRAGMA table_info(${LEDGER_TABLE})`).all() as any[]).map((r) => r.name);
  assert.equal(ledgerShapeProblem(fresh), null, 'the runner now has its own ledger');
});

test('expectedEffects reads CREATE, ADD COLUMN, and the rebuild idiom in statement order', () => {
  assert.deepEqual(expectedEffects('ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0;'),
    { tables: [], columns: [['users', 'is_super_admin']] });
  assert.deepEqual(expectedEffects('CREATE TABLE IF NOT EXISTS licence_admins (id INTEGER);'),
    { tables: ['licence_admins'], columns: [] });
  // Rebuild: the temporary table is renamed INTO the name the code reads.
  assert.deepEqual(expectedEffects(
    'CREATE TABLE service_offerings_new (id INTEGER, company_id INTEGER);\n' +
    'INSERT INTO service_offerings_new SELECT id, NULL FROM service_offerings;\n' +
    'DROP TABLE service_offerings;\n' +
    'ALTER TABLE service_offerings_new RENAME TO service_offerings;',
  ), { tables: ['service_offerings'], columns: [] });
  // A temp table the file drops itself leaves nothing to check.
  assert.deepEqual(expectedEffects('CREATE TABLE tmp_x (a); DROP TABLE tmp_x;'), { tables: [], columns: [] });
  // Prose in a header comment is not an effect.
  assert.deepEqual(expectedEffects('-- ALTER TABLE users ADD COLUMN example TEXT;\nINSERT OR IGNORE INTO t VALUES (1);'),
    { tables: [], columns: [] });
});

test('verifyMarked separates present, absent and unverifiable ledger rows', () => {
  const { files } = tmpMigrations({
    '001_present.sql': 'ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0;',
    '002_absent.sql': 'ALTER TABLE users ADD COLUMN never_added TEXT;',
    '003_table_absent.sql': 'CREATE TABLE IF NOT EXISTS security_events (id INTEGER);',
    '004_seed_only.sql': "INSERT OR IGNORE INTO users (id) VALUES (1);",
  });
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, is_super_admin INTEGER NOT NULL DEFAULT 0)');
  const engine = makeEngine(db);
  // A baseline marked all four without executing them.
  for (const f of files) engine.record(f);

  const probes = {
    tableExists: (t: string) =>
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t) !== undefined,
    tableColumns: (t: string) =>
      new Set((db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((r) => String(r.name).toLowerCase())),
  };
  const out = verifyMarked(files, engine.appliedSet(), probes);
  assert.deepEqual(out.verified.map((f) => f.name), ['001_present.sql']);
  assert.deepEqual(out.missing.map((m) => m.file.name), ['002_absent.sql', '003_table_absent.sql']);
  assert.match(out.missing[0].gaps.join(' '), /users\.never_added is missing/);
  assert.match(out.missing[1].gaps.join(' '), /table security_events is missing/);
  assert.deepEqual(out.unverifiable.map((u) => u.file.name), ['004_seed_only.sql'],
    'an INSERT-only file cannot be checked and must not be guessed at');
  // A file that is not in the ledger is simply not a marked row.
  const partial = new Map([...engine.appliedSet()].filter(([k]) => k !== '002_absent.sql'));
  assert.deepEqual(verifyMarked(files, partial, probes).missing.map((m) => m.file.name), ['003_table_absent.sql']);
});

/* ────────────────────────────────────────────────────────────────────────────
 * The workflows. CI used to deploy the worker without ever running the runner
 * (DEPLOY.md §1.1's first "silent skip", on every merge), and the one-off
 * super-admin workflow interpolated an operator-typed email straight into a
 * SQL string. Pin the replacements.
 * ──────────────────────────────────────────────────────────────────────────── */

const WORKFLOWS = path.join(HERE, '..', '..', '.github', 'workflows');
const workflow = (name: string) => fs.readFileSync(path.join(WORKFLOWS, name), 'utf8');

test('the deploy workflow applies migrations before it deploys the worker', () => {
  // Match the `run:` lines, not the phrases: the file's own header explains
  // that it USED to call `wrangler deploy` directly, and that sentence sits
  // above both steps.
  const src = workflow('cloudflare-worker-deploy.yml');
  const migrate = src.search(/^\s+run: node scripts\/migrate-d1\.mjs --remote\s*$/m);
  const deploy = src.search(/^\s+run: npx --no-install wrangler deploy\b/m);
  assert.ok(migrate > -1, 'the deploy must run the migration runner');
  assert.ok(deploy > -1, 'the deploy step must still be there');
  assert.ok(migrate < deploy, 'and run it BEFORE the worker ships, or the worker starts ahead of its schema');
});

test('the migrate workflow offers every mode the runner has, each behind a plan', () => {
  const src = workflow('d1-migrate.yml');
  for (const mode of ['dry-run', 'adopt-and-baseline', 'verify-marked', 'apply']) {
    assert.match(src, new RegExp(`^\\s+- ${mode}$`, 'm'), `mode ${mode} must be selectable`);
  }
  assert.match(src, /--adopt-legacy-ledger --baseline/);
  assert.match(src, /--verify-marked/);
  assert.ok(src.indexOf('--dry-run') < src.indexOf('--adopt-legacy-ledger'),
    'the read-only plan runs before any mode that writes');
});

test('no workflow interpolates a dispatch input into a SQL command', () => {
  // The deleted super-admin-setup.yml did: `lower(email) IN ('${{ github.event.inputs.email }}')`.
  assert.ok(!fs.existsSync(path.join(WORKFLOWS, 'super-admin-setup.yml')),
    'the elevate-by-email workflow is replaced by routes/admin_super_admins.ts');
  for (const name of fs.readdirSync(WORKFLOWS).filter((n) => /\.ya?ml$/.test(n))) {
    const lines = workflow(name).split('\n');
    const bad = lines.filter((l) => /--command/.test(l) && /\$\{\{\s*(github\.event\.)?inputs\./.test(l));
    assert.deepEqual(bad, [], `${name} builds SQL from a workflow input`);
  }
});
