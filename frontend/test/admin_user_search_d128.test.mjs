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
  // Imported from the shared module, among whatever else the page takes from
  // it, and never declared here. The second half is the property this message
  // has always named; the first used to pin the whole import line, which
  // failed the day the page took a second primitive from the same module
  // (D236 imports `Unreadable` beside it) while the property still held.
  assert.match(PAGE, /import \{[^}]*\bUnrecorded\b[^}]*\} from '\.\.\/ui'/,
    'the honesty primitive must be imported from ../ui');
  assert.doesNotMatch(PAGE, /\b(?:function|const|let|var|class)\s+Unrecorded\b/,
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
    'frontend/src/pages/AdminPage.jsx',
    'frontend/src/pages/branch/BranchAccounts.jsx',
    'frontend/src/pages/hq/SuperAdminHolders.jsx',
  ];
  for (const file of callers) {
    const code = codeOnlyJsx(read(file));
    assert.ok(!/api\.adminListUsers\(\s*\)/.test(code),
      `${file} reads the newest-100 page as though it were the directory`);
  }
});
