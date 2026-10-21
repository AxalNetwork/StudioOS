/**
 * D773 (#2099), the section PRs, as one: the advisor's and the operating
 * partner's boards each draw their rail, and every option their inventories
 * list (`lib/railOptions/advisor.js`, `partner.js`) names itself to the rail
 * on its own page, with its own key.
 *
 * WHERE IT NAMES ITSELF. Three ways, all read here from the option's own file:
 *   - a literal `useRailOption('<key>', …)` or `railOption="<key>"` (a file only
 *     one profile renders, such as the partner's zones or Earnings);
 *   - `railOptionFor(page, { file, control })` in a component more than one
 *     profile renders (Ask, Library, Client prep, Catalog, Perks, the Eadwyn
 *     interview, Competitor analysis), which reads the key from the inventory
 *     of the page the member is on, so the advisor's Companies board runs
 *     `analyze:competitors` where the founder's runs `analyse:competitors`.
 *
 * The render half — every route of both profiles draws exactly one rail with
 * its page key — is `airail_render_{advisor,partner}_d781.test.mjs`, whose
 * not-yet list for #2099 is now empty; this file pins that it stays empty.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { ADVISOR_RAIL_OPTIONS } from '../src/lib/railOptions/advisor.js';
import { PARTNER_RAIL_OPTIONS } from '../src/lib/railOptions/partner.js';
import { controlOf, railOptionFor } from '../src/lib/railOptions/index.js';
import { pageKeyFor } from '../src/lib/railPages.js';
import { RENDER_NOT_YET } from './_airailRender.mjs';

const read = (p) => codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src', p), 'utf8'));
const PROFILES = [['Advisor', ADVISOR_RAIL_OPTIONS], ['Operating Partner', PARTNER_RAIL_OPTIONS]];

const pageOf = (profile, o) => {
  const [path, query] = String(o.route || '').split('?');
  return pageKeyFor(path, profile, { search: query ? `?${query}` : '' });
};

/** The keys a file names to the rail on a page: its literals, and its shared lookups resolved for that page. */
function namedKeys(src, file, page) {
  const literal = [
    ...[...src.matchAll(/useRailOption\(([^;]*?)\);/g)].flatMap((m) => [...m[1].matchAll(/'([a-z]+:[a-z0-9_/-]+)'/g)].map((k) => k[1])),
    ...[...src.matchAll(/railOption="([a-z]+:[a-z0-9_/-]+)"/g)].map((m) => m[1]),
  ];
  const shared = [...src.matchAll(/railOptionFor\([^)]*control: '([^']+)'/g)]
    .map((m) => railOptionFor(page, { file, control: m[1] })?.key)
    .filter(Boolean);
  return new Set([...literal, ...shared]);
}

for (const [profile, options] of PROFILES) {
  test(`D773 ${profile}: every option names itself to the rail on its own page`, () => {
    assert.ok(options.length > 0);
    const missing = [];
    for (const o of options) {
      const page = pageOf(profile, o);
      assert.ok(page, `${o.key}: ${o.route} has no page key`);
      const src = read(o.source.file);
      // A shared lookup must resolve to this option on this page, not to another profile's key.
      const control = controlOf(o.source.marker);
      if (control && src.includes(`control: '${control}'`)) {
        assert.equal(railOptionFor(page, { file: o.source.file, control })?.key, o.key, `${page}: ${control} resolves to another key`);
      }
      if (!namedKeys(src, o.source.file, page).has(o.key)) missing.push(`${page} / ${o.key} (${o.source.file})`);
    }
    assert.deepEqual(missing, [], 'these options never name themselves to the rail');
  });
}

test('D773: the shared interview and competitor runs keep the founder\'s keys and give the advisor and partner theirs', () => {
  const interview = 'components/advisor/PersonalAdvisor.jsx';
  assert.equal(railOptionFor('Founder · Studio', { file: interview, control: 'advisor.ask' })?.key, 'ask:studio');
  assert.equal(railOptionFor('Advisor · Home', { file: interview, control: 'advisor.ask' })?.key, 'answer:interview');
  assert.equal(railOptionFor('Operating Partner · Home', { file: interview, control: 'advisor.ask' })?.key, 'answer:interview');
  const competitors = 'components/CompetitorAnalysis.jsx';
  const advisorCompanies = pageKeyFor('/research/companies', 'Advisor');
  assert.equal(railOptionFor(advisorCompanies, { file: competitors, control: 'competitors.analyze' })?.key, 'analyze:competitors');
  assert.equal(railOptionFor(advisorCompanies, { file: competitors, control: 'competitors.rerun' })?.key, 'rerun:analysis');
  assert.equal(railOptionFor(advisorCompanies, { file: competitors, control: 'competitors.refresh' })?.key, 'refresh:sources');
  // Outside a listed page the founder's literal stays the default.
  assert.match(read(competitors), /useRailOption\(running === 'analyze' \? \(analyzeOption\?\.key \?\? 'analyse:competitors'\) : null,/);
  assert.match(read(interview), /useRailOption\(asking \? \(askOption\?\.key \?\? 'ask:studio'\) : null,/);
});

test('D773: the boards that drew no rail draw one in the shared frame, for their own profile', () => {
  const frames = [
    ['pages/partner/PartnerWorkspaceTabs.jsx', /<RailFrame rail=\{rail\}>/, /<WorkerRail workspace=\{railMeta\.workspace\} role="partner"/],
    ['pages/advisor/advisory/AdvisorAdvisoryWorkspace.jsx', /<RailFrame rail=\{<WorkerRail workspace="Practice" role="advisor"/, null],
    // pages/research/GtmIntelligence.jsx drew one too, until #2297 removed /research/gtm (#2329).
    ['pages/PortfolioWorkspace.jsx', /<RailFrame data-testid="portfolio-partner-frame" rail=\{\(\s*<WorkerRail workspace="Delivery" role="partner"/, null],
  ];
  for (const [file, frame, rail] of frames) {
    const src = read(file);
    assert.match(src, frame, `${file}: the rail is not in the shared frame`);
    if (rail) assert.match(src, rail, `${file}: the rail is not the profile's`);
  }
  // The GTM page and its four literal mounts went with /research/gtm (#2329).
  assert.ok(!existsSync(resolve(process.cwd(), 'frontend/src/pages/research/GtmIntelligence.jsx')), 'the GTM page is back');
  // The shells' static "AI assist" cards stand down where the real rail docks.
  assert.match(read('pages/partner/PartnerWorkspaceTabs.jsx'), /tabs=\{visibleTabs\}\s+rail=\{false\}/);
  assert.match(read('pages/advisor/advisory/AdvisorAdvisoryWorkspace.jsx'), /embedded=\{embedded\}\s+rail=\{false\}/);
  // The partner's alias of Leads takes Leads' frame and lights Leads' tab.
  const app = read('App.jsx');
  assert.match(app, /path="\/partner\/needs" element=\{guard\(\['admin', 'partner'\], partnerPrivateWorkspace\(<PartnerWorkspaceTabs set="pipeline" user=\{user\}><NeedsBoardPage user=\{user\} \/><\/PartnerWorkspaceTabs>\)\)\}/);
});

test('D773: no advisor or partner route is waiting on #2099 any more', () => {
  assert.deepEqual(RENDER_NOT_YET[2099], []);
});
