import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isPublicPath } from '../src/lib/api.js';

test('directory-style public auth routes never trigger a session-expiry redirect', () => {
  for (const path of ['/login/', '/register/', '/verify-email/', '/spinout-lab/']) {
    assert.equal(isPublicPath(path), true, `${path} must be handled as public`);
  }
});

test('protected routes still require an active session', () => {
  assert.equal(isPublicPath('/studio/'), false);
  assert.equal(isPublicPath('/spinout-lab/apply/'), false);
});
// A BACKGROUND 401 ON A PUBLIC PAGE MUST NOT SIGN THE READER OUT.
//
// `isPublicPath` above decides whether a 401 bounces the tab to /login. It used
// to decide ONLY that: the two `localStorage.removeItem` calls that discard the
// session sat above the guard and ran unconditionally, so a signed-in reader on
// `/`, `/login`, `/articles` or `/jobs` lost their session to one background 401
// from any endpoint that is not `/auth/`-prefixed. Nothing announced it — they
// stayed on the page and were simply logged out by their next click.
//
// This is a source assertion rather than a behavioural one because `request()`
// needs a DOM, a fetch and a live module graph to exercise, and the thing worth
// pinning is structural: the wipe and the redirect share one guard. Reading the
// file is what catches a future edit that hoists the wipe back out.
test('the 401 session wipe is scoped to the same guard as the /login redirect', () => {
  const src = readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8');
  const branch = src.slice(src.indexOf("if (res.status === 401"));
  const guard = branch.indexOf('if (!publicPath && !_suppressAuthRedirect)');
  const wipeToken = branch.indexOf("localStorage.removeItem('token')");
  const wipeUser = branch.indexOf("localStorage.removeItem('user')");

  assert.ok(guard > 0, 'the public-path guard must still exist in the 401 branch');
  assert.ok(wipeToken > 0 && wipeUser > 0, 'the 401 branch must still clear a dead session somewhere');
  assert.ok(
    wipeToken > guard && wipeUser > guard,
    'both removeItem calls must sit INSIDE `if (!publicPath && …)`. Hoisting either one '
    + 'above the guard signs out a reader who is merely on a public page.',
  );
});
