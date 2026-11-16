// #6230: /funds/reporting shows the selected fund's reporting periods, its
// chips select the statuses periods carry, and each row opens its editor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  ReportingArchive, statusOf, periodsFor, periodCounts, periodPath, newPeriodPath, NO_FUND_REASON,
} from '../src/pages/investor/InvestorFundReporting.jsx';
import { investorZoneFilters } from '../src/workspaces/investorZoneFilters.js';
import { investorZoneActions } from '../src/workspaces/investorZoneActions.js';
import { primaryOf } from '../src/workspaces/zoneActionBuilder.js';

const PAGE = 'frontend/src/pages/investor/InvestorFundReporting.jsx';
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FUND = { id: 10, name: 'Recorded Fund', can_manage: true };
const ROWS = [
  { id: 3, fund_id: 10, period: 'Q3 2026', period_start: '2026-07-01', period_end: '2026-09-30', status: 'draft', issued_at: null, narrative: {} },
  { id: 2, fund_id: 10, period: 'Q2 2026', period_start: '2026-04-01', period_end: '2026-06-30', status: 'issued', issued_at: '2026-07-15T10:00:00Z', narrative: { letter: ['Recorded.'] } },
  { id: 1, fund_id: 10, period: 'Q1 2026', period_start: '2026-01-01', period_end: '2026-03-31', status: 'issued', issued_at: '2026-04-15T10:00:00Z', narrative: {} },
];
const render = (props) => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/funds/reporting'] },
  React.createElement(ReportingArchive, { loading: false, error: null, fund: FUND, rows: ROWS, filter: 'all', onRetry() {}, ...props })));

test('status mapping: the stored draft | issued is the status; issued_at only fills a missing one', () => {
  assert.equal(statusOf({ status: 'draft' }), 'draft');
  assert.equal(statusOf({ status: 'ISSUED' }), 'issued');
  // A stored status wins over issued_at; it is never rewritten to published/drafted.
  assert.equal(statusOf({ status: 'draft', issued_at: '2026-07-01' }), 'draft');
  assert.equal(statusOf({ issued_at: '2026-07-01' }), 'issued');
  assert.equal(statusOf({}), 'draft');
});

test('the Issued and Draft chips select rows with that status, and their counts match', () => {
  assert.deepEqual(periodsFor('issued', ROWS).map((r) => r.id), [2, 1]);
  assert.deepEqual(periodsFor('draft', ROWS).map((r) => r.id), [3]);
  assert.equal(periodsFor('all', ROWS).length, 3);
  const counts = periodCounts(ROWS);
  assert.deepEqual(counts, { all: 3, issued: 2, draft: 1 });

  let picked = null;
  const chips = investorZoneFilters('funds/reporting', { value: 'all', onChange: (k) => { picked = k; }, counts });
  const byLabel = Object.fromEntries(chips.map((c) => [c.label, c]));
  assert.ok(byLabel['Issued 2'], `no "Issued 2" chip in ${chips.map((c) => c.label)}`);
  assert.ok(byLabel['Draft 1'], `no "Draft 1" chip in ${chips.map((c) => c.label)}`);
  assert.ok(byLabel['All periods 3']);
  // Each live chip's key selects exactly the rows its count states.
  for (const [label, n] of [['Issued 2', 2], ['Draft 1', 1], ['All periods 3', 3]]) {
    byLabel[label].onSelect();
    assert.equal(periodsFor(picked, ROWS).length, n, `${label} selected ${periodsFor(picked, ROWS).length}`);
  }
  // Delivery narrowed on fields no period carries; it is a stated gap, not a chip.
  const delivery = chips.find((c) => c.label === 'Delivery');
  assert.equal(delivery.disabled, true);
  assert.equal(delivery.onSelect, undefined);
});

test('the page reads the selected fund only: no unscoped LP report list replaces its periods', () => {
  const src = codeOnly(read(PAGE));
  assert.match(src, /api\.fundsReportPeriods\(managed\.fund\.id\)/);
  assert.doesNotMatch(src, /lpReportsList/, 'an unscoped LP report read is back on the page');
  assert.doesNotMatch(src, /reportRows\.length \? reportRows/);
});

test('each row opens its period, and New reporting period opens /new for the fund', () => {
  const html = render();
  assert.equal(periodPath(10, ROWS[0]), '/funds/10/reporting/3');
  assert.equal(newPeriodPath(10), '/funds/10/reporting/new');
  for (const id of [1, 2, 3]) assert.match(html, new RegExp(`href="/funds/10/reporting/${id}"`), `row ${id} is not a link`);
  assert.match(html, /href="\/funds\/10\/reporting\/new"[^>]*>.*?New reporting period/);
  assert.equal((html.match(/data-testid="row-reporting-period"/g) || []).length, 3);
  assert.match(html, /3 of 3 periods/);
  const drafts = render({ filter: 'draft' });
  assert.match(drafts, /href="\/funds\/10\/reporting\/3"/);
  assert.doesNotMatch(drafts, /href="\/funds\/10\/reporting\/2"/);
  assert.match(drafts, /1 of 3 periods/);
});

test('the zone action is the new-period primary for a managed fund, and absent without one', () => {
  let opened = 0;
  const live = investorZoneActions('funds/reporting', { handlers: { newPeriod: () => { opened += 1; } } });
  const primary = primaryOf(live);
  assert.equal(primary?.label, 'New reporting period');
  primary.onClick();
  assert.equal(opened, 1);
  const none = investorZoneActions('funds/reporting', { handlers: { newPeriod: null } });
  assert.equal(none.find((a) => a.label === 'New reporting period'), undefined, 'the action is drawn with no fund to start a period on');
  assert.equal(none.find((a) => /Build pack/.test(a.label)), undefined, 'the disabled Build pack is back');
  // The page supplies the handler only when the managed-fund rule found a fund.
  assert.match(codeOnly(read(PAGE)), /fund \? \(\) => navigate\(newPeriodPath\(fund\.id\)\) : null/);
});

test('no fund to operate: no action, and the reason is given', () => {
  const html = render({ fund: null, rows: [] });
  assert.match(html, /data-testid="status-no-managed-fund"/);
  assert.ok(html.includes(NO_FUND_REASON.replace(/’/g, '&#x27;')) || html.includes(NO_FUND_REASON), 'the reason is not shown');
  assert.doesNotMatch(html, /New reporting period|reporting\/new/);
});

test('empty reads as empty with the action; a failed read reads Unreadable with Retry', () => {
  const empty = render({ rows: [] });
  assert.match(empty, /No reporting period yet/);
  assert.match(empty, /href="\/funds\/10\/reporting\/new"/);
  assert.doesNotMatch(empty, /Unreadable|unavailable|role="alert"/i);
  const failed = render({ rows: [], error: 'boom' });
  assert.match(failed, /Unreadable/);
  assert.match(failed, /Retry/);
  assert.doesNotMatch(failed, /No reporting period yet|reporting\/new/);
});

test('the boundary copy and rail describe what the member can do, and never deny authoring', () => {
  const src = read(PAGE);
  const shown = codeOnly(src);
  assert.doesNotMatch(shown, /no (LP )?pack authoring|offers no|never builds, publishes|no pack builder/i);
  assert.match(shown, /Start a period, or open one to edit its draft and issue it/);
  assert.match(shown, /stance=\{"Reporting periods"\}/);
});
