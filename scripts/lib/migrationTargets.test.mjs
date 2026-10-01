/**
 * Which database a migration run touches, and which it must never bootstrap.
 *
 * This is the file that decides, from a handful of argv flags, whether SQL
 * lands on production, on a laptop, or on one subsidiary's database. Every
 * test here is about a way that decision can be wrong quietly:
 *
 *   · a `--branch` typo resolving to something rather than throwing
 *   · a branch target carrying HQ's config, so wrangler resolves a database
 *     name its config never declared
 *   · `--bootstrap` reaching a database that already holds the platform
 *
 * The bootstrap rule is also checked against the real baseline and the real
 * migration directory, because its safety rests on two facts about files that
 * nothing else asserts: the baseline creates the ledger table, and its cutoff
 * still sits below the newest migration.
 *
 * Run with:
 *   node --test scripts/lib/migrationTargets.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { resolveTarget, bootstrapRefusal, branchConfigPath, HQ_CONFIG } from './migrationTargets.mjs';
import {
  LEDGER_TABLE, BASELINE_CUTOFF, listMigrationFiles, planActions, migrationNumber,
} from './migrationPlan.mjs';

const ROOT = process.cwd();

test('each flag selects one database, and every target names the config that declares it', () => {
  assert.deepEqual(resolveTarget(['--local']), {
    label: 'local', kind: 'local', dbName: 'studioos-db', config: HQ_CONFIG, flags: ['--local'],
  });
  assert.deepEqual(resolveTarget(['--remote']), {
    label: 'remote (prod)', kind: 'production', dbName: 'studioos-db', config: HQ_CONFIG, flags: ['--remote'],
  });
  assert.equal(resolveTarget(['--preview']).dbName, 'studioos-db-preview');
  assert.equal(resolveTarget([]), null, 'no flag is no target — never a default');

  const fr = resolveTarget(['--branch', 'fr']);
  assert.equal(fr.dbName, 'studioos-fr');
  assert.equal(fr.config, branchConfigPath('fr'));
  assert.notEqual(fr.config, HQ_CONFIG, "a branch target must not carry HQ's config");
  assert.deepEqual(fr.flags, ['--remote']);
});

test('a --branch value that is not a code throws rather than resolving', () => {
  // A typo that returned null would print the generic usage text; one that
  // fell through to the next arm would migrate production.
  for (const bad of ['', 'FR', '-fr', 'fr.axal.vc', 'studioos-fr-long-branch-code', '../etc']) {
    assert.throws(() => resolveTarget(['--branch', bad]), /branch code/, `--branch ${JSON.stringify(bad)}`);
  }
  assert.throws(() => resolveTarget(['--branch']), /branch code/, 'a bare --branch has no value');
  for (const other of ['--local', '--remote', '--preview']) {
    assert.throws(() => resolveTarget(['--branch', 'fr', other]), /do not combine/,
      `--branch with ${other} is two targets in one command`);
  }
});

test('bootstrap is refused for the database that already holds the platform, and allowed for a fresh one', () => {
  assert.match(bootstrapRefusal(resolveTarget(['--remote'])), /never bootstrapped/);
  assert.equal(bootstrapRefusal(resolveTarget(['--local'])), null);
  assert.equal(bootstrapRefusal(resolveTarget(['--preview'])), null);
  // THE CASE THE OLD RULE GOT WRONG. It read `argv.includes('--remote')`, so
  // it refused by flag rather than by database — and a freshly created branch
  // database is empty AND remote, which is precisely what provisioning has to
  // bootstrap.
  assert.equal(bootstrapRefusal(resolveTarget(['--branch', 'fr'])), null,
    'a new branch database is empty and remote; bootstrapping it is the provisioning step');
  assert.match(bootstrapRefusal(null), /no target/);
});

test('bootstrap works because the baseline carries the ledger table, not because the runner creates it', () => {
  // `--bootstrap` runs schema_baseline.sql and then writes ledger rows. It
  // never issues LEDGER_DDL itself, so a baseline regenerated without that
  // CREATE TABLE would fail on the first INSERT — after applying the whole
  // schema. Nothing else in the suite looks at this.
  const baseline = readFileSync(resolve(ROOT, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
  const ddl = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${LEDGER_TABLE}\\s*\\(`, 'i');
  assert.match(baseline, ddl, `schema_baseline.sql must create ${LEDGER_TABLE}`);
  const table = baseline.slice(baseline.search(ddl), baseline.search(ddl) + 400);
  for (const col of ['filename', 'checksum']) {
    assert.ok(new RegExp(`\\b${col}\\b`).test(table),
      `the baseline's ${LEDGER_TABLE} needs the runner's ${col} column`);
  }
  // It is a bare CREATE TABLE, not IF NOT EXISTS — so running the baseline
  // against a database that already has a ledger errors rather than merging
  // into one. That is the second half of why bootstrap demands an empty
  // target, and it is a property of this file, not of the runner.
  assert.ok(!/CREATE TABLE IF NOT EXISTS schema_migrations/i.test(baseline),
    'if the ledger DDL ever gains IF NOT EXISTS, bootstrap stops failing loudly on a non-empty database');
});

test('a bootstrapped branch is marked up to the cutoff and then migrated forward', () => {
  const files = listMigrationFiles(resolve(ROOT, 'cloudflare-worker/sql/migrations'));
  const actions = planActions(files, new Map(), { mode: 'bootstrap' });
  const marked = actions.filter((a) => a.action === 'mark').map((a) => a.file.name);
  // In bootstrap mode `skip` does NOT mean "already applied" — it means "the
  // baseline does not contain this one, so leave it for the forward run that
  // follows". Reading it as the apply-mode `skip` is how someone concludes a
  // bootstrapped branch is fully migrated when it is thirty-six files short.
  const forTheForwardRun = actions.filter((a) => a.action === 'skip').map((a) => a.file.name);
  assert.equal(marked.length + forTheForwardRun.length, actions.length, 'bootstrap neither applies nor invents anything');
  assert.ok(marked.length > 0 && forTheForwardRun.length > 0,
    'the baseline must cover some migrations and leave the rest to run');
  for (const name of marked) {
    assert.ok(migrationNumber(name) <= BASELINE_CUTOFF, `${name} is above the cutoff and must not be marked`);
  }
  for (const name of forTheForwardRun) {
    assert.ok(migrationNumber(name) > BASELINE_CUTOFF, `${name} is at or below the cutoff and should be marked`);
  }
  // Migration 207 seeds the single super-admin holder. It is below the cutoff,
  // so a branch marks it without running it — which is what makes a branch
  // Worker have no super admin of its own. If the cutoff ever moves below it,
  // every new branch would seed HQ's holder into its own database.
  assert.ok(marked.some((n) => n.startsWith('207_')), 'the super-admin seed must be marked, never executed, on a fresh database');
});
