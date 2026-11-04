// D2319 (#2319), #4415: retired aliases never mount or count; outside and used links survive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { retiredNavigationLinks, retiredRouteMapLinks } from './_redirectLinks_2319.mjs';
import FounderMarketplacePage from '../src/pages/FounderMarketplacePage.jsx';
import IncorporateDone from '../src/pages/incorporate/IncorporateDone.jsx';
import { advisorTabs } from '../src/pages/advisor/AdvisorWorkspaceShell.jsx';
import { COMMUNITY_CONSOLES } from '../src/pages/branch/BranchCommunity.jsx';
import { ROUND_LINK } from '../src/pages/raise/pitch/newDeckModel.js';
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


function runtimeSources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? runtimeSources(path)
      : !entry.name.endsWith('.d.ts') && /\.(?:js|jsx|ts|tsx|mjs|json|md)$/.test(entry.name) ? [path] : [];
  });
}

test('D2319: frontend navigation and Worker-built links never target a retired address', () => {
  const hits = [];
  for (const [dir, worker] of [['frontend/src', false], ['cloudflare-worker/src', true]]) {
    for (const file of runtimeSources(dir).filter((p) => !p.endsWith('.md'))) for (const hit of retiredNavigationLinks(read(file), file, { worker })) {
      hits.push(`${file}:${hit.line} ${hit.path}`);
    }
  }
  for (const file of runtimeSources('documentation/architecture/route-map')) for (const hit of retiredRouteMapLinks(read(file), file)) hits.push(`${file}:${hit.line} ${hit.path}`);
  assert.deepEqual(hits, [], 'Repoint live links and mark retired route-map addresses before removing their redirect');
});

test('D2319: every retired address is caught in each link syntax, including queries, parameters and Worker builders', () => {
  for (const path of retired) {
    const target = path.replace(/:[^/]+/g, '17').replace(/\*/g, 'keys');
    for (const source of [
      `<Link to=${JSON.stringify(target)} />`,
      `const item = {to:${JSON.stringify(target)}};`,
      `const item = {href:withProject(${JSON.stringify(target)})};`,
      `navigate(${JSON.stringify(target + '?project=7#details')});`,
      `const item = {page_target:${JSON.stringify(target)}};`,
      `const destination=${JSON.stringify(target)}; <Link to={destination} />`,
      `function cta(){const browse=${JSON.stringify(target)}; const selected=found ? browse : '/studio'; return {route:selected};}`,
      `function row(label,page){return {href:page};} row('title',${JSON.stringify(target)});`,
    ]) {
      assert.ok(retiredNavigationLinks(source).length > 0, `${path}: ${source}`);
    }
    for (const field of ['href', 'route', 'url', 'page_url', 'open_url']) assert.ok(retiredNavigationLinks(`const item = {${field}:scopePath(${JSON.stringify(target)})};`, 'fixture.ts', { worker: true }).length > 0, `${field}: ${path}`);
    assert.equal(retiredRouteMapLinks(`Live: \`${target}\``).length, 1, path);
    assert.deepEqual(retiredRouteMapLinks(`Historical: \`${target}\` (retired D2319)`), [], path);
  }
  assert.equal(retiredNavigationLinks('const item={href:`/validate/experiments-and-evidence/${id}?project=${project}`};').length, 1);
  assert.equal(retiredNavigationLinks('const item={href:"https://axal.vc/build/deck"};').length, 1);
  assert.equal(retiredNavigationLinks('const item={href: current || "/build/deck"};').length, 1);
});

test('D2319: comments, API endpoints, comparisons, assets, outside hosts and protected descendants are not navigation to aliases', () => {
  const source = `// <Link to="/build/deck" />
    /* navigate('/customer-discovery') */
    const old = pathname === '/build/deck';
    fetch('/projects'); <img src="/projects" />;
    const api = {href:'/api/projects'};
    const outside = {href:'https://elsewhere.test/build/deck'};
    const ticket = {to:'/tickets/17'};
    const help = {to:'/help/17'};
    const current = {href:'/raise/capital/cap-table'};`;
  assert.deepEqual(retiredNavigationLinks(source), []);
  assert.deepEqual(retiredNavigationLinks(`function endpoint(){return '/contacts';}`, 'frontend/src/lib/api/contacts.js'), []);
  assert.deepEqual(retiredNavigationLinks(`function match(route){return {route};} match('/build/deck');`), []);
  assert.throws(() => retiredNavigationLinks('<Link to='), SyntaxError);
});

test('D2319: repaired public navigation uses the canonical screens and 83(b) retains its role-aware destination', () => {
  assert.deepEqual(advisorTabs.map((t) => t.to), ['/practice/opportunities', '/advisor/advisory/clients', '/practice/engagements', '/practice/delivery', '/advisor/advisory/contracts']);
  assert.equal(COMMUNITY_CONSOLES.find((c) => c.key === 'network-profiles').to, '/admin/advisors-partners/deck');
  assert.equal(ROUND_LINK.path, '/raise/capital-relationships/calls');
  for (const [user, target] of [
    [{role:'founder',spinout_lab_active:1}, '/spinout-lab/83b'],
    [{role:'exploring',spinout_lab_active:1}, '/spinout-lab/83b'],
    [{role:'admin'}, '/spinout-lab/83b'],
    [{role:'founder',spinout_lab_active:0}, '/raise/legal-engine/equity'],
  ]) {
    const markup = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(IncorporateDone, {user,order:{status:'paid'}})));
    assert.ok(markup.includes(`href="${target}"`), `${user.role}: ${target}`);
    assert.equal(markup.includes('href="/incorporate/83b"'), false);
  }
});


test('D2319: the founder engagement mail destination opens the mounted Needs tab', () => {
  const user = { id: 1, role: 'founder', founder_id: 10 };
  const target = '/build/marketplace?tab=needs';
  assert.ok(routes.includes(`<Route path="/build/marketplace" element={guard(['admin', 'founder'], founderWorkspace('validate', founderEditor(<FounderMarketplacePage user={user} />)))} />`));
  const markup = renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [target] }, React.createElement(FounderMarketplacePage, { user })));
  assert.ok(markup.includes('Search title / description'), 'the actual NeedsBrowseTab renders from the mail destination query');
});
