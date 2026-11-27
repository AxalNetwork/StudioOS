/**
 * D5398 (#5398) — a migration's identity is its minute AND its issue, so two PRs writing a migration in the same
 * UTC minute can no longer collide and turn main and every open PR red (the 202611072219 and 202611092035 pairs).
 *
 *  · from DISCRIMINATOR_FROM a stamped name is `YYYYMMDDHHMM_<issue>_<slug>.sql`; one without the issue is refused;
 *  · every file stamped before the cut-off keeps its name (D269), and every file on main still passes;
 *  · two synthetic PRs in one minute for two issues pass together; the same minute and issue twice still fails;
 *  · the order stays deterministic and the existing `/^\d+_.*\.sql$/` filters still read the new form.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/migration_identity_5398.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DISCRIMINATOR_FROM, compareMigrations, migrationDuplicates, migrationIdentity, migrationIssue, migrationNameProblem, migrationStamp,
} from '../../scripts/lib/migrationPlan.mjs';

const REAL = path.resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const realNames = () => fs.readdirSync(REAL).filter((n) => n.endsWith('.sql'));
const AFTER = '202611111015';
const BEFORE = '202611101015';

test('the cut-off is in the future of every file on main, and every file on main still passes', () => {
  assert.equal(DISCRIMINATOR_FROM, '202611110000');
  for (const n of realNames()) {
    const stamp = migrationStamp(n);
    if (stamp && !migrationIssue(n)) assert.ok(stamp < DISCRIMINATOR_FROM, `${n} predates the cut-off`);
  }
  assert.deepEqual(realNames().map(migrationNameProblem).filter(Boolean), []);
  assert.deepEqual(migrationDuplicates(realNames()), []);
});

test('from the cut-off a new migration names its issue; before it, the minute alone still passes', () => {
  assert.equal(migrationNameProblem(`${AFTER}_5398_ci_state.sql`), null);
  assert.match(migrationNameProblem(`${AFTER}_ci_state.sql`)!, /YYYYMMDDHHMM_<issue>_<slug>\.sql \(D5398\)/);
  assert.match(migrationNameProblem(`${DISCRIMINATOR_FROM}_ci_state.sql`)!, /D5398/, 'the cut-off minute itself needs the issue');
  assert.equal(migrationNameProblem(`${BEFORE}_ci_state.sql`), null, 'an open PR written before the cut-off keeps passing');
  assert.equal(migrationNameProblem(`${BEFORE}_5398_ci_state.sql`), null, 'the new form is accepted early');
  for (const bad of [`${AFTER}_0_slug.sql`, `${AFTER}_5398_.sql`, `${AFTER}_5398_Upper.sql`, `${AFTER}_5398_9lives.sql`, `${AFTER}_12345678_slug.sql`]) {
    assert.ok(migrationNameProblem(bad), bad);
  }
});

test('two PRs in the same minute for two issues pass together; the same minute and issue twice is refused, naming both', () => {
  const a = `${AFTER}_5398_ci_state.sql`;
  const b = `${AFTER}_5401_ledger_cap.sql`;
  assert.deepEqual(migrationDuplicates([...realNames(), a, b]), [], 'the union of two parallel PRs passes');
  assert.deepEqual(migrationDuplicates([a, `${AFTER}_5398_other.sql`]), [`${AFTER}_5398_ci_state.sql and ${AFTER}_5398_other.sql share the stamp ${AFTER} and the issue 5398.`]);
  assert.deepEqual(migrationDuplicates([`${BEFORE}_a.sql`, `${BEFORE}_b.sql`]).length, 1, 'the old form still collides on its minute');
  assert.deepEqual(migrationDuplicates([`${BEFORE}_a.sql`, `${BEFORE}_5398_b.sql`]), [], 'an old-form and a new-form file are two identities');
});

test('identity, issue and order are deterministic, and the old filters still read the new form', () => {
  assert.equal(migrationIssue(`${AFTER}_5398_ci_state.sql`), '5398');
  assert.equal(migrationIssue(`${BEFORE}_ci_state.sql`), null);
  assert.equal(migrationIssue('763_x.sql'), null);
  assert.equal(migrationIdentity(`${AFTER}_5398_ci_state.sql`), `t${AFTER}_5398`);
  assert.equal(migrationIdentity(`${BEFORE}_ci_state.sql`), `t${BEFORE}`);
  assert.equal(migrationIdentity('763_x.sql'), 'n763');
  const names = [`${AFTER}_5401_b.sql`, '763_x.sql', `${AFTER}_5398_a.sql`, `${BEFORE}_old.sql`];
  assert.deepEqual([...names].sort(compareMigrations), ['763_x.sql', `${BEFORE}_old.sql`, `${AFTER}_5398_a.sql`, `${AFTER}_5401_b.sql`]);
  assert.deepEqual([...names].reverse().sort(compareMigrations), [...names].sort(compareMigrations), 'any input order gives one order');
  assert.ok(/^\d+_.*\.sql$/.test(`${AFTER}_5398_a.sql`));
});
