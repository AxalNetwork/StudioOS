/**
 * #2341 and #2333 (from #2297's checklist): two duplicate pages retired.
 *
 * - `/advisory` folds into Team › Advisors (`/build/team?mode=workspace&tab=advisors`), where
 *   `/advisors` already sends a founder. Its four panels move with it.
 * - `/insights` folds into `/articles`, whose Briefs section lists what the
 *   Insights index listed. Each brief keeps its share link,
 *   `/insights/public/:slug`.
 *
 * Both old addresses forward with `<Navigate replace>` and are counted in the
 * redirect inventory until #2319 retires them. Each check below is
 * mutation-checked: an isolated regression must fail it, and the unmodified
 * sources pass again.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/advisory_publications_2297.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { BriefsView } from '../src/pages/ArticlesPage.jsx';

const h = React.createElement;
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sources = () => ({
  app: read('../src/App.jsx'),
  sidebar: read('../src/sidebarConfig.js'),
  placement: read('../src/lib/adminPlacement.js'),
  rail: read('../src/lib/railPages.js'),
  tools: read('../src/pages/cycles/founderToolNavigation.js'),
  validate: read('../src/pages/cycles/ValidateSections.jsx'),
  brand: read('../src/pages/SpinoutLabBrandPage.jsx'),
  contacts: read('../src/pages/ContactsPage.jsx'),
  og: read('../src/lib/ogRegistry.js'),
  team: read('../src/pages/founder/FounderTeamPage.jsx'),
  advisory: read('../src/pages/founder/TeamAdvisoryTools.jsx'),
  articles: read('../src/pages/ArticlesPage.jsx'),
  redirects: read('../../cloudflare-worker/src/services/redirectRoutes.ts'),
});

/** Run `check` on `s`, then on each mutation, which must throw; then on `s` again. */
function mutationChecked(check, s, mutations) {
  check(s);
  for (const [key, change, label] of mutations) {
    const next = typeof change === 'function' ? change(s[key]) : s[key] + change;
    assert.notEqual(next, s[key], `${label}: the mutation changed nothing`);
    assert.throws(() => check({ ...s, [key]: next }), assert.AssertionError, label);
    check(s);
  }
}

function removed(s) {
  assert.doesNotMatch(s.app, /\bAdvisoryPage\b|pages\/insights\/InsightsPage|\bInsightsPage\b/, 'neither page component is mounted');
  assert.doesNotMatch(s.sidebar, /'\/advisory'/, 'no sidebar match for /advisory');
  assert.doesNotMatch(s.placement, /'\/advisory'/, 'no placement page or PAGE_HOMES row');
  assert.doesNotMatch(s.rail, /alias\('\/advisory'/, 'no rail page-key alias');
  assert.doesNotMatch(s.tools, /path: '\/advisory'/, 'no founder tool-navigation entry');
  for (const key of ['validate', 'brand', 'contacts']) {
    assert.doesNotMatch(s[key], /to(?:=|: )["']\/advisory["']/, `${key}: no link to /advisory`);
  }
  assert.doesNotMatch(s.og, /path: '\/insights',/, 'no Open Graph entry for the retired index');
}

function forwards(s) {
  assert.match(s.app, /<Route path="\/advisory" element=\{guard\(\['admin', 'founder'\], <Navigate to="\/build\/team\?mode=workspace&tab=advisors" replace \/>\)\} \/>/,
    '/advisory forwards to Team › Advisors behind its old guard');
  assert.match(s.app, /<Route path="\/insights" element=\{<Navigate to="\/articles#briefs" replace \/>\} \/>/,
    '/insights forwards to the Briefs section of /articles');
  assert.match(s.redirects, /\{ path: '\/advisory' \}/, '/advisory is counted');
  assert.match(s.redirects, /\{ path: '\/insights' \}/, '/insights is counted');
  // The share link, the reader and authoring stay pages.
  assert.match(s.app, /<Route path="\/insights\/public\/:slug" element=\{<PublicInsight \/>\} \/>/, 'the share link still resolves');
  assert.match(s.app, /<Route path="\/articles" element=\{<ArticlesPage \/>\} \/>/);
  assert.match(s.app, /<Route path="\/articles\/draft" element=\{authOnly\(<ArticleAuthorPage \/>\)\} \/>/);
  assert.match(s.app, /<Route path="\/articles\/edit\/:id" element=\{authOnly\(<ArticleAuthorPage \/>\)\} \/>/);
  assert.match(s.app, /<Route path="\/articles\/:slug" element=\{<ArticleReaderPage \/>\} \/>/);
}

function survivors(s) {
  // Team › Advisors mounts every panel /advisory had.
  assert.match(s.team, /const TeamAdvisoryTools = lazy\(\(\) => import\('\.\/TeamAdvisoryTools'\)\);/);
  const advisorsTab = s.team.slice(s.team.indexOf('function AdvisorsTab('), s.team.indexOf('// Hiring.'));
  assert.match(advisorsTab, /<TeamAdvisoryTools \/>/, 'mounted in the Advisors tab');
  for (const key of ['directory', 'advisor', 'financial', 'diligence']) {
    assert.match(s.advisory, new RegExp(`\\{ key: '${key}', label:`), `the ${key} tab is kept`);
  }
  for (const call of ['advisorProfilesList', 'contactPromote', 'advisorProfileAssign', 'advisorProfileArchive', 'askAdvisory', 'financialPlan', 'runDiligence']) {
    assert.match(s.advisory, new RegExp(`api\\.${call}\\(`), `${call} is still called`);
  }
  assert.match(s.advisory, /<PersonalAdvisor\b/, 'the Eadwyn chat is kept');
  assert.match(s.advisory, /<AssistLayout surface="advisory">/, 'and its rail');
  // /articles lists the briefs, read from the publications store.
  assert.match(s.articles, /publications\.publicList\(\)/, 'Briefs reads the public publications list');
  assert.match(s.articles, /<BrowseArticles \/>\s*<Briefs \/>/, 'the page renders Briefs after the articles');
}

test('the duplicate pages and their entries are gone', () => {
  const s = sources();
  assert.equal(existsSync(new URL('../src/pages/AdvisoryPage.jsx', import.meta.url)), false, 'AdvisoryPage moved');
  assert.equal(existsSync(new URL('../src/pages/insights/InsightsPage.jsx', import.meta.url)), false, 'InsightsPage removed');
  mutationChecked(removed, s, [
    ['app', "\nconst AdvisoryPage = lazy(() => import('./pages/AdvisoryPage'));", 'app: AdvisoryPage'],
    ['app', "\nconst InsightsPage = lazy(() => import('./pages/insights/InsightsPage'));", 'app: InsightsPage'],
    ['sidebar', "\nmatch: ['/advisory'],", 'sidebar'],
    ['placement', "\n  '/advisory': [['founder', 'Validate', 'also']],", 'placement'],
    ['rail', "\n  alias('/advisory', key(F, 'Validate'), 'x'),", 'rail'],
    ['tools', "\n  { path: '/advisory', cycle: 'validate', module: 'customer-research' },", 'tools'],
    ['validate', '\n<Link to="/advisory">Advisory</Link>', 'validate'],
    ['brand', "\n  mentor: { label: 'Advisory', to: '/advisory' },", 'brand'],
    ['contacts', "\n{ to: '/advisory', label: 'Advisory Suite' }", 'contacts'],
    ['og', "\n  { path: '/insights', title: 'Insights' },", 'og'],
  ]);
});

test('the old addresses forward and are counted; the share link and authoring stay', () => {
  const s = sources();
  const line = (src, path) => src.split('\n').find((l) => l.includes(`<Route path="${path}"`));
  mutationChecked(forwards, s, [
    ['app', (a) => a.replace(line(a, '/advisory'), line(a, '/advisory').replace('&tab=advisors', '&tab=roster')), 'advisory target'],
    ['app', (a) => a.replace(line(a, '/advisory'), line(a, '/advisory').replace("guard(['admin', 'founder'], ", 'guard([], ')), 'advisory guard'],
    ['app', (a) => a.replace(line(a, '/insights'), line(a, '/insights').replace('/articles#briefs', '/articles')), 'insights target'],
    ['app', (a) => a.replace(line(a, '/insights/public/:slug'), ''), 'share link'],
    ['app', (a) => a.replace(line(a, '/articles/draft'), ''), 'draft'],
    ['app', (a) => a.replace(line(a, '/articles/edit/:id'), ''), 'edit'],
    ['redirects', (r) => r.replace("  { path: '/advisory' },", ''), 'advisory counted'],
    ['redirects', (r) => r.replace("  { path: '/insights' },", ''), 'insights counted'],
  ]);
});

test('Team › Advisors keeps every /advisory panel, and /articles reads the briefs', () => {
  const s = sources();
  mutationChecked(survivors, s, [
    ['team', (t) => t.replace('          <TeamAdvisoryTools />\n', ''), 'mount'],
    ['advisory', (a) => a.replace("{ key: 'financial', label:", "{ key: 'plan', label:"), 'financial tab'],
    ['advisory', (a) => a.replace('api.runDiligence(', 'api.runSomething('), 'diligence call'],
    ['advisory', (a) => a.replace('api.contactPromote(', 'api.contactPromoted('), 'promote call'],
    ['advisory', (a) => a.replace('<AssistLayout surface="advisory">', '<AssistLayout surface="other">'), 'rail'],
    ['articles', (a) => a.replace('<Briefs />', ''), 'briefs mount'],
    ['articles', (a) => a.replace('publications.publicList()', 'publications.list()'), 'briefs read'],
  ]);
});

const render = (props) => renderToStaticMarkup(h(MemoryRouter, null, h(BriefsView, props)));
const BRIEF = { slug: 'q3 heat', title: 'Q3 sector heat', subtitle: 'Where rounds moved', section: 'market_brief', published_at: '2026-10-01T12:00:00Z' };

/** What a drawn Briefs section must say for each state. */
function briefsStates(view) {
  const ready = view({ items: [BRIEF] });
  assert.match(ready, /id="briefs"/, 'the anchor /insights forwards to');
  assert.match(ready, /href="\/insights\/public\/q3%20heat"[^>]*>Q3 sector heat</, 'each brief opens at its share link');
  assert.match(ready, /Market Brief · Oct 1, 2026/, 'section and date');
  assert.match(ready, /Where rounds moved/);
  const failed = view({ items: [], failed: true });
  assert.match(failed, /Unreadable/, 'a failed read says Unreadable');
  assert.doesNotMatch(failed, /No published briefs/, 'and never claims there are none');
  assert.match(view({ items: [] }), /No published briefs yet\./, 'an empty read says so');
  assert.match(view({ items: null }), /Loading…/);
}

test('the Briefs section draws each brief, an empty read and a failed read honestly', () => {
  briefsStates(render);
  const broken = [
    [(p) => render({ ...p, items: p.items?.map((b) => ({ ...b, slug: 'other' })) }), 'wrong link'],
    [(p) => render(p.failed ? { items: [] } : p), 'failure drawn as empty'],
    [(p) => render(p.items?.length ? { items: [] } : p), 'items dropped'],
    [(p) => render(p.items === null ? { items: [] } : p), 'no loading state'],
  ];
  for (const [view, label] of broken) assert.throws(() => briefsStates(view), assert.AssertionError, label);
});
