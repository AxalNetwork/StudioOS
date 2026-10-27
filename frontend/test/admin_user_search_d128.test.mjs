/**
 * The Users panel's search, and the tiles that were counting a page (D128).
 *
 * THE DEFECT THIS PINS was live on HQ's own Accounts screen. The role tiles
 * were `users.filter(u => u.role === r).length` over whatever `/admin/users`
 * returned — and it returns the newest 100 by default — so past a hundred
 * accounts the "All Users" tile read **100** as though it were the total, and
 * every role tile counted one page. There was no pagination control to reveal
 * the rest and no search to reach past it: the panel filtered by role and
 * nothing else, on both tiers.
 *
 * WHY A SOURCE GUARD AND NOT A RENDER TEST. The regression shape is "somebody
 * computes a count from the rows on screen again", which is a line of code
 * rather than a rendered value — a render test with a fixture smaller than the
 * page size passes against the broken version, because a total and a page
 * count are equal there. The worker side owns the behaviour
 * (`admin_user_search_d128.test.ts`, whose fixture deliberately crosses the
 * limit); this owns the shape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnlyJsx } from './_codeOnly.mjs';
import { adminConsoleSource } from './_adminConsoles.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnlyJsx(adminConsoleSource());
const API = codeOnlyJsx(read('frontend/src/lib/api.js'));

// D1305 (#3402): the tiles, search and table are All accounts' now
// (`pages/admin/accounts/`), over D1300's read. The same properties hold there.
const TABLE = codeOnlyJsx(read('frontend/src/pages/admin/accounts/AllAccounts.jsx'));
const MODEL = codeOnlyJsx(read('frontend/src/pages/admin/accounts/allAccountsModel.js'));

test('the profile chips count the directory, never the rows on screen', () => {
  assert.doesNotMatch(PAGE, /users\.filter\([^)]*\)\.length/, 'a count is taken from the loaded rows again — that is the page, not the total');
  for (const src of [TABLE, MODEL]) {
    assert.doesNotMatch(src, /(?:users|rows)\.filter\([^)]*\)\.length/,
      'a count is taken from the loaded rows again — that is the page, not the total');
  }
  // The chips read the envelope's whole-table totals.
  assert.match(TABLE, /const byRole = env\?\.by_role \|\| null;/);
  assert.match(TABLE, /c\.value \? Number\(byRole\[c\.value\] \|\| 0\) : Number\(env\?\.total \|\| 0\)/);
});

test('a total that has not been read yet is drawn as nothing, not zero', () => {
  // Until the envelope answers, a chip draws no number at all.
  assert.match(TABLE, /const n = byRole \? \([^\n]*\) : null;/);
  assert.match(TABLE, /\{n != null \? <span/);
});

test('the table says what it is showing, over the filtered set', () => {
  // "1–25 of 61": the page's place in D1300's `matched`, never the page's length.
  assert.match(MODEL, /return `\$\{fmt\(env\.from\)\}–\$\{fmt\(env\.to\)\} of \$\{fmt\(matched\)\}`;/);
  assert.match(TABLE, /data-testid="accounts-count">\{env \? countLine\(env\) : ''\}/);
});

test('the search box exists, is bound, and is gated at two characters', () => {
  assert.match(TABLE, /data-testid="accounts-search"/, 'the search input is gone');
  assert.match(TABLE, /value=\{query\} onChange=\{\(e\) => setQuery\(e\.target\.value\)\}/);
  // The browser gate mirrors the route's own refusal (`query_too_short`).
  assert.match(MODEL, /if \(q\.length >= 2\) out\.q = q;/,
    'a one-character query is sent, so the route will 400 mid-typing');
  assert.match(TABLE, /setTimeout\(/, 'the search is not debounced, so every keystroke is a request');
});

test('the scope caption names what it searches: the territory on a branch, HQ-held accounts off one', () => {
  assert.match(PAGE, /const accountScope = branchOfUser\(viewer\)/,
    'the caption is not fed from the branch fact');
  assert.match(PAGE, /Searching \$\{viewer\.branch\.name \|\| viewer\.branch\.code\} accounts/);
  assert.match(PAGE, /: 'Searching HQ-held accounts';/, 'off a branch the caption no longer says HQ-held accounts');
  assert.match(PAGE, /scopeLine=\{accountScope\}/, 'the caption is not handed to the table');
  assert.match(TABLE, /\{scopeLine \? <p[^>]*data-testid="accounts-scope">\{scopeLine\}\. Type at least two characters\.<\/p> : null\}/);
  assert.match(PAGE, /import \{ branchOfUser \} from '(?:\.\.\/){3}lib\/shellRole'/);
});

test('the api method keeps its no-argument form, and the envelope stays opt-in', () => {
  // Widening the signature must not have made the envelope mandatory: the flat
  // array is a published response shape, and removing one is a breaking change
  // for anything outside this repo.
  assert.match(API, /adminListUsers: \(opts = \{\}\) =>/, 'the method lost its default argument');
  assert.match(API, /if \(opts\.q\) qs\.set\('q'/);
  assert.match(API, /if \(opts\.envelope\) qs\.set\('envelope', '1'\)/);

  // D138 — THIS HALF WAS RE-POINTED RATHER THAN DELETED, and the reason is the
  // finding. It used to read: "`SuperAdminHolders.jsx` calls `adminListUsers()`
  // and reads a flat array", asserting that caller stayed. It does not any
  // more, ON PURPOSE: reading the flat form meant reading the newest 100
  // accounts and filtering them to `role === 'admin'` in the browser, and
  // admins are among the OLDEST accounts — so its grant picker silently omitted
  // them and the elevation could not be handed over. It reads
  // `GET /admin/hq/admins`, which filters on role server-side with no LIMIT.
  //
  // What survives is the property this test was actually written for: EVERY
  // caller in the SPA asks for the envelope, so nothing is reading a page as
  // though it were a whole. That is the stronger assertion, and it is what
  // `hq_team_h9.test.mjs` also guards from the other side.
  const callers = [
    'frontend/src/pages/admin/accounts/AllAccounts.jsx',
    'frontend/src/pages/branch/BranchAccounts.jsx',
    'frontend/src/pages/hq/SuperAdminHolders.jsx',
  ];
  for (const file of callers) {
    const code = codeOnlyJsx(read(file));
    assert.ok(!/api\.adminListUsers\(\s*\)/.test(code),
      `${file} reads the newest-100 page as though it were the directory`);
  }
});
