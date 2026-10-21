/**
 * #2321 — the four older audience landing pages are removed (#2297 §11, ticked
 * by the owner): the door pages (D676) replaced them. Each address forwards to
 * its door, so a link already shared outside keeps working, and is counted in
 * #2301's redirect inventory. `/lp/spinout-demo-day` stays.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/lp_pages_removed_2321.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { REDIRECT_ROUTES } from '../../cloudflare-worker/src/services/redirectRoutes.ts';
import { OG_ROUTES } from '../src/lib/ogRegistry.js';

const at = (p) => new URL(`../${p}`, import.meta.url);
const APP = readFileSync(at('src/App.jsx'), 'utf8');
const DOORS = {
  '/lp/founder': '/for-founders',
  '/lp/customer-discovery': '/for-founders',
  '/lp/investor': '/for-investors',
  '/lp/partner': '/for-service-partners',
};
const routeLine = (path) => APP.split('\n').find((l) => l.includes(`<Route path="${path}"`)) || '';

test('each removed address forwards to its door page, and the door page is a route', () => {
  for (const [from, to] of Object.entries(DOORS)) {
    assert.match(routeLine(from), new RegExp(`element=\\{<Navigate to="${to}" replace />\\}`), from);
    assert.ok(routeLine(to), `${to} is not a route`);
  }
  assert.match(routeLine('/lp/spinout-demo-day'), /<SpinoutDemoDayPage \/>/, 'the demo-day page was not in scope');
});

test('the four pages and the blocks only they used are gone, and nothing imports them', () => {
  const gone = [
    'src/pages/templates/FounderHomePage.jsx', 'src/pages/templates/CustomerDiscoveryHomePage.jsx',
    'src/pages/templates/InvestorDealflowHomePage.jsx', 'src/pages/templates/PartnerPartnershipHomePage.jsx',
    'src/templates/components/Hero.jsx', 'src/templates/components/MetricsStrip.jsx',
    'src/templates/components/FeatureGrid.jsx', 'src/templates/components/CTABlock.jsx',
    'src/templates/components/AccessBlock.jsx',
  ];
  for (const f of gone) assert.equal(existsSync(at(f)), false, f);
  for (const name of ['FounderHomePage', 'CustomerDiscoveryHomePage', 'InvestorDealflowHomePage', 'PartnerPartnershipHomePage']) {
    assert.equal(APP.includes(name), false, `App.jsx still names ${name}`);
  }
});

test('the redirects are in #2301\'s inventory, and no share card describes a page that is gone', () => {
  const listed = new Set(REDIRECT_ROUTES.map((r) => r.path));
  for (const from of Object.keys(DOORS)) {
    assert.ok(listed.has(from), `${from} is not counted`);
    assert.equal(REDIRECT_ROUTES.find((r) => r.path === from).keep, undefined, `${from} should retire with the others unless still hit`);
    assert.equal(OG_ROUTES.some((r) => r.path === from), false, `${from} still has its own share card`);
  }
  assert.ok(OG_ROUTES.some((r) => r.path === '/lp/spinout-demo-day'));
});
