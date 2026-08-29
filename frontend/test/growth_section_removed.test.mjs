import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The Growth section is withdrawn — five modules, 15 nav rows across founder,
 * partner and advisor, 20 routes, six pages and src/data/growth.js.
 *
 * Every module was a UI shell over invented data, and the shell said so in its
 * own header: "This is a UI shell only — everything here is sample data."
 * Checked one at a time, none had a table behind it:
 *
 *   Talent, Customers, Experts   no table for searches, candidates, recruiters,
 *                                customer targets or expert profiles
 *   Partnerships                 partners.ts exists, but /partners already
 *                                serves it via PartnersPage + api.matchPartners.
 *                                Wiring this would have built a SECOND
 *                                partner-matching surface — the same duplicate
 *                                -surface problem D8, D10 and D11 each resolved
 *                                by keeping one.
 *   Capital                      GET /capital/investors is misleadingly named.
 *                                It returns limited_partners joined to vc_funds
 *                                — Axal's own LP register, gated to
 *                                investor/admin by canViewLpData — not a
 *                                capital-source directory. Growth is a founder/
 *                                partner/advisor surface, so all three roles get
 *                                403 from it. The `investors` table (angel/VC
 *                                directory) has no route serving it as a list.
 *
 * This file replaces founder_growth_paywall.test.mjs, which asserted that
 * founders hit a paywall before reaching the mock pages. That protection is
 * now absolute rather than tier-gated: there is no page to reach. The intent
 * is preserved in its strongest form, which is why the old file is deleted
 * rather than left asserting against code that no longer exists.
 */

const root = resolve(process.cwd());
const read = (p) => readFileSync(resolve(root, p), 'utf8');

test('the Growth pages and their fixture are gone from disk', () => {
  assert.equal(existsSync(resolve(root, 'frontend/src/data/growth.js')), false);
  assert.equal(existsSync(resolve(root, 'frontend/src/pages/growth')), false);
  for (const p of ['GrowthWorkspace', 'TalentPage', 'CustomersPage', 'PartnershipsPage', 'CapitalPage', 'ExpertsPage']) {
    assert.equal(existsSync(resolve(root, `frontend/src/pages/growth/${p}.jsx`)), false, `${p} must not return`);
  }
});

test('no route reaches the Growth workspace under any persona', () => {
  const app = read('frontend/src/App.jsx');
  assert.doesNotMatch(app, /GrowthWorkspace/);
  for (const role of ['founder', 'partner', 'advisor']) {
    assert.doesNotMatch(app, new RegExp(`path="/${role}/growth`), `${role} growth routes must not return`);
  }
});

test('no sidebar row points at a withdrawn Growth tab', () => {
  const sidebar = read('frontend/src/sidebarConfig.js');
  for (const role of ['founder', 'partner', 'advisor']) {
    assert.doesNotMatch(sidebar, new RegExp(`'/${role}/growth/`), `${role} nav must not link Growth`);
  }
  // The tier gate that used to lock these rows goes with them; a
  // requiredTier on a route that no longer exists is dead configuration.
  assert.doesNotMatch(sidebar, /\{ key: 'growth', label: 'Growth'/);
});

test('the investor Portfolio Growth tab is NOT what was withdrawn', () => {
  // /portfolio/growth is a different surface, wired to the live introductions
  // endpoint in #325. Withdrawing the shared Growth section must not take it.
  const sidebar = read('frontend/src/sidebarConfig.js');
  assert.match(sidebar, /'\/portfolio\/growth'/);
  assert.equal(existsSync(resolve(root, 'frontend/src/pages/PortfolioGrowthPage.jsx')), true);
});

test('nothing still imports the deleted module', () => {
  // A dangling import is a build failure, not a style problem — and the fixture
  // was imported by six pages across three personas.
  for (const f of ['frontend/src/App.jsx', 'frontend/src/sidebarConfig.js']) {
    assert.doesNotMatch(read(f), /data\/growth|pages\/growth/);
  }
});
