/**
 * Auth routes must not depend on a lazy chunk that can 404 after deploy.
 *
 * /login is where session expiry, logout, and RequireAuth all land — often via
 * a hard navigation that must fetch a fresh index.html but may still carry a
 * stale module graph. A lazy LoginPage chunk 404 is the stale-deploy case that
 * triggered Safari's unbounded reload banner; these pages ship in the entry
 * graph instead.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const app = codeOnly(read('frontend/src/App.jsx'));

const AUTH_PAGES = [
  'LoginPage',
  'RegisterPage',
  'VerifyEmailPage',
  'RecoverPage',
];

test('auth pages are imported eagerly in App.jsx', () => {
  for (const page of AUTH_PAGES) {
    assert.match(app, new RegExp(`import ${page} from '\\./pages/${page}'`),
      `${page} must be a static import, not lazy()`);
    assert.doesNotMatch(app, new RegExp(`lazy\\(\\(\\) => import\\('\\./pages/${page}'\\)`),
      `${page} must not stay lazy-loaded`);
  }
});

test('SettingsContext respects the forced-light pin on auth surfaces', () => {
  const settings = read('frontend/src/contexts/SettingsContext.jsx');
  const forced = read('frontend/src/hooks/useForcedLightTheme.js');
  assert.match(forced, /dataset\.axalForcedTheme = 'light'/);
  assert.match(settings, /dataset\.axalForcedTheme === 'light'/);
});

test('RouteErrorBoundary chunk recovery uses the shared reload budget', () => {
  const boundary = codeOnly(read('frontend/src/components/RouteErrorBoundary.jsx'));
  assert.match(boundary, /reloadWithinBudget\(RELOAD_GUARD_KEY, RELOAD_GUARD_PARAM/);
  assert.match(boundary, /readAttempts\(RELOAD_GUARD_KEY, RELOAD_GUARD_PARAM\)/);
});
