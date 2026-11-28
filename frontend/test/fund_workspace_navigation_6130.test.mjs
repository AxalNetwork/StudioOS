import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import SpinoutLabLpWorkspacePage from '../src/pages/SpinoutLabLpWorkspacePage.jsx';
import FundWorkspaceNavigation from '../src/pages/investor/fund/FundWorkspaceNavigation.jsx';

const workspace = new URL('../src/pages/', import.meta.url);
const read = (path) => readFileSync(new URL(path, workspace), 'utf8');

function renderNav(href, hasPosition, showReports) {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [href] },
    createElement(FundWorkspaceNavigation, { hasPosition, showReports })));
}

test('fund navigation renders native links and identifies the current section', () => {
  const route = '/spinout-lab/investor-workspace';
  const guest = renderNav(route, false, false);
  assert.match(guest, /<nav aria-label="Fund workspace sections"/);
  assert.match(guest, /href="#overview" aria-current="location"/);
  assert.match(guest, /href="#fund"/);
  assert.match(guest, /href="#apply"/);
  assert.doesNotMatch(guest, /href="#(?:my-commitment|documents|reports)"/);

  const member = renderNav(route + '#documents', true, true);
  assert.match(member, /href="#my-commitment"/);
  assert.match(member, /href="#documents" aria-current="location"/);
  assert.match(member, /href="#reports"/);
});

test('the workspace retains the existing targets and has a smaller route component', () => {
  assert.match(read('SpinoutLabLpCommitment.jsx'), /id="my-commitment"/);
  assert.match(read('SpinoutLabLpNotices.jsx'), /id="my-notices"/);
  assert.match(read('investor/fund/FundParticipationSection.jsx'), /id="documents"/);
  assert.match(read('investor/fund/FundOnboardingSection.jsx'), /id="apply"/);
  assert.match(read('investor/fund/FundReportsSection.jsx'), /id="reports"/);
  assert.match(read('investor/fund/FundOverviewSection.jsx'), /id="fund"/);
  assert.ok(read('SpinoutLabLpWorkspacePage.jsx').split('\n').length < 500);
});

test('the route starts in a loading state without presenting a standing', () => {
  const markup = renderToStaticMarkup(createElement(MemoryRouter, {
    initialEntries: ['/spinout-lab/investor-workspace#my-commitment'],
  }, createElement(SpinoutLabLpWorkspacePage, { embedded: true })));
  assert.match(markup, /data-testid="lp-workspace-loading"/);
  assert.doesNotMatch(markup, /Visitor · viewing by invitation|Full participation active|Fund workspace sections/);
});

test('the extracted application renders its recorded controls and commitment range', async () => {
  const { default: LpApplicationForm } = await import('../src/pages/investor/fund/LpApplicationForm.jsx');
  const markup = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(LpApplicationForm, { loaded: true, existing: null, onSubmitted() {} })));
  assert.match(markup, /aria-label="Target commitment"/);
  assert.match(markup, /type="range"/);
  assert.match(markup, /Submit application/);
});

// D9006 (#9006): the standing chip says what the canvas STAND map says
// (Axal VC Fund v2 and LP Workspace), and a committed standing carries the
// commitment from the record, once, never as $0.
test('D9006: the standing chip uses the canvas words for every standing', async () => {
  const { PROFILE_CHIP, standingWords } = await import('../src/pages/investor/fund/FundWorkspaceSupport.jsx');
  assert.deepEqual(Object.fromEntries(Object.entries(PROFILE_CHIP).map(([k, v]) => [k, v[1]])), {
    visitor: 'Visitor · viewing by invitation',
    pending: 'Applicant · application in review',
    approved: 'Approved · nothing committed yet',
    committed: 'Committed LP',
    voting: 'Full rights',
  });
  assert.equal(standingWords('visitor', null), 'Visitor · viewing by invitation');
  assert.equal(standingWords('pending', null), 'Applicant · application in review');
  assert.equal(standingWords('approved', null), 'Approved · nothing committed yet');
  assert.equal(standingWords('committed', 15_000_000), 'Committed LP · $150,000.00');
  assert.equal(standingWords('voting', 30_000_000), 'Full rights · $300,000.00');
  assert.equal(standingWords('nonsense', 15_000_000), 'Visitor · viewing by invitation', 'an unknown standing reads as a visitor, with no amount');
});

test('D9006: no commitment recorded prints no amount, never $0; a pre-commitment standing prints none', async () => {
  const { standingWords } = await import('../src/pages/investor/fund/FundWorkspaceSupport.jsx');
  for (const cents of [null, undefined, 0, -100, 'x']) {
    assert.equal(standingWords('committed', cents), 'Committed LP', String(cents));
    assert.equal(standingWords('voting', cents), 'Full rights', String(cents));
  }
  assert.equal(standingWords('approved', 15_000_000), 'Approved · nothing committed yet', 'approved has no commitment to print');
  assert.equal(standingWords('pending', 15_000_000), 'Applicant · application in review');
});

test('D9006: the header chip, Your access and the fund brief print the amount once, from the record', async () => {
  const page = read('SpinoutLabLpWorkspacePage.jsx');
  assert.match(page, /const chipText = standingWords\(state, derived\.commitmentCents\);/);
  assert.match(page, /standing: standingWords\(derived\.state, derived\.commitmentCents\),/, 'the brief reads the viewer\'s own standing, not a preview');
  assert.doesNotMatch(page, /K committed|commitLabel/, 'the chip carries the amount; nothing beside it repeats it');
  assert.doesNotMatch(read('investor/fund/FundReportsSection.jsx'), /K committed|commitLabel/);

  const { default: FundReportsSection } = await import('../src/pages/investor/fund/FundReportsSection.jsx');
  const { fundFigures } = await import('../src/lib/spinoutFundFigures.js');
  const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(FundReportsSection, {
    F: fundFigures(null), kpis: [], ARCHIVE_FILTERS: ['all'], setArchiveFilter() {}, archiveFilter: 'all', archive: [],
    hasReports: true, holding: null, generateReport() {}, reportBusy: '', reportErr: '', ambiguousFund: false,
    portal: null, state: 'committed', chipTone: 'violet', chipText: 'Committed LP · $150,000.00',
    derived: { holdings: 0, commitmentK: 150, commitmentCents: 15_000_000 }, isAdmin: false,
  })));
  assert.equal(markup.split('$150,000.00').length - 1, 1, 'Your access prints the commitment once');
  assert.doesNotMatch(markup, /\$150K/);
});
