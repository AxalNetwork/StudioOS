// D2319 (#2319), #4415: retired aliases never mount or count; outside and used links survive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REDIRECT_ROUTES, ADMIN_TAB_REDIRECTS, FORWARD_REDIRECTS, ROLE_REDIRECTS, isRedirectKey } from '../../cloudflare-worker/src/services/redirectRoutes.ts';
import { redirectPatternFor } from '../src/lib/redirectBeacon.js';
import { isRetiredRedirect } from './_retiredRedirects_2319.mjs';
const read = (p) => readFileSync(p, 'utf8');
const decision = read('documentation/architecture/decisions/D2319.md');
const retired = [...decision.split('<!-- retired-paths:begin -->')[1].split('<!-- retired-paths:end -->')[0].matchAll(/^- `([^`]+)`$/gm)].map((m) => m[1]);
const routes = read('frontend/src/App.jsx') + read('frontend/src/routes/hqDecks.jsx');

function checkRetired(routeSource, listed) {
  assert.ok(retired.includes('/messages') && retired.includes('/admin/ai/deck-grid'));
  for (const path of retired) {
    assert.equal(routeSource.includes(`<Route path="${path}"`), false, path);
    assert.equal(listed.some((r) => r.path === path), false, path);
  }
}

function checkProtected(routeSource, listed) {
  const retained = ["/settings", "/settings/:section", "/dashboard", "/product-testing", "/raise/pitch-deck", "/insights", "/notifications", "/notifications/*", "/help/:id", "/tickets/:id", "/support", "/plans-and-pricing", "/raise/capital/cap-table", "/lp-portal", "/integrations", "/lp/founder", "/lp/customer-discovery", "/lp/investor", "/lp/partner", "/admin/spinout-lab", "/admin", "/refer", "/wellbeing/expert-dashboard"];
  for (const path of retained) {
    assert.ok(listed.some((r) => r.path === path), path);
    assert.ok(routeSource.includes(`<Route path="${path}"`), path);
  }
  for (const path of ['/lp/founder', '/lp/customer-discovery', '/lp/investor', '/lp/partner', '/dashboard', '/refer', '/wellbeing/expert-dashboard']) {
    assert.equal(listed.find((r) => r.path === path)?.keep, true, path);
  }
  for (const r of [...ADMIN_TAB_REDIRECTS, ...FORWARD_REDIRECTS, ...ROLE_REDIRECTS]) {
    assert.ok(listed.includes(r), r.path);
  }
}

const check = (source = routes, list = REDIRECT_ROUTES) => {
  checkRetired(source, list);
  checkProtected(source, list);
};

test('D2319: retired aliases are absent and every protected address remains', () => {
  check();
  for (const path of retired) assert.equal(isRedirectKey(`redirect:${path}`), false, path);
  for (const r of REDIRECT_ROUTES) assert.equal(isRedirectKey(`redirect:${r.path}`), true, r.path);
  for (const path of ['/lp/founder', '/lp/customer-discovery', '/lp/investor', '/lp/partner', '/dashboard', '/refer', '/wellbeing/expert-dashboard']) {
    assert.equal(redirectPatternFor(path), path, path);
  }
});

test('D2319: each restored alias or missing protected route/key/keep flag fails, then restoration passes', () => {
  for (const path of retired) {
    assert.throws(() => check(routes + `<Route path="${path}" element={<Navigate to="/studio" />} />`), assert.AssertionError, path);
    check();
    assert.throws(() => check(routes, [...REDIRECT_ROUTES, { path }]), assert.AssertionError, path);
    check();
  }
  for (const row of REDIRECT_ROUTES) {
    assert.throws(() => check(routes, REDIRECT_ROUTES.filter((r) => r !== row)), assert.AssertionError, row.path);
    check();
    if (!row.forward && !('role' in row) && !row.path.includes('?')) {
      assert.throws(() => check(routes.replace(`<Route path="${row.path}"`, '<Route path="/lost-alias"')), assert.AssertionError, row.path);
      check();
    }
  }
  for (const path of ['/lp/founder', '/lp/customer-discovery', '/lp/investor', '/lp/partner', '/dashboard', '/refer', '/wellbeing/expert-dashboard']) {
    assert.throws(() => check(routes, REDIRECT_ROUTES.map((r) => r.path === path ? { path } : r)), assert.AssertionError, path);
    check();
  }
});

test('D2319: historical pins distinguish exact roots, parameters and splats from protected descendants', () => {
  for (const path of ['/tickets', '/docs', '/products/example', '/account/developer/keys?tab=usage#recent']) {
    assert.equal(isRetiredRedirect(path), true, path);
  }
  for (const path of ['/tickets/42', '/help/42', '/raise/capital/cap-table', '/account/builder/keys', '/lp/investor']) {
    assert.equal(isRetiredRedirect(path), false, path);
  }
});
