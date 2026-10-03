/**
 * D334 — a Codex review (P1) caught that `clearSession()` never revoked a
 * device's push subscription on sign-out. `getPushState()` only checks
 * whether the browser's service worker has ANY subscription at all, so the
 * next account to sign in on the same device sees push as already "on" and
 * never calls `enablePush()` to re-home the endpoint to its own `user_id` —
 * the server-side `push_subscriptions` row kept the FORMER user's id, and
 * `notify()`'s push fan-out (D334) sends to whatever row matches the
 * endpoint, not whoever is currently signed in. Net effect: a signed-out
 * device kept receiving that account's notifications, capital-call and
 * contract notices included, indefinitely.
 *
 * `disablePush()` (`lib/pwa.js`) both unsubscribes the browser's push
 * manager AND calls `api.pushUnsubscribe`, which deletes the row.
 *
 * A FOLLOW-UP REVIEW CAUGHT THE FIRST FIX HERE TOO: it awaited
 * `disablePush()` (behind a 3s race) before any of `clearSession`'s
 * synchronous local teardown — `setUser(null)` and the token/user wipe
 * included. A stalled service worker, subscription lookup or unsubscribe
 * request held up ALL of it for up to 3s, and a tab closed during that
 * stall kept both the local token and the server cookie alive. The actual
 * fix: `disablePush()` is called fire-and-forget (never awaited at all),
 * with the token captured into a local variable and passed through
 * explicitly as `authToken` — `disablePush`'s own internal `await`s
 * (`navigator.serviceWorker.ready`, `getSubscription()`) mean it would
 * otherwise reach `api.pushUnsubscribe` well after `localStorage` has
 * already been cleared by the synchronous code that no longer waits for it.
 *
 * Source-level, like the codebase's other App.jsx assertions: `clearSession`
 * is a large hook-bound closure inside a component, not an isolated,
 * importable unit, so the established pattern here is pinning its shape in
 * the source rather than mounting the component.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP = readFileSync(resolve(process.cwd(), 'frontend/src/App.jsx'), 'utf8');
const PWA = readFileSync(resolve(process.cwd(), 'frontend/src/lib/pwa.js'), 'utf8');
const API = readFileSync(resolve(process.cwd(), 'frontend/src/lib/api.js'), 'utf8');

test('App.jsx imports disablePush from lib/pwa', () => {
  assert.match(
    APP,
    /import\s*\{\s*disablePush\s*\}\s*from\s*'\.\/lib\/pwa'/,
    'clearSession has no way to revoke a push subscription without this import',
  );
});

function clearSessionBody() {
  const start = APP.indexOf('const clearSession = useCallback(async () => {');
  assert.ok(start > 0, 'clearSession not found');
  return start;
}

test('clearSession captures the token and calls disablePush with it, before clearing the token', () => {
  const start = clearSessionBody();
  const tokenCapture = APP.indexOf('localStorage.getItem(\'token\')', start);
  assert.ok(tokenCapture > start, 'clearSession never captures the token for disablePush — pushUnsubscribe needs it after the token is gone');
  const tokenRemoval = APP.indexOf("localStorage.removeItem('token')", start);
  assert.ok(tokenRemoval > start, "clearSession no longer removes the token — this test's ordering check is stale");
  const disablePushCall = APP.indexOf('disablePush({', start);
  assert.ok(disablePushCall > start, 'clearSession never calls disablePush()');
  assert.ok(
    tokenCapture < disablePushCall && disablePushCall < tokenRemoval,
    'the token must be captured, then handed to disablePush(), before it is cleared from localStorage',
  );
  const nearCall = APP.slice(disablePushCall, disablePushCall + 120);
  assert.match(nearCall, /authToken:\s*tokenForPushRevoke/, 'disablePush() must receive the captured token explicitly');
});

test('clearSession does NOT await disablePush — the local teardown must not wait on it', () => {
  const start = clearSessionBody();
  const disablePushCall = APP.indexOf('disablePush({', start);
  const line = APP.slice(Math.max(start, disablePushCall - 20), disablePushCall);
  assert.ok(
    !/await\s*$/.test(line.trimEnd()),
    'disablePush() must be fire-and-forget — awaiting it here is exactly the stall a follow-up review caught',
  );
  // A fire-and-forget promise still needs a rejection handler, or a failed
  // revoke becomes an unhandled rejection instead of the silent best-effort
  // this is supposed to be.
  const nextStatement = APP.slice(disablePushCall, disablePushCall + 150);
  assert.match(nextStatement, /\.catch\(/, 'the un-awaited disablePush() call must still catch its own rejection');
});

test('disablePush accepts an explicit authToken and passes it through to pushUnsubscribe', () => {
  assert.match(
    PWA,
    /export async function disablePush\(\{\s*authToken\s*\}\s*=\s*\{\}\)/,
    'disablePush no longer takes an authToken override — a sign-out-time caller has nowhere to pass the captured token',
  );
  const fnStart = PWA.indexOf('export async function disablePush(');
  const fnBody = PWA.slice(fnStart, fnStart + 800);
  assert.match(fnBody, /Authorization:\s*`Bearer \$\{authToken\}`/, 'disablePush must forward authToken as an explicit Authorization header');
});

test('api.pushUnsubscribe accepts an options object and merges its headers in', () => {
  const start = API.indexOf('pushUnsubscribe:');
  assert.ok(start > 0, 'pushUnsubscribe not found in api.js');
  assert.match(
    API.slice(start, start + 60),
    /pushUnsubscribe:\s*\(data,\s*opts\s*=\s*\{\}\)/,
    'pushUnsubscribe must accept an opts parameter, or a captured token has no way through to the request',
  );
  assert.match(
    API.slice(start, start + 220),
    /headers:\s*opts\.headers/,
    'pushUnsubscribe must forward opts.headers into the request',
  );
});
