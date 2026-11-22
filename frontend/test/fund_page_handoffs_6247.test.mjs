/**
 * #6247: /funds/:fundId hands its reader to the next page, and each link is shown only to a reader its
 * destination admits. A manager (`can_manage`: the GP of record on the institutional tier, or an admin) gets
 * the fund's zones opened on this fund; an LP gets their own commitment and statements; every reader gets fund
 * performance (#6245, owner answer C). An admin edits fund facts in the admin console; a GP of record who is not
 * an admin gets Edit terms on the page (#6235). No new API call: everything below is
 * drawn from the page read the test supplies.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import FundPage, { fundHandoffs, periodIssue } from '../src/pages/FundPage.jsx';
import { fundFactsEditHref } from '../src/pages/admin/fundAdmin/fundAdminModel.js';
import { page } from './fund_reports_d631.test.mjs';
import { tagHolding } from './_tagHolding.mjs';

const ready = (data) => ({ loading: false, error: null, data, reload() {} });
const render = (data, role = 'investor') => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/funds/10'] },
  React.createElement(FundPage, { reading: ready(data), role })));
const href = (html, testid) => {
  const tag = tagHolding(html, `data-testid="${testid}"`, (t) => t.startsWith('<a')) || undefined;
  return tag ? tag.match(/href="([^"]*)"/)?.[1] ?? null : null;
};
const lp = { ...page, can_manage: false, periods: [{ id: 7, period: 'Q1 2026', status: 'issued', issued_at: '2026-04-15 09:30:00' }] };
const gp = { ...page, periods: [{ id: 8, period: 'Q2 2026', status: 'draft', issued_at: null }, { id: 7, period: 'Q1 2026', status: 'issued', issued_at: '2026-04-15 09:30:00' }] };

test('an LP gets their commitment and statements and fund performance, and no manager link', () => {
  const html = render(lp);
  assert.equal(href(html, 'link-fund-my-commitment'), '/spinout-lab/investor-workspace');
  assert.match(html, />My commitment and statements</);
  assert.equal(href(html, 'link-fund-performance'), '/funds/performance');
  for (const id of ['link-fund-calls', 'link-fund-ledger', 'link-fund-lps', 'link-fund-reporting', 'link-fund-new-period', 'link-fund-edit-facts', 'link-fund-empty-lps'])
    assert.equal(href(html, id), null, id);
  assert.doesNotMatch(html, /Edit fund facts/);
});

test('a GP of record gets the fund zones on this fund, performance, and Edit terms on the page', () => {
  const html = render(gp, 'investor');
  assert.equal(href(html, 'link-fund-calls'), '/funds/calls?fund=10');
  assert.equal(href(html, 'link-fund-ledger'), '/funds/ledger?fund=10');
  assert.equal(href(html, 'link-fund-lps'), '/funds/lps?fund=10');
  assert.equal(href(html, 'link-fund-reporting'), '/funds/reporting?fund=10');
  assert.equal(href(html, 'link-fund-new-period'), '/funds/10/reporting/new');
  assert.equal(href(html, 'link-fund-performance'), '/funds/performance');
  assert.equal(href(html, 'link-fund-my-commitment'), null);
  assert.equal(href(html, 'link-fund-edit-facts'), null);
  assert.match(html, /<button[^>]*data-testid="button-fund-edit-terms"[^>]*>Edit terms<\/button>/);
  assert.doesNotMatch(html, /Not available/);
});

test('an admin gets the console edit link for fund facts', () => {
  const html = render(gp, 'admin');
  assert.equal(href(html, 'link-fund-edit-facts'), '/admin/fund-admin/funds/10?edit=facts');
  assert.equal(fundFactsEditHref(10), '/admin/fund-admin/funds/10?edit=facts');
  assert.doesNotMatch(html, /button-fund-edit-terms/);
  assert.equal(fundHandoffs({ ...gp, can_manage: false }, 'admin').edit, null, 'no edit link without can_manage, whatever the role');
});

test('the empty LP state carries Open LPs for a manager only', () => {
  const empty = (data) => ({ ...data, fund: { ...data.fund, lp_count: 0 } });
  const managed = render(empty(gp));
  assert.match(managed, /No LP has committed yet\./);
  assert.equal(href(managed, 'link-fund-empty-lps'), '/funds/lps?fund=10');
  const read = render(empty(lp));
  assert.match(read, /No LP has committed yet\./);
  assert.equal(href(read, 'link-fund-empty-lps'), null);
});

test('reporting periods print the issue date and mark drafts; status is a pill', () => {
  const html = render(gp);
  assert.match(html, /row-fund-period-8.*?fd-pill fd-pill-draft">Draft · not issued</);
  assert.match(html, /row-fund-period-7.*?class="fd-pill">Issued 2026-04-15</);
  assert.equal(periodIssue({ status: 'issued', issued_at: null }), 'Issued · date not recorded');
  assert.match(html, /data-testid="pill-fund-status">investing</);
  const missing = render({ ...gp, fund: { ...gp.fund, status: null } });
  assert.doesNotMatch(missing, /pill-fund-status/);
  assert.match(missing, /The fund status has not been recorded\./);
});
