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
import { KycPersonView, KycTabBody } from '../src/pages/admin/kyc/KycTabs.jsx';
import { BASE, NOT_YET, QUEUE_FILTERS, TABS, WAITS, decidable, personFacts, personHref, statusWord, viewOf } from '../src/pages/admin/kyc/kycModel.js';

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
  assert.deepEqual(viewOf('/admin/kyc'), { tab: 'people', person: null });
  assert.deepEqual(viewOf('/admin/kyc/businesses/'), { tab: 'businesses', person: null });
  assert.deepEqual(viewOf('/admin/kyc/audit'), { tab: 'audit', person: null });
  assert.deepEqual(viewOf('/admin/kyc/people/42'), { tab: 'people', person: '42' });
  assert.deepEqual(viewOf('/admin/kyc/people/0'), { tab: 'people', person: null }, 'no account has id 0');
  assert.deepEqual(viewOf('/admin/kyc/people/4x'), { tab: 'people', person: null });
  assert.deepEqual(viewOf('/admin/kyc/people/42/more'), { tab: 'people', person: null });
  assert.deepEqual(viewOf('/admin/kyc/odd'), { tab: 'people', person: null });
  assert.equal(personHref(42), '/admin/kyc/people/42');
  assert.equal(personHref('../1'), BASE);
  assert.equal(personHref(null), BASE);
});

test('the canvas’s status words, with Waiting for pending and nothing unknown read as a status', () => {
  assert.deepEqual(['not_started', 'pending', 'needs_info', 'approved', 'rejected', 'expired', 'odd'].map(statusWord),
    ['Not started', 'Waiting', 'Needs information', 'Approved', 'Rejected', 'Expired', 'Not recorded']);
  assert.deepEqual(QUEUE_FILTERS, ['pending', 'approved', 'rejected', 'not_started'], 'the four the queue read accepts, Waiting first');
  assert.deepEqual(['pending', 'rejected', 'approved', 'not_started'].map(decidable), [true, true, false, false], 'as the Worker allows');
});

test('a fact the record did not return stays null, and no wait says zero or none', () => {
  const f = Object.fromEntries(personFacts({ email: 'a@example.test', kyc_status: 'pending', kyc_data: { legal_first_name: 'Dev', legal_last_name: 'Testcase' } }));
  assert.equal(f.Status, 'Waiting');
  assert.equal(f['Legal name'], 'Dev Testcase');
  assert.equal(f.Provider, null);
  assert.equal(f.Nationality, null);
  for (const [k, w] of Object.entries(WAITS)) assert.ok(!/\b0\b|\bnone\b/i.test(w), k);
});

/* ------------------------------------------------------------------ *
 * Rendered
 * ------------------------------------------------------------------ */

test('People keeps the queue it is given, between the figures and the queue’s waits', () => {
  const out = html(h(KycTabBody, { view: viewOf('/admin/kyc'), people: h('div', { 'data-testid': 'the-queue' }) }));
  assert.ok(out.includes('data-testid="the-queue"'), 'D648’s queue, and its Review, stay reachable');
  for (const id of ['figures', 'queue', 'statuses']) assert.ok(out.includes(`data-testid="kyc-wait-${id}"`), id);
  assert.ok(out.indexOf('kyc-wait-figures') < out.indexOf('the-queue'));
});

test('Businesses, Renewals and Audit say what is not read yet, never an empty table', () => {
  for (const tab of ['businesses', 'renewals', 'audit']) {
    const out = html(h(KycTabBody, { view: viewOf(`/admin/kyc/${tab}`), people: h('div', { 'data-testid': 'the-queue' }) }));
    assert.ok(out.includes(`data-testid="kyc-wait-${tab}"`) && out.includes(NOT_YET), tab);
    assert.ok(!out.includes('the-queue'), `${tab} does not draw People`);
    assert.ok(!/<table/.test(out), `${tab} draws no table`);
  }
});

test('a person’s case (KYC3): identity, the earlier rejection, each wait, and where to decide', () => {
  const out = html(h(KycPersonView, { record: {
    id: 7, name: 'Dev Testcase', email: 'dev@example.test', role: 'investor', kyc_status: 'rejected', rejection_reason: 'The photo was unreadable.',
    kyc_data: { legal_first_name: 'Dev', legal_last_name: 'Testcase', country: 'IN', id_type: 'passport' },
  } }));
  assert.match(out, /Dev Testcase/);
  assert.match(out, /data-testid="kyc-case-status"[^>]*>Rejected</);
  assert.match(out, /Earlier rejection: The photo was unreadable\./);
  assert.match(out, /Not in the record|is not in the record/i, 'a missing fact says so');
  for (const id of ['documents', 'checks', 'sanctions', 'history', 'assignment', 'decide', 'hq']) assert.ok(out.includes(`data-testid="kyc-wait-${id}"`), id);
  assert.match(out, /approved or rejected from <a[^>]*href="\/admin\/kyc"/);
  const done = html(h(KycPersonView, { record: { id: 8, name: 'Ana', kyc_status: 'approved' } }));
  assert.match(done, /This check is Approved; no decision is open on it\./);
  assert.ok(!done.includes('kyc-case-rejected'));
});

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
  assert.ok(page.includes('<KycTabBody view={kycViewOf(pathname)} people={<KycConsole />} />'));
  const queue = read('frontend/src/pages/admin/consoles/KycConsole.jsx');
  assert.ok(queue.includes('<Link to={`/admin/kyc/people/${k.id}`}'), 'each name opens its case');
  assert.ok(queue.includes('{statusWord(s)}'), 'the filters say the canvas’s words');
  for (const f of ['KYC KYB Page.dc.html', 'KYC & KYB · Boards.dc.html']) assert.ok(existsSync(`design/incoming/${f}`), f);
  assert.ok(read('design/incoming/KYC & KYB · Boards.dc.html').includes('name="KYC KYB Page"'));
  assert.ok(existsSync('documentation/architecture/decisions/D1228.md'));
  assert.ok(existsSync('documentation/audits/KYC_KYB_MAP_2026-10-26.md'));
});
