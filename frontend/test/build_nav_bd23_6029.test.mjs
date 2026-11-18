/**
 * D6029 (#6029, BD23) — Build's navigation and module copy: the sidebar lists
 * Overview · Plan · Progress and the six modules and is the one module
 * switcher on desktop; the Build header draws no desktop module tabs only
 * while the sidebar lists them; each module's subtitle is its founder outcome.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_nav_bd23_6029.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { BUILD_SUBPAGES, SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { SidebarSubpagesContext, subpageRoots, subpageRootsKey, visibleSubpageRoots } from '../src/lib/sidebarSubpages.js';
import { SubpageList, subpageActive } from '../src/ui/SidebarNav.jsx';
import { CycleHeader } from '../src/pages/cycles/CycleOverview.jsx';
import { BUILD_MODULE_OUTCOMES, moduleSubtitle } from '../src/pages/cycles/cycleModel.js';
import { MODULES } from '../src/pages/cycles/modules.js';

const buildRow = () => SIDEBAR_GROUPS.founder.flatMap((g) => g.items).find((i) => i.to === '/build');
const OLD = 'Records below; the tabs above move between modules.';

test('the sidebar lists Overview, Plan, Progress, then the six modules under Build; Tools waits on #5078', () => {
  assert.deepEqual(BUILD_SUBPAGES.map((c) => c.label ?? `# ${c.heading}`),
    ['Overview', 'Plan', 'Progress', '# Modules', 'Solution design', 'Prototype / MVP', 'Product roadmap', 'Founding team', 'Company creation', 'Operating systems']);
  assert.ok(!BUILD_SUBPAGES.some((c) => /tools/i.test(c.label || '')), 'no Tools entry until #5078');
  const row = buildRow();
  assert.equal(row.children, BUILD_SUBPAGES);
  for (const p of ['/build/plan', '/build/plan/progress', '/build/solution-design', '/build/operating-systems', '/build/this-week']) assert.ok(row.match.includes(p), p);
  assert.ok(!row.match.includes('/build/team') && !row.match.includes('/build/brand'), 'Grow keeps its Build-prefixed addresses');
  // The module paths are the cycle's own modules, in its order.
  const build = MODULES.build.map((m) => `/build/${m.slug}`);
  assert.deepEqual(BUILD_SUBPAGES.filter((c) => c.to && !['/build', '/build/plan', '/build/plan/progress'].includes(c.to)).map((c) => c.to), build);
});

test('which rows list their pages: only while the sidebar is open and expanded', () => {
  assert.deepEqual([...subpageRoots(SIDEBAR_GROUPS.founder)], ['/build']);
  assert.equal(subpageRootsKey(SIDEBAR_GROUPS.founder), '/build');
  assert.deepEqual([...visibleSubpageRoots(SIDEBAR_GROUPS.founder, { open: true, collapsed: false })], ['/build']);
  assert.equal(visibleSubpageRoots(SIDEBAR_GROUPS.founder, { open: false, collapsed: false }).size, 0);
  assert.equal(visibleSubpageRoots(SIDEBAR_GROUPS.founder, { open: true, collapsed: true }).size, 0);
  assert.equal(visibleSubpageRoots(SIDEBAR_GROUPS.investor || [], { open: true, collapsed: false }).size, 0);
});

test('a sub-page lights on its own address: Plan and Progress apart, a module on its records too', () => {
  const by = Object.fromEntries(BUILD_SUBPAGES.filter((c) => c.to).map((c) => [c.label, c]));
  assert.equal(subpageActive(by.Plan, '/build/plan'), true);
  assert.equal(subpageActive(by.Plan, '/build/plan/progress'), false);
  assert.equal(subpageActive(by.Progress, '/build/plan/progress'), true);
  assert.equal(subpageActive(by.Overview, '/build/solution-design'), false);
  assert.equal(subpageActive(by['Solution design'], '/build/solution-design/records/12'), true);
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(SubpageList, { items: BUILD_SUBPAGES, pathname: '/build/plan/progress', parent: 'Build' })));
  assert.match(html, /aria-label="Build pages"/);
  assert.match(html, />Modules</);
  assert.match(html, /<a aria-current="page"[^>]*href="\/build\/plan\/progress"/);
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
});

test('the sidebar draws the list only under the current row, expanded, with no search typed', () => {
  const nav = readFileSync('frontend/src/ui/SidebarNav.jsx', 'utf8');
  assert.match(nav, /const kids = !collapsed && !q && rowIsCurrent && Array\.isArray\(item\.children\)/);
  assert.match(nav, /\{kids\}\n\s+<\/React\.Fragment>/);
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  assert.match(app, /<SidebarSubpagesProvider groups=\{sidebarGroups\} open=\{sidebarOpen && isDesktop\} collapsed=\{effectiveCollapsed\}>/);
  assert.doesNotMatch(app, /lib\/sidebarSubpages/, 'App.jsx imports are frozen (D5615): the provider comes from ui/SidebarNav');
  assert.match(nav, /visibleSubpageRoots\(groups, \{ open, collapsed \}\)/);
});

test('the Build header drops its desktop tabs only while the sidebar lists Build; tablet and phone keep the select', () => {
  const header = (roots) => renderToStaticMarkup(h(MemoryRouter, null, h(SidebarSubpagesContext.Provider, { value: roots },
    h(CycleHeader, { cycle: 'build', cards: MODULES.build.map((m) => ({ slug: m.slug, name: m.name })), active: 'solution-design', title: 'Solution design', sub: BUILD_MODULE_OUTCOMES['solution-design'] }))));
  const listed = header(new Set(['/build']));
  assert.match(listed, /data-testid="cycle-tabs" data-sidebar-lists="true"/);
  assert.doesNotMatch(listed.match(/<nav[^>]*cycle-tabs[^>]*>/)[0], /lg:flex/);
  assert.match(listed, /aria-label="Build module"/, 'the phone and tablet select stays');
  const unlisted = header(new Set());
  assert.match(unlisted.match(/<nav[^>]*cycle-tabs[^>]*>/)[0], /lg:flex/, 'no sidebar list, the tabs stay');
  // Raise is untouched by Build's list.
  const raise = renderToStaticMarkup(h(MemoryRouter, null, h(SidebarSubpagesContext.Provider, { value: new Set(['/build']) },
    h(CycleHeader, { cycle: 'raise', cards: [], active: null }))));
  assert.match(raise.match(/<nav[^>]*cycle-tabs[^>]*>/)[0], /lg:flex/);
});

test('each Build module\'s subtitle is its founder outcome (BD23); no Build module shows the old line', () => {
  assert.deepEqual(Object.keys(BUILD_MODULE_OUTCOMES), MODULES.build.map((m) => m.slug));
  assert.equal(moduleSubtitle('build', 'prototype-mvp', 'Must-have rows'), 'Ship the smallest product that tests what Validate proved.');
  assert.equal(moduleSubtitle('build', 'operating-systems', null), 'Run the company on connected systems and a weekly rhythm.');
  for (const m of MODULES.build) assert.ok(!moduleSubtitle('build', m.slug, 'x').includes(OLD), m.slug);
  assert.equal(moduleSubtitle('raise', 'pitch-deck', 'Your deck.'), `Your deck. ${OLD}`, 'other cycles keep theirs');
  // A tool page that owns the module (D5081 `owned`) keeps its own subtitle; every other module reads moduleSubtitle.
  assert.match(readFileSync('frontend/src/pages/cycles/CycleModulePage.jsx', 'utf8'), /sub=\{sub !== undefined \? sub : owned \? owned\.sub : moduleSubtitle\(meta\.key, slug, card\?\.caption\)\}/);
});
