/**
 * D8537 (#8537): the two hand-offs the public-journey browser spec found broken, held without a browser.
 *
 *   · the email link lands on `/dashboard?magic=ok` (or `/onboarding/chat?magic=ok`) with only the httpOnly cookie,
 *     so the session probe must run for `magic=ok` as it does for Google's `google=ok`;
 *   · the kept destination's redirect is keyed on the history entry it left: a re-render of that entry before the
 *     navigation lands still redirects, so that page's own guard cannot send the visitor elsewhere.
 *
 * The journeys themselves are `frontend/tests/e2e/public_journey.spec.js`.
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pending_next_redirect_8537.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { markPendingNextRedirected, pendingNextRedirected } from '../src/lib/pendingNext.js';

const read = (p) => readFileSync(path.resolve(process.cwd(), p), 'utf8');

test('the redirect is pending until issued, then spent everywhere except the entry it was issued from', () => {
  assert.equal(pendingNextRedirected('entry-a'), false, 'nothing issued yet');
  markPendingNextRedirected('entry-a');
  assert.equal(pendingNextRedirected('entry-a'), false, 'a re-render of the page being left still redirects');
  assert.equal(pendingNextRedirected('entry-b'), true, 'the target, or any later page, is not bounced');
  assert.equal(pendingNextRedirected(), true, 'a caller without a key reads it spent');
  markPendingNextRedirected();
  assert.equal(pendingNextRedirected('entry-a'), true, 'landed on the target directly: spent on every entry');
});

test('RequireAuth keys the redirect on location.key, and the email link starts the session probe', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /!pendingNextRedirected\(location\.key\)/);
  assert.match(app, /markPendingNextRedirected\(location\.key\)/);
  const sync = read('frontend/src/hooks/useAuthSync.jsx');
  const marker = sync.slice(sync.indexOf('const [postOAuthMarker]'), sync.indexOf('const [oauthBootstrapping'));
  assert.match(marker, /params\.has\('google'\) \|\| params\.has\('google_signup'\)/);
  assert.match(marker, /params\.get\('magic'\) === 'ok'/);
  // D4580 part 2 (#4580): Apple's callback lands with `apple=ok` (`apple_signup=1` for a new account).
  assert.match(marker, /params\.get\('apple'\) === 'ok' \|\| params\.has\('apple_signup'\)/);
});
