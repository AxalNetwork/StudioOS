/**
 * Branch · Settings — who owns each row (canvas S11) — D155.
 *
 * WHAT THIS PAGE IS FOR, and it is unusual among the branch screens: its whole
 * subject is OWNERSHIP. Every other zone shows figures; this one answers "who
 * decides this?" row by row, and the canvas says exactly how — "HQ-owned rows
 * show the request path instead of a disabled input: a greyed field invites a
 * ticket asking to enable it; a chip saying HQ and a route saying 'escalation'
 * answers the question on the page."
 *
 * SO A ROW THAT NAMES THE WRONG OWNER IS THIS PAGE'S ONE UNSURVIVABLE DEFECT,
 * and the canvas contains two of them. It marks "Subsidiary name" and "Staff &
 * roles" as the branch's to edit. Measured against the worker:
 *
 *   · the name is `BRANCH_NAME`, a Worker var set at provisioning
 *     (`routes/auth.ts` — "THE VARS ARE THE SOURCE, NOT THE DATABASE"), and
 *     the licence copy's `brand_name` is HQ's: there is not one
 *     `UPDATE branch_licence` in the worker, so an edit would be overwritten;
 *   · a role cannot be changed from a branch at all —
 *     `admin_promotion_disabled` refuses everyone but the super admin, and
 *     `hydrateSuperAdmin` answers 0 on a branch without querying (D106).
 *
 * These assertions pin the corrected ownership, and they are written against
 * the WORKER as well as the page, because a page that merely says "HQ" while
 * the worker grew a branch-side write would be wrong in the other direction.
 *
 * AMENDED BY D197, which moved this file from five rows to seven and from a
 * typed count to a derived one. The canvas's five gained **Data residency**
 * (S11 draws it) and **Domain** (the canvas puts it in a Settings sub-nav this
 * page does not have), and both are HQ's with no branch-side read — so each
 * renders its absence with a reason rather than a value. That makes the split
 * 6-of-7 rather than the canvas's 4-of-6, and the number beside the rows is now
 * counted from them: it had been a typed string under a comment reading
 * "COUNTED, NOT TYPED" since D155, in two spellings that a grep for either
 * would miss. The `rows` array is what both the render and these assertions
 * read, so a row cannot reach one without reaching the other.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(read('frontend/src/pages/branch/BranchSettings.jsx'));
const APP = codeOnly(read('frontend/src/App.jsx'));
const INSIGHTS = codeOnly(read('cloudflare-worker/src/routes/branch_insights.ts'));

test('the route is built, admin-gated, and renders no placeholder', () => {
  const line = APP.split('\n').find((l) => l.includes('path="/branch/settings"'));
  assert.ok(line, '/branch/settings must be registered');
  assert.match(line, /guard\(\['admin'\]/, 'the settings route lost its admin gate');
  assert.match(line, /<BranchSettings/, 'the route no longer renders the page');
  assert.doesNotMatch(line, /Pending/, 'the route went back to a placeholder');
});

/**
 * The `rows` array, sliced out of the page and split per row.
 *
 * D197 TURNED THE ROWS FROM JSX LITERALS INTO DATA, because that is the only
 * thing that could make the count beside them true — it had been a typed
 * string under a comment reading "COUNTED, NOT TYPED" since D155. Reading the
 * same array the page derives from is also a stronger scan than matching
 * `<Row …/>` ever was: a row added to the array reaches both the render and
 * this assertion, and one cannot be updated without the other.
 */
function rowBlocks() {
  const at = PAGE.indexOf('const rows = [');
  assert.ok(at > 0, 'the rows stopped being one array, so the count below cannot be derived from them');
  const end = PAGE.indexOf('\n  ];', at);
  assert.ok(end > at, 'the rows array never closes');
  const body = PAGE.slice(at, end);
  const parts = body.split(/\n      field: /).slice(1);
  return parts.map((s) => `field: ${s}`);
}

test('every row names an owner and a path, and S11 has the six the canvas draws plus Domain', () => {
  const rows = rowBlocks();
  assert.equal(rows.length, 7, `expected S11's rows, found ${rows.length}`);
  const fields = rows.map((r) => (r.match(/field: '([^']+)'/) || [])[1]);
  // ORDER MATTERS AND IS ASSERTED AS ORDER. The canvas's five, then its sixth
  // (Data residency), then Domain — which the canvas puts in a Settings
  // sub-nav this page does not have, so it lands here where its owner chip can
  // say the true thing.
  assert.deepEqual(fields, [
    'Subsidiary name', 'Territory', 'Staff & roles', 'Brand kit',
    'Licence summary', 'Data residency', 'Domain',
  ], 'the row set moved');
  for (const r of rows) {
    assert.match(r, /who: '(HQ|Yours)'/, `a row names no owner: ${r.slice(0, 60)}`);
    assert.match(r, /act: /, `a row offers no path: ${r.slice(0, 60)}`);
  }
});

test('the stated count is DERIVED from the rows, not typed beside them', () => {
  // THE DEFECT THIS REPLACES. `s11-owner-count` carried the literal
  // "4 of 5 rows HQ-owned" directly under a comment claiming it was counted,
  // and the rail carried "Four of five rows are HQ-owned" in a second spelling
  // — so a grep for either missed the other, and both were wrong the moment a
  // sixth row landed. Two spellings of one number is the shape this repo has
  // corrected a dozen times.
  const rows = rowBlocks();
  const hq = rows.filter((r) => /who: 'HQ'/.test(r)).length;
  assert.equal(hq, 6, 'the ownership split moved — say so in the note if a row genuinely changed hands');

  // The page must COMPUTE it: a typed figure is refused in either spelling.
  assert.doesNotMatch(PAGE, /\b\d+ of \d+ rows HQ-owned/,
    'the count went back to being typed beside the rows it is meant to be counted from');
  assert.doesNotMatch(PAGE, /of (five|six|seven) rows are HQ-owned/i,
    'the rail went back to a second, typed spelling of the same number');
  assert.match(PAGE, /rows\.filter\(\(r\) => r\.who === 'HQ'\)\.length/,
    'the count is no longer derived from the rows');
  assert.match(PAGE, /\$\{hqOwned\} of \$\{rows\.length\} rows HQ-owned/,
    'the derived sentence changed shape');
  // ONE source reaches BOTH the span and the rail, so they cannot disagree.
  assert.match(PAGE, /data-testid="s11-owner-count">\s*\{ownerCount\}/,
    'the rendered count stopped reading the derived value');
  assert.match(PAGE, /^\s*ownerCount,$/m, 'the rail stopped reading the same derived value');
});

test('the two rows with no branch-side read state their absence rather than the canvas sentence', () => {
  // D197 — the canvas types "D1 · DO · R2 with jurisdiction eu" on the Data
  // residency row. `branch_licence` has no residency column and HQ never
  // pushes one, so printing that would be a claim about this deployment that
  // nothing on this deployment measured. Same for Domain: the host register is
  // HQ's, and a branch cannot read it.
  const rows = rowBlocks();
  for (const field of ['Data residency', 'Domain']) {
    const row = rows.find((r) => r.includes(`field: '${field}'`));
    assert.ok(row, `${field} is not a row`);
    assert.match(row, /who: 'HQ'/, `${field} stopped being HQ's`);
    assert.match(row, /value: null/, `${field} started printing a value no branch read produces`);
    assert.match(row, /reason: /, `${field} renders an absence with no reason`);
  }
  assert.doesNotMatch(PAGE, /jurisdiction eu/,
    'the residency row printed the canvas\'s sample string as though it were this deployment\'s');
});

test('the two rows the canvas gets wrong are corrected, and the page says so', () => {
  const rows = rowBlocks();
  const name = rows.find((r) => r.includes("field: 'Subsidiary name'"));
  assert.ok(name, 'the subsidiary name row is gone');
  assert.match(name, /who: 'HQ'/,
    'the subsidiary name went back to being the branch\'s, which the worker refuses');
  const staff = rows.find((r) => r.includes("field: 'Staff & roles'"));
  assert.ok(staff, 'the staff row is gone');
  assert.match(staff, /roles are granted by HQ/,
    'the staff row stopped saying roles are HQ\'s');
  // The correction is explained on the page, not only in a comment: a reader
  // who notices the artboard says otherwise gets the reason rather than a
  // discrepancy.
  assert.match(PAGE, /data-testid="s11-ownership-note"/, 'the ownership correction is not stated on screen');
});

test('no row draws a control the server would refuse', () => {
  // The `still_an_admin` rule (D134), and this page is where it bites hardest:
  // its subject is who may act, so a disabled input here would be a claim that
  // the action exists and is merely switched off.
  assert.ok(!PAGE.includes('disabled'), 'a row greyed a control instead of not drawing it');
  assert.ok(!/<input\b/.test(PAGE) && !/<select\b/.test(PAGE) && !/<textarea\b/.test(PAGE),
    'a settings field appeared on a page whose rows are all decided elsewhere');
  // Every act is a LINK to somewhere that works.
  const acts = [...PAGE.matchAll(/actTo: '([^']+)'/g)].map((m) => m[1]);
  assert.equal(acts.length, rowBlocks().length, 'a row lost its destination');
  for (const to of acts) {
    assert.ok(APP.includes(`path="${to}"`), `${to} is a request path with no route behind it`);
  }
});

test('the role breakdown is read rather than recomputed, and absent is not zero', () => {
  // D155 — the route computed `GROUP BY role` and returned only the totals.
  assert.match(INSIGHTS, /by_role: statsAvailable \? byRole : null/,
    'the branch insights route stopped returning the role breakdown');
  assert.match(INSIGHTS, /by_role_active_only: true/, 'the breakdown no longer says what it counted');
  assert.match(PAGE, /ins\?\.stats\?\.by_role/, 'the page recomputes the breakdown instead of reading it');
  // An unreadable breakdown is unknown, never "no staff".
  assert.doesNotMatch(PAGE, /\|\|\s*0\b/, 'a figure defaults to zero instead of saying it is absent');
  assert.match(PAGE, /value: staffLine,/, 'the staff row stopped reading the derived line');
});

test('the page owns no second rail — BranchZone mounts the branch tier\'s only one', () => {
  // D126 put the mount in `BranchZone` and `branch_rail_mount.test.mjs` pins
  // it; a page that rendered its own would be the doubled chrome that guard
  // exists to prevent. This page passes coverage and absences instead.
  assert.ok(!PAGE.includes('<WorkerRail'), 'the page mounted a second rail');
  assert.match(PAGE, /<BranchZone/, 'the page is not wrapped in the branch frame');
  assert.match(PAGE, /coverage=\{coverage\}/, 'the page tells the rail nothing — D151\'s defect');
  assert.match(PAGE, /unavailable=\{\[/, 'the page states no absences to the rail');
});
