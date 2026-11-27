/**
 * D120 — the branch landing for an HQ support session, and the three ways the
 * SPA half fails without looking broken.
 *
 * 1. THE ROUTE MUST SIT OUTSIDE `RequireAuth`. The HQ operator arriving here
 *    holds no session on this host and cannot: HQ's cookie is scoped elsewhere
 *    and its JWT is signed with another secret (D.4). Wrapping the route would
 *    bounce them to /login to sign in as a branch account they do not have —
 *    a redirect loop that reads as "the link is broken" rather than "the page
 *    is gated". `isPublicPath` carries the same fact for the background
 *    `settings/me` 401, and BOTH are needed: the route decides what renders,
 *    the predicate decides whether a background 401 redirects.
 *
 * 2. IT MUST NOT REDEEM ON MOUNT. The code is single-use, so a page that spent
 *    it during its own first render would burn it on a prefetch, a link
 *    scanner or the operator's own refresh — and the retry would then correctly
 *    refuse, which reads as a broken feature rather than a spent code.
 *
 * 3. NO TOKEN MAY REACH A URL. The whole reason for the one-time code is that a
 *    session token in a link survives in history, in the next Referer, and in
 *    anything that reads the address bar.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isPublicPath } from '../src/lib/api.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const APP = read('frontend/src/App.jsx');
const PAGE = read('frontend/src/pages/SupportRedeemPage.jsx');

test('/support/session is registered, and outside RequireAuth', () => {
  const at = APP.indexOf('path="/support/session"');
  assert.ok(at > 0, '/support/session is not a registered route — the hand-off URL 404s');
  // Bounded to this route's own element so a NEIGHBOURING route cannot satisfy
  // it, and asserting the element is the page rather than a guard wrapper.
  const element = APP.slice(at, at + 120);
  assert.match(element, /element=\{<SupportRedeemPage \/>\}/,
    '/support/session does not render SupportRedeemPage, or renders it behind a wrapper');
  assert.ok(!/RequireAuth/.test(element), '/support/session was wrapped in RequireAuth');
});

test('THE COLLISION: bare /support still belongs to the help redirect', () => {
  // This is the assertion that earned the path. `/support` was already a route
  // — `SupportRedirect` sends it to /help, preserving `?topic=` — so the first
  // version of this page registered a SECOND `/support`, which React Router
  // never reaches: it takes the first match. The hand-off link would have
  // redirected to the help centre and dropped its code, on every branch, and
  // every other test in this file still passed.
  const supportRoutes = [...APP.matchAll(/path="\/support[^"]*"/g)].map((m) => m[0]);
  assert.deepEqual(supportRoutes, ['path="/support"', 'path="/support/session"'],
    'the /support routes changed — a duplicate here is dead code, not a conflict error');
  const bare = APP.slice(APP.indexOf('path="/support"'), APP.indexOf('path="/support"') + 80);
  assert.match(bare, /<SupportRedirect \/>/, 'the help-centre shortcut at /support was taken over');
});

test('isPublicPath lets /support/session through, and is not a blanket prefix', () => {
  assert.equal(isPublicPath('/support/session'), true,
    'a background settings/me 401 bounces the HQ operator to /login');
  assert.equal(isPublicPath('/support/session/'), true, 'the trailing-slash form is not handled');
  // EXACT, NOT A PREFIX. Opening `/support/` wholesale would also open the
  // help-centre redirect and anything added under it later.
  assert.equal(isPublicPath('/support/anything-else'), false,
    '/support is matched as a prefix, which would open future sub-routes');
});

test('the page redeems on a click, never on mount', () => {
  assert.ok(!/useEffect/.test(PAGE),
    'SupportRedeemPage runs an effect — a single-use code spent on mount is burned by any prefetch');
  // The control, and its binding: a button with no handler would satisfy a
  // testid-only assertion while redeeming nothing.
  assert.match(PAGE, /onClick=\{open\}/, 'the button is not bound to the redeem handler');
  assert.match(PAGE, /api\.redeemSupportSession\(code\)/, 'the page does not call the redeem endpoint');
  // Re-entry guard: a double click must not spend two codes' worth of attempts.
  assert.match(PAGE, /if \(busy\) return;/, 'the redeem handler has no re-entry guard');
});

test('the token comes back in the response body and never goes into a URL', () => {
  assert.match(PAGE, /localStorage\.setItem\('token', res\.token\)/);
  // No interpolation of the token into any location assignment or link.
  assert.ok(!/href[^\n]*res\.token/.test(PAGE), 'the token is put into a link');
  assert.ok(!/location[^\n]*res\.token/.test(PAGE), 'the token is put into a location');
  // The code arrives from the query string and is never re-published.
  assert.match(PAGE, /params\.get\('code'\)/);
  assert.ok(!/setItem\('supportCode'/.test(PAGE), 'the one-time code is persisted after use');
});

test('the actor reaches the banner as a NAME, because no local row can name them', () => {
  // The branch has no `realUser` row for an HQ operator — the two databases do
  // not meet — so the name has to travel in the response. An id here would be
  // resolved against local `users` and would name a stranger.
  assert.match(PAGE, /actor_name: res\.actor_name/);
  assert.ok(!/actor_id|impersonated_by/.test(PAGE),
    'the page carries an HQ user id, which resolves to a different person on this branch');
});
