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

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnlyJsx(read('frontend/src/pages/AdminPage.jsx'));
const API = codeOnlyJsx(read('frontend/src/lib/api.js'));

test('the role tiles count the directory, never the rows on screen', () => {
  // The exact expression that was wrong, banned by shape rather than by name:
  // any `users.filter(...).length` is a count of the page.
  assert.doesNotMatch(PAGE, /users\.filter\([^)]*\)\.length/,
    'a tile is counting the loaded rows again — that is the page, not the total');
  assert.doesNotMatch(PAGE, /all:\s*users\.length/,
    '"All Users" is back to counting the page');
  // And what replaced it reads the envelope's totals.
  assert.match(PAGE, /const counts = totals/, 'the tiles no longer read the server totals');
  assert.match(PAGE, /totals\.by_role/, 'the per-role totals are not read');
});

test('a total that has not been read yet is Unrecorded, not zero', () => {
  // "Not read yet" and "none" are different things, and a zero for the first
  // is the same lie one beat earlier. `Unrecorded` is the shared primitive.
  assert.match(PAGE, /count === null \? <Unrecorded \/> : count/,
    'an unread total renders as a number rather than as a stated absence');
  assert.match(PAGE, /import \{ Unrecorded \} from '\.\.\/ui'/,
    'the honesty primitive must be imported, not re-declared');
});

test('the panel says what the table is showing', () => {
  // A tile reading 341 above a table of 100 rows would be its own confusion.
  // The caption is what makes them agree.
  assert.match(PAGE, /data-testid="admin-user-showing"/);
  assert.match(PAGE, /Showing the newest \$\{userPage\.showing\} of \$\{counts\.all\} accounts/,
    'the caption no longer reconciles the tiles with the page');
});

test('the search box exists, is bound, and is gated at two characters', () => {
  assert.match(PAGE, /data-testid="admin-user-search"/, 'the search input is gone');
  assert.match(PAGE, /value=\{userQuery\}/, 'the input is not bound to its state');
  assert.match(PAGE, /onChange=\{\(e\) => setUserQuery\(e\.target\.value\)\}/);
  // The browser gate mirrors the route's own refusal. It is a convenience, not
  // the control — `admin.ts` returns `query_too_short` regardless — and the
  // comment in the page says so.
  assert.match(PAGE, /next\.length >= 2 \? next : ''/,
    'the box no longer holds back a one-character query, so the route will 400 mid-typing');
  assert.match(PAGE, /setTimeout\(/, 'the search is not debounced, so every keystroke is a request');
});

test('the scope caption names a territory only where there is one', () => {
  // S0 wall rule 2. On HQ there is no territory, so there is no caption rather
  // than a vague one — `null` renders nothing, which is what stops this
  // becoming a second chip answering the badge's question.
  assert.match(PAGE, /const accountScope = branchOfUser\(viewer\)/,
    'the caption is not fed from the branch fact');
  assert.match(PAGE, /Searching \$\{viewer\.branch\.name \|\| viewer\.branch\.code\} accounts/);
  assert.match(PAGE, /\{accountScope && \(/, 'HQ renders an empty caption element');
  // The same reader the territory badge uses, so the two cannot disagree.
  assert.match(PAGE, /import \{ branchOfUser \} from '\.\.\/lib\/shellRole'/);
});

test('the api method keeps its no-argument form, because a live caller uses it', () => {
  // `SuperAdminHolders.jsx` calls `adminListUsers()` and reads a flat array.
  // Widening the signature must not have made the envelope mandatory.
  assert.match(API, /adminListUsers: \(opts = \{\}\) =>/, 'the method lost its default argument');
  assert.match(API, /if \(opts\.q\) qs\.set\('q'/);
  assert.match(API, /if \(opts\.envelope\) qs\.set\('envelope', '1'\)/);
  const holders = codeOnlyJsx(read('frontend/src/pages/hq/SuperAdminHolders.jsx'));
  assert.match(holders, /api\.adminListUsers\(\)/,
    'the flat-array caller changed — if it now passes an envelope, this test is what should have told you');
});
