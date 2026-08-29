/**
 * The free-tier project cap — the query, against a real database.
 *
 * `routes/projects.ts` counted a founder's projects with
 * `SELECT COUNT(*)::int AS n`. `::` is Postgres cast syntax and D1 is SQLite,
 * which answers `unrecognized token: ":"`. The cap therefore threw for every
 * free founder who already had a `founders` row — anyone creating a second
 * project, or a first one after onboarding had registered them — and the core
 * founder action returned a 500 instead of either the project or the clean
 * 402 the cap exists to raise.
 *
 * Nothing caught it. `tsc` cannot see inside a SQL string, and no test ran the
 * query. `check-sqlite-dialect.mjs` now fails the build on the syntax; this
 * pins the BEHAVIOUR, because the next version of this bug will be a query
 * that parses fine and counts the wrong rows.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeD1 } from './_d1_sqlite.mjs';
import { sqlStrings } from '../../scripts/check-sqlite-dialect.mjs';

const SCHEMA = `
CREATE TABLE founders (id INTEGER PRIMARY KEY, email TEXT, name TEXT);
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT, founder_id INTEGER, name TEXT,
  status TEXT, created_at TEXT DEFAULT '2026-01-01');
`;

/** The cap's query, lifted from routes/projects.ts and run for real. */
const COUNT_OWNED = 'SELECT COUNT(*) AS n FROM projects WHERE founder_id = ?';

function seed(rows: Array<[number, string, string]>) {
  const { DB, db } = makeD1(SCHEMA);
  db.exec("INSERT INTO founders (id, email, name) VALUES (9, 'f@x.com', 'F');");
  for (const [fid, name, status] of rows) {
    db.prepare('INSERT INTO projects (founder_id, name, status) VALUES (?, ?, ?)').run(fid, name, status);
  }
  return DB;
}

test('the cap query runs at all — the Postgres cast is gone', async () => {
  // The whole bug in one assertion. `COUNT(*)::int` throws here.
  const DB = seed([[9, 'One', 'active']]);
  const r = await DB.prepare(COUNT_OWNED).bind(9).all();
  assert.equal(Number((r.results as any[])[0].n), 1);
});

test('no SQL STRING in projects.ts carries a Postgres cast', () => {
  // Deliberately scans the SQL strings, not the file.
  //
  // The first version of this test was `assert.doesNotMatch(src, /COUNT\(\*\)::/)`
  // against raw source, and it FAILED — on the comment beside the fix, which
  // quotes `COUNT(*)::int` in order to explain what was wrong. That is the
  // same prose-matching mistake this suite spent a whole pass removing, made
  // again while removing it.
  //
  // It failed loudly rather than passing quietly, which is the difference
  // between `doesNotMatch` and `match` on unstripped source: the negative
  // direction fails safe. The positive direction is what let the barrel-export
  // guard wave through four deleted exports.
  const src = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/src/routes/projects.ts'), 'utf8');
  for (const { body } of sqlStrings(src)) {
    assert.doesNotMatch(body, /::/,
      `\`::\` is Postgres; D1 answers \`unrecognized token: ":"\` — in: ${body.slice(0, 80)}`);
  }
  // And the corrected query is really there, so this cannot pass by the file
  // having no SQL in it at all.
  assert.ok(sqlStrings(src).some((q) => /SELECT COUNT\(\*\) AS n FROM projects WHERE founder_id/.test(q.body)),
    'the cap query must still exist');
});

test('the count is every project the founder owns, whatever its status', async () => {
  // The cap's own comment says it "counts ALL projects owned by the founder
  // regardless of status". A cap that ignored archived projects would let a
  // founder park one and keep creating.
  const DB = seed([
    [9, 'Active',   'active'],
    [9, 'Archived', 'archived'],
    [9, 'Draft',    'draft'],
  ]);
  const r = await DB.prepare(COUNT_OWNED).bind(9).all();
  assert.equal(Number((r.results as any[])[0].n), 3);
});

test('another founder’s projects do not count against this one', async () => {
  const DB = seed([[9, 'Mine', 'active'], [42, 'Theirs', 'active'], [42, 'Theirs 2', 'active']]);
  const mine = await DB.prepare(COUNT_OWNED).bind(9).all();
  assert.equal(Number((mine.results as any[])[0].n), 1, 'the cap is per founder');
});

test('a founder with nothing yet counts zero, and is under the cap', async () => {
  const DB = seed([]);
  const r = await DB.prepare(COUNT_OWNED).bind(9).all();
  assert.equal(Number((r.results as any[])[0].n), 0);
});

test('the cap trips at the limit the constant declares, not at a hardcoded 1', async () => {
  // Reads FREE_TIER_LIMITS out of the source rather than assuming 1, so
  // raising the limit does not silently leave this test asserting the old one.
  const src = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/src/routes/projects.ts'), 'utf8');
  const m = src.match(/FREE_TIER_LIMITS[\s\S]{0,200}?projects:\s*(\d+)/)
    ?? readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/middleware/requireTier.ts'), 'utf8')
       .match(/projects:\s*(\d+)/);
  assert.ok(m, 'the free-tier project limit must be discoverable');
  const limit = Number(m[1]);
  assert.ok(limit >= 1, 'a zero cap would block every founder');

  const DB = seed(Array.from({ length: limit }, (_, i) => [9, `P${i}`, 'active'] as [number, string, string]));
  const r = await DB.prepare(COUNT_OWNED).bind(9).all();
  assert.equal(Number((r.results as any[])[0].n), limit,
    `a founder at the limit must count exactly ${limit}, so \`count >= limit\` trips`);
});
