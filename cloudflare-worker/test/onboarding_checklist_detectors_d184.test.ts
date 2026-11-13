/**
 * D184/D186 — every onboarding-checklist detector, prepared against the real
 * schema. D184 made the twenty-four broken ones visible; D186 repaired them,
 * so the expected-failure list below is now empty and the advisor assertion is
 * inverted. The two tests that did NOT move are the ones that keep this honest:
 * the non-vacuity floor, and the proof that these queries are reachable only
 * through the widened literal scan.
 *
 * `services/onboardingChecklist.ts` carries fifty items across five personas,
 * all of them `autoDetect: true`, and each runs one query through `num()`:
 *
 *     async function num(env, sql, ...binds) {
 *       try { … } catch { return 0; }
 *     }
 *
 * A query naming a table or column that does not exist therefore throws inside
 * `num`, returns 0, fails `0 > 0`, upserts no row, and the item renders
 * `pending`. Forever, for every account. The route answers 200 and NOTHING is
 * logged — `loadChecklist`'s own `console.warn` sits outside a catch that can
 * never fire, because `num` already swallowed it.
 *
 * THE FILE PREDICTED THIS. Its header, lines 20-29, describes the same defect
 * in the past tense: `op.service` named `services_offerings`, a typo for a
 * table that exists everywhere, and "the item read 'not done' for every
 * operator, forever, with nothing anywhere to notice." It ends with the rule —
 * *"a swallowed query is indistinguishable from an honest zero"* — and what
 * that lesson bought was one hand-written assertion in
 * `frontend/test/migration_column_shapes.test.mjs` watching `op.service`
 * alone. The other forty-nine went unwatched, and twenty-four of them are the
 * very defect the header warns about.
 *
 * WHY THIS TEST CAN EXIST NOW AND COULD NOT BEFORE. `sqlStrings()` harvested
 * only a literal sitting next to `.prepare(`, `.exec(` or the `sql` tag. Every
 * detect query is `num(env, \`SELECT …\`, userId)` — the `.prepare(` is inside
 * `num`, on the `sql` variable — so all forty-four were invisible to the three
 * SQL guards AND to any test built on the same extractor. D184 widened the
 * harvest to every literal in a file; `everyDetectQueryCameFromTheWidening`
 * below is what keeps that from silently regressing.
 *
 * The database is the real one — `schema_baseline.sql` plus every post-cutoff
 * migration — because a hand-written fixture is how this class hides. #203 was
 * exactly that, and `board_lanes.test.ts` says so in its own header.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/onboarding_checklist_detectors_d184.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { sqlStrings } from '../../scripts/check-sqlite-dialect.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { splitStatements } from './_baseline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const MIGRATIONS = resolve(SQL, 'migrations');
const SERVICE = resolve(HERE, '../src/services/onboardingChecklist.ts');
const SRC = readFileSync(SERVICE, 'utf8');

/** A new environment's schema: the baseline, then every migration past it. */
function freshDb(): InstanceType<typeof DatabaseSync> {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const name of readdirSync(MIGRATIONS)
    .filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF)
    .sort((a, b) => migrationNumber(a) - migrationNumber(b) || a.localeCompare(b))) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, name), 'utf8'))) {
      try { db.exec(stmt); } catch { /* fresh-build failures are migrations_fresh_build's to report */ }
    }
  }
  return db;
}

/**
 * The `detect()` switch, bounded at both ends.
 *
 * Bounded rather than whole-file because the file's other nine literals are the
 * checklist's own bookkeeping DDL and progress reads — real, working SQL that
 * would dilute the count this test is about.
 */
function detectQueries(): Array<{ body: string; line: number; kind: string }> {
  const from = SRC.indexOf('async function detect(');
  assert.ok(from > 0, 'detect() is gone, so this test is aimed at nothing');
  const to = SRC.indexOf('export interface ChecklistRow', from);
  assert.ok(to > from, 'the marker that ends the detect switch moved');
  const region = SRC.slice(from, to);
  const before = SRC.slice(0, from).split('\n').length - 1;
  return sqlStrings(region).map((q) => ({ ...q, line: q.line + before }));
}

/** Which of them SQLite refuses to prepare against the real schema. */
function unpreparable(): Map<string, string> {
  const db = freshDb();
  const bad = new Map<string, string>();
  for (const { body, line } of detectQueries()) {
    try {
      db.prepare(body).finalize?.();
    } catch (e: any) {
      bad.set(`${line}`, String(e?.message || e).replace(/^.*?:\s*/, ''));
    }
  }
  return bad;
}

// ---------------------------------------------------------------------------

test('the detect switch is read in full, and only the widening can read it', () => {
  const qs = detectQueries();
  // Non-vacuity. A number far below the real one means the region bound or the
  // extractor stopped working, and a test that silently examines three queries
  // is worse than none.
  //
  // THE FLOOR MOVED WITH D186, and the arithmetic is the justification rather
  // than the observation: the switch held 44 queries and now holds 39, because
  // five arms were DELETED on purpose — the four whose fact nothing stores
  // (ef.ip, op.conflicts, op.refs, mt.refs, all now autoDetect:false) and
  // ef.captable's dead captable_holders arm. 44 − 5 = 39. The floor keeps the
  // margin it had before (4 under the true count), so it still catches a
  // collapse without failing on the next deliberate deletion.
  assert.ok(qs.length >= 35,
    `only ${qs.length} detect queries were read — the region bound or sqlStrings is broken`);

  // THE PROOF THE WIDENING IS LOAD-BEARING. Every one of these reaches D1
  // through `num(env, sql, …)`, so none of them sits next to `.prepare(`,
  // `.exec(` or the `sql` tag. If any ever carries an anchored `kind`, the
  // file has been rewritten and this test's premise needs re-reading; if they
  // ALL do, the widening has been reverted and the guards are blind again.
  const anchored = qs.filter((q) => q.kind !== 'literal');
  assert.equal(anchored.length, 0,
    `${anchored.length} detect queries came from the anchored pass — expected all `
    + 'to be reachable only through the whole-file literal scan');
});

test('every auto-detected checklist item can be satisfied — the list is empty', () => {
  const bad = unpreparable();
  const lines = [...bad.keys()].map(Number).sort((a, b) => a - b);

  // D184 FOUND TWENTY-FOUR HERE; D186 REPAIRED THEM AND THIS LIST IS NOW EMPTY.
  // Each was a detect query SQLite refuses against the shipped schema, with an
  // identical consequence: num() returns 0, the item never completes, and
  // nobody is told. Twenty were repointed at the store that holds the fact, one
  // (ef.captable's captable_holders arm) was deleted as dead weight because the
  // cap_table_holders arm beside it already worked, and four whose fact nothing
  // stores anywhere — ef.ip, op.conflicts, op.refs, mt.refs — became
  // autoDetect:false with their arms deleted, so the user ticks them by hand.
  //
  // DELETING THE ARM IS NOT OPTIONAL for those four: a dead `case` keeps its
  // literal harvestable, which keeps its baseline entry alive, and both
  // check-sqlite-* guards refuse a STALE entry as loudly as a new one. That
  // refusal is what proved each repair landed.
  //
  // THIS LIST IS NOT THE GUARDS' LIST, AND THE DIFFERENCE IS THE POINT. The
  // three check-sqlite-* guards ask "does the repo declare this anywhere",
  // unioning every file under sql/. This asks "does a freshly provisioned
  // database have it" — baseline plus post-cutoff migrations, which is what
  // migrate-d1 --bootstrap builds. captable_holders and references_records are
  // declared in migrations/034 and exist in neither the baseline nor
  // production, so the guards called them known and only a fresh-build fixture
  // could see them. That migration declaring tables the baseline lacks is
  // baseline drift, which check-baseline-drift owns.
  assert.deepEqual(lines, [],
    'a detect query no longer prepares against a fresh build — a repoint is wrong, or a new '
    + `item shipped naming something that does not exist: ${[...bad].map(([l, m]) => `${l} (${m})`).join('; ')}`);
});

test('the advisor catalogue CAN now reach the celebration threshold', () => {
  // THE SHARPEST SINGLE CONSEQUENCE, INVERTED. Seven of the advisor's ten items
  // were among the broken set while CELEBRATION_THRESHOLD is an absolute 8, so
  // an advisor who completed everything the platform could observe reached 3 of
  // 10 and the checklist never finished for them. That is why wholesale removal
  // was never an option for mt.*: dropping the broken ones would have put the
  // threshold out of reach by a different route.
  //
  // The window is derived from the section comment rather than typed, because
  // the line numbers move every time this switch is edited — which is exactly
  // what a repair does.
  const from = SRC.slice(0, SRC.indexOf('// ----- advisor side-effects -----')).split('\n').length;
  const mt = detectQueries().filter((q) => q.line >= from);
  assert.ok(mt.length >= 5, `only ${mt.length} mt.* queries found — the section comment moved`);

  const bad = new Set([...unpreparable().keys()].map(Number));
  const broken = mt.filter((q) => bad.has(q.line));
  assert.deepEqual(broken.map((q) => q.line), [],
    `${broken.length} advisor detectors still cannot prepare, so the advisor checklist still `
    + 'cannot finish — the whole point of the repair');

  // The threshold is an absolute count, so reachability is a claim about the
  // CATALOGUE, not about the detectors alone: an item the user ticks by hand
  // counts toward it exactly like a detected one.
  const threshold = /CELEBRATION_THRESHOLD\s*=\s*(\d+)/.exec(SRC);
  assert.ok(threshold, 'CELEBRATION_THRESHOLD is gone');
  assert.equal(Number(threshold![1]), 8,
    'the threshold is an absolute count, not a ratio — changing it changes which personas '
    + 'can ever finish');

  const advisorItems = [...SRC.matchAll(/\{ key: 'mt\.[a-z_]+'/g)].length;
  assert.ok(advisorItems >= Number(threshold![1]),
    `the advisor catalogue has ${advisorItems} items against a threshold of ${threshold![1]} — `
    + 'the celebration is unreachable by construction');
});

test('a swallowed query is why none of this was visible', () => {
  // The mechanism, pinned. If `num` ever rethrows, these items start failing
  // loudly instead of silently — a better world, and one that makes the
  // assertions above describe something else, so it must not change unnoticed.
  const numFn = SRC.slice(SRC.indexOf('async function num('), SRC.indexOf('async function detect('));
  assert.match(numFn, /catch\s*\{\s*\n?\s*return 0;/,
    'num() no longer swallows — re-read what the checklist does on a bad query');
  assert.doesNotMatch(numFn, /console\.(warn|error)/,
    'num() gained a log line; if a bad query is now reported, say so in D184 rather '
    + 'than leaving this suite describing a silence that has ended');
});
