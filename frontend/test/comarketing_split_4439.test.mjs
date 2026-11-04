/** D4439 (#4439): the same feature belongs to partner Offers and founder Partner network, never investor. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route, useLocation, useNavigationType, matchRoutes } from 'react-router-dom';
import { transformWithOxc } from 'vite';
import { installDocument } from './_contracts_dom.mjs';
import { routeBlock } from './_routes.mjs';
import comarketingRoutes from '../src/routes/comarketing.jsx';
import CoMarketingFounderRedirect from '../src/pages/founder/CoMarketingFounderRedirect.jsx';
import FounderCoMarketingPage from '../src/pages/founder/FounderCoMarketingPage.jsx';
import { PARTNER_TAB_SETS } from '../src/pages/partner/PartnerWorkspaceTabs.jsx';
import { moduleToolLinks, editorModuleLink } from '../src/pages/cycles/founderToolNavigation.js';
import { FOUNDER_ZONE_ACTIONS } from '../src/workspaces/founderZoneActions.js';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { HELP_SURFACES, canOpenSurface } from '../src/pages/docs/guidePlacement.js';
import { recordFeedVisit } from '../src/pages/CoMarketingPage.jsx';
import { ROLE_REDIRECTS, isRedirectKey } from '../../cloudflare-worker/src/services/redirectRoutes.ts';
import { redirectPatternFor, useRedirectBeacon } from '../src/lib/redirectBeacon.js';

const h = React.createElement;
const founder = { role: 'founder', subscription_tier: 'studio' };
const target = '/grow/partner-network/co-marketing';
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the canonical route admits a founder and admin, and refuses investor and partner', () => {
  const admitted = [];
  const tree = comarketingRoutes({ user: founder, guard: (roles, page) => { admitted.push(roles); return page; } });
  const route = React.Children.toArray(tree.props.children)[0];
  assert.equal(route.props.path, target);
  assert.deepEqual(admitted, [['admin', 'founder']]);
  assert.equal(route.props.element.props.user, founder);
  assert.equal(matchRoutes([{ path: '/grow/:slug/:id' }, { path: route.props.path }], target).at(-1).route.path, target);
});

test('the old route sends only a founder to the counted forward; the partner Offers page stays intact', async () => {
  // Evaluate the actual JSX declaration, with its existing wrappers represented
  // as identity functions, rather than pinning one whitespace-sensitive line.
  const declaration = routeBlock(read('../src/App.jsx'), '/comarketing').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const { code } = await transformWithOxc('function route() { return (' + declaration + '); }', 'route.jsx', { jsx: { runtime: 'classic' } });
  const names = ['React', 'Route', 'guard', 'partnerPrivateWorkspace', 'effectiveRole', 'user', 'CoMarketingFounderRedirect', 'PartnerWorkspaceTabs', 'CoMarketingPage', 'founderWorkspace', 'founderEditor'];
  for (const role of ['founder', 'partner', 'admin', 'investor']) {
    const allowed = [];
    const route = new Function(...names, code + '; return route();')(React, Route,
      (roles, page) => { allowed.push(roles.includes(role)); return roles.includes(role) ? page : 'refused'; },
      (page) => page, role, { role }, CoMarketingFounderRedirect, 'partner-offers', 'co-marketing', (_name, page) => page, (page) => page);
    assert.deepEqual(allowed, [role !== 'investor']);
    if (role === 'investor') assert.equal(route.props.element, 'refused');
    else if (role === 'founder') assert.equal(route.props.element.type, CoMarketingFounderRedirect);
    else {
      assert.equal(route.props.element.type, 'partner-offers');
      assert.equal(route.props.element.props.set, 'offers');
      assert.equal(route.props.element.props.children.type, 'co-marketing');
    }
  }
  assert.match(read('../src/App.jsx'), /const CoMarketingFounderRedirect = lazy\(\(\) => import\('\.\/pages\/founder\/CoMarketingFounderRedirect'\)\)/);
});

test('founder opens co-marketing from Partner network and returns with the venture; investor has no navigation link', () => {
  assert.deepEqual(moduleToolLinks('grow', 'partner-network', founder, '?project_id=41&tab=old'), [{ label: 'Open co-marketing', href: target + '?project_id=41' }]);
  assert.ok(!moduleToolLinks('grow', 'distribution', founder).some((link) => link.href.includes('co-marketing')));
  assert.deepEqual(editorModuleLink(target, '?project_id=41&tab=old', founder), { href: '/grow/partner-network?project_id=41', label: '← Grow › Partner network' });
  assert.deepEqual(FOUNDER_ZONE_ACTIONS['grow/partnerships'][0], { label: 'Open co-marketing', to: target });
  assert.equal((read('../src/pages/founder/FounderGrowPartnerships.jsx').match(/\/grow\/partner-network\/co-marketing\?project_id=/g) || []).length, 2);
  const visibility = PARTNER_TAB_SETS.offers.find((tab) => tab.to === '/comarketing');
  assert.deepEqual(visibility.roles, ['admin', 'partner']);
  const partnerOffers = SIDEBAR_GROUPS.partner.flatMap((group) => group.items).find((row) => row.label === 'Offers');
  assert.ok(partnerOffers.match.includes('/comarketing'));
  const investorTargets = SIDEBAR_GROUPS.investor.flatMap((group) => group.items).flatMap((row) => [row.to, ...(row.match || [])]);
  assert.ok(!investorTargets.some((path) => path?.includes('comarketing') || path?.includes('co-marketing')));
  assert.equal(canOpenSurface(HELP_SURFACES['/comarketing'], { role: 'investor' }), false);
  assert.deepEqual(moduleToolLinks('grow', 'partner-network', { role: 'investor' }), []);
});

test('the reused founder page shows the published feed with a Partner network return, not a partner pitch form', () => {
  const html = renderToStaticMarkup(h(MemoryRouter, { initialEntries: [target + '?project_id=41'] }, h(FounderCoMarketingPage, { user: founder })));
  assert.match(html, /href="\/grow\/partner-network\?project_id=41"/);
  assert.match(html, /Explore published webinars, blog posts and podcasts from the partner network/);
  assert.doesNotMatch(html, /My pitches|partner profile|Propose a pitch/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
});

test('the founder forward keeps query and hash, replaces history, and counts its pattern once; partner address-bar visits do not count', async () => {
  const restore = installDocument();
  const root = createRoot(document.createElement('div'));
  const sent = [], locations = [];
  const send = (key) => sent.push(key);
  function AddressBeacon() { const loc = useLocation(); useRedirectBeacon(loc.pathname, loc.search, send); return null; }
  function Destination() { const loc = useLocation(); const action = useNavigationType(); locations.push([loc.pathname, loc.search, loc.hash, action]); return null; }
  try {
    await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/comarketing?project_id=41&private=never-count#published'] },
      h(AddressBeacon), h(Routes, null,
        h(Route, { path: '/comarketing', element: h(CoMarketingFounderRedirect, { send }) }),
        h(Route, { path: target, element: h(Destination) })))));
    assert.deepEqual(sent, ['redirect:/comarketing']);
    assert.deepEqual(locations.at(-1).slice(0, 3), [target, '?project_id=41&private=never-count', '#published']);
    assert.equal(locations.at(-1)[3], 'REPLACE');
    assert.equal(redirectPatternFor('/comarketing'), null);
    assert.equal(ROLE_REDIRECTS.find((entry) => entry.path === '/comarketing')?.role, 'founder');
    assert.equal(isRedirectKey('redirect:/comarketing'), true);
    assert.equal(isRedirectKey('redirect:/comarketing?private=never-count'), false);
  } finally { await act(async () => root.unmount()); restore(); }
});

test('a founder feed visit records its new path; partner visits keep their existing path', async () => {
  const calls = [];
  const client = { trackCoMarketing: async (body) => { calls.push(body); } };
  await recordFeedVisit({ attribution_code: 'code' }, client, target);
  await recordFeedVisit({ attribution_code: 'code' }, client);
  assert.deepEqual(calls.map((body) => body.landing_path), [target, '/comarketing']);
});
