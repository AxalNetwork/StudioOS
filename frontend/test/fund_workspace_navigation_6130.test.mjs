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
  assert.doesNotMatch(markup, /Invited guest|Full participation active|Fund workspace sections/);
});

test('the extracted application renders its recorded controls and commitment range', async () => {
  const { default: LpApplicationForm } = await import('../src/pages/investor/fund/LpApplicationForm.jsx');
  const markup = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(LpApplicationForm, { loaded: true, existing: null, onSubmitted() {} })));
  assert.match(markup, /aria-label="Target commitment"/);
  assert.match(markup, /type="range"/);
  assert.match(markup, /Submit application/);
});
