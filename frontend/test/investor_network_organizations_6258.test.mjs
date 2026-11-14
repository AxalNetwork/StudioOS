/**
 * D6258 (#6258) — the investor Network's Organizations zone reads the
 * counterpart's own company, which the Worker has returned since D572 part 3.
 *
 * `GET /api/partnernet/relationships` sends `other.company` on every row: the
 * company the other person links on their account (`user_company_links`), a
 * name or null. When that read fails, every row carries
 * `companies_unreadable: true` and `other.company` is null, which is not the
 * same as "no company". The page used to read six fields nothing writes, so
 * the zone was empty for every investor.
 *
 * This file RENDERS the page in a fake document with the five reads stubbed,
 * and covers the three states: recorded (grouped under the company), not
 * recorded (not grouped, the Person row says so) and unreadable (the section
 * says the companies could not be read, with a retry, and never that none
 * exist). It also pins the chip row: `All` live, the other four held.
 *
 * Run with:  node --import ./frontend/test/_deck-loader.mjs --test frontend/test/investor_network_organizations_6258.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { investorZoneFilters } from '../src/workspaces/investorZoneFilters.js';

const restoreDoc = installDocument();
const { default: InvestorNetworkWorkspace } = await import('../src/pages/investor/InvestorNetworkWorkspace.jsx');
restoreDoc();

const ROUTE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/partnernet.ts'), 'utf8');

const tie = (id, name, email, company, extra = {}) => ({
  id, relationship_type: 'co_investor', strength_score: 60,
  other: { id: 100 + id, name, email, role: 'investor', company }, my_company: 'Our Fund',
  ...extra,
});
const RECORDED = [
  tie(1, 'Ada Byron', 'ada@northwind.vc', 'Northwind Capital'),
  tie(2, 'Bo Chen', 'bo@northwind.vc', 'Northwind Capital'),
  tie(3, 'Cy Dahl', 'cy@acme.io', 'Acme'),
  // Same email domain as Northwind and no linked company: never grouped.
  tie(4, 'Di Ekk', 'di@northwind.vc', null),
];
const UNREADABLE = RECORDED.map((row) => ({
  ...row, other: { ...row.other, company: null }, my_company: null, companies_unreadable: true,
}));

const textOf = (node) => (!node ? '' : node.nodeType === 3 ? node.textContent || ''
  : node.childNodes?.length ? node.childNodes.map(textOf).join('') : node.textContent || '');
const propsOf = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};

const STUBS = ['partnerRelationships', 'partnerSummary', 'introPropositions', 'listIntroductions', 'partnerReminders'];

async function mount(relationshipReads, { zone = null } = {}) {
  const restore = installDocument();
  const original = Object.fromEntries(STUBS.map((k) => [k, api[k]]));
  let reads = 0;
  api.partnerRelationships = async () => relationshipReads[Math.min(reads++, relationshipReads.length - 1)];
  api.partnerSummary = async () => ({});
  api.introPropositions = async () => ({ propositions: [], credits: null });
  api.listIntroductions = async () => ({ introductions: [] });
  api.partnerReminders = async () => ({ items: [] });
  const filterCalls = [];
  const zoneFilters = (opts) => { filterCalls.push(opts); return []; };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const flush = () => act(async () => { await new Promise((r) => setImmediate(r)); });
  await act(async () => {
    root.render(React.createElement(MemoryRouter, { initialEntries: ['/network'] },
      React.createElement(InvestorNetworkWorkspace, { embedded: true, zone, role: 'investor', zoneFilters })));
  });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const byTestId = (id) => nodes().find((n) => n.nodeType === 1 && propsOf(n)['data-testid'] === id) || null;
  const byPrefix = (prefix) => nodes().filter((n) => n.nodeType === 1 && String(propsOf(n)['data-testid'] || '').startsWith(prefix));
  return {
    text: () => textOf(container),
    byTestId, byPrefix, flush, filterCalls,
    reads: () => reads,
    async done() {
      await act(async () => root.unmount());
      Object.assign(api, original);
      restore();
    },
  };
}

test('the Worker shape this page reads: other.company, a name or null, and a row-level unreadable flag', () => {
  // If the route stops sending either, this page is reading a field nothing
  // writes again, which is the defect D6258 fixed.
  assert.match(ROUTE, /company: companyOf\(r\.partner_b_id\)/);
  assert.match(ROUTE, /company: companyOf\(r\.partner_a_id\)/);
  assert.match(ROUTE, /companies \? \{\} : \{ companies_unreadable: true \}/);
});

test('recorded: a tie appears under its counterpart’s company; a tie with none is not grouped and reads Not recorded', async () => {
  const page = await mount([RECORDED]);
  try {
    const orgs = page.byPrefix('row-organization-');
    assert.deepEqual(orgs.map((n) => propsOf(n)['data-testid']).sort(),
      ['row-organization-acme', 'row-organization-northwind-capital'],
      'the roll-up is not the set of linked companies');
    const northwind = page.byTestId('row-organization-northwind-capital');
    assert.match(textOf(northwind), /2 known/, 'two ties at one company are not grouped together');
    // The tie with no linked company shares Northwind's email domain and is
    // still not counted there: a firm is never inferred from an address.
    assert.doesNotMatch(textOf(northwind), /3 known/);
    assert.ok(page.byTestId('empty-organizations') === null, 'the empty state shows over real companies');
    assert.ok(page.byTestId('status-organizations-unreadable') === null, 'a readable book says it was unreadable');
    // The Person row carries the company, or Not recorded.
    assert.equal(textOf(page.byTestId('text-relationship-company-1')), 'Northwind Capital');
    assert.equal(textOf(page.byTestId('text-relationship-company-4')), 'Not recorded');
    assert.match(textOf(page.byTestId('text-organizations-detail')), /^2 relationship-backed organizations$/);
    // The footnote still refuses to infer.
    assert.match(textOf(page.byTestId('text-organizations-source')),
      /Names and email domains are never used to infer a firm\./);
  } finally { await page.done(); }
});

test('not recorded anywhere: the section says no one links a company, not that the read failed', async () => {
  const none = RECORDED.map((row) => ({ ...row, other: { ...row.other, company: null } }));
  const page = await mount([none]);
  try {
    assert.equal(page.byPrefix('row-organization-').length, 0);
    assert.ok(page.byTestId('empty-organizations') !== null, 'an empty roll-up says nothing');
    assert.ok(page.byTestId('status-organizations-unreadable') === null);
    assert.equal(textOf(page.byTestId('text-relationship-company-3')), 'Not recorded');
  } finally { await page.done(); }
});

test('unreadable: the section says the companies could not be read, offers a retry, and never says none exist', async () => {
  const page = await mount([UNREADABLE, RECORDED]);
  try {
    const status = page.byTestId('status-organizations-unreadable');
    assert.ok(status !== null, 'a failed company read is not said');
    assert.match(textOf(status), /could not be read\. This is not a claim that none are recorded\./);
    assert.ok(page.byTestId('empty-organizations') === null, 'a failed read is drawn as "none recorded"');
    assert.equal(page.byPrefix('row-organization-').length, 0);
    assert.equal(textOf(page.byTestId('text-organizations-detail')), 'Companies unreadable');
    // The Person row says the same, never Not recorded.
    assert.equal(textOf(page.byTestId('text-relationship-company-1')), 'Company could not be read');
    // Try again reads the book again, and a readable answer replaces the alert.
    const before = page.reads();
    await act(async () => { propsOf(page.byTestId('button-organizations-retry')).onClick(); });
    await page.flush();
    assert.equal(page.reads(), before + 1, 'Try again did not read the book again');
    assert.ok(page.byTestId('status-organizations-unreadable') === null, 'the retry left the alert up');
    assert.ok(page.byTestId('row-organization-northwind-capital') !== null, 'the retry did not draw the companies');
  } finally { await page.done(); }
});

test('the Organizations section wires its chip row to its own view', async () => {
  const page = await mount([RECORDED], { zone: 'organizations' });
  try {
    const wired = page.filterCalls.find((opts) => opts && opts.value === 'all' && typeof opts.onChange === 'function');
    assert.ok(wired, 'the section calls the chip builder without its view');
  } finally { await page.done(); }
});

test('the chip row: All is live; Portfolio, Co-investors, LPs and Passed keep their reasons', () => {
  const chips = investorZoneFilters('network/organizations', { value: 'all', onChange: () => {} });
  const all = chips.find((c) => c.label === 'All');
  assert.ok(all && !all.disabled && typeof all.onSelect === 'function' && all.active === true, 'All is not a live chip');
  for (const label of ['Portfolio', 'Co-investors', 'LPs', 'Passed']) {
    const c = chips.find((x) => x.label === label);
    assert.equal(c.disabled, true, `${label} can be selected`);
    assert.equal(c.onSelect, undefined, `${label} is disabled and still selectable`);
    assert.ok(c.title, `${label} says nothing on hover`);
    assert.doesNotMatch(c.title, /#1023|nothing on it names the firm/, `${label} still says no firm is recorded`);
  }
});
