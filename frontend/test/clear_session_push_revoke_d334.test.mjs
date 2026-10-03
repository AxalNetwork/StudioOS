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
 * manager AND calls `api.pushUnsubscribe`, which deletes the row. The fix
 * is calling it from `clearSession()` — BEFORE `localStorage.removeItem('token')`,
 * since `pushUnsubscribe`'s request is authenticated off that same token
 * every other API call uses; call it after and the request goes out with no
 * Authorization header and silently no-ops.
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

test('App.jsx imports disablePush from lib/pwa', () => {
  assert.match(
    APP,
    /import\s*\{\s*disablePush\s*\}\s*from\s*'\.\/lib\/pwa'/,
    'clearSession has no way to revoke a push subscription without this import',
  );
});

test('clearSession calls disablePush before clearing the auth token', () => {
  const start = APP.indexOf('const clearSession = useCallback(async () => {');
  assert.ok(start > 0, 'clearSession not found');
  const tokenRemoval = APP.indexOf("localStorage.removeItem('token')", start);
  assert.ok(tokenRemoval > start, "clearSession no longer removes the token — this test's ordering check is stale");
  // The literal `disablePush()` (no trailing comma) also appears inside this
  // function's own explanatory comment above the real call — matching the
  // actual call expression `disablePush(),` skips that false hit.
  const disablePushCall = APP.indexOf('disablePush(),', start);
  assert.ok(disablePushCall > start, 'clearSession never calls disablePush()');
  assert.ok(
    disablePushCall < tokenRemoval,
    'disablePush() must run before the token is cleared — pushUnsubscribe is authenticated off that same token',
  );
});

test('the disablePush call is time-boxed and cannot throw out of clearSession', () => {
  const start = APP.indexOf('const clearSession = useCallback(async () => {');
  const disablePushCall = APP.indexOf('disablePush(),', start);
  const tryBefore = APP.lastIndexOf('try {', disablePushCall);
  assert.ok(tryBefore > start, 'disablePush() is not inside a try block');
  const nearby = APP.slice(tryBefore, disablePushCall + 50);
  assert.match(nearby, /Promise\.race/, 'disablePush() must race a timeout, like the server-side logout call below it does');
});
