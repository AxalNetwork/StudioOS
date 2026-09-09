/**
 * The three Research stores behind `/research/funds`, `/research/benchmarking`
 * and `/research/diligence`, and the properties that make them safe.
 *
 * WHY SOURCE-LEVEL. Each is one missing WHERE clause away from a cross-account
 * read, and the shape of that mistake is the text of a query rather than the
 * output of one call with one fixture. `routes/research.ts` opens by claiming
 * "there is no cross-user listing anywhere in this file by construction"; this
 * is what keeps that sentence true as the file grows.
 *
 * THE FUNDS TABLE IS THE MOST SENSITIVE OF THE THREE, and not obviously so. A
 * founder's shortlist is mildly private. Their record of WHICH FUND PASSED AND
 * WHAT THEY SAID is not — it is the kind of thing that ends a raise if it
 * reaches the wrong reader.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const routes = read('cloudflare-worker/src/routes/research.ts');
const funds = read('cloudflare-worker/sql/migrations/216_research_funds.sql');
const bench = read('cloudflare-worker/sql/migrations/217_research_benchmarks.sql');

/**
 * Every `DB.prepare(`…`)` template in the file, whole.
 *
 * The first draft matched from a SELECT keyword to the next backtick, which
 * cut the diligence query in half at its first subquery and failed on code
 * that was correct. A whole template literal is the only span that corresponds
 * to a statement.
 */
const preparedTemplates = (src: string): string[] =>
  [...src.matchAll(/prepare\(\s*`([\s\S]*?)`\s*\)/g)].map((m) => m[1]);

const touching = (src: string, table: string) =>
  preparedTemplates(src).filter((t) => new RegExp(`\\b${table}\\b`).test(t));

for (const table of ['research_funds', 'research_benchmarks']) {
  test(`every ${table} read, update and delete filters on owner_user_id`, () => {
    const found = touching(routes, table);
    assert.ok(found.length > 0, `no prepared statement names ${table}`);
    const reads = found.filter((t) => !/^\s*INSERT/i.test(t.trim()));
    assert.ok(reads.length > 0, `parse failed — no non-INSERT statement for ${table}`);
    for (const stmt of reads) {
      assert.match(stmt, /owner_user_id = \?/,
        `a ${table} statement reads without narrowing to its owner`);
    }
  });

  test(`every ${table} insert writes the authenticated owner`, () => {
    // An INSERT carries no WHERE, so the property is different in kind: the
    // owner column must be in the statement and bound from the authenticated
    // user rather than from anything the caller sent.
    const inserts = touching(routes, table).filter((t) => /^\s*INSERT/i.test(t.trim()));
    assert.ok(inserts.length > 0, `no INSERT for ${table}`);
    for (const stmt of inserts) assert.match(stmt, /owner_user_id/);
    for (const tail of routes.split(`INSERT INTO ${table}`).slice(1)) {
      assert.match(tail.slice(0, 900), /\.bind\(\s*\n?\s*uid, user\.id/,
        `${table} must bind the authenticated user as the owner`);
    }
  });
}

test('no research route takes an identity from the request', () => {
  // Not "does .bind() mention the request" — it legitimately does, for a row's
  // own uid. What must never appear is an IDENTITY from caller input, which is
  // how an owner-scoped table stops being one with no WHERE clause changing.
  assert.doesNotMatch(routes, /query\(['"]user_id['"]\)/);
  assert.doesNotMatch(routes, /param\(['"]user(_?id)?['"]\)/);
  // `b.owner_user_id` is banned because `b` is this file's habitual name for a
  // parsed request body. It therefore also refuses a SQL alias spelled `b` on
  // an owner-scoped table, and that is the right trade: the ban stays exact and
  // the alias gets a longer name (`bc` in the relationships draft gather). If
  // this fires on a query rather than on a body, rename the alias — do not
  // loosen the pattern.
  assert.doesNotMatch(routes, /body\.owner_user_id|b\.owner_user_id/,
    'an owner is being taken from the request — or a SQL alias is spelled `b`; see the note above');
});

/**
 * The `/diligence` handler alone.
 *
 * BOTH TESTS BELOW USED `touching(routes, table)[0]` — the first statement in
 * the file naming the table — on the assumption that the diligence read was the
 * only reader of the room. It stopped being: `raise/data-room` is a founder
 * draft surface over the SAME tables from the other side, and it sorts earlier
 * in the file, so the two assertions silently moved onto a statement whose
 * safety is a different property. Bounding the slice is what keeps each rule on
 * the statement it is a rule about.
 */
const DILIGENCE = routes.slice(
  routes.indexOf("research.get('/diligence'"),
  routes.indexOf("research.get('/funds'") > routes.indexOf("research.get('/diligence'")
    ? routes.indexOf("research.get('/funds'")
    : routes.length,
);
assert.ok(DILIGENCE.includes('data_room_grants'), 'the diligence handler could not be found');

test('the diligence read is scoped to the caller as the grantee', () => {
  // This one reads ANOTHER user's project, which is the point of a grant. The
  // safety is that the row must name the caller as the investor the founder
  // granted to, and the grant must still be live.
  const stmt = touching(DILIGENCE, 'data_room_grants')[0];
  assert.ok(stmt, 'no prepared statement in /diligence reads data_room_grants');
  assert.match(stmt, /g\.investor_user_id = \?/);
  assert.match(stmt, /g\.status = 'active'/);
  assert.match(stmt, /expires_at IS NULL OR g\.expires_at > datetime\('now'\)/);
});

test('diligence counts withheld files and never names them', () => {
  // The data room's own rule, kept: "A count, never the names."
  assert.match(DILIGENCE, /withheld_behind_nda/);
  const stmt = touching(DILIGENCE, 'data_room_files')[0];
  assert.ok(stmt, 'no prepared statement in /diligence reads data_room_files');
  assert.match(stmt, /COUNT\(\*\) FROM data_room_files/);
  assert.doesNotMatch(stmt, /f\.name|f\.uid|f\.r2_key/);
});

test('every other room read in this file is bound to an owned project', () => {
  // The other side of the same tables: a FOUNDER reading their own room to
  // draft over it. There is no grant to check — they own it — so the property
  // is that the project id was resolved by the ownership check and never taken
  // from the request. This is the rule the two tests above were accidentally
  // asserting against, and it needs saying in its own right.
  for (const table of ['data_room_grants', 'data_room_files', 'data_room_folders', 'data_room_access_log']) {
    for (const stmt of touching(routes, table)) {
      if (DILIGENCE.includes(stmt)) continue;
      assert.match(stmt, /project_id = \?|f\.project_id = \?/,
        `a ${table} statement outside /diligence reads without narrowing to one project`);
      // And the binding for it is `pid`, which only `founderProject` produces.
      const tail = routes.slice(routes.indexOf(stmt) + stmt.length, routes.indexOf(stmt) + stmt.length + 200);
      assert.match(tail, /\)\s*\.bind\(pid\)/,
        `a ${table} statement binds something other than the ownership-checked project id`);
    }
  }
  assert.match(routes, /async function founderProject\(/, 'the founder ownership check is gone');
});

test('the project read behind the cheque-overlap figure goes through companyScope', () => {
  // A founder with two companies raising two different rounds would otherwise
  // have every fund measured against whichever project was touched last — one
  // company's data on another company's screen. `company_switcher.test.mjs`
  // caught this reading unscoped before the comment in the route existed.
  assert.match(routes, /resolveActiveCompany\(c\.env, user, c\.req\.header\(ACTIVE_COMPANY_HEADER\)\)/);
  assert.match(routes, /companyScope\(user, companyId, 'p'\)/);
  assert.doesNotMatch(routes, /FROM projects\s+WHERE founder_id = \?/);
});

test('a benchmark cannot be stored without its base', () => {
  // Stronger than validating in the handler: the handler is one writer today
  // and the constraint holds for every writer there will ever be.
  assert.match(
    bench,
    /CHECK \(peer_value IS NULL OR \(peer_source IS NOT NULL AND peer_sample_size IS NOT NULL\)\)/,
  );
  // And the route refuses it too, so a writer gets a sentence rather than a
  // constraint error.
  assert.match(routes, /A peer figure needs its source and its sample size/);
});

test('is_comparison is derived, never stored', () => {
  assert.match(routes, /is_comparison: Boolean\(r\.peer_value && r\.peer_source && r\.peer_sample_size\)/);
  assert.doesNotMatch(bench, /is_comparison/);
});

test('the funds table keeps fit, access and status apart', () => {
  // The canvas pills them as one row of four values — "Warm path", "Right
  // stage", "Wrong stage", "Passed" — and they are not four values of one
  // column: a fund can be right-stage AND warm, and those are the ones worth
  // the meeting. Collapsing them would force a founder to choose which true
  // thing to record.
  for (const col of [/stage_fit\s+TEXT/, /path\s+TEXT/, /status\s+TEXT\s+NOT\s+NULL/]) {
    assert.match(funds, col);
  }
});

test('a pass is a state that keeps its reason, not a delete', () => {
  assert.match(funds, /pass_reason TEXT/);
  assert.match(funds, /status TEXT NOT NULL DEFAULT 'researching'/);
  assert.match(routes, /FUND_STATUS = new Set\(\['researching', 'passed'\]\)/);
  // The count of passes missing a reason is returned, because a pass with no
  // reason is indistinguishable from a fund nobody reached.
  assert.match(routes, /passed_without_reason/);
});

test('fund money is cents', () => {
  assert.match(funds, /cheque_min_cents INTEGER/);
  assert.match(funds, /cheque_max_cents INTEGER/);
  assert.doesNotMatch(funds, /cheque_(min|max)_usd/);
});
