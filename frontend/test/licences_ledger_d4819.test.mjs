/**
 * D4819 (#4819), Build part 1 — the HQ Licences ledger and its true zero
 * state (Licences v2 boards L00 to L02 and L19), mounted on fake Worker reads.
 *
 *   - zero state: "No licences have been issued" and Issue first licence lead;
 *     search, filters and the renewal pipeline are not drawn; coverage is one
 *     line from the real coverage; Why is this empty? is a disclosure;
 *   - no internal identifier (U1) in operator copy;
 *   - Needs HQ items filter the table, and a category the reads cannot compute
 *     is never a 0;
 *   - None, Not recorded, Unavailable and Not instrumented stay four things;
 *   - deep links (`/admin/licences/:uid/:section`);
 *   - Program grants renamed Program access by licence, at its old address;
 *   - what the page did before is still reachable.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licences_ledger_d4819.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, matchRoutes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import AdminLicences from '../src/pages/admin/AdminLicences.jsx';
import LicenceDeepLink, { deepLinkTarget } from '../src/pages/admin/licences/LicenceDeepLink.jsx';
import { LicenceConsequenceSheet } from '../src/pages/admin/LicenceConsequenceSheet.jsx';
import { licenceConsequence } from '../src/pages/admin/licenceConsequenceModel.js';
import {
  NOT_INSTRUMENTED, attentionCell, countsLine, filterByNeeds, ledgerIsEmpty, needsFromParam, needsSummary, renewalCell, requestsCell, tabForSection, territoryCell,
} from '../src/pages/admin/licenceLedgerModel.js';
import { HQ_STRIPS } from '../src/lib/hqStrips.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const h = React.createElement;

const DAY = 86400000;
const inDays = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

const response = (body, status = 200) => ({
  ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});

const licence = (uid, o = {}) => ({
  uid, licence_ref: `REF-${uid}`, brand_name: `Studio ${uid}`, legal_entity_name: `Entity ${uid}`, kind: 'subsidiary',
  status: 'active', territories: [], renews_on: null, seats_licensed: 0, seats: {}, ...o,
});

const EMPTY_SUMMARY = { coverage: [], renewals: { items: [], total: 0, complete: true }, counts: { total: 0, by_status: {}, by_kind: {} } };
const SEATS_REASON = 'This ledger does not attribute HQ accounts to a licence (U1), so a per-licence utilisation figure here would invent scoping.';

/**
 * The Worker, as far as this page reads it. `requests[uid]` is a total, or a
 * function answering a response (so a read can fail, then succeed on Retry).
 */
function worker({ items = [], summary = EMPTY_SUMMARY, requests = {}, next = null, summaryStatus = 200 } = {}) {
  return (url) => {
    const u = new URL(url, 'http://x');
    const p = u.pathname.replace(/^\/api/, '');
    if (p === '/admin/licences') {
      const status = u.searchParams.get('status');
      const rows = status ? items.filter((l) => l.status === status) : items;
      return response({ items: rows, total: rows.length, next_cursor: next, limit: 50, seats_used_available: false, seats_used_reason: SEATS_REASON });
    }
    if (p === '/admin/licences/summary') return summaryStatus === 200 ? response(summary) : response({ error: 'down' }, summaryStatus);
    if (p === '/admin/licences/territories') return response({ items: [] });
    const m = p.match(/^\/admin\/licences\/([^/]+)\/requests$/);
    if (m) {
      const r = requests[decodeURIComponent(m[1])];
      if (typeof r === 'function') return r();
      return response({ available: true, items: [], total: r ?? 0, next_cursor: null, limit: 1, branch_code: null, branch_readable: true });
    }
    const one = p.match(/^\/admin\/licences\/([^/]+)$/);
    if (one) {
      const l = items.find((x) => x.uid === decodeURIComponent(one[1]));
      return l ? response({ ...l, blockers: [], sync: null }) : response({ error: 'not_found' }, 404);
    }
    return response({ error: 'not_found' }, 404);
  };
}

async function mount(url, handle) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push(String(u)); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootNode = createRoot(container);
  const at = { path: url };
  function Probe() { const loc = useLocation(); at.path = `${loc.pathname}${loc.search}`; return null; }
  await act(async () => rootNode.render(h(MemoryRouter, { initialEntries: [url] },
    h(Routes, null,
      h(Route, { path: '/admin/licences', element: h(React.Fragment, null, h(AdminLicences), h(Probe)) }),
      h(Route, { path: '/admin/licences/:uid', element: h(React.Fragment, null, h(LicenceDeepLink), h(Probe)) }),
      h(Route, { path: '/admin/licences/:uid/:section', element: h(React.Fragment, null, h(LicenceDeepLink), h(Probe)) })))));
  const flush = () => act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(container);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const allById = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  const event = { button: 0, preventDefault() {}, stopPropagation() {} };
  return {
    requests, at, flush, nodes, props, byId, allById,
    text: () => text(container),
    textOf: (id) => text(byId(id)),
    has: (id) => Boolean(byId(id)),
    async click(id, ev = event) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); await act(async () => { await p.onClick(ev); }); await flush(); },
    async clickNode(n, ev = event) { await act(async () => { await props(n).onClick(ev); }); await flush(); },
    async change(id, value) { await act(async () => { props(byId(id)).onChange({ target: { value } }); }); await flush(); },
    rowsShown: () => allById('licence-row').map((n) => props(n)['data-uid']),
    textNode: text,
    async close() {
      await act(async () => rootNode.unmount());
      globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia;
      restore();
    },
  };
}

// ── L00: the true zero state ─────────────────────────────────────────────

test('L00: with no licence, "No licences have been issued" and Issue first licence lead; search, filters and the pipeline are not drawn', async () => {
  const v = await mount('/admin/licences', worker());
  try {
    assert.ok(v.has('licence-zero'));
    const t = v.text();
    const lead = t.indexOf('No licences have been issued');
    assert.ok(lead >= 0, 'the zero state is drawn');
    assert.ok(lead < t.indexOf('EU territory coverage'), 'it leads, before the coverage');
    assert.ok(lead < t.indexOf('Seat utilisation'), 'and before seat utilisation');
    assert.match(v.textOf('licence-zero'), /Issue the first licence to a real legal entity and assign its territory, commercial terms and administrators\.Issue first licence/);
    for (const id of ['licence-search', 'licence-kind-filter', 'licence-status-filter', 'licence-ledger', 'licence-needs', 'hq-coverage', 'hq-renewal-pipeline']) {
      assert.equal(v.has(id), false, `${id} is not drawn at zero`);
    }
    assert.doesNotMatch(t, /Renewal pipeline/, 'empty renewal analytics do not lead');
    assert.doesNotMatch(t, /Territory licences/, 'one title: Licences');
  } finally { await v.close(); }
});

test('L00: territory coverage is one line from the summary, and View territory coverage opens the existing matrix without the pipeline', async () => {
  const v = await mount('/admin/licences', worker());
  try {
    assert.equal(v.textOf('licence-coverage-counts'), '27 available · 0 held · 0 suspended');
    assert.equal(v.props(v.byId('licence-coverage-toggle'))['aria-expanded'], false);
    await v.click('licence-coverage-toggle');
    assert.ok(v.has('hq-coverage'), 'the 27-cell grid opens');
    assert.equal(v.allById('hq-coverage').length, 1);
    assert.equal(v.nodes().filter((n) => /^coverage-[A-Z]{2}$/.test(v.props(n)['data-testid'] || '')).length, 27);
    assert.equal(v.props(v.byId('licence-coverage-toggle'))['aria-expanded'], true);
    assert.doesNotMatch(v.text(), /Renewal pipeline/, 'still no empty pipeline');
  } finally { await v.close(); }
});

test('L00: the coverage line counts the real holdings, and says Unavailable when the summary cannot be read', async () => {
  // A ledger whose only licences are terminated is empty of live licences but
  // not of rows; coverage still comes from the summary, never a default 27.
  const held = { ...EMPTY_SUMMARY, coverage: [
    { uid: 'a', licence_ref: 'A', brand_name: 'A', status: 'active', territories: ['FR', 'BE'] },
    { uid: 'b', licence_ref: 'B', brand_name: 'B', status: 'suspended', territories: ['ES'] },
  ], counts: { total: 2, by_status: { active: 1, suspended: 1 }, by_kind: {} } };
  const v = await mount('/admin/licences', worker({ items: [licence('a'), licence('b', { status: 'suspended' })], summary: held }));
  try { assert.equal(v.textOf('licence-coverage-counts'), '24 available · 2 held · 1 suspended'); } finally { await v.close(); }
  const down = await mount('/admin/licences', worker({ summaryStatus: 500 }));
  try {
    assert.match(down.textOf('licence-coverage-line'), /! Unavailable/);
    assert.equal(down.has('licence-coverage-counts'), false, 'never 27 available by default');
    assert.equal(down.has('licence-coverage-toggle'), false);
  } finally { await down.close(); }
});

test('L00: Why is this empty? is a closed disclosure that says the ledger is not seeded', async () => {
  const v = await mount('/admin/licences', worker());
  try {
    const why = v.byId('licence-zero-why');
    assert.equal(v.props(why)['aria-expanded'], false);
    assert.doesNotMatch(v.text(), /does not seed fictional subsidiaries/);
    await v.click('licence-zero-why');
    assert.equal(v.props(v.byId('licence-zero-why'))['aria-expanded'], true);
    assert.match(v.textOf('licence-zero'), /StudioOS does not seed fictional subsidiaries or licence agreements\. The ledger fills only when HQ issues a licence\./);
  } finally { await v.close(); }
});

test('L00: Issue first licence opens the existing New licence form', async () => {
  const v = await mount('/admin/licences', worker());
  try {
    assert.equal(v.has('licence-kind'), false);
    await v.click('licence-issue-first');
    assert.ok(v.has('licence-kind'), 'the draft form, unchanged');
    assert.ok(v.nodes().some((n) => v.props(n)['aria-label'] === 'Licence reference'));
    assert.match(v.text(), /Create draft/);
  } finally { await v.close(); }
});

// ── operator copy ─────────────────────────────────────────────────────────

const INTERNAL_ID = /\b(?:U|H|D|S|L)\d{1,4}\b|#\d{3,}/;

test('no internal identifier reaches operator copy: seat utilisation reads Not recorded in plain language', async () => {
  const v = await mount('/admin/licences', worker());
  try {
    assert.equal(v.textOf('licence-seat-utilisation'),
      'Seat utilisation — Not recordedHQ cannot reliably attribute account usage to individual licences yet. Branch-level usage remains available on HQ Home and the branch console.');
    for (const id of ['licence-zero', 'licence-seat-utilisation', 'licence-coverage-line']) {
      assert.doesNotMatch(v.textOf(id), INTERNAL_ID, id);
    }
    assert.doesNotMatch(v.text(), /U1/);
  } finally { await v.close(); }
  const p = await mount('/admin/licences', worker({ items: POPULATED, summary: POP_SUMMARY, requests: { a: 2, b: 0, c: 0 } }));
  try {
    for (const id of ['licence-counts', 'licence-needs', 'licence-ledger', 'licence-seat-utilisation', 'licence-coverage-line']) {
      assert.doesNotMatch(p.textOf(id), INTERNAL_ID, id);
    }
    assert.doesNotMatch(p.text(), /U1/);
  } finally { await p.close(); }
  // The Worker's own reason still names U1; the page no longer prints it.
  assert.doesNotMatch(codeOnly(read('frontend/src/pages/admin/AdminLicences.jsx')), /seats_used_reason/);
});

test('policy prose is off the ledger and at its actions: overlap at the territory step, suspension and release in their consequence sheets', async () => {
  const page = codeOnly(read('frontend/src/pages/admin/AdminLicences.jsx'));
  assert.doesNotMatch(page, /Two licences\s+cannot hold the same country/);
  assert.match(read('frontend/src/pages/admin/licences/TerritoryEditor.jsx'), /this step refuses any country another\s+licence already holds regardless of kind/);
  // D4819 part 4 (#5927): the suspension and release rules moved from the reason dialog to the consequence sheet.
  const suspend = renderedText(renderToStaticMarkup(h(LicenceConsequenceSheet, { sheet: licenceConsequence('suspend', { status: 'active', territories: ['FR'] }), onDone: () => {} })));
  assert.match(suspend, /A suspended licence still holds its countries, so no other licence can be issued over them\. Releasing them is a termination, not a suspension\./);
  const terminate = renderedText(renderToStaticMarkup(h(LicenceConsequenceSheet, { sheet: licenceConsequence('terminate', { status: 'active', territories: ['FR'] }), onDone: () => {} })));
  assert.match(terminate, /Terminating releases every country this licence holds, permanently\./);
  // The coverage grid keeps its legend, behind View territory coverage.
  assert.match(read('frontend/src/pages/admin/licences/Coverage.jsx'), /A suspended licence still holds its countries/);
});

// ── L01 / L02: the populated ledger ──────────────────────────────────────

const POPULATED = [
  licence('a', { territories: ['FR'], renews_on: inDays(20), status: 'active' }),
  licence('b', { territories: ['ES'], renews_on: inDays(60), status: 'suspended', kind: 'white_label' }),
  licence('c', { territories: [], renews_on: null, status: 'draft' }),
];
const POP_SUMMARY = {
  coverage: [
    { uid: 'a', licence_ref: 'REF-a', brand_name: 'Studio a', status: 'active', territories: ['FR'] },
    { uid: 'b', licence_ref: 'REF-b', brand_name: 'Studio b', status: 'suspended', territories: ['ES'] },
  ],
  renewals: { items: [{ uid: 'a', licence_ref: 'REF-a', brand_name: 'Studio a', renews_on: inDays(20) }], total: 1, complete: true },
  counts: { total: 3, by_status: { active: 1, suspended: 1, draft: 1 }, by_kind: { subsidiary: 2, white_label: 1 } },
};

test('L01: the counts line, Needs HQ, freshness and the nine-column table once a licence exists', async () => {
  const v = await mount('/admin/licences', worker({ items: POPULATED, summary: POP_SUMMARY, requests: { a: 2, b: 0, c: 0 } }));
  try {
    assert.equal(v.has('licence-zero'), false);
    assert.equal(v.textOf('licence-counts'), 'Licences3 licences1 active · 1 suspended · 1 draft');
    assert.equal(v.textOf('licence-need-requests'), '1 request waiting');
    assert.equal(v.textOf('licence-need-renewal'), '2 renewals approaching');
    assert.match(v.textOf('licence-freshness'), /^HQ ledger · read \d\d:\d\d UTC$/);
    assert.ok(v.has('licence-refresh'));
    const heads = v.nodes().filter((n) => n.tagName === 'TH').map(v.textNode);
    assert.deepEqual(heads, ['Licence / studio', 'Territory', 'Status', 'Renewal', 'Agreement', 'Branch', 'Requests', 'Billing', 'Attention']);
    assert.deepEqual(v.rowsShown(), ['a', 'b', 'c']);
    for (const id of ['licence-search', 'licence-kind-filter', 'licence-status-filter']) assert.ok(v.has(id), `${id} appears once licences exist`);
  } finally { await v.close(); }
});

test('L02: each Needs HQ item is a real filter of the table, kept in the URL; two narrow, clearing restores', async () => {
  const v = await mount('/admin/licences', worker({ items: POPULATED, summary: POP_SUMMARY, requests: { a: 2, b: 0, c: 0 } }));
  try {
    await v.click('licence-need-requests');
    assert.equal(v.props(v.byId('licence-need-requests'))['aria-checked'], true);
    assert.deepEqual(v.rowsShown(), ['a']);
    assert.match(v.at.path, /needs=requests/);
    assert.equal(v.textOf('licence-list-count'), '1 of 3 loaded need HQ');
    await v.click('licence-need-requests');
    await v.click('licence-need-renewal');
    assert.deepEqual(v.rowsShown(), ['a', 'b'], 'renewals within 90 days, the suspended one included');
    await v.click('licence-need-requests');
    assert.deepEqual(v.rowsShown(), ['a'], 'both chosen: only the rows both match');
    assert.match(v.at.path, /needs=requests%2Crenewal|needs=requests,renewal/);
    await v.click('licence-need-requests');
    await v.click('licence-need-renewal');
    assert.deepEqual(v.rowsShown(), ['a', 'b', 'c']);
    assert.doesNotMatch(v.at.path, /needs=/);
  } finally { await v.close(); }
  // A filtered ledger is a link: the URL's needs open already applied.
  const linked = await mount('/admin/licences?needs=renewal', worker({ items: POPULATED, summary: POP_SUMMARY, requests: { a: 2, b: 0, c: 0 } }));
  try { assert.deepEqual(linked.rowsShown(), ['a', 'b']); } finally { await linked.close(); }
});

test('a Needs HQ category the reads cannot compute is never a 0: Not instrumented, or Unavailable when a read failed', async () => {
  const fail = () => response({ error: 'down' }, 500);
  const v = await mount('/admin/licences', worker({ items: POPULATED, summary: POP_SUMMARY, requests: { a: 2, b: 0, c: fail } }));
  try {
    const needs = v.textOf('licence-needs');
    assert.equal(v.textOf('licence-need-requests'), 'Requests waiting · Unavailable');
    assert.equal(v.props(v.byId('licence-need-requests')).role, undefined, 'an unknown count is not a filter');
    assert.match(v.textOf('licence-needs-not-instrumented'), /Not instrumented on the ledger yet: Branch out of sync · Overdue invoices\./);
    assert.doesNotMatch(needs, /\b0\b/, 'no category reads 0');
    for (const name of ['agreement', 'branch', 'sync', 'invoice']) assert.doesNotMatch(needs, new RegExp(`\\b0 [a-z ]*${name}`, 'i'));
  } finally { await v.close(); }
  assert.deepEqual(NOT_INSTRUMENTED, ['Branch out of sync', 'Overdue invoices']);
  // Until every loaded row's read answers, the requests item is Reading, never a partial count.
  const partial = needsSummary(POPULATED, { a: { ok: true, total: 2 } });
  assert.deepEqual(partial[0], { key: 'requests', state: 'reading', label: 'Requests waiting · Reading…' });
  assert.deepEqual(needsSummary(POPULATED, { a: { ok: true, total: 0 }, b: { ok: true, total: 0 }, c: { ok: true, total: 0 } })[0],
    { key: 'requests', state: 'none', count: 0, label: 'Requests waiting · None' });
});

test('L19: None, Not recorded, Unavailable and Not instrumented are four treatments, never zero', async () => {
  let fails = true;
  const flaky = () => (fails ? response({ error: 'down' }, 500) : response({ available: true, items: [], total: 0, next_cursor: null }));
  const v = await mount('/admin/licences', worker({ items: POPULATED, summary: POP_SUMMARY, requests: { a: 2, b: 0, c: flaky } }));
  try {
    const row = (uid) => v.nodes().find((n) => v.props(n)['data-testid'] === 'licence-row' && v.props(n)['data-uid'] === uid);
    const cellIn = (uid, id) => {
      const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
      const node = walk(row(uid)).find((n) => v.props(n)['data-testid'] === id);
      return { text: v.textNode(node), state: v.props(node)['data-state'] ?? v.props(node.childNodes[0] || {})['data-state'] };
    };
    assert.deepEqual(cellIn('b', 'licence-cell-requests'), { text: 'None', state: 'none' }, 'read, and nothing open');
    assert.deepEqual(cellIn('a', 'licence-cell-requests'), { text: '2 waiting', state: 'value' });
    assert.deepEqual(cellIn('c', 'licence-cell-requests'), { text: '! Unavailable', state: 'unavailable' }, 'could not be read');
    assert.deepEqual(cellIn('c', 'licence-cell-renewal'), { text: 'Not recorded', state: 'not_recorded' }, 'no renewal date on the record');
    assert.deepEqual(cellIn('c', 'licence-cell-territory'), { text: 'None', state: 'none' }, 'holds no country');
    assert.deepEqual(cellIn('c', 'licence-cell-attention'), { text: '! Unavailable', state: 'unavailable' }, 'unknown requests are not "nothing needed"');
    assert.deepEqual(cellIn('a', 'licence-cell-attention'), { text: '2 items', state: 'value' }, 'renewal in 20 days and 2 requests');
    assert.deepEqual(cellIn('b', 'licence-cell-attention'), { text: '1 item', state: 'value' });
    for (const col of ['agreement', 'branch', 'billing']) {
      assert.deepEqual(cellIn('a', `licence-cell-${col}`), { text: 'Not instrumented', state: 'not_instrumented' }, col);
    }
    const ledger = v.textOf('licence-ledger-table');
    assert.doesNotMatch(ledger.replace(/REF-|\d+ waiting|\d+ items?|\d{4}-\d\d-\d\d|in \d+d/g, ''), /\b0\b/, 'no cell reads 0');
    // Retry re-reads that licence's requests alone.
    fails = false;
    const inside = (n, top) => { for (let p = n; p; p = p.parentNode) if (p === top) return true; return false; };
    const retry = v.nodes().find((n) => n.tagName === 'BUTTON' && v.textNode(n) === 'Retry' && inside(n, row('c')));
    assert.ok(retry, 'an unavailable count offers Retry');
    await v.clickNode(retry);
    assert.deepEqual(cellIn('c', 'licence-cell-requests'), { text: 'None', state: 'none' });
  } finally { await v.close(); }
  // The model, directly.
  assert.equal(requestsCell(undefined).state, 'reading');
  assert.equal(requestsCell({ ok: false }).state, 'unavailable');
  assert.equal(requestsCell({ ok: true, total: 0 }).state, 'none');
  assert.equal(renewalCell({ renews_on: null }).label, 'Not recorded');
  assert.equal(renewalCell({ status: 'active', renews_on: inDays(-3) }).state, 'overdue');
  assert.equal(territoryCell({ territories: [] }).label, 'None');
  assert.equal(territoryCell({}).state, 'unavailable');
  assert.equal(attentionCell(licence('z'), { ok: false }).label, 'Unavailable');
  assert.equal(attentionCell(licence('z'), { ok: true, total: 0 }).label, 'None');
});

test('the counts line says Unavailable, not 0, when the summary cannot be read; an empty ledger is decided only by a successful count', async () => {
  const v = await mount('/admin/licences', worker({ items: POPULATED, summaryStatus: 500, requests: { a: 0, b: 0, c: 0 } }));
  try {
    assert.match(v.textOf('licence-counts'), /^Licences! Unavailable Retry$/);
    assert.equal(v.has('licence-zero'), false, 'rows exist, so it is not the zero state');
  } finally { await v.close(); }
  assert.equal(ledgerIsEmpty({ total: 0, filtered: false, summaryTotal: null }), true);
  assert.equal(ledgerIsEmpty({ total: 0, filtered: true, summaryTotal: null }), false, 'a filter matching nothing is not an empty ledger');
  assert.equal(ledgerIsEmpty({ total: 0, filtered: true, summaryTotal: 0 }), true);
  assert.equal(ledgerIsEmpty({ total: 2, filtered: false, summaryTotal: 0 }), false);
  assert.equal(countsLine(null), null);
  assert.equal(countsLine({ total: 'x' }), null);
  assert.deepEqual(countsLine({ total: 1, by_status: { terminated: 1 } }), { total: 1, head: '1 licence', parts: ['0 active', '0 suspended', '0 draft', '1 terminated'] });
});

// ── deep links ────────────────────────────────────────────────────────────

test('rows deep-link to /admin/licences/:uid, the unread columns to their section; a plain click opens it in place', async () => {
  const v = await mount('/admin/licences', worker({ items: POPULATED, summary: POP_SUMMARY, requests: { a: 0, b: 0, c: 0 } }));
  try {
    const links = v.allById('licence-row-link');
    assert.ok(links.map((n) => v.props(n).href).includes('/admin/licences/a'));
    const hrefs = v.nodes().map((n) => v.props(n).href).filter(Boolean);
    for (const s of ['agreement', 'operations', 'fee-invoices']) assert.ok(hrefs.includes(`/admin/licences/a/${s}`), s);
    // A modified click is the browser's: the page does not move.
    let prevented = false;
    await v.clickNode(links[0], { button: 0, metaKey: true, preventDefault() { prevented = true; } });
    assert.equal(prevented, false);
    assert.equal(v.at.path, '/admin/licences');
    await v.clickNode(links[0]);
    assert.equal(v.at.path, '/admin/licences?licence=a');
    assert.equal(v.has('licence-ledger'), false, 'the licence opens as its own view');
    assert.match(v.textOf('licence-breadcrumb'), /^Licences \/ Studio a$/);
    assert.ok(v.has('licence-tabs'), 'today\'s detail, with its tabs');
    await v.clickNode(v.byId('licence-breadcrumb').childNodes[0]);
    assert.equal(v.at.path, '/admin/licences');
    assert.ok(v.has('licence-ledger'));
    // The agreement cell opens the contract tab.
    await v.clickNode(v.allById('licence-cell-agreement')[0]);
    assert.equal(v.at.path, '/admin/licences?licence=a&tab=contract');
  } finally { await v.close(); }
});

test('/admin/licences/:uid/:section opens today\'s detail view; the section defaults to overview', async () => {
  assert.equal(deepLinkTarget('a', undefined), '/admin/licences?licence=a');
  assert.equal(deepLinkTarget('a', 'overview'), '/admin/licences?licence=a');
  assert.equal(deepLinkTarget('a', 'agreement'), '/admin/licences?licence=a&tab=contract');
  assert.equal(deepLinkTarget('a', 'access'), '/admin/licences?licence=a&tab=admins');
  assert.equal(deepLinkTarget('a', 'operations'), '/admin/licences?licence=a&tab=deploy');
  assert.equal(deepLinkTarget('a', 'history'), '/admin/licences?licence=a&tab=history');
  assert.equal(deepLinkTarget('a', 'terms'), '/admin/licences?licence=a&tab=terms');
  assert.equal(deepLinkTarget('a', 'fee-invoices'), '/admin/licences?licence=a&tab=fee-invoices', 'an existing tab key opens itself');
  assert.equal(deepLinkTarget('a', 'nonsense'), '/admin/licences?licence=a');
  assert.equal(deepLinkTarget('a b', 'history'), '/admin/licences?licence=a+b&tab=history');
  // Part 3: the Overview is a tab of its own now.
  assert.equal(tabForSection('OVERVIEW', null), 'overview');
  const v = await mount('/admin/licences/b/history', worker({ items: POPULATED, summary: POP_SUMMARY }));
  try {
    assert.equal(v.at.path, '/admin/licences?licence=b&tab=history');
    assert.match(v.textOf('licence-breadcrumb'), /Studio b/);
  } finally { await v.close(); }
  const bare = await mount('/admin/licences/a', worker({ items: POPULATED, summary: POP_SUMMARY }));
  try { assert.equal(bare.at.path, '/admin/licences?licence=a'); } finally { await bare.close(); }
  // A licence the ledger does not hold sends the page back to the ledger and says so; it never opens another.
  const gone = await mount('/admin/licences/zzz/overview', worker({ items: POPULATED, summary: POP_SUMMARY }));
  try {
    assert.equal(gone.at.path, '/admin/licences');
    assert.ok(gone.has('licence-not-found'));
    assert.ok(gone.has('licence-ledger'));
  } finally { await gone.close(); }
});

test('App routes both deep-link shapes behind the HQ guard, and the static Program access paths still win', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/admin\/licences\/:uid" element=\{guard\(\['admin'\], hqOnly\(<LicenceDeepLink \/>\)\)\} \/>/);
  assert.match(app, /<Route path="\/admin\/licences\/:uid\/:section" element=\{guard\(\['admin'\], hqOnly\(<LicenceDeepLink \/>\)\)\} \/>/);
  const routes = ['/admin/licences', '/admin/licences/programs', '/admin/licences/programs/history', '/admin/licences/:uid', '/admin/licences/:uid/:section'].map((path) => ({ path }));
  const at = (url) => matchRoutes(routes, url)?.[0]?.route.path;
  assert.equal(at('/admin/licences/programs'), '/admin/licences/programs');
  assert.equal(at('/admin/licences/programs/history'), '/admin/licences/programs/history');
  assert.equal(at('/admin/licences/abc'), '/admin/licences/:uid');
  assert.equal(at('/admin/licences/abc/terms'), '/admin/licences/:uid/:section');
});

// ── navigation ────────────────────────────────────────────────────────────

test('"Program grants" is "Program access by licence", at the same address, and the old address still opens it', () => {
  assert.deepEqual(HQ_STRIPS.Licences.map((s) => [s.label, s.route]), [['Ledger', '/admin/licences'], ['Program access by licence', '/admin/licences/programs']]);
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<StripLink to="\/admin\/licences\/programs">Program access by licence<\/StripLink>/);
  assert.doesNotMatch(app, />Program grants<\/StripLink>/);
  assert.match(app, /<Route path="\/admin\/licences\/programs" element=\{guard\(\['admin'\], hqOnly\(<ProgramGrants \/>\)\)\} \/>/);
  for (const f of ['ProgramGrants.jsx', 'ProgramGrantsHistory.jsx']) {
    assert.match(read(`frontend/src/pages/admin/grants/${f}`), /title="Program access by licence"/, f);
  }
});

// ── what the page did before is still reachable ───────────────────────────

test('existing functions stay reachable: New licence, search, kind, the status filter, Show more, the coverage grid that opens a licence, the pipeline', async () => {
  const v = await mount('/admin/licences', worker({ items: POPULATED, summary: POP_SUMMARY, requests: { a: 0, b: 0, c: 0 }, next: 'cur' }));
  try {
    assert.ok(v.nodes().some((n) => n.tagName === 'BUTTON' && v.props(n).children === 'New licence'));
    assert.equal(v.props(v.byId('licence-search'))['aria-label'], 'Search licences');
    assert.equal(v.allById('licence-kind-filter').length, 1);
    assert.ok(v.has('licence-list-more'), 'paging stays');
    assert.match(v.textOf('licence-needs'), /on the 3 loaded of 3/, 'with more pages, Needs HQ says it counts the loaded rows');
    await v.change('licence-status-filter', 'suspended');
    assert.match(v.at.path, /status=suspended/);
    assert.ok(v.requests.some((u) => /\/api\/admin\/licences\?.*status=suspended/.test(u)), 'the status filter runs on the server');
    assert.deepEqual(v.rowsShown(), ['b']);
    await v.change('licence-status-filter', '');
    await v.click('licence-coverage-toggle');
    assert.match(v.text(), /Renewal pipeline/, 'the pipeline is drawn once licences exist');
    await v.click('coverage-FR');
    assert.equal(v.at.path, '/admin/licences?licence=a', 'a held cell opens its licence');
  } finally { await v.close(); }
});

test('the Needs HQ filter reads only fields the ledger and requests reads return', () => {
  const model = codeOnly(read('frontend/src/pages/admin/licenceLedgerModel.js'));
  // The fields NEEDS reads: a row's status and renewal date, and its requests total.
  const fields = new Set([...model.matchAll(/\bl\.(\w+)/g)].map((m) => m[1]));
  for (const f of fields) assert.ok(['renews_on', 'status', 'territories', 'uid', 'legal_signals'].includes(f), `the model reads l.${f}`);
  assert.deepEqual(needsFromParam('renewal,bogus,requests'), ['requests', 'renewal']);
  assert.deepEqual(filterByNeeds(POPULATED, {}, ['requests']), [], 'an unread count matches nothing');
});

test('legal Needs HQ chips count and filter the loaded ledger page', async () => {
  const items = POPULATED.map((row, index) => ({
    ...row, legal_signals: index === 0 ? ['awaiting_signature'] : [],
  }));
  const v = await mount('/admin/licences', worker({ items, summary: POP_SUMMARY }));
  try {
    assert.equal(v.textOf('licence-need-legal_awaiting_signature'), 'Awaiting signature · 1');
    await v.click('licence-need-legal_awaiting_signature');
    assert.deepEqual(v.rowsShown(), ['a']);
    assert.match(v.at.path, /needs=legal_awaiting_signature/);
  } finally { await v.close(); }
  assert.equal(needsSummary(POPULATED, {}).find((item) => item.key === 'legal_stale').state, 'unavailable');
});
