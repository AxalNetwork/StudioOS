/**
 * Every Usage page has a route. `/account/usage/cost` (D789) and
 * `/account/usage/limits` (D807) are drawn by SettingsPage from the path, but
 * App.jsx routed only `/account/:section`, one segment, so both answered the
 * 404 page in production. This holds each Usage page's address to a route
 * App.jsx declares, matched the way react-router matches it.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/account_usage_routes.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchPath } from 'react-router-dom';
import { USAGE_PAGES, usagePageFor } from '../src/pages/account/limitsModel.js';

const APP = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const ROLES = "['admin', 'founder', 'partner', 'investor', 'advisor', 'exploring']";
/** Each `<Route path="/account…">` App.jsx declares, with what it mounts. */
const accountRoutes = [...APP.matchAll(/<Route path="(\/account[^"]*)" element=\{([^\n]+)\} \/>/g)].map((m) => ({ path: m[1], element: m[2] }));

test('every Usage page address matches a route that mounts SettingsPage behind the account guard', () => {
  assert.ok(accountRoutes.length > 3, 'the account routes were not found in App.jsx');
  for (const { id, path } of USAGE_PAGES) {
    const route = accountRoutes.find((r) => matchPath({ path: r.path, end: true }, path));
    assert.ok(route, `${path} (${id}) matches no route: it renders the 404 page`);
    assert.equal(route.element, `guard(${ROLES}, <SettingsPage />)`, `${path} is not the account page behind its guard`);
    assert.equal(usagePageFor(path), id, `${path} does not open the ${id} page`);
  }
});

test('the Usage sub-page route is the two-segment one, and one segment still opens a section', () => {
  assert.ok(accountRoutes.some((r) => r.path === '/account/usage/:page'));
  assert.ok(accountRoutes.some((r) => r.path === '/account/:section'));
  // An unknown Usage page still reaches the account page, which opens Overview.
  assert.ok(accountRoutes.some((r) => matchPath({ path: r.path, end: true }, '/account/usage/elsewhere')));
  assert.equal(usagePageFor('/account/usage/elsewhere'), 'overview');
});
