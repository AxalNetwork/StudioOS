/**
 * D8680 (#8680): an email link whose session cannot be read says why on the sign-in page, never a bare "Sign in".
 *
 *   · `linkBootstrapFailureFor` names the failure of the session probe after `?magic=ok`: `session` when the server
 *     answered 401 (the browser did not keep the cookie), `unreachable` for anything else;
 *   · `withLinkFailure` adds only those two codes to the sign-in address, after any kept `?next=`;
 *   · LoginPage words both codes, and RequireAuth carries the reason on its redirect to /login.
 *
 * The journeys themselves are the "member sign-up links (#8680)" block of `frontend/tests/e2e/public_journey.spec.js`.
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/link_bootstrap_failure_8680.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LINK_BOOTSTRAP_FAILURES, linkBootstrapFailureFor, withLinkFailure } from '../src/lib/pendingNext.js';

const read = (p) => readFileSync(path.resolve(process.cwd(), p), 'utf8');
const failed = (status, message = 'Request failed') => Object.assign(new Error(message), status ? { status } : {});

test('the probe failure is named by what the server answered', () => {
  assert.equal(linkBootstrapFailureFor(failed(401, 'Not authenticated')), 'session', '/auth/me 401: the cookie was not kept');
  assert.equal(linkBootstrapFailureFor(failed(0, 'Session expired')), 'session', 'api.request\'s own 401 throw');
  assert.equal(linkBootstrapFailureFor(failed(503, 'Synthetic outage')), 'unreachable');
  assert.equal(linkBootstrapFailureFor(failed(500, 'Session expired')), 'unreachable', 'a 5xx is ours, whatever it says');
  assert.equal(linkBootstrapFailureFor(new TypeError('Failed to fetch')), 'unreachable', 'no network');
  assert.equal(linkBootstrapFailureFor(undefined), 'unreachable');
});

test('only the two codes reach the sign-in address, after a kept destination', () => {
  assert.deepEqual([...LINK_BOOTSTRAP_FAILURES], ['session', 'unreachable']);
  assert.equal(withLinkFailure('/login', 'session'), '/login?magic_error=session');
  assert.equal(withLinkFailure('/login?next=%2Fgrow%2Fupdate', 'unreachable'), '/login?next=%2Fgrow%2Fupdate&magic_error=unreachable');
  assert.equal(withLinkFailure('/login', null), '/login', 'no failure: the plain sign-in page');
  assert.equal(withLinkFailure('/login', 'expired'), '/login', 'a code the probe never names is dropped');
  assert.equal(withLinkFailure('/login', 'x&next=//evil.test'), '/login', 'nothing else is written into the address');
});

test('LoginPage words both codes, and the guard and the probe carry them', () => {
  const login = read('frontend/src/pages/LoginPage.jsx');
  for (const code of LINK_BOOTSTRAP_FAILURES) assert.match(login, new RegExp(`\\n  ${code}: 'Your link was accepted, but `), code);
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Navigate to=\{withLinkFailure\(loginRedirectFor\(location\), linkBootstrapFailure\)\}/);
  const sync = read('frontend/src/hooks/useAuthSync.jsx');
  assert.match(sync, /if \(magicMarker && outcome\?\.error\) \{\n\s+setLinkBootstrapFailure\(linkBootstrapFailureFor\(outcome\.error\)\);\n\s+setUser\(null\);/);
  assert.match(sync, /if \(linkBootstrapFailure && location\.pathname === '\/login'\) setLinkBootstrapFailure\(null\);/);
});
