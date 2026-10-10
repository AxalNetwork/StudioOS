// D626: stable addresses, complete placements, route guard parity and real renders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ViewModeContext from '../src/contexts/ViewModeContext.js';
import { MemoryRouter } from 'react-router-dom';
import { readRoutesSource } from './_routesSource.mjs';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { SECTIONS, filterSectionsForRole, adminOnlyAnchors } from '../src/pages/docs/sections/index.js';
import { HELP_AREAS, HELP_SURFACES, GUIDE_PLACEMENT, canOpenSurface, helpAreas } from '../src/pages/docs/guidePlacement.js';
import { BrowseByTask, HelpArticle, SearchResults } from '../src/pages/docs/DocsLayout.jsx';
import { guideFor, guideHref, hashTarget, parseGuidePath, popularGuides, adminFeedbackView } from '../src/pages/docs/helpCenter.js';
import { GuideAnswersAdminView } from '../src/pages/docs/HelpSignals.jsx';
const html = (component, props) => renderToStaticMarkup(h(MemoryRouter, null, h(component, props)));
const visible = filterSectionsForRole(SECTIONS, 'founder');
const routes = codeOnly(readRoutesSource());
const labels = ['Getting started', 'The Spin-Out Lab', 'Building your startup', 'Incorporation & legal', 'Raising & cap table', 'Funds & portfolio', 'Data rooms & due diligence', 'Advisors & office hours', 'Partners & the network', 'Connecting your tools', 'Billing & account', 'Running the platform'];

test('every guide has exactly one placement and every ordered area has guides', () => {
  const anchors = SECTIONS.flatMap((s) => s.subsections.map((g) => `${s.id}/${g.id}`));
  assert.deepEqual(Object.keys(GUIDE_PLACEMENT).sort(), anchors.sort());
  assert.deepEqual([...new Set(Object.values(GUIDE_PLACEMENT).map((p) => p.area))].sort(), HELP_AREAS.map((a) => a.id).sort());
  assert.deepEqual(HELP_AREAS.map((a) => a.title), labels);
  assert.deepEqual(helpAreas(SECTIONS).map((a) => a.title), labels);
});

test('surface paths and guards match the mounted routes, including dynamic Account paths', () => {
  const guards = new Map([...routes.matchAll(/<Route\s+path="([^"]+)"\s+element=\{guard\((labRoles\()?\[([^\]]+)\]/g)].map((m) => [m[1], { roles: [...m[3].matchAll(/'([^']+)'/g)].map((x) => x[1]), lab: Boolean(m[2]) }]));
  for (const [path, surface] of Object.entries(HELP_SURFACES)) {
    const guard = guards.get(path) || (path.startsWith('/account/') ? guards.get('/account/:section') : null);
    if (guard) assert.deepEqual({ roles: surface.roles, lab: surface.lab }, guard, path);
    else {
      const route = [...routes.matchAll(/<Route\s+path="([^"]+)"\s+element=\{([^\n]+)/g)].find((m) => m[1] === path);
      assert.ok(route, path);
      assert.equal(surface.roles, null, path);
      assert.equal(surface.lab, false, path);
      assert.equal(Boolean(surface.authenticated), route[2].startsWith('authOnly('), path);
    }
  }
  for (const [anchor, placement] of Object.entries(GUIDE_PLACEMENT)) {
    if (!placement.surface) continue;
    const surface = HELP_SURFACES[placement.surface];
    assert.ok(surface, anchor);
    for (const role of placement.appliesTo || []) assert.equal(canOpenSurface(surface, { role, spinout_lab_active: surface.lab ? 1 : 0 }), true, `${anchor}: ${role}`);
  }
});

test('old hashes and page addresses still resolve every same guide, with admin exclusions', () => {
  const restricted = adminOnlyAnchors();
  for (const section of SECTIONS) for (const guide of section.subsections) {
    const anchor = `${section.id}/${guide.id}`;
    const path = `/help/${anchor}`;
    assert.equal(guideHref(anchor), path);
    assert.deepEqual(parseGuidePath(path), { area: section.id, guide: guide.id });
    assert.equal(hashTarget(`#${anchor}`, SECTIONS, { isAdmin: true, restricted }), path);
    assert.equal(hashTarget(`#${anchor}`, visible, { restricted }), restricted.has(anchor) ? '/help' : path);
    assert.equal(guideFor(anchor, SECTIONS).title, guide.title);
  }
});

test('home renders task areas, four previews, surface labels and single-role badges', () => {
  // Funds & portfolio reads INVESTOR for a founder since D670 removed the
  // Market Intelligence guide, the one guide in that area for every role.
  assert.deepEqual(helpAreas(visible).map((a) => a.badge), [null, 'FOUNDER', null, null, null, 'INVESTOR', null, null, null, null, null]);
  const output = html(BrowseByTask, { sections: visible });
  assert.deepEqual([...output.matchAll(/<h3[^>]*>(.*?)<\/h3>/gs)].map((m) => renderedText(m[1])), labels.slice(0, -1));
  const lab = output.slice(output.indexOf('The Spin-Out Lab'), output.indexOf('Building your startup'));
  assert.match(renderedText(lab), /FOUNDER/);
  assert.match(renderedText(lab), /All 6 →/);
  assert.equal((lab.match(/href="\/help\/spin-out-lab\//g) || []).length, 4);
  const start = output.slice(output.indexOf('Getting started'), output.indexOf('The Spin-Out Lab'));
  assert.doesNotMatch(renderedText(start), /FOUNDER|INVESTOR|PARTNER|ADVISOR/);
  assert.match(renderedText(output), /Startup board/);
  assert.match(renderedText(html(BrowseByTask, { sections: SECTIONS })), /Running the platform/);
});

test('an area with two different single-role audiences has no badge', () => {
  const account = SECTIONS.find((section) => section.id === 'account');
  const mixed = [{ ...account, subsections: account.subsections.filter((guide) => ['tiers', 'investor-billing'].includes(guide.id)) }];
  assert.doesNotMatch(renderedText(html(BrowseByTask, { sections: mixed })), /FOUNDER|INVESTOR/);
});

for (const [role, allowed] of [['investor', true], ['admin', true], ['founder', false], ['partner', false], ['advisor', false]]) {
  test(`fund guide: ${role} sees metadata and ${allowed ? 'can' : 'cannot'} open the surface`, () => {
    const output = html(HelpArticle, { sections: visible, area: 'capital', guide: 'funds', user: { role } });
    assert.equal(renderedText(output.match(/<nav aria-label="Breadcrumb"[^>]*>(.*?)<\/nav>/s)[1]).trim(), 'Help/Funds & portfolio/Funds, Reserves, Waterfall');
    assert.equal(renderedText(output.match(/<span class="rounded-full[^>]*>(.*?)<\/span>/s)[1]).trim(), 'Funds & portfolio');
    assert.match(renderedText(output), /Where this livesFunds/);
    assert.match(renderedText(output), /Applies toInvestor/);
    assert.equal(output.includes('href="/funds"'), allowed);
    assert.match(renderedText(output), /In Funds &amp; portfolio|In Funds & portfolio/);
  });
}

test('general guide has no surface jump and says Every account', () => {
  const output = html(HelpArticle, { sections: visible, area: 'getting-started', guide: 'what-is-studioos', user: { role: 'founder' } });
  assert.match(renderedText(output), /Where this livesNo single screen/);
  assert.match(renderedText(output), /Applies toEvery account/);
  assert.doesNotMatch(renderedText(output), /Open the surface/);
});

test('active Lab membership admits the actual role while inactive or anonymous viewers cannot jump', () => {
  for (const [user, allowed] of [[{ role: 'founder', spinout_lab_active: 1 }, true], [{ role: 'founder', spinout_lab_active: 0 }, false], [{ role: 'founder', spinout_lab_active: '1' }, false], [null, false]]) {
    const output = html(HelpArticle, { sections: visible, area: 'spin-out-lab', guide: 'week-1', user });
    assert.equal(output.includes('href="/spinout-lab/discovery"'), allowed);
  }
  assert.equal(canOpenSurface(HELP_SURFACES['/articles/draft'], null), false);
  assert.equal(canOpenSurface(HELP_SURFACES['/articles/draft'], { role: 'founder' }), true);
  assert.equal(canOpenSurface(HELP_SURFACES['/directory'], null), true);
  assert.equal(canOpenSurface(HELP_SURFACES['/funds'], { role: 'founder', spinout_lab_active: 1 }), false);
});

test("admin view-as links follow active role, with the router's Lab preview exception", () => {
  const render = (area, guide, user, session) => renderToStaticMarkup(h(MemoryRouter, null, h(ViewModeContext.Provider, { value: session }, h(HelpArticle, { sections: SECTIONS, area, guide, user }))));
  assert.equal(render('capital', 'funds', { role: 'admin' }, { viewMode: 'founder', isImpersonating: false }).includes('href="/funds"'), false);
  assert.equal(render('capital', 'funds', { role: 'admin' }, { viewMode: 'investor', isImpersonating: false }).includes('href="/funds"'), true);
  assert.equal(render('spin-out-lab', 'week-1', { role: 'admin' }, { viewMode: 'partner', isImpersonating: false }).includes('href="/spinout-lab/discovery"'), true);
  assert.equal(render('spin-out-lab', 'week-1', { role: 'founder' }, { viewMode: 'founder', isImpersonating: true }).includes('href="/spinout-lab/discovery"'), false);
});

test('search, related-area rail, popular cards and admin answers name the task area', () => {
  const anchor = 'build/pitch-deck';
  const result = html(SearchResults, { sections: visible, query: 'Pitch', results: [{ anchor, subsectionTitle: 'Pitch Deck', sectionTitle: 'Core', text: 'Pitch deck' }] });
  assert.match(renderedText(result), /Raising & cap table/);
  assert.doesNotMatch(renderedText(result), /Core/);
  const article = html(HelpArticle, { sections: visible, area: 'build', guide: 'pitch-deck', user: { role: 'founder' } });
  const rail = article.match(/<nav aria-label="Guides in Raising &amp; cap table"[^>]*>(.*?)<\/nav>/s)[1];
  assert.deepEqual([...rail.matchAll(/href="([^\"]+)"/g)].map((m) => m[1]).sort(), ['/help/build/deck-share-viewer', '/help/build/pitch-deck', '/help/capital/cap-table', '/help/capital/fundraise', '/help/capital/investors', '/help/capital/liquidity']);
  assert.deepEqual(popularGuides({ guides: [{ anchor, views: 2 }] }, visible), [{ anchor, title: 'Pitch Deck', area: 'Raising & cap table', views: 2 }]);
  const view = adminFeedbackView({ guides: [{ anchor, yes: 1, no: 2 }], missing: [] }, SECTIONS);
  assert.match(renderedText(html(GuideAnswersAdminView, { read: { status: 'ok', view }, onRetry() {} })), /Raising & cap table/);
});
