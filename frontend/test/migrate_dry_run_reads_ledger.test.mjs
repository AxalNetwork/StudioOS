/**
 * `migrate-d1.mjs --dry-run` reports what is ACTUALLY pending.
 *
 * DEPLOY.md sends the operator to `--remote --dry-run` and calls its output the
 * authority on what a deploy will apply. That was not true. The branch planned
 * against a hardcoded `new Map()` and printed "Plan (assuming an empty
 * ledger)", listing every migration ever written no matter what the target had
 * applied. A release was correctly refused on it: the gate could not report
 * anything, so nobody could tell 2 pending from 191.
 *
 * The dry run now performs the same two READS the live run does. Three
 * properties have to hold, and each is asserted below:
 *
 *   1. it plans against the ledger it read, never an empty map;
 *   2. it stays read-only — the live run creates the ledger before reading it,
 *      and a dry run must not write, so a missing ledger is REPORTED, not
 *      created;
 *   3. a wrangler failure that is not "no such table" propagates. Reporting a
 *      connection or auth error as "nothing applied" is the one lie that would
 *      push someone into an unnecessary --baseline against a live database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { planActions, needsBaseline } from '../../scripts/lib/migrationPlan.mjs';

const SRC = 'scripts/migrate-d1.mjs';
const raw = readFileSync(resolve(process.cwd(), SRC), 'utf8');
const code = codeOnly(raw);

/**
 * The dry-run branch only, so these assertions cannot pass on the live path.
 *
 * Both anchors are CODE. An earlier version of this ended the slice on the
 * `// --- Live run` comment, which `codeOnly()` had already stripped — so the
 * slice failed and four assertions errored instead of testing anything. Never
 * anchor to a comment in text you have deliberately removed comments from.
 */
function dryRunBranch() {
  const i = code.indexOf('if (MODE_DRY_RUN)');
  assert.ok(i > -1, 'could not find the dry-run branch');
  // `appTableRows` is the live run's first statement; `dryTableRows` is the
  // dry run's. They are distinct names precisely so this slice is unambiguous.
  const j = code.indexOf('const appTableRows', i);
  assert.ok(j > i, 'could not find the live-run boundary that ends the dry-run branch');
  return code.slice(i, j);
}

test('the dry run does not plan against a hardcoded empty ledger', () => {
  const branch = dryRunBranch();
  assert.ok(
    !/planActions\(\s*files\s*,\s*new Map\(\)/.test(branch),
    `${SRC} still plans the dry run against an empty map, so its output cannot ` +
      'reflect what the target has applied.',
  );
  assert.ok(
    !/assuming an empty ledger/.test(branch),
    'the dry run still advertises that it is guessing',
  );
});

test('the dry run reads the ledger and the table count from the target', () => {
  const branch = dryRunBranch();
  assert.ok(
    /SELECT filename, checksum FROM/.test(branch),
    'the dry run does not read the migration ledger',
  );
  assert.ok(
    /FROM sqlite_master/.test(branch),
    'the dry run does not count existing tables, so it cannot detect the ' +
      'hand-migrated-database case',
  );
  assert.ok(
    /needsBaseline\(/.test(branch),
    'the dry run never asks whether a live run would refuse',
  );
});

test('the dry run writes nothing', () => {
  const branch = dryRunBranch();
  // LEDGER_DDL is a CREATE TABLE. The live run issues it; a dry run must not.
  assert.ok(
    !/LEDGER_DDL/.test(branch),
    `${SRC} issues the ledger DDL inside the dry run. That is a write, and ` +
      '--dry-run promises to touch nothing.',
  );
  assert.ok(
    /no such table/.test(branch),
    'a missing ledger is not handled, so a dry run against a fresh database throws',
  );
});

test('only a missing ledger is swallowed; other failures propagate', () => {
  const branch = dryRunBranch();
  // The catch must rethrow. A bare catch here would report an auth or network
  // failure as an empty ledger and send the operator into --baseline.
  assert.ok(
    /else throw e;/.test(branch),
    'the dry run swallows every wrangler error, so a connection failure would ' +
      'be reported as "nothing has been applied"',
  );
});

test('planActions distinguishes applied from pending — the behaviour being gated', () => {
  const files = [
    { name: '001_a.sql', sql: 'CREATE TABLE IF NOT EXISTS a(x);', checksum: 'c1' },
    { name: '002_b.sql', sql: 'ALTER TABLE a ADD COLUMN y;', checksum: 'c2' },
    { name: '003_c.sql', sql: 'ALTER TABLE a ADD COLUMN z;', checksum: 'c3' },
  ];

  // An empty ledger — what the dry run used to assume — says everything is pending.
  const blind = planActions(files, new Map(), { mode: 'apply' });
  assert.equal(blind.filter((a) => a.action !== 'skip').length, 3);

  // The real ledger says only the last one is.
  const real = new Map([['001_a.sql', 'c1'], ['002_b.sql', 'c2']]);
  const actual = planActions(files, real, { mode: 'apply' });
  const pending = actual.filter((a) => a.action !== 'skip');
  assert.equal(pending.length, 1, 'expected exactly one pending migration');
  assert.equal(pending[0].file.name, '003_c.sql');

  // 3 vs 1 is precisely the difference the operator could not see.
  assert.notEqual(blind.length - blind.filter((a) => a.action === 'skip').length, pending.length);
});

test('needsBaseline fires only for a populated database with an empty ledger', () => {
  assert.equal(needsBaseline({ mode: 'apply', appliedCount: 0, appTableCount: 40 }), true);
  assert.equal(needsBaseline({ mode: 'apply', appliedCount: 12, appTableCount: 40 }), false);
  assert.equal(needsBaseline({ mode: 'apply', appliedCount: 0, appTableCount: 0 }), false,
    'a genuinely fresh database must migrate normally, not demand a baseline');
  assert.equal(needsBaseline({ mode: 'baseline', appliedCount: 0, appTableCount: 40 }), false,
    'baseline mode is the remedy and must not block on itself');
});
