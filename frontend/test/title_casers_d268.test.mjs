/**
 * D268 — fifteen title-casers moved onto lib/absence.js's titleCase, and every
 * behaviour that changed with them, asserted on the helper's real output.
 *
 * The exported helpers are imported. The page-local wrappers are not
 * exported, so each is lifted out of its file by name and evaluated with the
 * real titleCase bound in — the wrapper that runs is the one on disk.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { titleCase } from '../src/lib/absence.js';
import { humanize } from '../src/lib/assessmentMeta.js';
import { prettify } from '../src/lib/signalsMeta.js';
import { prettyStage } from '../src/pages/pipeline/bucketing.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const src = (rel) => readFileSync(resolve(root, rel), 'utf8');

/** Evaluate `const <name> = …;` from a page, with titleCase bound under both import names. */
function local(rel, name) {
  // A literal search, not a RegExp built from `name`: Semgrep refuses a
  // non-literal pattern, and the declaration is one line by construction.
  const text = src(rel);
  const head = `const ${name} = (`;
  const at = text.indexOf(head);
  assert.ok(at >= 0, `${rel}: ${name} is gone`);
  const line = text.slice(at + head.length - 1, text.indexOf('\n', at)).replace(/;\s*$/, '');
  assert.match(line, /^\([^)]*\) => /, `${rel}: ${name} is no longer a one-line arrow`);
  // eslint-disable-next-line no-new-func
  return new Function('titleCase', 'caseLabel', `return ${line};`)(titleCase, titleCase);
}

const PAGES = {
  fundPerformance: () => local('pages/FundPerformancePage.jsx', 'titleCase'),
  portfolioGrowth: () => local('pages/PortfolioGrowthPage.jsx', 'titleCase'),
  fundLPs: () => local('pages/investor/InvestorFundLPs.jsx', 'titleCase'),
  fundLanding: () => local('pages/investor/InvestorFundLanding.jsx', 'titleCase'),
  fundReporting: () => local('pages/investor/InvestorFundReporting.jsx', 'titleCase'),
  networkType: () => local('pages/investor/InvestorNetworkWorkspace.jsx', 'typeLabel'),
  portfolioCanvas: () => local('pages/investor/InvestorPortfolioCanvas.jsx', 'label'),
  portfolioUpdates: () => local('pages/investor/InvestorPortfolioUpdates.jsx', 'title'),
  partnerStudio: () => local('pages/partner/PartnerStudioHome.jsx', 'titleCase'),
};

test('hyphens now normalise to spaces where only underscores did', () => {
  assert.equal(prettify('pre-seed'), 'Pre Seed');
  for (const k of ['fundPerformance', 'portfolioGrowth', 'fundLPs', 'fundLanding', 'fundReporting',
    'networkType', 'portfolioCanvas']) {
    assert.equal(PAGES[k]()('co-invest_round'), 'Co Invest Round', k);
  }
  // AdminLpApplications and InsightsPage call titleCase directly now.
  assert.match(src('pages/admin/AdminLpApplications.jsx'), /import \{ titleCase \} from '\.\.\/\.\.\/lib\/absence';/);
  assert.match(src('pages/insights/InsightsPage.jsx'), /return titleCase\(s\);/);
});

test('input is now trimmed before casing', () => {
  assert.equal(prettify('  in_progress '), 'In Progress');
  for (const k of Object.keys(PAGES)) {
    assert.equal(PAGES[k]()('  in_progress '), 'In Progress', k);
  }
});

test('whitespace-only input now takes the fallback instead of rendering blank', () => {
  assert.equal(PAGES.fundPerformance()('   '), 'Unknown');
  assert.equal(PAGES.fundLPs()('  '), 'Unrecorded');
  assert.equal(PAGES.networkType()(' '), 'Relationship');
});

test('each fallback reads as it did, and is never passed through the caser', () => {
  assert.equal(PAGES.fundPerformance()(null), 'Unknown');
  assert.equal(PAGES.portfolioGrowth()(''), 'Unknown');
  assert.equal(PAGES.fundLPs()(null), 'Unrecorded');
  assert.equal(PAGES.fundLanding()(null), 'Unrecorded', 'the lower-case fallback relied on the caser');
  assert.equal(PAGES.fundReporting()(undefined), 'Unrecorded');
  assert.equal(PAGES.networkType()(null), 'Relationship', 'the lower-case fallback relied on the caser');
  assert.equal(PAGES.portfolioCanvas()(null), 'Unknown');
  assert.equal(PAGES.portfolioUpdates()(null), 'Not recorded');
  // A fallback passed through titleCase would come out re-cased.
  assert.equal(titleCase('Not recorded'), 'Not Recorded');
});

test('PartnerStudioHome\'s absence reads "Not recorded", never "Not Recorded"', () => {
  const cased = PAGES.partnerStudio();
  assert.equal(cased(null), 'Not recorded');
  assert.equal(cased(''), 'Not recorded');
  assert.equal(cased('pending_review'), 'Pending Review');
});

test('humanize and prettyStage keep collapsing runs of _ and -, at the call site', () => {
  assert.equal(humanize('deep__tech--founder'), 'Deep Tech Founder');
  assert.equal(humanize('_edge_'), 'Edge');
  assert.equal(prettyStage('series__b--ext'), 'Series B Ext');
  assert.equal(prettyStage(''), '—', 'the empty dash moved');
});

/**
 * router.js imports a JSON manifest the test loader cannot load, so its
 * pageLabel is lifted out whole and run with the real titleCase.
 */
function pageLabelFromSource() {
  const m = src('lib/advisor/router.js').match(/export function pageLabel\(path\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'pageLabel is gone');
  // eslint-disable-next-line no-new-func
  return new Function('titleCase', `${m[0].replace('export ', '')}; return pageLabel;`)(titleCase);
}

test('pageLabel keeps its route map and its empty string', () => {
  const pageLabel = pageLabelFromSource();
  assert.equal(pageLabel(''), '');
  assert.equal(pageLabel('/build/deck'), 'Pitch Deck');
  assert.equal(pageLabel('/some/new-page_x'), 'New Page X');
});

test('no converted file declares its own caser', () => {
  for (const rel of ['lib/advisor/router.js', 'lib/assessmentMeta.js', 'lib/signalsMeta.js',
    'pages/FundPerformancePage.jsx', 'pages/PortfolioGrowthPage.jsx', 'pages/admin/AdminLpApplications.jsx',
    'pages/insights/InsightsPage.jsx', 'pages/investor/InvestorFundLPs.jsx', 'pages/investor/InvestorFundLanding.jsx',
    'pages/investor/InvestorFundReporting.jsx', 'pages/investor/InvestorNetworkWorkspace.jsx',
    'pages/investor/InvestorPortfolioCanvas.jsx', 'pages/investor/InvestorPortfolioUpdates.jsx',
    'pages/partner/PartnerStudioHome.jsx', 'pages/pipeline/bucketing.js']) {
    const s = src(rel);
    assert.ok(!/toUpperCase\(\)/.test(s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')),
      `${rel} upper-cases by hand again`);
    assert.match(s, /import \{ titleCase(?: as caseLabel)? \} from '[./]+(?:lib\/)?absence';/, `${rel} does not import titleCase`);
  }
});
