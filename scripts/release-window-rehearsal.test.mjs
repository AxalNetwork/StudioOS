// D8532 (#8532): the release-window rehearsal, run against fixture migrations
// on top of this checkout's own schema and Worker. The base and the candidate
// are both this tree here; a fixture file is the candidate's only pending
// migration. The base database is built and seeded once (`prepareBase`) and
// every case starts from a copy.
//
//   node --test scripts/release-window-rehearsal.test.mjs
//
// Not in `test:retention` (scripts/lib/*.test.mjs): it builds the whole schema and boots the
// Worker about twenty times, so it runs in the release-rehearsal workflow, on the pull requests
// whose paths can change its answer.
//
// Mutation checked (D8532.md lists each): every assertion below goes red when
// the step it guards is switched off in lib/releaseWindow.mjs.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checksum, listMigrationFiles } from './lib/migrationPlan.mjs';
import { durableObjectTags, forwardFixesOf, prepareBase, rehearse, renderReport } from './lib/releaseWindow.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKER = join(ROOT, 'cloudflare-worker');
const SQL = join(WORKER, 'sql');
let scratch;
let base;
let repoFiles;
let caseNo = 0;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'release-window-test-'));
  repoFiles = listMigrationFiles(join(SQL, 'migrations'));
  base = prepareBase({ workDir: scratch, baseSqlDir: SQL, baseWorker: WORKER });
  assert.ok(base.ok, base.error);
});
after(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });

/** One rehearsal whose candidate is this tree plus `fixtures` (`{ name, sql }`), forward fixes in `extra`. */
function rehearseWith(fixtures, extra = {}) {
  const dir = mkdtempSync(join(scratch, `case-${++caseNo}-`));
  for (const [path, sql] of Object.entries(extra)) writeFileSync(join(dir, path), sql);
  const candidateFiles = [...repoFiles, ...fixtures.map((f) => ({ ...f, path: null, checksum: checksum(f.sql) }))];
  try {
    return rehearse({
      workDir: dir, preparedBase: base, baseSha: 'base-fixture', candidateSha: 'candidate-fixture',
      baseSqlDir: SQL, baseWorker: WORKER, candidateWorker: WORKER, candidateRoot: dir, candidateFiles,
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// Names that sort after every real migration.
const ADDITIVE = '209912312300_8532_fixture_additive_column.sql';
const DROPPED = '209912312301_8532_fixture_drop_totp_recovery_hashes.sql';
const TWICE = '209912312302_8532_fixture_seed_rows_twice.sql';
const MANUAL = '209912312303_8532_fixture_manual_rewrite.sql';
const REWRITE = '209912312304_8532_fixture_downgrade_seeded_plan.sql';

test('the base Worker answers every probe as expected on the base schema (step 1)', () => {
  assert.equal(base.answers['sign-in'].status, 200);
  assert.equal(base.answers['entitlement:paid'].status, 200);
  assert.equal(base.answers['entitlement:free'].status, 402);
  assert.equal(base.answers['grant:member'].status, 200);
  assert.equal(base.answers['grant:outsider'].status, 403);
  assert.equal(base.answers['asset:hashed'].status, 200);
  assert.equal(base.answers['asset:missing'].status, 404);
});

test('an additive column passes every step, and its replay refuses rather than changing anything', () => {
  const r = rehearseWith([{ name: ADDITIVE, sql: 'ALTER TABLE projects ADD COLUMN rehearsal_note_8532 TEXT;\n' }]);
  assert.equal(r.verdict, 'pass', JSON.stringify(r.first_failure));
  assert.deepEqual(r.migrations.map((m) => m.file), [ADDITIVE]);
  assert.equal(r.classifier.class, 'auto-additive');
  assert.deepEqual(r.steps['2'].applied, [ADDITIVE]);
  assert.deepEqual(r.steps['3'].differences, []);
  assert.deepEqual(r.steps['4'].ledger_retry_planned, []);
  assert.equal(r.steps['4'].ledger_converges, true);
  assert.deepEqual(r.steps['4'].replay.map((x) => x.outcome), ['refused']);
  assert.match(r.steps['4'].replay[0].error, /duplicate column/);
  assert.equal(r.base_sha, 'base-fixture');
  assert.equal(r.candidate_sha, 'candidate-fixture');
  assert.match(renderReport(r), new RegExp(ADDITIVE));
});

test('a dropped column the old Worker still reads is caught at step 3', () => {
  // services/authTotp.ts loadTotp: SELECT secret_ct, recovery_hashes FROM auth_totp — the sign-in reads it.
  const r = rehearseWith([{ name: DROPPED, sql: 'ALTER TABLE auth_totp DROP COLUMN recovery_hashes;\n' }]);
  assert.equal(r.verdict, 'fail');
  assert.equal(r.first_failure.step, '3');
  assert.equal(r.steps['2'].ok, true);
  assert.ok(r.steps['3'].differences.some((d) => d.probe === 'sign-in'), JSON.stringify(r.steps['3'].differences));
  // The classifier already calls it manual, and no forward fix is named.
  assert.equal(r.classifier.class, 'manual');
  assert.equal(r.steps['5'].ok, false);
});

test('a migration that is not idempotent is caught at step 4', () => {
  const sql = 'CREATE TABLE IF NOT EXISTS rehearsal_seed_8532 (k TEXT);\nINSERT INTO rehearsal_seed_8532 (k) VALUES (\'once\');\n';
  const r = rehearseWith([{ name: TWICE, sql }]);
  assert.equal(r.verdict, 'fail');
  assert.equal(r.first_failure.step, '4');
  assert.equal(r.classifier.class, 'auto-additive');
  assert.equal(r.steps['3'].ok, true);
  assert.deepEqual(r.steps['4'].replay.map((x) => x.outcome), ['changed']);
  assert.ok(r.steps['4'].replay[0].changed.includes('table rehearsal_seed_8532'));
  // The ledger-driven retry itself is still a no-op: the danger is the lost ledger row.
  assert.deepEqual(r.steps['4'].ledger_retry_planned, []);
});

test('a manual-recovery migration fails without a forward fix and passes with a rehearsed one (step 5)', () => {
  const rewrite = "UPDATE users SET subscription_status = subscription_status WHERE email LIKE '%@release-window.invalid';\n";
  const bare = rehearseWith([{ name: MANUAL, sql: rewrite }]);
  assert.equal(bare.classifier.class, 'manual');
  assert.equal(bare.first_failure.step, '5');
  assert.deepEqual(bare.forward_fixes.map((f) => f.status), ['missing']);

  const fix = 'CREATE TABLE IF NOT EXISTS rehearsal_fix_8532 (done INTEGER);\n';
  const fixed = rehearseWith([{ name: MANUAL, sql: `-- forward-fix: fix_8532.sql\n${rewrite}` }], { 'fix_8532.sql': fix });
  assert.equal(fixed.verdict, 'pass', JSON.stringify(fixed.first_failure));
  assert.deepEqual(fixed.forward_fixes.map((f) => [f.fix, f.status]), [['fix_8532.sql', 'ran']]);
});

test('a forward fix outside the candidate tree or not SQL is not accepted', () => {
  assert.deepEqual(forwardFixesOf('-- forward-fix: a/b.sql\n-- forward-fix:  c.mjs \nSELECT 1; -- forward-fix: inline.sql'), ['a/b.sql', 'c.mjs']);
  // The file exists, one directory above the candidate tree: only the containment check refuses it.
  writeFileSync(join(scratch, 'escape.sql'), 'SELECT 1;\n');
  const r = rehearseWith([{ name: MANUAL, sql: "-- forward-fix: ../escape.sql\nUPDATE users SET name = name WHERE 0;\n" }]);
  assert.equal(r.first_failure.step, '5');
  assert.match(r.forward_fixes[0].status, /unusable/);
});

test('a rewrite of rows the base already holds does not converge with a clean candidate build (step 4)', () => {
  // Seeded before the migration, the paid account is downgraded; a clean candidate build seeds after it and is not.
  const r = rehearseWith([{ name: REWRITE, sql: "UPDATE users SET subscription_tier = 'free' WHERE email LIKE '%@release-window.invalid';\n" }]);
  assert.equal(r.verdict, 'fail');
  assert.equal(r.steps['4'].ok, false);
  assert.ok(r.steps['4'].differences.some((d) => d.probe === 'entitlement:paid'), JSON.stringify(r.steps['4'].differences));
  assert.equal(r.steps['4'].ledger_converges, true);
});

test('Durable Object migrations are reported "not rehearsed", with the reason, and do not fail the run', () => {
  const toml = (tags) => tags.map((t) => `[[env.production.migrations]]\ntag = "${t}"\nnew_sqlite_classes = ["X"]\n`).join('\n');
  assert.deepEqual(durableObjectTags(toml(['v1']), toml(['v1'])), []);
  const added = durableObjectTags(toml(['v1']), toml(['v1', 'v2']));
  assert.deepEqual(added.map((d) => [d.tag, d.status]), [['v2', 'not rehearsed']]);
  assert.match(added[0].reason, /workerd/);
});
