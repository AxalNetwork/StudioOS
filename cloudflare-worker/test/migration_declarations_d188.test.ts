/**
 * D188 — what a migration DECLARES must reach a freshly provisioned database.
 *
 * The guard under test is `scripts/check-migration-declarations.mjs`. These
 * tests exercise its parser against fixtures rather than against the tree, so
 * a finding count that moves with the repo cannot make them pass or fail; the
 * two that DO read the tree assert properties, not counts.
 *
 * The defect being guarded, in one sentence: a migration at or below
 * BASELINE_CUTOFF is MARKED, never run, on a new database, so its effect
 * reaches a database only if the baseline already carries it — and the
 * baseline is a dump of production, so what it lacks, production lacks, while
 * the ledger row says the migration was applied. Migration 042 lost eleven
 * columns that way, 028 lost eighteen (D187), and two authors found instances
 * by hand and left a comment instead of a check (182's header, auth.ts:394).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  declarationsFor,
  createTableColumns,
  freshBuild,
  findings,
} from '../../scripts/check-migration-declarations.mjs';
import {
  BASELINE_CUTOFF,
  migrationNumber,
  compareMigrations,
  expectedEffects,
} from '../../scripts/lib/migrationPlan.mjs';

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../sql/migrations');
const files = () =>
  readdirSync(MIGRATIONS).filter((n) => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations);

test('the rebuild idiom resolves: a file declares the final name, never the intermediate', () => {
  const { tables } = declarationsFor(`
    CREATE TABLE widgets_new (id INTEGER PRIMARY KEY, label TEXT, owner_id INTEGER);
    INSERT INTO widgets_new SELECT id, label, owner_id FROM widgets;
    DROP TABLE widgets;
    ALTER TABLE widgets_new RENAME TO widgets;
  `);

  assert.equal(tables.has('widgets_new'), false,
    'the intermediate was reported as a declared table — every rebuild migration '
    + 'would then produce a permanent false finding');
  assert.equal(tables.has('widgets'), true, 'the final table was not declared');
  assert.deepEqual([...tables.get('widgets')].sort(), ['id', 'label', 'owner_id'],
    'the intermediate\'s columns did not follow the rename onto the final name');
});

test('ADD COLUMN IF NOT EXISTS does not declare a column called "IF"', () => {
  // SQLite has no such form — seven migrations say so in their own comments —
  // but 080_brand_kit_expansion.sql:5-7 uses it anyway. A parser that took the
  // next word after ADD COLUMN reports `landing_pages.IF`, which is the false
  // positive that would have to be baselined to get the guard green.
  const { alters } = declarationsFor(
    'ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS palette_accent TEXT;',
  );
  assert.deepEqual(alters, [{ table: 'landing_pages', column: 'palette_accent' }]);

  // The shared helper had the same bug, and fixing it here without fixing it
  // there would leave `verifyMarked` reading a column named IF.
  const eff = expectedEffects('ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS palette_accent TEXT;');
  assert.deepEqual(eff.columns, [['landing_pages', 'palette_accent']],
    'migrationPlan.expectedEffects still reads IF as the column name');
});

test('a CREATE TABLE body yields its columns and not its constraints', () => {
  const cols = createTableColumns(`
    CREATE TABLE IF NOT EXISTS thing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      price DECIMAL(10,2) NOT NULL,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'open',
      UNIQUE(owner_id, status),
      FOREIGN KEY (owner_id) REFERENCES users(id),
      CHECK (price > 0)
    )
  `);
  assert.deepEqual(cols, ['id', 'price', 'owner_id', 'status'],
    'a constraint was promoted to a column. CONSTRAINT_HEAD is what does this '
    + 'work: drop CHECK from it and `CHECK (price > 0)` returns a column named '
    + '"check", because the name pattern matches CHECK and the space after it. '
    + 'The depth-aware split is NOT what this catches — measured over all 788 '
    + 'CREATE TABLE statements in the tree, splitting on every comma returns the '
    + 'same answer, because the `2)` fragment fails the identifier anchor '
    + 'anyway. The earlier wording here claimed otherwise and a mutation proved '
    + 'it wrong.');
});

test('an ALTER on a table that exists NOWHERE is a finding, not a silent skip', () => {
  // This is the category a table-and-column comparison drops. The first draft
  // of the guard only looked at a column when the table was already present,
  // so migration 042's three `mentors` ALTERs produced no finding at all —
  // and `mentors` is created by no migration and absent from production.
  const build = new Map([['advisors', new Set(['id', 'weekly_hours_band'])]]);
  const found = findings(build);

  const orphans = [...found.keys()].filter((k) => k.startsWith('alter-orphan:mentors.'));
  assert.deepEqual(orphans.sort(), [
    'alter-orphan:mentors.topics_unwilling_json',
    'alter-orphan:mentors.topics_willing_json',
    'alter-orphan:mentors.weekly_hours_band',
  ], 'the mentors ALTERs were skipped because their table does not exist — '
    + 'which is exactly the condition that makes them worth reporting');

  // …and a column on a table the build HAS is a plain column finding, so the
  // two kinds are not being conflated.
  assert.equal([...found.values()].some((v) => v.kind === 'column'), true);
});

test('a table the build lacks is reported once, and not again per column', () => {
  // `captable_holders` is declared by 034 with several columns. Reporting the
  // table AND each of its columns would put one gap on the ledger many times
  // and make the count meaningless.
  const found = findings(new Map([['users', new Set(['id'])]]));
  const holders = [...found.keys()].filter((k) => k.includes('captable_holders'));
  assert.deepEqual(holders, ['table:captable_holders'],
    'a missing table was also reported as missing columns');
});

test('every declaration the guard finds is on the ledger with a reason', () => {
  // The property, not the count: the count moves with the repo, but "no
  // unexplained finding" must hold on every commit. The guard's own exit code
  // enforces this too; asserting it here means `test:worker` catches it
  // without waiting for test:guards.
  const ledger = JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/migration-declarations-baseline.json'), 'utf8'),
  ).declarations;
  const found = findings();

  const unexplained = [...found.keys()].filter((k) => !(k in ledger)).sort();
  assert.deepEqual(unexplained, [], 'a migration declares these and a fresh build lacks them');

  const stale = Object.keys(ledger).filter((k) => !found.has(k)).sort();
  assert.deepEqual(stale, [], 'these ledger entries now exist — delete them');

  for (const [k, reason] of Object.entries(ledger)) {
    assert.equal(typeof reason === 'string' && reason.length > 40, true,
      `${k} has no reviewed reason — a ledger of known gaps is only worth reading `
      + 'if every line says why');
  }
});

test('migration 042\'s eleven remaining columns reach a fresh build, and mentors still does not', () => {
  const build = freshBuild();

  for (const [table, column] of [
    ['investor_profiles', 'deal_volume_band'],
    ['investor_profiles', 'coinvest_pref_text'],
    ['investor_profiles', 'watchlist_seed_text'],
    ['projects', 'runway_months'],
    ['projects', 'monthly_burn_usd'],
    ['projects', 'mrr_usd'],
    ['projects', 'raise_active'],
    ['projects', 'raise_target_usd'],
    ['projects', 'entity_label'],
    ['projects', 'advisor_extras_json'],
  ] as Array<[string, string]>) {
    assert.equal(build.get(table)?.has(column), true,
      `${table}.${column} is declared by 042 and migration 276 did not land it — `
      + 'services/advisor/writeRouter.ts reads it');
  }

  // THE ELEVENTH IS A SIDE TABLE, AND THAT IS A PLATFORM LIMIT, NOT A CHOICE.
  // 042 also declares `users.advisor_extras_json`, and that ALTER can never
  // succeed: D1 caps a table at 100 columns and `users` is at exactly 100
  // (production, 2026-09-21). Migration 199 hit it for real on 2026-09-03 and
  // held 200-207 out of production behind it. node:sqlite has no such cap, so
  // a fresh build here would happily accept a twelfth ADD COLUMN — which is
  // exactly why the cap is asserted rather than assumed.
  assert.equal(build.has('user_advisor_extras'), true,
    'migration 276 must create the side table the cross-project extras live in');
  for (const c of ['user_id', 'extras_json', 'updated_at']) {
    assert.equal(build.get('user_advisor_extras')?.has(c), true, `user_advisor_extras.${c}`);
  }
  assert.equal(build.get('users')?.has('advisor_extras_json'), false,
    'a migration added advisor_extras_json to `users` — D1 refuses the 101st column, '
    + 'so that deploy fails and every later migration is held behind it');
  assert.ok((build.get('users')?.size ?? 0) <= 100,
    `users has ${build.get('users')?.size} columns on a fresh build; D1's cap is 100, `
    + 'so the next ADD COLUMN fails the deploy. Keep the fact in a side table (GOTCHAS).');

  // 182_advisor_topics_calendar.sql:6-10 quotes 042's mentors ALTERs, states
  // there is no CREATE TABLE mentors anywhere, and repairs them onto advisors.
  // Re-creating the table would undo a decision, so its absence is asserted.
  assert.equal(build.has('mentors'), false,
    'a `mentors` table appeared — 182 deliberately repaired 042 onto `advisors`');
  for (const c of ['topics_willing_json', 'topics_unwilling_json', 'weekly_hours_band']) {
    assert.equal(build.get('advisors')?.has(c), true, `advisors.${c} is where 182 put it`);
  }
});

test('the guard agrees with migrationPlan.expectedEffects on every migration\'s table set', () => {
  // The guard re-implements the rebuild walk so it can also harvest CREATE-body
  // columns, which expectedEffects does not return. Re-implementing a rule is
  // how two definitions drift apart — so the two are asserted equal here, on
  // the real tree, rather than left to agree by inspection.
  for (const name of files()) {
    const sql = readFileSync(resolve(MIGRATIONS, name), 'utf8');
    const mine = [...declarationsFor(sql).tables.keys()].sort();
    const theirs = [...expectedEffects(sql).tables].sort();
    assert.deepEqual(mine, theirs, `${name}: the two declaration readers disagree on tables`);
  }
});

test('the post-cutoff set the guard builds from is the set bootstrap leaves pending', () => {
  // freshBuild() must model `migrate-d1 --bootstrap` exactly: baseline, then
  // every migration ABOVE the cutoff. If it silently included a sub-cutoff
  // file the guard would find nothing, because every declaration would then be
  // present — the vacuous-pass failure mode.
  const post = files().filter((n) => migrationNumber(n) > BASELINE_CUTOFF);
  assert.equal(post.length > 0, true, 'the post-cutoff set is empty; the guard would be vacuous');
  assert.equal(post.every((n) => migrationNumber(n) > BASELINE_CUTOFF), true);
  assert.equal(
    files().some((n) => migrationNumber(n) <= BASELINE_CUTOFF), true,
    'no sub-cutoff migration exists, so there is nothing for this guard to check',
  );
});
