/**
 * D4106 (#4106) — migration and decision numbers that cannot collide.
 *
 *  · a new migration is named by its UTC minute, `YYYYMMDDHHMM_<slug>.sql`:
 *    it sorts after every numbered file, the existing `/^\d+_.*\.sql$/`
 *    filters still read it, and the ledger runner applies it exactly once,
 *    proven against a SQLite copy (never production);
 *  · a numbered file above NUMBERED_CEILING, a malformed stamp, and two files
 *    sharing a number or a stamp are refused, naming both files;
 *  · from D4000 up a decision is numbered by its issue and its heading cites
 *    that issue;
 *  · two parallel PRs each adding a migration and a decision need no
 *    coordination, and their union passes both checks.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/collision_free_ids_d4106.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BASELINE_CUTOFF, LEDGER_DDL, LEDGER_TABLE, LEGACY_DUPLICATES, NUMBERED_CEILING,
  applyPlan, compareMigrations, listMigrationFiles, migrationDuplicates, migrationNameProblem, migrationNumber, migrationStamp, planActions,
} from '../../scripts/lib/migrationPlan.mjs';
import { ISSUE_NUMBERED_FROM, allDecisionProblems, decisionFileProblems, readDecisionFiles } from '../../scripts/check-decision-ids.mjs';

const REAL = path.resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const realNames = () => fs.readdirSync(REAL).filter((n) => n.endsWith('.sql'));

test('a stamped migration sorts after every numbered one, by minute, and the existing filters still read it', () => {
  const names = ['202611021016_b.sql', '9_x.sql', '202611021015_c.sql', '763_y.sql', '202611021015_a.sql', '10_z.sql'];
  assert.deepEqual([...names].sort(compareMigrations), ['9_x.sql', '10_z.sql', '763_y.sql', '202611021015_a.sql', '202611021015_c.sql', '202611021016_b.sql']);
  assert.ok(/^\d+_.*\.sql$/.test('202611021015_a.sql'), 'every fixture filter in the suite reads it');
  assert.ok(migrationNumber('202611021015_a.sql') > BASELINE_CUTOFF, 'never marked by a bootstrap, always applied');
  assert.equal(migrationStamp('202611021015_add_things.sql'), '202611021015');
  assert.equal(migrationStamp('763_x.sql'), null);
});

test('names: numbered up to the ceiling, stamped after it; a malformed stamp is refused', () => {
  // Mutation checked: the ceiling test removed → 800_x passes; the minute range check removed → 2026110215 61 passes.
  assert.equal(migrationNameProblem('763_scope.sql'), null);
  assert.equal(migrationNameProblem(`${NUMBERED_CEILING}_last.sql`), null);
  assert.match(migrationNameProblem(`${NUMBERED_CEILING + 1}_too_late.sql`)!, /numbered migrations stop at 799.*YYYYMMDDHHMM_<slug>\.sql/);
  assert.equal(migrationNameProblem('202611021015_add_things.sql'), null);
  for (const bad of ['202611021061_bad_minute.sql', '202613021015_bad_month.sql', '202611021015_Upper.sql', '20261102T1015Z_iso.sql', 'add_things.sql']) {
    assert.ok(migrationNameProblem(bad), bad);
  }
  assert.deepEqual(realNames().map(migrationNameProblem).filter(Boolean), [], 'every file on main is named one way or the other');
});

test('duplicates: a shared number or a shared stamp is refused, naming both files; the seven historical pairs are not', () => {
  // Mutation checked: the legacy list emptied → the real set reports 228/229/230/…; the stamp key dropped → the stamp pair passes.
  assert.deepEqual(migrationDuplicates(['202611021015_a.sql', '202611021015_b.sql']), ['202611021015_a.sql and 202611021015_b.sql share the stamp 202611021015.']);
  assert.deepEqual(migrationDuplicates(['764_a.sql', '764_b.sql']), ['764_a.sql and 764_b.sql share the number 764.']);
  assert.deepEqual(migrationDuplicates(['202611021015_a.sql', '202611021016_b.sql', '764_a.sql']), []);
  assert.deepEqual(migrationDuplicates(['259_a.sql', '259_b.sql']), [], 'a historical pair stays as it is');
  assert.deepEqual(migrationDuplicates(realNames()), []);
  const counts = new Map<number, number>();
  for (const n of realNames()) counts.set(migrationNumber(n), (counts.get(migrationNumber(n)) ?? 0) + 1);
  assert.deepEqual([...counts].filter(([, c]) => c > 1).map(([n]) => n).sort((a, b) => a - b), [...LEGACY_DUPLICATES], 'the list is exactly the pairs on main, no more');
});

test('the ledger runner applies a stamped migration once, after the numbered ones, on a SQLite copy', () => {
  // The same planActions/applyPlan migrate-d1.mjs runs on deploy, bound to node:sqlite instead of wrangler.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-4106-'));
  try {
    fs.writeFileSync(path.join(dir, '762_numbered.sql'), 'CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, label TEXT);');
    fs.writeFileSync(path.join(dir, '202611021015_stamped.sql'), "INSERT INTO t (label) VALUES ('stamped');");
    fs.writeFileSync(path.join(dir, '202611021016_later.sql'), "INSERT INTO t (label) VALUES ('later');");
    const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
    db.exec(LEDGER_DDL);
    const order: string[] = [];
    const engine = {
      exec: (f: any) => { order.push(f.name); db.exec(f.sql); },
      record: (f: any) => { db.prepare(`INSERT INTO ${LEDGER_TABLE} (filename, checksum) VALUES (?, ?)`).run(f.name, f.checksum); },
    };
    const applied = () => new Map((db.prepare(`SELECT filename, checksum FROM ${LEDGER_TABLE}`).all() as any[]).map((r) => [r.filename, r.checksum]));
    const run = () => applyPlan(planActions(listMigrationFiles(dir), applied(), { mode: 'apply' }), engine);
    const first = run();
    assert.equal(first.failure ?? null, null);
    assert.deepEqual(order, ['762_numbered.sql', '202611021015_stamped.sql', '202611021016_later.sql']);
    const second = run();
    assert.equal(second.failure ?? null, null);
    assert.equal(order.length, 3, 'a second deploy applies nothing again');
    assert.deepEqual((db.prepare('SELECT label FROM t ORDER BY id').all() as any[]).map((r) => r.label), ['stamped', 'later'], 'each ran exactly once');
    assert.equal(applied().size, 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const file = (n: number, first: string) => ({ name: `D${n}.md`, md: `${first}\n\nBody.\n` });

test('decisions from D4000 up are numbered by their issue, and the heading cites it', () => {
  // Mutation checked: the citation check removed → D4106 citing #4105 passes.
  assert.equal(ISSUE_NUMBERED_FROM, 4000);
  assert.deepEqual(decisionFileProblems([file(4106, '## D4106 — Names that cannot collide (#4106)')]), []);
  assert.match(decisionFileProblems([file(4106, '## D4106 — Names that cannot collide (#4105)')])[0], /numbered by its issue, so its heading cites #4106.*It cites #4105/);
  assert.match(decisionFileProblems([file(4106, '## D4106 — Names that cannot collide')])[0], /It cites no issue/);
  assert.deepEqual(decisionFileProblems([file(1650, '## D1650 — A number an issue handed out before D4106')]), [], 'below D4000 the old numbers stand');
  const md = fs.readFileSync(path.resolve(process.cwd(), 'documentation/architecture/DECISIONS.md'), 'utf8');
  assert.deepEqual(allDecisionProblems(md, readDecisionFiles()), [], 'the real folder is clean, D4106 included');
});

test('two parallel PRs each add a migration and a decision without coordinating, and their union passes', () => {
  // PR A (issue #4120) and PR B (issue #4121), written in the same hour from the same main.
  const main = realNames();
  const a = { migration: '202611021015_add_widgets.sql', decision: file(4120, '## D4120 — Widgets (#4120)') };
  const b = { migration: '202611021022_add_gadgets.sql', decision: file(4121, '## D4121 — Gadgets (#4121)') };
  const union = [...main, a.migration, b.migration];
  assert.deepEqual(union.map(migrationNameProblem).filter(Boolean), []);
  assert.deepEqual(migrationDuplicates(union), []);
  assert.deepEqual(decisionFileProblems([a.decision, b.decision]), []);
  // The only way they can still meet is the same minute, and the check names both files.
  assert.equal(migrationDuplicates([...main, '202611021015_add_widgets.sql', '202611021015_add_gadgets.sql']).length, 1);
});
