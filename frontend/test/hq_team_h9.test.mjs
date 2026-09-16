/**
 * D138 / H9 — HQ · Team, the first screen whose subject is the admin accounts.
 *
 * THE DEFECT THIS EXISTS TO KEEP CLOSED. `SuperAdminHolders.jsx` fed its grant
 * picker from `api.adminListUsers()` with no arguments — the newest 100
 * accounts — and filtered that PAGE to `role === 'admin'` in the browser.
 * Admins are among the OLDEST accounts, so past a hundred rows an admin is not
 * in the list and the elevation cannot be handed to them at all; the `<select>`
 * reads "No other admin to hand it to" about a database that has several. The
 * route it reads now filters on role SERVER-SIDE with no LIMIT, and the worker
 * suite proves that half (`supervision_surface_d138.test.ts`).
 *
 * WHAT IS ASSERTED HERE is the half a worker test cannot see: that the page
 * asks the right route, renders the honest state when the ladder cannot be
 * read, says "HQ-held" rather than nothing, and does NOT draw a control that
 * could only refuse.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_team_h9.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

const TEAM_RAW = read('frontend/src/pages/hq/HqTeamTable.jsx');
const TEAM = codeOnly(TEAM_RAW);
const PAGE_RAW = read('frontend/src/pages/hq/AccountsPage.jsx');
const PAGE = codeOnly(PAGE_RAW);
const HOLDERS = codeOnly(read('frontend/src/pages/hq/SuperAdminHolders.jsx'));
const API = codeOnly(read('frontend/src/lib/api.js'));
const NOTICES = codeOnly(read('frontend/src/lib/notices.js'));

/** Every file under frontend/src, so a claim about the tree is about the tree. */
function srcFiles(dir = 'frontend/src', out = []) {
  const { readdirSync } = require('node:fs');
  for (const e of readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) srcFiles(p, out);
    else if (/\.(jsx?|tsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('the grant picker reads the role-filtered route, not a page of accounts', () => {
  // The whole point of D138's route. A picker fed a page is not a display
  // problem: you cannot grant the elevation to somebody who is not in the list.
  assert.match(HOLDERS, /api\.hqAdmins\(\)/,
    'SuperAdminHolders does not read the server-filtered admin list');
  assert.ok(!/api\.adminListUsers\(\s*\)/.test(HOLDERS),
    'SuperAdminHolders still reads the unpaginated flat array, which is the newest 100 accounts');
  // And the browser-side role filter is gone with it — the route has the
  // predicate now, so filtering here would be filtering a filtered list.
  assert.ok(!/role\)\.toLowerCase\(\) === 'admin'/.test(HOLDERS),
    'the browser still filters by role, which means it is still reading everyone');
});

test('no caller anywhere in the SPA reads the flat, unpaginated user list', () => {
  // `admin.ts`'s back-compat comment named SuperAdminHolders as the reason that
  // shape exists. It was the last flat caller; this is what keeps it so.
  const offenders = srcFiles()
    .filter((p) => /api\.adminListUsers\(\s*\)/.test(read(p)))
    .filter((p) => !p.endsWith('SuperAdminHolders.jsx')); // its own comment names it
  assert.deepEqual(offenders, [],
    'a caller reads the newest-100 page as though it were the whole directory');
});

test('the route exists in api.js and asks the branches with q', () => {
  assert.match(API, /hqAdmins: \(q\) =>/, 'api.hqAdmins is gone or renamed');
  assert.match(API, /\/admin\/hq\/admins/, 'hqAdmins does not point at the Team route');
  // `q` is what HQ asks the BRANCHES. If it became a server-side filter on the
  // roster, the picker would be reading a filtered list again.
  assert.match(TEAM, /api\.hqAdmins\(asked\)/, 'the table does not pass the query through');
});

test('the filter narrows a complete list in the browser, which is the honest case', () => {
  // Filtering a COMPLETE list narrows it; filtering a page hides rows. The
  // route returns every admin, so this is the first one.
  assert.match(TEAM, /\.filter\(\(row\) => !needle/,
    'the table does not narrow its own rows');
  assert.match(TEAM, /String\(row\.name \|\| ''\)\.toLowerCase\(\)\.includes\(needle\)/,
    'the filter does not read the name');
  assert.match(TEAM, /String\(row\.email \|\| ''\)\.toLowerCase\(\)\.includes\(needle\)/,
    'the filter does not read the email');
});

test('an unreadable ladder renders as unreadable, never as every admin being clear', () => {
  assert.match(TEAM, /const ladderReadable = data\.ladder_readable !== false;/,
    'the page infers the ladder rather than reading the flag');
  assert.ok(TEAM_RAW.includes('data-testid="hq-team-ladder-unreadable"'),
    'nothing on screen says the ladder could not be read');
  // And the rung cell is gated on the same flag, so a failed read cannot paint
  // a "Clear" chip against an account nobody measured.
  const cell = TEAM.slice(TEAM.indexOf('data-testid="hq-team-rung"'));
  const gate = cell.slice(0, cell.indexOf('</td>'));
  assert.match(gate, /ladderReadable \?/,
    'the compliance chip renders whether or not the ladder could be read');
});

test('the Branch column says HQ-held rather than nothing', () => {
  // Every account on HQ's database IS HQ-held — a fact about where the row
  // lives, not a placeholder for a value nobody has.
  const at = TEAM.indexOf('data-testid="hq-team-branch"');
  assert.ok(at > 0, 'the Branch column is gone');
  assert.match(TEAM.slice(at, at + 160), /row\.branch \|\| 'HQ-held'/,
    'the Branch column does not fall back to HQ-held');
});

test('the rows sort worst-first, through the shared ordering', () => {
  assert.match(TEAM, /rungRank\(a\.rung\) - rungRank\(b\.rung\)/,
    'the team is not sorted worst-first');
  assert.match(TEAM, /from '\.\.\/\.\.\/lib\/notices'/,
    'the ordering is a second copy rather than the shared one');
  // The shared ordering must agree with the worker's rung precedence, or the
  // screen sorts by one rule and the payload was computed under another.
  assert.match(NOTICES, /RUNGS = \['frozen', 'awaiting_review', 'notified', 'clear'\]/,
    'the rung ordering changed — re-point the worker\'s rungOf() with it');
});

test('the deadline is read through the shared UTC normaliser', () => {
  // `admin_notices` stamps are SQL `YYYY-MM-DD HH:MM:SS`, which V8 reads as the
  // READER'S LOCAL time. A bare `new Date(...)` on one is wrong by the reader's
  // offset, which is the D136 defect one screen over.
  assert.match(TEAM, /daysTo\(row\.froze_at\)/, 'the frozen-for line is not computed from froze_at');
  assert.match(TEAM, /daysTo\(row\.respond_by\)/, 'the deadline is not computed from respond_by');
  assert.ok(!/new Date\((?!\))/.test(TEAM),
    'the page parses a stamp itself instead of using lib/notices.js');
});

test('the Move control is not drawn, and the page says what a move needs', () => {
  // Its route needs a SOURCE and a DESTINATION branch code, each a live
  // binding. With none provisioned the control could only refuse, and D134
  // already named that: a button the server always rejects teaches the operator
  // that one of its buttons is a lie.
  assert.ok(!/accountMove|accounts\/.*\/move|>Move</.test(TEAM),
    'a Move control is drawn against a route that has no branch to move between');
  assert.ok(TEAM_RAW.includes('needs two provisioned branches'),
    'the page neither offers a move nor says why there is none');
});

test('the page composes the three in H9\'s order and keeps the directory', () => {
  const holders = PAGE.indexOf('<SuperAdminHolders');
  const team = PAGE.indexOf('<HqTeamTable');
  const directory = PAGE.indexOf('<AdminPage');
  assert.ok(holders > 0 && team > holders, 'the Team table is not below the holder console');
  assert.ok(directory > team, 'the Team table replaced the directory instead of sitting above it');
  assert.match(PAGE, /section="users"/, 'the Admin Console users panel was dropped');
});

test('granting the elevation refreshes the badge rather than leaving it stale', () => {
  assert.match(PAGE, /onChanged=\{\(\) => setReloadKey/,
    'the page does not hear about a grant');
  assert.match(PAGE, /<HqTeamTable reloadKey=\{reloadKey\} \/>/,
    'the Team table is not told to reload');
  assert.match(HOLDERS, /onChanged\?\.\(\)/, 'the holder console never tells anyone');
});

test('the page states what it still cannot show, and the reason is the narrower one', () => {
  // The tenant column on the DIRECTORY is still not drawn, and the reason
  // changed: `licence_admins` now names an administrator's licence, so the
  // claim "no account names the licence it belongs to" is no longer true as
  // written. A reason that outlives its fact is what this repo keeps deleting.
  assert.ok(!PAGE_RAW.includes('no account names the licence it belongs to'),
    'the page still says no account names a licence — an administrator now does');
  assert.ok(PAGE_RAW.includes('an administrator names the licence they'),
    'the narrowed reason is not on the page');
});
