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

test('every row names an owner, and four of the five are HQ', () => {
  const rows = [...PAGE.matchAll(/<Row\b[\s\S]*?\/>/g)].map((m) => m[0]);
  assert.equal(rows.length, 5, `expected S11's five rows, found ${rows.length}`);
  const owners = rows.map((r) => (/who="HQ"/.test(r) ? 'HQ' : 'Yours'));
  // COUNTED FROM THE ROWS, so the figure on screen cannot drift from them.
  assert.equal(owners.filter((o) => o === 'HQ').length, 4,
    'the ownership split moved — if a row genuinely changed hands, the count and the note move with it');
  assert.match(PAGE, /4 of 5 rows HQ-owned/, 'the stated count disagrees with the rows');
  for (const r of rows) {
    assert.match(r, /who="(HQ|Yours)"/, `a row names no owner: ${r.slice(0, 60)}`);
    assert.match(r, /act=/, `a row offers no path: ${r.slice(0, 60)}`);
  }
});

test('the two rows the canvas gets wrong are corrected, and the page says so', () => {
  const name = PAGE.slice(PAGE.indexOf('field="Subsidiary name"'));
  assert.match(name.slice(0, 200), /who="HQ"/,
    'the subsidiary name went back to being the branch\'s, which the worker refuses');
  const staff = PAGE.slice(PAGE.indexOf('field="Staff & roles"'));
  assert.match(staff.slice(0, 400), /roles are granted by HQ/,
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
  const acts = [...PAGE.matchAll(/actTo="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(acts.length, 5, 'a row lost its destination');
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
  assert.match(PAGE, /staffLine\s*$|value=\{staffLine\}/m, 'the staff row stopped reading the derived line');
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
