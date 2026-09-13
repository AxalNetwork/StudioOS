/**
 * The reasoning behind a market size, which used to be lost when a tab closed.
 *
 * `SpinoutLabMarketPage` saves three numbers — `projects.tam`, `.sam`, `.som` —
 * and until migration 247 it dropped the twelve inputs that produced them. Its
 * own comment asked for this table. What the page kept was the CONCLUSION with
 * none of the derivation, on a page whose claim is that its figures are derived
 * rather than invented.
 *
 * THE CASES PINNED HERE ARE THE ONES WHERE A FAILURE IS SILENT. A patch that
 * behaves as a replace blanks eleven values a founder typed; a cleared field that
 * stores an empty string instead of NULL makes `filledColumns` think Eadwyn's
 * figure was replaced rather than removed; an unknown key that is dropped instead
 * of rejected shows a save that worked and a value that never comes back. None of
 * those looks like an error on screen.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs --test \
 *     cloudflare-worker/test/market_assumptions_store.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ASSUMPTION_COLUMNS, ASSUMPTION_KEYS,
  loadAssumptions, sanitizeAssumptions, saveAssumptions, saveOneAssumption,
} from '../src/services/marketAssumptions.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(HERE, '..', p), 'utf8');
const MIGRATION = '247_project_market_assumptions';

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first(col?: string) {
          const r = db.prepare(sql).get(...b) ?? null;
          return col === undefined ? r : ((r as any)?.[col] ?? null);
        },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

/**
 * THE DDL COMES FROM THE MIGRATION. A fixture typed by hand is a second schema
 * that drifts in silence, and this file's whole subject is a store agreeing with
 * itself — including the DEFAULTs, which are the two places this table says
 * anything on its own.
 */
function tableFromMigration(): string {
  const src = readFileSync(resolve(HERE, `../sql/migrations/${MIGRATION}.sql`), 'utf8');
  const at = src.indexOf('CREATE TABLE IF NOT EXISTS project_market_assumptions');
  assert.ok(at >= 0, `${MIGRATION} no longer creates project_market_assumptions`);
  const end = src.indexOf('\n);', at);
  assert.ok(end > at, 'the DDL does not close the way this reader expects');
  return `${src.slice(at, end)}\n);`;
}

const P = 8100;
function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(tableFromMigration());
  return db;
}
const env = (db: InstanceType<typeof DatabaseSync>) => ({ DB: makeD1(db) }) as any;

test('a project with nothing on record reads as every field empty', async () => {
  // NOT as a row of defaults. The page's rule, on screen, is "empty means not
  // researched yet", and a market figure invented by a schema default would be
  // indistinguishable from one a founder supplied.
  const a = await loadAssumptions(env(freshDb()), P);
  assert.equal(a.population, null);
  assert.equal(a.acv, null);
  assert.equal(a.cagr, null);
  assert.deepEqual(a.segFilter, []);
  assert.equal(a.updated_at, null, 'an absent row claims to have been updated');
});

test('what the drawer sends comes back, and the row is created on first save', async () => {
  const db = freshDb();
  const { assumptions, rejected } = await saveAssumptions(env(db), P, {
    category: 'Supply chain software',
    geography: 'Europe',
    targetYear: '2027',
    methodology: 'Bottom-up',
    population: '41,200 firms',
    acv: '$18,000 / year',
    samPct: '14',
    winRate: '8',
    cagr: '11',
    growthDriver: 'Compliance deadlines',
    segFilter: ['Mid-market', 'Enterprise'],
  }, 55);
  assert.deepEqual(rejected, []);
  assert.equal(assumptions.population, '41,200 firms');
  assert.equal(assumptions.acv, '$18,000 / year');
  assert.equal(assumptions.methodology, 'Bottom-up');
  assert.deepEqual(assumptions.segFilter, ['Mid-market', 'Enterprise']);
  assert.ok(assumptions.updated_at, 'a saved row does not say when it was saved');
  assert.equal(
    Number((db.prepare('SELECT COUNT(*) AS n FROM project_market_assumptions').get() as any).n), 1,
    'one save per project, or the UNIQUE is not doing its job',
  );
  assert.equal(
    Number((db.prepare('SELECT updated_by AS u FROM project_market_assumptions').get() as any).u), 55,
  );
});

test('a second save patches and does not replace — the reason a fill can write one field', async () => {
  // THE CASE THE WHOLE STORE IS SHAPED AROUND. A `sourced` fill accepts one
  // figure with one citation, and a replace would blank the eleven the founder
  // typed. Nothing on screen would say so: the drawer would simply be empty next
  // time it opened.
  const db = freshDb();
  await saveAssumptions(env(db), P, {
    geography: 'Europe', population: '41,200 firms', acv: '$18,000 / year', cagr: '11',
  }, 55);
  const after = await saveOneAssumption(env(db), P, 'population', '52,000 firms', 77);
  assert.equal(after.population, '52,000 firms');
  assert.equal(after.acv, '$18,000 / year', 'accepting one figure blanked another');
  assert.equal(after.geography, 'Europe');
  assert.equal(after.cagr, '11');
  assert.equal(
    Number((db.prepare('SELECT COUNT(*) AS n FROM project_market_assumptions').get() as any).n), 1,
    'the second save appended a row instead of patching one',
  );
});

test('a cleared field comes back as NULL, not as an empty string', async () => {
  // The page renders '' and null the same, so this looks like nothing. It is not:
  // `filledColumns` compares a provenance row's `written_value` against what the
  // row holds now, and an empty string would read as a value Eadwyn's figure was
  // REPLACED by rather than as a figure that was removed — so a card would keep
  // claiming Eadwyn supplied a number that is no longer there.
  const db = freshDb();
  await saveAssumptions(env(db), P, { population: '41,200 firms' }, 55);
  const cleared = await saveAssumptions(env(db), P, { population: '   ' }, 55);
  assert.equal(cleared.assumptions.population, null);
  assert.equal(
    db.prepare('SELECT population FROM project_market_assumptions').get() as any
      && (db.prepare('SELECT population FROM project_market_assumptions').get() as any).population,
    null, 'the column holds an empty string rather than NULL',
  );
});

test('an unknown field is rejected by name rather than dropped', async () => {
  // A field name the client got wrong is a control that appears to work: the save
  // succeeds, the figure never comes back, and nothing says why.
  const { rejected, patch } = sanitizeAssumptions({ population: '1', tamm: '9', segFilter: 'not-an-array' });
  assert.deepEqual(rejected.sort(), ['segFilter', 'tamm']);
  assert.deepEqual(Object.keys(patch), ['population'], 'an unknown key reached the patch');

  // And the route checks BEFORE writing, so a 400 never describes a request that
  // changed the row.
  const route = read('src/routes/projects.ts');
  const at = route.indexOf("projects.put('/:projectId/market-assumptions'");
  assert.ok(at > 0, 'the market-assumptions PUT is gone');
  const body = route.slice(at, route.indexOf('\n});', at));
  assert.ok(body.indexOf('sanitizeAssumptions(raw)') < body.indexOf('await saveAssumptions('),
    'the rejection check runs after the write, so a 400 can follow a changed row');
});

test('the keys the store accepts are the keys it tells a caller about', async () => {
  // The GET hands the drawer `keys` so it cannot send a field the server will
  // reject and find out from a 400. A list that drifted from the map would be
  // worse than no list — it would name fields that do not work.
  assert.deepEqual(
    [...ASSUMPTION_KEYS].sort(),
    [...Object.keys(ASSUMPTION_COLUMNS), 'segFilter'].sort(),
  );
  // Every column the map names exists in the migration, spelled the same way.
  const migration = read(`sql/migrations/${MIGRATION}.sql`);
  for (const column of Object.values(ASSUMPTION_COLUMNS)) {
    assert.match(migration, new RegExp(`^    ${column} TEXT`, 'm'),
      `${column} is in the column map and not in migration 247`);
  }
  assert.match(migration, /^    seg_filter_json TEXT,$/m);
  // And a round trip proves the spelling, not just the grep.
  const db = freshDb();
  const all: Record<string, string> = {};
  for (const key of Object.keys(ASSUMPTION_COLUMNS)) all[key] = `v-${key}`;
  const { assumptions, rejected } = await saveAssumptions(env(db), P, all, 1);
  assert.deepEqual(rejected, []);
  for (const key of Object.keys(ASSUMPTION_COLUMNS)) {
    assert.equal((assumptions as any)[key], `v-${key}`, `${key} did not round-trip`);
  }
});

test('a field this store has no column for throws rather than writing nothing', async () => {
  // `saveOneAssumption` is the fill path's entry point, and a fill that appeared
  // to be accepted and changed nothing is exactly the silent failure the accept
  // route's claim-then-revert exists to prevent.
  await assert.rejects(
    () => saveOneAssumption(env(freshDb()), P, 'tam', '1000000', 1),
    /no market assumption called tam/,
  );
});

test('a malformed segment list reads as none rather than throwing on load', async () => {
  const db = freshDb();
  await saveAssumptions(env(db), P, { population: '1' }, 1);
  db.prepare('UPDATE project_market_assumptions SET seg_filter_json = ? WHERE project_id = ?')
    .run('{not json', P);
  const a = await loadAssumptions(env(db), P);
  assert.deepEqual(a.segFilter, [], 'a corrupt filter blob takes the whole drawer down with it');
  assert.equal(a.population, '1', 'and the rest of the row is still readable');
});

test('one row per project — a second project does not overwrite the first', async () => {
  const db = freshDb();
  await saveAssumptions(env(db), P, { population: 'theirs' }, 1);
  await saveAssumptions(env(db), P + 1, { population: 'ours' }, 2);
  assert.equal((await loadAssumptions(env(db), P)).population, 'theirs');
  assert.equal((await loadAssumptions(env(db), P + 1)).population, 'ours');
});

test('the migration carries no transaction statement', () => {
  // Migration 200 failed a production deploy this way: D1's HTTP API rejects
  // BEGIN/COMMIT inside a migration file. `check-sql-migrations.mjs` enforces it
  // repo-wide; this is the same check where this table's own test can see it.
  const migration = read(`sql/migrations/${MIGRATION}.sql`);
  assert.doesNotMatch(migration, /^\s*(BEGIN|COMMIT|ROLLBACK)\b/mi);
  assert.match(migration, /UNIQUE REFERENCES projects\(id\) ON DELETE CASCADE/,
    'the row no longer goes when its project does');
});
