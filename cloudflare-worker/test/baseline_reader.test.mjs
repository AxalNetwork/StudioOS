/**
 * `_baseline.mjs` holds every property its regex predecessor had.
 *
 * WHY THIS FILE EXISTS. Three fixtures — `board_lanes`, `okr_move_log`,
 * `traction_snapshots` — used to carry their own copy of
 *
 *     new RegExp(`^CREATE TABLE (?:IF NOT EXISTS )?"?${name}"?\\s*\\(`, 'im')
 *
 * and Semgrep flagged all three (`detect-non-literal-regexp`, alerts 6088-6090).
 * Rewriting a matcher is where a "safe" change quietly narrows what it matches,
 * and NOTHING WOULD HAVE CAUGHT IT: those three fixtures ask for four tables
 * between them, all unquoted, all uniquely named. A rewrite that dropped quote
 * tolerance or the trailing boundary would have passed the whole suite and then
 * broken the next fixture — or worse, silently resolved the wrong table, which is
 * the #203 failure the baseline reader exists to prevent.
 *
 * So the cases below are chosen for what the callers do NOT exercise, and every
 * one is read out of the real `schema_baseline.sql` rather than a string written
 * here to suit the assertion.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *        --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/baseline_reader.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tableFromBaseline, stripForeignKeys, wordInText } from './_baseline.mjs';
import { codeOnly } from './_codeOnly.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE = readFileSync(resolve(HERE, '../sql/schema_baseline.sql'), 'utf8');

/**
 * What the three deleted helpers computed, kept here as the thing to match.
 *
 * THIS IS THE POINT OF THE FILE and not a redundant second implementation: the
 * extraction is only safe if it returns what today's callers already receive, so
 * the old expression is preserved as the oracle rather than as the reader. It is
 * built from a literal, never from `name`, so it is not the construction Semgrep
 * flagged — the interpolation was the finding, not the regex.
 */
function asTheRegexDid(name) {
  const m = /^CREATE TABLE (?:IF NOT EXISTS )?"?([A-Za-z0-9_]+)"?\s*\(/gim;
  for (const hit of BASELINE.matchAll(m)) {
    if (hit[1] !== name) continue;
    const end = BASELINE.indexOf(');', hit.index);
    return BASELINE.slice(hit.index, end + 2);
  }
  return null;
}

test('the reader returns byte-for-byte what the regex it replaced returned', () => {
  // The four tables the live fixtures actually ask for. If the extraction changed
  // a byte of any of them, three suites are now running against a different
  // schema than they were — which would show up as a passing test over the wrong
  // table, the failure mode that is worth pinning rather than trusting.
  for (const name of ['mvp_tasks', 'roadmap_okrs', 'metrics_snapshots', 'projects']) {
    const old = asTheRegexDid(name);
    assert.ok(old, `${name} left the baseline, so this oracle is measuring nothing`);
    assert.equal(tableFromBaseline(BASELINE, name), old, `${name}'s DDL changed under the rewrite`);
  }
});

test('a quoted table name resolves — seven of them are quoted in the baseline', () => {
  // NOT A HYPOTHETICAL. `"advisors"`, `"capital_calls"`, `"landing_pages"`,
  // `"watchlist_items"` and three more are declared with quoted names, and no
  // live fixture asks for one — so a rewrite that dropped the `"?` would pass
  // every existing suite and fail the next fixture that needed `capital_calls`,
  // which is the table #197 works with.
  const ddl = tableFromBaseline(BASELINE, 'capital_calls');
  assert.match(ddl, /^CREATE TABLE "capital_calls" \(/);
  assert.ok(ddl.includes('limited_partner_id'), 'the quoted read returned the wrong table');
  assert.equal(ddl, asTheRegexDid('capital_calls'));
});

test('a table is found by its own declaration, never by a REFERENCES to it', () => {
  // THE BUG `traction_snapshots.test.ts` RECORDS. An earlier helper allowed
  // `[^;]*?` between `CREATE TABLE` and the name, matched the `REFERENCES
  // projects(id)` inside `activity_logs`, and built THAT table under the name
  // `projects`. It failed loudly, which its own comment calls luck.
  const projects = tableFromBaseline(BASELINE, 'projects');
  assert.match(projects, /^CREATE TABLE projects \(/,
    'the reader resolved `projects` to something that is not its own declaration');
  // A table that is only ever referenced, never declared, must not resolve at all
  // — the same walk read the other way.
  assert.throws(() => tableFromBaseline(BASELINE, 'no_such_table_anywhere'),
    /no_such_table_anywhere is not declared/);
});

test('a name that is a prefix of another table does not resolve to it', () => {
  // `metric_targets` and `metrics_snapshots` sit two lines apart in the baseline.
  // Without a boundary check after the name, `metrics_snapshot` takes
  // `metrics_snapshots` and every column assertion above it is about a table the
  // fixture did not ask for.
  assert.throws(() => tableFromBaseline(BASELINE, 'metrics_snapshot'),
    /metrics_snapshot is not declared/);
  assert.throws(() => tableFromBaseline(BASELINE, 'metric_target'),
    /metric_target is not declared/);
  // And both real names still resolve, to different tables — so the check above
  // is a boundary and not a ban on the prefix.
  assert.notEqual(
    tableFromBaseline(BASELINE, 'metric_targets'),
    tableFromBaseline(BASELINE, 'metrics_snapshots'),
  );
});

test('an unterminated CREATE TABLE throws instead of returning the rest of the file', () => {
  // Two of the three helpers this replaces omitted this check; `board_lanes`
  // would have handed `slice(at, -1 + 2)` — one character — to `db.exec` and
  // failed with a syntax error naming nothing. The shared reader takes the
  // strictest of the three behaviours.
  const truncated = 'CREATE TABLE lonely (\n  id INTEGER PRIMARY KEY\n';
  assert.throws(() => tableFromBaseline(truncated, 'lonely'), /lonely's DDL is not terminated/);
});

test('the keywords are case-insensitive and the table name is not', () => {
  // The old pattern's `i` flag covered both. Keeping it on the keywords is
  // faithful; dropping it on the NAME is a deliberate tightening, because a test
  // asking for `Projects` and being handed `projects` is a test whose author has
  // lost track of which table they meant.
  const lower = 'create table quiet (\n  id INTEGER\n);\n';
  assert.match(tableFromBaseline(lower, 'quiet'), /^create table quiet \(/);
  assert.throws(() => tableFromBaseline(lower, 'Quiet'), /Quiet is not declared/);
});

test('the first declaration wins, and a later line cannot shadow it', () => {
  // `);` terminates at the FIRST occurrence after the match, so a reader that
  // found a later declaration would return a slice spanning both.
  const two = 'CREATE TABLE dup (\n  a INTEGER\n);\nCREATE TABLE dup (\n  b INTEGER\n);\n';
  assert.equal(tableFromBaseline(two, 'dup'), 'CREATE TABLE dup (\n  a INTEGER\n);');
});

test('stripForeignKeys removes the REFERENCES clause and nothing else', () => {
  // `node:sqlite` enforces foreign keys by default, so a REFERENCES to a table a
  // fixture does not create fails at CREATE. Only `traction_snapshots` wants
  // this, which is why it is a separate function rather than something the reader
  // does to everybody.
  const withFk = tableFromBaseline(BASELINE, 'metric_targets');
  assert.ok(withFk.includes('REFERENCES projects(id)'), 'metric_targets lost its FK, so this proves nothing');
  const stripped = stripForeignKeys(withFk);
  assert.ok(!stripped.includes('REFERENCES'), 'a REFERENCES clause survived the strip');
  assert.ok(!stripped.includes('ON DELETE'), 'an ON DELETE action survived its own clause');
  // The columns themselves are untouched — the strip must not eat the column it
  // was attached to.
  for (const col of ['project_id', 'metric_key', 'target_value', 'created_by']) {
    assert.ok(stripped.includes(col), `${col} was removed along with its REFERENCES`);
  }
});

test('wordInText matches a whole word and not a fragment of a longer one', () => {
  // The three migration/column guards that used `\b${v}\b` rest on this. A bare
  // `includes` passes the first two of these and fails the rest, which is the
  // mutation worth naming.
  assert.ok(wordInText('BEGIN; END TRANSACTION;', 'END TRANSACTION'), 'a phrase with a space is still one word run');
  assert.ok(wordInText('SELECT scope FROM t', 'scope'));
  assert.ok(!wordInText('SELECT scope_id FROM t', 'scope'), '`scope` matched inside `scope_id`');
  assert.ok(!wordInText('SELECT xmetric_name FROM t', 'metric_name'), '`metric_name` matched inside `xmetric_name`');
  assert.ok(!wordInText('COMMITTED', 'COMMIT'), '`COMMIT` matched inside `COMMITTED`');
  // Punctuation is a boundary; that is what makes the migration guard work at all.
  assert.ok(wordInText('BEGIN;', 'BEGIN'));
  assert.ok(wordInText('(value)', 'value'));
  assert.ok(!wordInText('anything at all', ''), 'an empty needle must not match');
});

test('no fixture reader builds a regex out of the name it is given', () => {
  // THE FINDING ITSELF, asserted as gone rather than assumed. Semgrep only scans
  // a PR's diff, so once these files stop changing nothing re-checks them — and
  // the cheapest way to re-introduce the alert is to copy one of these fixtures.
  const files = [
    '_baseline.mjs',
    'board_lanes.test.ts',
    'okr_move_log.test.ts',
    'traction_snapshots.test.ts',
  ];
  for (const f of files) {
    // `codeOnly` FIRST, and it earned its place on the first run of this test:
    // `_baseline.mjs`'s own header QUOTES the pattern it removed, so the ban
    // failed on the paragraph explaining why the shape is gone. Narrowing to code
    // is the repo's answer to that; the accepted cost is that a re-introduction
    // hidden inside a docblock would be missed, which is the safe direction.
    const src = codeOnly(readFileSync(resolve(HERE, f), 'utf8'));
    // A `new RegExp(` whose argument is a TEMPLATE LITERAL is the flagged shape;
    // a string literal argument is not, and neither is this test's own oracle.
    assert.ok(!/new RegExp\(\s*`/.test(src),
      `${f} builds a RegExp from a template literal again — that is alert 6088's shape`);
  }
});
