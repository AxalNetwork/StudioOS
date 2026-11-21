/**
 * D4819 part 12 (#5923) — a licence's Operations, Licences v2 boards L12
 * (studio requests and compliance) and L13 (annual licence-fee invoices):
 *
 *   - a request shows who raised it, its age and Decline… / Approve…, which
 *     open the Support queue's decision panel on that outcome; a request
 *     decided here shows who decided it and when, from the decision's record;
 *   - compliance notices carry their state in words, and an outstanding one
 *     is counted on the heading and marked on its row without opening it;
 *   - an invoice shows its state, the PDF and Void…, and a void one its reason;
 *   - the Overview's Requests and Billing facts open these two views;
 *   - each group fails on its own, with Try again, and a failed read is never
 *     "none".
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_operations_d5923.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { Detail } from '../src/pages/admin/licences/LicenceDetail.jsx';
import LicenceFeeInvoices from '../src/pages/admin/LicenceFeeInvoices.jsx';
import { sectionTabs } from '../src/pages/admin/licenceNavModel.js';
import {
  complianceState, decidedLine, isOutstanding, noticeStateWord, requestAge, requestsState,
} from '../src/pages/admin/licenceOperationsModel.js';
import { FEE_CHANGE_NOTE, voidLine } from '../src/pages/admin/licenceFeeInvoicesModel.js';

const h = React.createElement;

// ── the model ───────────────────────────────────────────────────────────────

test('a request\'s age is in days or hours from its created_at; an unreadable one is Not recorded, never 0', () => {
  const now = '2026-11-14T12:00:00Z';
  assert.equal(requestAge('2026-11-10 10:00:00', now), '4 days');
  assert.equal(requestAge('2026-11-13T11:00:00Z', now), '1 day');
  assert.equal(requestAge('2026-11-14T07:00:00Z', now), '5 hours');
  assert.equal(requestAge('2026-11-14T11:00:00Z', now), '1 hour');
  assert.equal(requestAge('2026-11-14T11:59:00Z', now), 'Under an hour');
  assert.equal(requestAge(null, now), 'Not recorded');
  assert.equal(requestAge('soon', now), 'Not recorded');
});

test('a decision names its outcome, who decided and when, from the record; a missing field is Not recorded', () => {
  assert.equal(decidedLine({ status: 'answered', answered_by_name: 'G. Lauzier', answered_at: '2026-11-14 10:32:00' }).text,
    'Approved by G. Lauzier · 2026-11-14 10:32 UTC');
  assert.equal(decidedLine({ status: 'declined', answered_by_name: 'M. Okafor', answered_at: '2026-11-14T09:05:00Z' }).text,
    'Declined by M. Okafor · 2026-11-14 09:05 UTC');
  assert.equal(decidedLine({ status: 'declined' }).text, 'Declined by Not recorded · Not recorded');
});

test('the requests heading: Unavailable on a failed read, None only when counted none and the branch was looked at', () => {
  assert.equal(requestsState(undefined).state, 'reading');
  assert.deepEqual(requestsState(null), { state: 'unavailable', word: 'Unavailable' });
  assert.equal(requestsState({ items: [], total: null }).state, 'unavailable');
  assert.deepEqual(requestsState({ items: [], total: 0, branchReadable: true }), { state: 'none', word: 'None' });
  assert.equal(requestsState({ items: [], total: 0, branchReadable: false }).state, 'unavailable');
  assert.deepEqual(requestsState({ items: [{}], total: 2, branchReadable: true }), { state: 'attention', word: '2 waiting' });
});

test('compliance: every notice not accepted or withdrawn is outstanding, and the heading counts them', () => {
  for (const s of ['issued', 'overdue', 'responded', 'rejected']) assert.equal(isOutstanding({ status: s }), true, s);
  for (const s of ['accepted', 'withdrawn']) assert.equal(isOutstanding({ status: s }), false, s);
  assert.equal(noticeStateWord('issued'), 'Open · waiting on the administrator');
  assert.equal(noticeStateWord('overdue'), 'Overdue · account frozen');
  assert.equal(noticeStateWord('responded'), 'Answered · waiting on HQ’s review');
  assert.equal(noticeStateWord(null), 'Not recorded');
  assert.deepEqual(complianceState(null), { state: 'unavailable', word: 'Unavailable', outstanding: null });
  assert.equal(complianceState([]).word, 'No notices');
  assert.equal(complianceState([{ status: 'accepted' }]).word, 'Nothing outstanding');
  assert.deepEqual(complianceState([{ status: 'issued' }, { status: 'accepted' }, { status: 'overdue' }]),
    { state: 'attention', word: '2 outstanding', outstanding: 2 });
});

test('a void invoice gives its reason; the foot says what Void keeps and when an amended fee applies', () => {
  assert.equal(voidLine({ status: 'void', void_note: ' Issued to the wrong licence year ' }), 'Reason: Issued to the wrong licence year');
  assert.equal(voidLine({ status: 'void', void_note: null }), 'Reason not recorded');
  assert.match(FEE_CHANGE_NOTE, /Voiding needs a reason/);
  assert.match(FEE_CHANGE_NOTE, /amended fee applies to the next invoice issued/);
});

test('Operations is Branch and domain, Requests and compliance, Billing; the keys links use are kept', () => {
  assert.deepEqual(sectionTabs('operations', 'subsidiary').map((t) => [t.key, t.label]),
    [['deploy', 'Branch and domain'], ['notices', 'Requests and compliance'], ['fee-invoices', 'Billing']]);
});

// ── the detail view, mounted ────────────────────────────────────────────────

const LICENCE = {
  uid: 'lic_fr', licence_ref: 'AXL-FR-001', brand_name: 'Axal VC France', legal_entity_name: 'Axal VC France SAS', kind: 'subsidiary',
  status: 'active', territories: ['FR'], seats: { founder: 25 }, seats_licensed: 25, annual_fee_cents: 10000000, currency: 'EUR',
  starts_on: '2026-03-02', renews_on: '2099-03-01', terms_revision: 4, deployment: null, deployment_available: true,
  domain: null, domain_available: true, sync: null, blockers: [], events: [],
};
const ago = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString(); // clock-ok: relative
const REQUESTS = {
  available: true, total: 2, next_cursor: null, branch_readable: true, items: [
    { uid: 'r_seats', kind: 'seat_increase', subject: 'Add 5 founder seats', raised_by_name: 'C. Martin', created_at: ago(4 * 24 + 1), sla: 'past', branch_code: 'hq', request: { seat_type: 'founder', seats: 5 } },
    { uid: 'r_perks', kind: 'renewal', subject: 'Enable Perks programme', raised_by_name: 'L. Bernard', created_at: ago(25), sla: 'ok', branch_code: 'hq', request: null },
  ],
};
const NOTICES = {
  notices_available: true, freeze_holders: 0, items: [
    { uid: 'n_aml', kind: 'other', subject: 'Annual AML attestation', body: 'Send the signed attestation.', respond_by: '2099-12-31 00:00:00', status: 'issued', name: 'C. Martin', email: 'c@fr' },
    { uid: 'n_dp', kind: 'other', subject: 'Data-protection notice', body: 'Reviewed.', respond_by: '2026-10-01 00:00:00', status: 'accepted', response: 'Done', reviewed_at: '2026-10-12 09:00:00', name: 'L. Bernard', email: 'l@fr' },
  ],
};

const response = (body, status = 200) => ({
  ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' },
  json: async () => body, text: async () => JSON.stringify(body),
});

function worker({ fail = {}, requests = REQUESTS, notices = NOTICES } = {}) {
  const calls = [];
  const handle = (url, options = {}) => {
    const u = new URL(url, 'http://x');
    const p = u.pathname.replace(/^\/api/, '');
    const method = options.method || 'GET';
    calls.push([method, p, u.search, options.body]);
    const answer = (key, body) => (fail[key] ? response({ error: 'down' }, 500) : response(body));
    if (p === '/admin/licences/lic_fr') return response(LICENCE);
    if (p === '/admin/licences/lic_fr/requests') return answer('requests', requests);
    if (p === '/admin/licences/lic_fr/notices') return answer('notices', notices);
    if (p === '/admin/licences/lic_fr/admins') return response({ items: [{ user_id: 1, name: 'C. Martin', email: 'c@fr' }] });
    if (p === '/admin/licences/lic_fr/terms') return response({ terms: { non_renewal_notice_days: 90 } });
    if (p === '/admin/licences/lic_fr/fee-invoices') return answer('invoices', { invoices: [], annual_fee_cents: 10000000, currency: 'EUR', starts_on: '2026-03-02' });
    if (method === 'PATCH' && p.startsWith('/admin/escalations/')) {
      const b = JSON.parse(options.body || '{}');
      return response({ uid: p.split('/').pop(), branch_code: 'hq', subject: 'x', status: b.status, answer: b.answer, answered_by_name: 'G. Lauzier', answered_at: '2026-11-14 10:32:00', notified: true });
    }
    return response({ error: 'not_found' }, 404);
  };
  return { handle, calls, fail };
}

async function mount(handle, startTab) {
  const restore = installDocument();
  const previous = globalThis.fetch;
  globalThis.fetch = async (u, options = {}) => handle(String(u), options);
  const container = document.createElement('div'); document.body.appendChild(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(container);
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  document.getElementById = () => null;
  const tabs = [];
  function Host() {
    const [tab, setTab] = useState(startTab);
    return h(Detail, { uid: 'lic_fr', held: new Map(), tab, onTab: (t) => { tabs.push(t); setTab(t); } });
  }
  const rootNode = createRoot(container);
  await act(async () => rootNode.render(h(MemoryRouter, null, h(Host))));
  const flush = () => act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const within = (id, inner) => walk(byId(id)).find((n) => props(n)['data-testid'] === inner);
  return {
    tabs, props, byId, nodes, within,
    text: () => text(container), textOf: (id) => text(byId(id)), has: (id) => Boolean(byId(id)),
    stateOf: (id) => props(byId(id))['data-state'],
    async click(n) { const p = props(typeof n === 'string' ? byId(n) : n); assert.ok(p.onClick, 'nothing to click'); await act(async () => { await p.onClick({ preventDefault() {} }); }); await flush(); },
    async change(n, value) { await act(async () => { props(n).onChange({ target: { value } }); }); },
    async submit(n) { await act(async () => { await props(n).onSubmit({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => rootNode.unmount()); globalThis.fetch = previous; restore(); },
  };
}

test('L12 mounted: studio requests with who, age and Decline… / Approve…; compliance with its outstanding notice in view', async () => {
  const v = await mount(worker().handle, 'notices');
  try {
    assert.equal(v.has('licence-requests-panel'), false, 'the side panel steps aside where requests are the section\'s own card');
    assert.equal(v.stateOf('studio-requests-state'), 'attention');
    assert.match(v.textOf('studio-requests-state'), /2 waiting/);
    const row = v.textOf('studio-request-r_seats');
    assert.match(row, /C\. Martin/);
    assert.match(row, /4 days/);
    assert.match(row, /Past response time/);
    assert.match(row, /Decline…/);
    assert.match(row, /Approve…/);
    assert.match(v.textOf('studio-request-r_perks'), /L\. Bernard.*1 day/);
    // Compliance: the heading counts the outstanding notice; its row says its state without opening it.
    assert.equal(v.stateOf('licence-compliance-state'), 'attention');
    assert.match(v.textOf('licence-compliance-state'), /1 outstanding/);
    const aml = v.byId('licence-notice-n_aml');
    assert.equal(v.props(aml)['data-outstanding'], 'true');
    assert.equal(v.props(v.byId('licence-notice-n_dp'))['data-outstanding'], 'false');
    assert.match(v.textOf('licence-notice-n_aml'), /Annual AML attestation.*C\. Martin.*Open · waiting on the administrator/);
    assert.match(v.textOf('licence-notice-n_dp'), /Accepted.*Reviewed 2026-10-12/);
    // The notice's text is behind Open notice, not spread across the row.
    const opened = v.within('licence-notice-n_aml', 'licence-notice-open');
    assert.ok(opened && opened.tagName.toLowerCase() === 'details');
  } finally { await v.close(); }
});

test('Approve… opens the decision on that outcome; once recorded, the request shows who decided it and when', async () => {
  const w = worker();
  const v = await mount(w.handle, 'notices');
  try {
    assert.equal(v.has('hq-support-decision-form'), false, 'no form until a decision is chosen');
    await v.click(v.within('studio-request-r_seats', 'studio-request-approve'));
    const form = v.byId('hq-support-decision-form');
    assert.ok(form, 'the Support queue\'s own decision panel opens');
    assert.equal(v.props(form)['data-outcome'], 'answered', 'on the outcome Approve chose, not on a second choice');
    const box = v.nodes().find((n) => n.tagName?.toLowerCase() === 'textarea');
    await v.change(box, 'Five more founder seats approved for 2027.');
    await v.submit(v.byId('hq-support-decision-form'));
    const patch = w.calls.find(([m, p]) => m === 'PATCH' && p === '/admin/escalations/r_seats');
    assert.ok(patch, 'the decision is the existing escalation write');
    assert.deepEqual(JSON.parse(patch[3]), { answer: 'Five more founder seats approved for 2027.', status: 'answered' });
    assert.match(v.textOf('studio-request-decided-r_seats'), /Approved by G\. Lauzier · 2026-11-14 10:32 UTC/);
    assert.equal(v.has('hq-support-decision-form'), false, 'the panel closes once the decision is recorded');

    await v.click(v.within('studio-request-r_perks', 'studio-request-decline'));
    assert.equal(v.props(v.byId('hq-support-decision-form'))['data-outcome'], 'declined');
  } finally { await v.close(); }
});

test('each group fails on its own with Try again, and a failed read is never none', async () => {
  // Compliance down, requests up.
  const a = worker({ fail: { notices: true } });
  let v = await mount(a.handle, 'notices');
  try {
    assert.ok(v.has('licence-notices-unreadable'));
    assert.match(v.textOf('licence-notices-unreadable'), /not the same as there being none.*Try again/);
    assert.equal(v.stateOf('licence-compliance-state'), 'unavailable');
    assert.ok(v.has('studio-requests-table'), 'the requests still read');
    const before = a.calls.filter(([, p]) => p.endsWith('/notices')).length;
    const requestsBefore = a.calls.filter(([, p]) => p.endsWith('/requests')).length;
    a.fail.notices = false;
    await v.click(v.nodes().find((n) => v.props(n)['aria-label'] === 'Try reading the compliance notices again'));
    assert.equal(a.calls.filter(([, p]) => p.endsWith('/notices')).length, before + 1);
    assert.equal(a.calls.filter(([, p]) => p.endsWith('/requests')).length, requestsBefore, 'only compliance is read again');
    assert.match(v.textOf('licence-compliance-state'), /1 outstanding/, 'and it recovers');
  } finally { await v.close(); }

  // Requests down, compliance up.
  const b = worker({ fail: { requests: true } });
  v = await mount(b.handle, 'notices');
  try {
    assert.equal(v.stateOf('studio-requests-state'), 'unavailable');
    assert.match(v.textOf('studio-requests-unreadable'), /unknown — not none.*Try again/);
    assert.equal(v.has('studio-requests-none'), false, 'a failed read is not None');
    assert.match(v.textOf('licence-compliance-state'), /1 outstanding/, 'compliance still reads');
    const noticesBefore = b.calls.filter(([, p]) => p.endsWith('/notices')).length;
    b.fail.requests = false;
    await v.click(v.nodes().find((n) => v.props(n)['aria-label'] === 'Try reading the studio requests again'));
    assert.ok(v.has('studio-requests-table'), 'Try again reads the requests again');
    assert.equal(b.calls.filter(([, p]) => p.endsWith('/notices')).length, noticesBefore, 'only the requests are read again');
  } finally { await v.close(); }

  // A read that counted none and looked everywhere is None.
  const c = worker({ requests: { available: true, items: [], total: 0, next_cursor: null, branch_readable: true }, notices: { notices_available: true, items: [], freeze_holders: 0 } });
  v = await mount(c.handle, 'notices');
  try {
    assert.equal(v.stateOf('studio-requests-state'), 'none');
    assert.ok(v.has('studio-requests-none'));
    assert.equal(v.stateOf('licence-compliance-state'), 'none');
  } finally { await v.close(); }
});

test('the Overview\'s Requests and Billing facts open Requests and compliance and Billing', async () => {
  const v = await mount(worker().handle, 'overview');
  try {
    await v.click('licence-fact-requests-open');
    assert.equal(v.tabs.at(-1), 'notices');
    assert.ok(v.has('studio-requests'));
  } finally { await v.close(); }
  const u = await mount(worker().handle, 'overview');
  try {
    await u.click('licence-fact-billing-open');
    assert.equal(u.tabs.at(-1), 'fee-invoices');
    assert.ok(u.has('fee-invoices'));
    assert.ok(u.has('licence-requests-panel'), 'every tab but Requests and compliance keeps the side panel');
  } finally { await u.close(); }
});

// ── L13, the invoices ───────────────────────────────────────────────────────

const INV = {
  uid: 'inv_2', period_label: '2026–27', amount_cents: 9000000, currency: 'EUR', paid_cents: 0, outstanding_cents: 9000000,
  reference: 'FR-2026-02', issued_at: '2026-09-01', due_at: '2026-10-01', status: 'issued', paid_at: null, void_note: null,
  pdf_url: '/api/admin/licences/lic_fr/fee-invoices/inv_2/pdf', revision: 0,
};
const VOID = { ...INV, uid: 'inv_0', reference: 'FR-2025-09', period_label: '2025–26', status: 'void', void_note: 'Issued to the wrong licence year', pdf_url: null };

async function mountInvoices(api) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); });
  await act(async () => { root.render(h(LicenceFeeInvoices, { licence: { uid: 'lic_fr' }, api, today: '2026-11-07' })); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  return {
    by, props, text: (id) => text(id ? by(id) : container), nodes: () => walk(container),
    async click(n) { await act(async () => { props(n).onClick(); }); await flush(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

test('L13 mounted: each invoice\'s state, PDF and Void…; a void one gives its reason; the foot is drawn', async () => {
  const m = await mountInvoices({ list: async () => ({ invoices: [INV, VOID], annual_fee_cents: 10000000, currency: 'EUR', starts_on: '2026-03-02' }) });
  try {
    assert.match(m.text(), /Annual licence-fee invoices/);
    const row = m.text('fee-invoice-inv_2');
    assert.match(row, /FR-2026-02.*2026–27.*€90,000\.00.*2026-10-01/);
    assert.match(row, /Overdue37 days past due/);
    assert.ok(m.by('fee-invoice-pdf'), 'an issued invoice has its PDF');
    assert.equal(m.text('fee-invoice-void'), 'Void…', 'Void asks before it sends');
    assert.match(m.text('fee-invoice-inv_0'), /Void.*Reason: Issued to the wrong licence year/);
    assert.match(m.text('fee-invoices-foot'), /Voiding needs a reason/);
  } finally { await m.close(); }
});

test('L13: a failed invoice read is unknown, not none, and Try again reads it again', async () => {
  let calls = 0;
  let fail = true;
  const m = await mountInvoices({ list: async () => { calls += 1; if (fail) throw new Error('down'); return { invoices: [], annual_fee_cents: 10000000, currency: 'EUR', starts_on: '2026-03-02' }; } });
  try {
    assert.match(m.text('fee-invoices-unreadable'), /unknown — not none.*Try again/);
    assert.equal(m.by('fee-invoices-empty'), undefined, 'a failed read is never "no invoice"');
    fail = false;
    await m.click(m.nodes().find((n) => m.props(n)['aria-label'] === 'Try reading the invoices again'));
    assert.equal(calls, 2);
    assert.ok(m.by('fee-invoices-empty'));
  } finally { await m.close(); }
});
