// D1228 (#2384) — KYC & KYB (KYC1–KYC17): the page's four tabs at their own
// addresses, one person's case at /admin/kyc/people/:id, the canvas's status
// words, People keeping D648's queue and its decisions, and "Not read here yet"
// on every block no read carries — never a zero.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/kyc_kyb_d1228.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { KycTabBody } from '../src/pages/admin/kyc/KycTabs.jsx';
import { BASE, NOT_YET, TABS, WAITS, personHref, statusWord, viewOf } from '../src/pages/admin/kyc/kycModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the four tabs in the canvas’s order, each at its own address', () => {
  assert.deepEqual(TABS.map((t) => [t.label, t.path]), [
    ['People', '/admin/kyc'], ['Businesses', '/admin/kyc/businesses'], ['Renewals', '/admin/kyc/renewals'], ['Audit', '/admin/kyc/audit'],
  ]);
});

test('an address names its tab and a person’s case; anything else is People', () => {
  assert.deepEqual(viewOf('/admin/kyc'), { tab: 'people', person: null, business: null });
  assert.deepEqual(viewOf('/admin/kyc/businesses/'), { tab: 'businesses', person: null, business: null });
  // D1234: a business's case is its uid; the queue and the uid rules are kyc_businesses_d1234's.
  assert.deepEqual(viewOf('/admin/kyc/businesses/company-12'), { tab: 'businesses', person: null, business: 'company-12' });
  assert.deepEqual(viewOf('/admin/kyc/audit'), { tab: 'audit', person: null, business: null });
  assert.deepEqual(viewOf('/admin/kyc/people/42'), { tab: 'people', person: '42', business: null });
  assert.deepEqual(viewOf('/admin/kyc/people/0'), { tab: 'people', person: null, business: null }, 'no account has id 0');
  assert.deepEqual(viewOf('/admin/kyc/people/4x'), { tab: 'people', person: null, business: null });
  assert.deepEqual(viewOf('/admin/kyc/people/42/more'), { tab: 'people', person: null, business: null });
  assert.deepEqual(viewOf('/admin/kyc/odd'), { tab: 'people', person: null, business: null });
  assert.equal(personHref(42), '/admin/kyc/people/42');
  assert.equal(personHref('../1'), BASE);
  assert.equal(personHref(null), BASE);
});

test('the canvas’s status words, with Waiting for pending and nothing unknown read as a status', () => {
  assert.deepEqual(['not_started', 'pending', 'needs_info', 'approved', 'rejected', 'expired', 'odd'].map(statusWord),
    ['Not started', 'Waiting', 'Needs information', 'Approved', 'Rejected', 'Expired', 'Not recorded']);
  // D1233: the queue's chips, its filters and what each status allows are `peopleModel`'s (kyc_people_d1233).
});

test('no wait says zero or none', () => {
  for (const [k, w] of Object.entries(WAITS)) assert.ok(!/\b0\b|\bnone\b/i.test(w), k);
  assert.deepEqual(Object.keys(WAITS), ['renewals', 'audit'], 'D1233 drew People’s waits; D1234 drew Businesses');
});

/* ------------------------------------------------------------------ *
 * Rendered
 * ------------------------------------------------------------------ */

test('People draws the queue it is given, and no wait of its own (D1233)', () => {
  const out = html(h(KycTabBody, { view: viewOf('/admin/kyc'), people: h('div', { 'data-testid': 'the-queue' }) }));
  assert.ok(out.includes('data-testid="the-queue"'));
  assert.ok(!out.includes('kyc-wait-'), 'part 1’s reads fill the figures and the queue');
});

test('Renewals and Audit say what is not read yet, never an empty table (D1234 drew Businesses)', () => {
  for (const tab of ['renewals', 'audit']) {
    const out = html(h(KycTabBody, { view: viewOf(`/admin/kyc/${tab}`), people: h('div', { 'data-testid': 'the-queue' }) }));
    assert.ok(out.includes(`data-testid="kyc-wait-${tab}"`) && out.includes(NOT_YET), tab);
    assert.ok(!out.includes('the-queue'), `${tab} does not draw People`);
    assert.ok(!/<table/.test(out), `${tab} draws no table`);
  }
});

// D1233: one person's case is `KycCase.jsx`'s, tested in kyc_people_d1233.

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the wiring: the routes, the header’s tabs, the queue’s door to each case, the canvas and the docs', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of ['/admin/kyc', '/admin/kyc/:tab', '/admin/kyc/people/:id']) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(['admin'], <KycPage />)} />`), p);
  }
  const page = read('frontend/src/pages/admin/ConsolePages.jsx');
  for (const t of TABS) assert.ok(page.includes(`<HeaderTab to="${t.path}" data-testid="kyc-tab-${t.key}">${t.label}</HeaderTab>`), t.label);
  assert.ok(page.includes('<KycTabBody view={kycViewOf(pathname)} people={<KycConsole />} businesses={<KycBusinesses />} />'), 'D1234 passes Businesses as it passes People');
  const queue = read('frontend/src/pages/admin/consoles/KycConsole.jsx');
  assert.ok(queue.includes('<Link to={`/admin/kyc/people/${k.id}`}'), 'each name opens its case');
  for (const f of ['KYC KYB Page.dc.html', 'KYC & KYB · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  assert.ok(read('design/incoming/KYC & KYB · Boards.dc.html').includes('name="KYC KYB Page"'));
  assert.ok(existsSync('documentation/architecture/decisions/D1228.md'));
  assert.ok(existsSync('documentation/audits/KYC_KYB_MAP_2026-10-26.md'));
});
