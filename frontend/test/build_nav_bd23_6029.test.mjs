/**
 * #6029 (Build v2 BD23 / BU23): Build's navigation and module copy.
 *
 * - The sidebar is Build's one module switcher on a desktop: Build › Overview · Plan · Progress · Tools, then
 *   the six modules, drawn under the Build row while a Build page is open. The page draws no module tab row
 *   there; below 1024px, where the sidebar is a sheet, the module picker stays and lists Plan and Progress.
 * - Each Build module's subtitle is its founder outcome in BD23's words, never "Records below; the tabs above
 *   move between modules."
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/build_nav_bd23_6029.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { BUILD_OUTCOMES, BUILD_DESTINATIONS, buildOutcome } from '../src/pages/cycles/buildNav.js';
import { cycleTabs } from '../src/pages/cycles/cycleModel.js';
import { CycleHeader } from '../src/pages/cycles/CycleOverview.jsx';
import CycleModulePage from '../src/pages/cycles/CycleModulePage.jsx';
import { SidebarChildren } from '../src/ui/SidebarNav.jsx';
import { BUILD_SIDEBAR_CHILDREN, SIDEBAR_GROUPS } from '../src/sidebarConfig.js';
import { MODULES } from '../src/pages/cycles/modules.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const at = (path, el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
const OLD = 'Records below; the tabs above move between modules.';
const cards = MODULES.build.map((m) => ({ slug: m.slug, name: m.name, caption: `${m.name} caption.` }));

test('each Build module has its BD23 outcome line, and no module page draws the old subtitle', () => {
  assert.deepEqual(Object.keys(BUILD_OUTCOMES), MODULES.build.map((m) => m.slug), 'one line per module, in module order');
  // BD23's "After (founder outcome)" column, word for word.
  assert.deepEqual(MODULES.build.map((m) => buildOutcome(m.slug)), [
    'Decide what you are building, and tie every feature to the evidence behind it.',
    'Ship the smallest product that tests what Validate proved.',
    'Decide what ships now, next and later, and show what shipped.',
    'Agree who builds the company, and on what terms.',
    'Get the company formed, then keep its filings current.',
    'Run the company on connected systems and a weekly rhythm.',
  ]);
  for (const { slug, name } of MODULES.build) {
    const card = cards.find((c) => c.slug === slug);
    const out = at(`/build/${slug}`, h(CycleModulePage, { cycle: 'build', slug, cards, data: { module: { slug, name }, card, records: { rows: [], total: 0 } }, query: {}, onQuery() {} }));
    assert.ok(out.includes(BUILD_OUTCOMES[slug]), `${name} shows its outcome`);
    assert.ok(!out.includes(OLD), `${name} no longer says the tabs above move between modules`);
  }
  assert.match(read('frontend/src/pages/cycles/PhoneModulePage.jsx'), /sub=\{\(meta\.key === 'build' && buildOutcome\(slug\)\) \|\| card\?\.caption \|\| undefined\}/, 'the phone module bar says it too');
});

test('Build draws no desktop tab row; its below-1024px picker lists Overview, Plan, Progress, Tools, then the modules', () => {
  const build = at('/build/founding-team', h(CycleHeader, { cycle: 'build', cards, active: 'founding-team', title: 'Founding team', sub: 'x' }));
  assert.doesNotMatch(build, /data-testid="cycle-tabs"/, 'the sidebar is the desktop switcher');
  const options = [...build.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(options, ['overview', 'plan', 'progress', 'tools', ...MODULES.build.map((m) => m.slug)]);
  assert.match(build, /class="mt-1 flex min-h-\[44px\][^"]*lg:hidden/, 'the picker is the tablet and phone switcher');
  const validate = at('/validate/problem-discovery', h(CycleHeader, { cycle: 'validate', cards: [{ slug: 'problem-discovery', name: 'Problem discovery' }], active: 'problem-discovery', title: 'Problem discovery', sub: 'x' }));
  assert.match(validate, /data-testid="cycle-tabs"/, 'other cycles keep their tabs');
  const overview = at('/build', h(CycleHeader, { cycle: 'build', cards }));
  assert.ok(!overview.includes('the tabs above move between modules'), 'the Build overview does not point at tabs it no longer draws');
});

test('Plan and Progress are one step from every Build page, keeping the venture', () => {
  assert.deepEqual(BUILD_DESTINATIONS.map((d) => [d.key, d.path]), [['plan', '/build/plan'], ['progress', '/build/plan/progress']]);
  const tabs = cycleTabs('build', cards, 'company-creation', '?project_id=7');
  assert.deepEqual(tabs.slice(0, 4).map((t) => [t.name, t.href]), [
    ['Overview', '/build?project_id=7'], ['Plan', '/build/plan?project_id=7'], ['Progress', '/build/plan/progress?project_id=7'],
    ['Tools', '/build/operating-systems?project_id=7#tools'],
  ]);
  assert.equal(tabs.find((t) => t.key === 'progress').active, false);
  assert.equal(cycleTabs('build', cards, 'progress').find((t) => t.key === 'progress').active, true, 'Progress is current on its own page');
  assert.match(read('frontend/src/pages/cycles/BuildPlan.jsx'), /<CycleHeader cycle="build" cards=\{cards\} active=\{tab === 'progress' \? 'progress' : 'plan'\}/);
});

test('the sidebar draws Build › Overview · Plan · Progress · Tools, then the six modules, and lights the page open', () => {
  const buildRow = SIDEBAR_GROUPS.founder.flatMap((g) => g.items).find((i) => i.to === '/build');
  assert.equal(buildRow.children, BUILD_SIDEBAR_CHILDREN);
  assert.deepEqual(BUILD_SIDEBAR_CHILDREN.map((k) => k.label || `[${k.heading}]`), ['Overview', 'Plan', 'Progress', 'Tools', '[Modules]', ...MODULES.build.map((m) => m.name)]);
  const lit = (path) => {
    const out = at(path, h(SidebarChildren, { label: 'Build', root: '/build', items: BUILD_SIDEBAR_CHILDREN }));
    return [...out.matchAll(/aria-current="page"[^>]*>([^<]+)</g)].map((m) => m[1]);
  };
  assert.deepEqual(lit('/build'), ['Overview']);
  assert.deepEqual(lit('/build/plan'), ['Plan']);
  assert.deepEqual(lit('/build/plan/progress'), ['Progress'], 'not Plan as well');
  assert.deepEqual(lit('/build/operating-systems#tools'), ['Tools'], 'Tools, not Operating systems');
  assert.deepEqual(lit('/build/operating-systems'), ['Operating systems']);
  assert.deepEqual(lit('/build/solution-design/12'), ['Solution design'], 'a record lights its module, not Overview');
  assert.deepEqual(lit('/build/connect'), [], 'a page that is no child lights none, and never Overview');
  const nav = read('frontend/src/ui/SidebarNav.jsx');
  assert.match(nav, /p && p !== to && \(navLocation\.pathname === p \|\| navLocation\.pathname\.startsWith\(`\$\{p\}\/`\)\)/, 'Overview never opens the block, so /build/team (Grow) does not');
  assert.match(nav, /const subnav = kids && !collapsed && !q && \(navLocation\.pathname === to \|\| onKid\)/, 'drawn only while a Build page is open, never in the collapsed rail or a search');
});
