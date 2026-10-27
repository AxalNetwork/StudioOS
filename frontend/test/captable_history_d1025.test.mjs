// D1025 (#2862, part 10 of #2432) — History (CT10), the three proposal drawers
// (CT11a–c), Record an issuance (CT12a), Void (CT12b) and the admin correction
// (CT12c). Fixtures follow the Worker's shapes (services/capTableRecord.ts,
// capTableClose.ts, capTableDocumentRead.ts) and are worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import {
  NOT_FOUND, RECORD_FOOT, changeRow, closeView, correctionBody, draftBody, draftView, filterQuery, issuanceBody,
  mercuryView, pageLine, timelineRow, voidLine,
} from '../src/pages/raise/captable/historyModel.js';

const h = React.createElement;
const read = (path) => readFileSync(path, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const CLASSES = [
  { uid: 'c1', name: 'Common', kind: 'common' },
  { uid: 'c2', name: 'Series Seed Preferred', kind: 'preferred' },
  { uid: 'c3', name: 'Options', kind: 'option_pool' },
];
const iss = (o) => ({ status: 'recorded', source: 'typed', origin: 'owner', origin_ref: null, from_holder: null, class_uid: null, shares: null, amount_cents: null, currency: 'USD', price_per_share_micros: null, issued_on: null, terms: {}, document_ref: null, safe_issuance_uid: null, correction_reason: null, void_reason: null, dismiss_reason: null, created_at: '2026-10-01 10:00:00', ...o });
const RECORD = {
  project_id: 3,
  currency: { code: 'USD', source: 'default' },
  classes: { available: true, reason: null, rows: CLASSES },
  by_holder: { available: true, reason: null, rows: [
    { holder_id: 12, name: 'Ada Founder', kind: 'founder', shares: 4400000, options: 0, by_class: [{ class_uid: 'c1', shares: 4400000 }] },
    { holder_id: 15, name: 'Jo Rivera', kind: 'employee', shares: 0, options: 300000, by_class: [{ class_uid: 'c3', shares: 300000 }] },
  ] },
  by_class: { available: true, reason: null, rows: [] },
  outstanding: { available: true, reason: null, shares: 4400000, common: 4400000, preferred: 0 },
  fully_diluted: { available: true, reason: null, shares: 5900000, outstanding: 4400000, options_granted: 300000, unallocated_pool: 1200000, pool_recorded: true },
  instruments: { available: true, reason: null, rows: [] },
  issuances: { available: true, reason: null, rows: [
    iss({ uid: 'i1', kind: 'founding', holder: { holder_id: 12, name: 'Ada Founder' }, class_uid: 'c1', shares: 4400000, issued_on: '2025-01-03', source: 'document', document_ref: 'data_room_files:9' }),
    iss({ uid: 'i5', kind: 'grant', holder: { holder_id: 15, name: 'Jo Rivera' }, class_uid: 'c3', shares: 300000, price_per_share_micros: 420000, issued_on: '2026-02-02' }),
  ] },
  proposals: { available: true, reason: null, rows: [
    iss({ uid: 'p3', status: 'proposed', kind: 'priced', origin: 'close', origin_ref: 'raise_prospect:pr-harbor', close_uid: 'cl-second', holder: { holder_id: null, name: 'Harbor Seed Fund' }, class_uid: 'c2', shares: 582524, price_per_share_micros: 1030000, amount_cents: 60000000 }),
    iss({ uid: 'p4', status: 'proposed', kind: 'priced', origin: 'close', origin_ref: 'raise_prospect:pr-axal', close_uid: 'cl-second', holder: { holder_id: null, name: 'Studio Fund I' }, class_uid: 'c2', shares: 194174, price_per_share_micros: 1030000, amount_cents: 20000000 }),
    iss({ uid: 'p6', status: 'proposed', kind: 'grant', origin: 'cofounder', holder: { holder_id: 15, name: 'Jo Rivera' }, class_uid: 'c3', shares: 50000 }),
  ] },
};
const by = (who) => (who === 'admin' ? { name: null, admin: true } : { name: who, admin: false });
const TIMELINE = { section: 'record', page: 1, page_size: 25, total: 4, rows: [
  { type: 'issuance', at: '2026-09-02', issuance: { ...iss({ uid: 'i9', kind: 'safe', holder: { holder_id: null, name: 'Northwind Angels' }, amount_cents: 15000000, terms: { cap_cents: 1000000000, basis: 'post_money' }, source: 'connector_mercury', issued_on: '2026-09-02' }), recorded_by_who: by('Ada Founder') } },
  { type: 'issuance', at: '2026-07-01', issuance: { ...iss({ uid: 'i7', kind: 'grant', status: 'void', holder: { holder_id: null, name: 'Kai Engineer' }, class_uid: 'c3', shares: 82000, price_per_share_micros: 420000, void_reason: 'Granted to the wrong person', issued_on: '2026-07-01' }), voided_by_who: by('Ada Founder') } },
  { type: 'issuance', at: '2026-03-03', issuance: { ...iss({ uid: 'i8', kind: 'correction', holder: { holder_id: 13, name: 'Ben Cofounder' }, class_uid: 'c1', shares: -100000, correction_reason: 'Fixed a share count typo', issued_on: '2026-03-03' }), recorded_by_who: by('admin') } },
  { type: 'issuance', at: '2025-01-03', issuance: { ...iss({ uid: 'i1', kind: 'founding', holder: { holder_id: 12, name: 'Ada Founder' }, class_uid: 'c1', shares: 4400000, source: 'document', document_ref: 'data_room_files:9', issued_on: '2025-01-03' }), recorded_by_who: by('Ada Founder') } },
] };
const CHANGES = { section: 'changes', page: 1, page_size: 10, total: 2, rows: [
  { type: 'activity', at: '2026-10-10 09:00:00', activity: { action: 'captable_scenario_updated', user_name: 'Ben Cofounder', details: { scenario_uid: 's-1' } } },
  { type: 'activity', at: '2026-06-04 09:00:00', activity: { action: 'captable_access_granted', user_name: 'Ada Founder', details: { level: 'investor' } } },
] };
const CLOSE = { close: { uid: 'cl-second', name: 'Second close', round_name: 'Seed', state: 'closed', closed_date: '2026-10-09' }, rows: [
  { prospect_uid: 'pr-harbor', holder_name: 'Harbor Seed Fund', instrument: 'priced', amount_cents: 60000000, currency: 'USD', signature: { signed: true, via: 'legal_document', label: 'Signed' }, proposal: { uid: 'p3', status: 'proposed' }, skipped: null },
  { prospect_uid: 'pr-axal', holder_name: 'Studio Fund I', instrument: 'priced', amount_cents: 20000000, currency: 'USD', signature: { signed: false, via: null, label: 'Not signed yet' }, proposal: { uid: 'p4', status: 'proposed' }, skipped: null },
] };
// D1021's draft: terms with their page, money fields with a page and never a figure.
const DRAFT = {
  uid: 'rp-1', document_ref: 'data_room_files:9', document_name: 'SAFE · Bluefern Capital.pdf', pages: 4,
  terms: [
    { key: 'holder', label: 'Holder', found: true, value: 'Bluefern Capital', page: 1, note: null },
    { key: 'instrument_type', label: 'Instrument type', found: true, value: 'safe', page: 1, note: null },
    { key: 'basis', label: 'Basis', found: true, value: 'post_money', page: 1, note: null },
    { key: 'mfn', label: 'MFN', found: true, value: true, page: 3, note: null },
    { key: 'executed_on', label: 'Date signed', found: true, value: '2026-10-08', page: 4, note: null },
  ],
  amounts: [
    { key: 'amount', label: 'Amount', found: true, page: 2, note: null },
    { key: 'valuation_cap', label: 'Valuation cap', found: true, page: 2, note: null },
    { key: 'discount', label: 'Discount', found: false, page: null, note: NOT_FOUND },
    { key: 'price_per_share', label: 'Price per share', found: false, page: null, note: NOT_FOUND },
    { key: 'shares', label: 'Shares', found: false, page: null, note: NOT_FOUND },
  ],
};
const MERCURY = { module: { slug: 'cap-table', name: 'Cap table' }, card: { state: 'empty' }, records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 },
  parts: { mercury: { proposals: [{ id: 7, investor_name: 'Northwind Angels', amount_cents: 15000000, cap_cents: 1000000000, discount_pct: null, date: '2026-10-10', status: 'Signed by the investor' }] } } };
const GRANTS = { grants: [], can_change: true, levels: [] };
const OWNER = { id: 2, role: 'founder', founder_id: 20, subscription_tier: 'studio', name: 'Ada Founder' };
const ADMIN = { id: 1, role: 'admin', subscription_tier: 'studio', name: 'Studio Admin' };

function handlerFor(o = {}) {
  const at = { record: RECORD, grants: GRANTS, timeline: TIMELINE, changes: CHANGES, ...o };
  const send = (v) => (typeof v === 'number' ? response({ detail: 'refused' }, v) : response(v));
  return (url, options = {}) => {
    if (url.includes('/history') && url.includes('section=record')) return send(at.timeline);
    if (url.includes('/history') && url.includes('section=changes')) return send(at.changes);
    if (/\/captable\/record\/3\/proposals\/[^/]+\/(accept|dismiss)/.test(url)) return o.decide ? o.decide(url, options) : response({ issuance: {} });
    if (/\/captable\/record\/3\/proposals$/.test(url)) return response({ issuance: { uid: 'new' } }, 201);
    if (/\/captable\/record\/3\/issuances\/[^/]+\/void$/.test(url)) return o.voided ? o.voided(url, options) : response({ issuance: {} });
    if (/\/captable\/record\/3\/issuances$/.test(url)) return o.recorded ? o.recorded(url, options) : response({ issuance: { uid: 'new' } }, 201);
    if (url.includes('/captable/record/3/closes/cl-second')) return send(CLOSE);
    if (url.includes('/captable/record/3/document-read')) return response({ draft: DRAFT });
    if (url.includes('/captable/record/3')) return send(at.record);
    if (url.includes('/captable/access/3/grants')) return send(at.grants);
    if (url.includes('/ai/rail/proposals/rp-1/decide')) return response({ ok: true });
    if (/\/cycles\/raise\/mercury\/proposals\/7\/(accept|dismiss)/.test(url)) return response({ ok: true });
    if (url.includes('/cycles/raise/modules/')) return response(MERCURY);
    if (/\/projects\/3(\?|$)/.test(url)) return response({ id: 3, uid: 'p-3' });
    if (url.includes('/data-room/p-3')) return response({ files: [{ id: 9, uid: 'f9', name: 'SAFE · Bluefern Capital.pdf' }] });
    if (url.includes('/auth/me')) return response(o.user || OWNER);
    return response({});
  };
}

async function mounted(url, o = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  const handle = handlerFor(o);
  globalThis.fetch = async (u, options = {}) => { requests.push([String(u), options.method || 'GET', options.body]); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(o.user || OWNER));
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(Routes, null,
    h(Route, { path: '/raise/cap-table/proposal/:proposal', element: h(CycleRoute, { cycle: 'raise', slug: 'cap-table', capTableProposal: true }) }),
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
    h(Route, { path: '/raise/:slug/new', element: h(CycleRoute, { cycle: 'raise', adding: true }) }),
    h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
  )))));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  const one = (id) => all(id)[0];
  const labelled = (label) => nodes().find((n) => props(n)['aria-label'] === label);
  return {
    requests, flush, by: one, all, props, labelled,
    text: (...a) => { const n = a.length ? a[0] : container; assert.ok(n, 'no such node'); return text(n).replace(/\s+/g, ' '); },
    ids: () => nodes().map((n) => props(n)['data-testid']).filter(Boolean),
    async press(node) { assert.ok(node, 'no such node'); await act(async () => { await props(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    async change(node, value) { assert.ok(node, 'no such node'); await act(async () => { props(node).onChange?.({ target: { value } }); }); await flush(); },
    async submit(node) { assert.ok(node, 'no such node'); await act(async () => { props(node).onSubmit?.({ preventDefault() {} }); }); await flush(); },
    posted: (re) => requests.filter(([u, m]) => re.test(u) && m !== 'GET').map(([u, , b]) => [u, b ? JSON.parse(b) : null]),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

// ─────────────────────────────────────────────────────────── the model

test('the timeline\'s lines: figures in words, who recorded it (an admin as "an admin"), a void struck with its reason, the document or "No document"', () => {
  const rows = TIMELINE.rows.map((e) => timelineRow(e, RECORD));
  assert.equal(rows[0].text, 'Northwind Angels · SAFE recorded · $150,000 · post-money cap $10,000,000');
  assert.deepEqual(rows[0].date, { m: 'SEP', d: '02', y: '2026' });
  assert.equal(rows[0].by, 'Recorded by Ada Founder');
  assert.equal(rows[0].source, 'Mercury');
  assert.equal(rows[0].document, null, 'no document is "No document", never invented');
  assert.equal(rows[1].text, 'Kai Engineer · Option grant void · 82,000 options at $0.42');
  assert.equal(rows[1].struck, true);
  assert.equal(rows[1].reason, 'Granted to the wrong person');
  assert.equal(rows[1].by, 'Voided by Ada Founder');
  assert.equal(rows[2].text, 'Correction: ‘Fixed a share count typo’ on Ben Cofounder’s record · −100,000 Common');
  assert.equal(rows[2].by, 'Recorded by an admin');
  assert.equal(rows[3].document, 'Data room file');
  assert.equal(rows[3].text, 'Ada Founder · Founding shares recorded · 4,400,000 Common');
  // A SAFE with no amount says so; it is never $0.
  assert.match(timelineRow({ at: '2026-01-01', issuance: iss({ kind: 'safe', holder: { name: 'X' } }) }, RECORD).text, /amount not recorded/);
});

test('the toolbar\'s filters, the pager\'s line and the changes in words', () => {
  assert.deepEqual(filterQuery({ q: ' north ', kind: 'safe', source: '', has_document: '0', from: '', to: '' }).query, { q: 'north', kind: 'safe', has_document: '0' });
  assert.equal(filterQuery({ q: '', kind: '', source: '', has_document: '', from: '2026-05-01', to: '2026-04-01' }).error, 'The date range ends before it starts.');
  assert.equal(pageLine(1, 25, 40, 25), '1–25 of 40');
  assert.equal(pageLine(2, 25, 40, 15), '26–40 of 40');
  assert.equal(pageLine(1, 25, 0, 0), 'Nothing yet');
  assert.deepEqual(changeRow(CHANGES.rows[0]), { text: 'Ben Cofounder changed a scenario', when: '10 Oct 2026' });
  assert.equal(changeRow(CHANGES.rows[1]).text, 'Ada Founder set someone to Investor level');
  assert.equal(changeRow({ at: '2026-01-01', activity: { action: 'captable_link_created', user_name: null, details: { level: 'summary' } } }).text, 'A member shared a Summary link');
});

test('Record an issuance\'s body: each kind\'s fields in the record\'s units, a blank left out, what is missing named', () => {
  const grant = issuanceBody({ kind: 'grant', holder: { id: 15 }, pool_uid: 'c3', shares: '40,000', price: '0.42', date: '2026-10-12', document_ref: '' });
  assert.equal(grant.sentence, null);
  assert.deepEqual(grant.body, { kind: 'grant', holder_id: 15, class_uid: 'c3', shares: 40000, price_per_share_micros: 420000, issued_on: '2026-10-12', source: 'typed' });
  const safe = issuanceBody({ kind: 'safe', holder: { name: 'Northwind Angels' }, amount: '150,000', cap: '10,000,000', basis: 'post_money', discount: '', date: '', document_ref: 'data_room_files:9' });
  assert.deepEqual(safe.body, { kind: 'safe', holder_name: 'Northwind Angels', amount_cents: 15000000, cap_cents: 1000000000, basis: 'post_money', source: 'document', document_ref: 'data_room_files:9' });
  assert.ok(!('discount_bps' in safe.body), 'a blank discount is left out: it reads Not recorded, never 0%');
  const exercise = issuanceBody({ kind: 'exercise', holder: { id: 15 }, pool_uid: 'c3', class_uid: 'c1', shares: '1000', price: '', date: '2026-10-12' });
  assert.equal(exercise.body.from_class_uid, 'c3');
  assert.equal(exercise.body.class_uid, 'c1');
  assert.equal(issuanceBody({ kind: 'founding', holder: null, class_uid: '', shares: '', date: '' }).sentence, 'It still needs a holder, a class, a share count, a date.');
  assert.equal(issuanceBody({ kind: 'founding', holder: { id: 12 }, class_uid: 'c1', shares: 'lots', date: '2026-01-01' }).sentence, 'The share count is not a number.');
  assert.equal(issuanceBody({ kind: 'safe', holder: { id: 12 }, amount: '1', discount: '120' }).sentence, 'A discount is below 100%.');
  assert.equal(issuanceBody({ kind: 'founding', holder: { id: 12 }, class_uid: 'c1', shares: '10', date: '2026-01-01' }, { admin: true }).sentence, 'It still needs a reason.');
  assert.equal(issuanceBody({ kind: 'note', holder: { id: 12 }, amount: '100', interest: '8', maturity: '2027-01-01' }).body.interest_bps, 800);
});

test('Void\'s line, and the admin\'s correction as the difference with the founder\'s reason', () => {
  assert.equal(voidLine(RECORD.issuances.rows[1], RECORD), '2 Feb 2026 · Jo Rivera · 300,000 options at $0.42. It stays in History, struck through, with your reason.');
  const row = RECORD.issuances.rows[0];
  assert.deepEqual(correctionBody(row, '4,300,000', 'Fixed a share count typo', '2026-10-25').body,
    { kind: 'correction', related_uid: 'i1', shares: -100000, issued_on: '2026-10-25', source: 'typed', reason: 'Fixed a share count typo', holder_id: 12, class_uid: 'c1' });
  assert.equal(correctionBody(row, '4400000', 'x', '2026-10-25').sentence, 'That is the share count already on record.');
  assert.equal(correctionBody(row, '4300000', '  ', '2026-10-25').sentence, 'Write the reason the founder will see.');
  assert.equal(correctionBody({ ...row, shares: null }, '1', 'x', '2026-10-25').sentence, 'This record has no share count to correct.');
});

test('the drawers\' models: Mercury\'s facts, a close\'s signed and waiting rows, and Eadwyn\'s draft with no figure in it', () => {
  const m = mercuryView(MERCURY.parts.mercury.proposals[0]);
  assert.equal(m.title, 'SAFE request · Northwind Angels');
  assert.deepEqual(m.facts.slice(0, 3), [['Investor', 'Northwind Angels'], ['Amount', '$150,000'], ['Post-money cap', '$10,000,000']]);
  assert.equal(m.confirm, 'Record Northwind Angels’s SAFE for $150,000? Co-founders see it at once; investors as their access allows.');
  const c = closeView(CLOSE, RECORD);
  assert.equal(c.title, 'Second close of Seed');
  assert.deepEqual(c.ready.map((r) => r.uid), ['p3']);
  assert.deepEqual(c.waiting.map((r) => r.uid), ['p4']);
  assert.equal(c.action, 'Record 1 issuance');
  assert.equal(c.rows[0].sub, 'Series Seed Preferred · 582,524 shares at $1.03');
  assert.match(c.foot, /^Studio Fund I has not signed yet, so its row waits\./);
  const d = draftView(DRAFT);
  assert.deepEqual(d.terms.map((t) => [t.label, t.value, t.page]), [['Holder', 'Bluefern Capital', 'page 1'], ['Instrument type', 'SAFE', 'page 1'], ['Basis', 'Post-money', 'page 1'], ['MFN', 'Yes', 'page 3'], ['Date signed', '8 Oct 2026', 'page 4']]);
  assert.deepEqual(d.amounts.map((a) => a.hint), ['Enter from page 2', 'Enter from page 2', NOT_FOUND, NOT_FOUND, NOT_FOUND]);
  assert.equal(draftBody(DRAFT, {}).sentence, 'Enter the amount from the document.');
  assert.equal(draftBody(DRAFT, { amount: '500,000' }).sentence, 'Enter the valuation cap from the document.');
  assert.deepEqual(draftBody(DRAFT, { amount: '500,000', valuation_cap: '8,000,000' }).body,
    { kind: 'safe', holder_name: 'Bluefern Capital', source: 'document', document_ref: 'data_room_files:9', basis: 'post_money', mfn: true, issued_on: '2026-10-08', amount_cents: 50000000, cap_cents: 800000000 });
  // A term the read did not find says so, and a draft with no holder offers no Accept.
  const missing = { ...DRAFT, terms: DRAFT.terms.map((t) => (t.key === 'holder' ? { ...t, found: false, value: null, page: null } : t)) };
  assert.equal(draftView(missing).terms[0].value, NOT_FOUND);
  assert.equal(draftBody(missing, { amount: '1', valuation_cap: '2' }).body, null);
});

// ─────────────────────────────────────────────────────────── mounted

test('CT10: History draws the timeline and the changes, each read alone; the toolbar sends its filters to the Worker', async () => {
  const v = await mounted('/raise/cap-table/history?project_id=3');
  try {
    assert.ok(v.by('captable-history-page'));
    assert.equal(v.all('captable-history-row').length, 4);
    assert.equal(v.all('captable-history-no-document').length, 3);
    assert.match(v.text(v.by('captable-history-document')), /Data room file/);
    assert.match(v.text(v.by('captable-history-reason')), /Granted to the wrong person/);
    assert.match(v.text(v.by('captable-history-pager-line')), /1–4 of 4/);
    assert.equal(v.all('captable-change').length, 2);
    assert.ok(v.requests.some(([u]) => u.includes('/captable/record/3/history?') && u.includes('section=record') && u.includes('page_size=25')), 'pages of 25');
    await v.change(v.by('captable-history-kind'), 'grant');
    assert.ok(v.requests.some(([u]) => u.includes('section=record') && u.includes('kind=grant')), 'Type goes to the Worker');
    await v.change(v.by('captable-history-q'), 'north');
    await v.submit(v.by('captable-history-toolbar'));
    assert.ok(v.requests.some(([u]) => u.includes('q=north') && u.includes('kind=grant')), 'search is sent on Search, with the other filters');
    const before = v.requests.length;
    await v.change(v.by('captable-history-from'), '2026-05-01');
    await v.change(v.by('captable-history-to'), '2026-04-01');
    await v.submit(v.by('captable-history-toolbar'));
    assert.match(v.text(v.by('captable-history-filter-error')), /ends before it starts/);
    assert.ok(!v.requests.slice(before).some(([u]) => u.includes('from=2026-05-01')), 'a backwards range is never sent');
  } finally { await v.close(); }
  // The timeline failing says so; the changes still draw.
  const w = await mounted('/raise/cap-table/history?project_id=3', { timeline: 500 });
  try {
    assert.ok(w.by('captable-history-unreadable'));
    assert.ok(!w.by('captable-history-empty'), 'a failed read is never "Nothing is recorded yet"');
    assert.equal(w.all('captable-change').length, 2);
  } finally { await w.close(); }
});

test('CT12b: the owner voids a recorded row from History; the reason is required and the refusal shows in place', async () => {
  let fail = false;
  const v = await mounted('/raise/cap-table/history?project_id=3', { voided: () => (fail ? response({ error: 'not_recorded', message: 'That issuance is not on record.' }, 409) : response({ issuance: {} })) });
  try {
    const voids = v.all('captable-history-void');
    assert.equal(voids.length, 3, 'every recorded row, never a void one');
    await v.press(voids[0]);
    assert.match(v.text(v.by('captable-void-line')), /2 Sep 2026 · Northwind Angels · \$150,000/);
    await v.press(v.by('captable-void-dialog-go'));
    assert.match(v.text(v.by('captable-void-dialog-refusal')), /Say why this issuance is void\./);
    assert.equal(v.posted(/\/void$/).length, 0, 'nothing is sent without a reason');
    await v.change(v.by('captable-void-reason'), 'Entered twice');
    fail = true;
    await v.press(v.by('captable-void-dialog-go'));
    assert.match(v.text(v.by('captable-void-dialog-refusal')), /That issuance is not on record\./);
    fail = false;
    await v.press(v.by('captable-void-dialog-go'));
    assert.deepEqual(v.posted(/\/void$/).at(-1), ['/api/captable/record/3/issuances/i9/void', { reason: 'Entered twice' }]);
    assert.ok(!v.by('captable-void-dialog'), 'the dialog closes and History reads again');
    assert.ok(!v.by('captable-history-correct'), 'only an admin corrects');
  } finally { await v.close(); }
});

test('CT12c: an admin corrects a record with the reason the founder will see; the difference is recorded', async () => {
  const v = await mounted('/raise/cap-table/history?project_id=3', { user: ADMIN, grants: { ...GRANTS, can_change: false } });
  try {
    const corrects = v.all('captable-history-correct');
    assert.equal(corrects.length, 1, 'the founding row: never a SAFE, a void row or a correction');
    await v.press(corrects[0]);
    assert.match(v.text(v.by('captable-correct-dialog')), /As a studio admin\. The founder sees your reason and the change\./);
    await v.change(v.by('captable-correct-shares'), '4,300,000');
    await v.press(v.by('captable-correct-dialog-go'));
    assert.match(v.text(v.by('captable-correct-dialog-refusal')), /Write the reason the founder will see\./);
    await v.change(v.by('captable-correct-reason'), 'Fixed a share count typo');
    await v.press(v.by('captable-correct-dialog-go'));
    const [url, body] = v.posted(/\/captable\/record\/3\/issuances$/).at(-1);
    assert.equal(url, '/api/captable/record/3/issuances');
    assert.equal(body.kind, 'correction');
    assert.equal(body.shares, -100000);
    assert.equal(body.related_uid, 'i1');
    assert.equal(body.reason, 'Fixed a share count typo');
  } finally { await v.close(); }
});

test('CT12a: /new is Record an issuance over Overview; the owner records, a co-founder proposes', async () => {
  const v = await mounted('/raise/cap-table/new?project_id=3', { recorded: (u, opt) => (JSON.parse(opt.body).shares === 1 ? response({ error: 'incomplete', message: 'Say which class it is in.', missing: ['class_uid'] }, 400) : response({ issuance: { uid: 'n1' } }, 201)) });
  try {
    assert.ok(v.by('captable-new-over-overview') && v.by('captable-overview'), 'the dialog sits over Overview');
    assert.ok(!v.ids().includes('cycle-form-lightbox'), 'the old Add holder form is gone');
    assert.equal(v.text(v.by('captable-record-foot')), RECORD_FOOT);
    await v.press(v.by('captable-record-type-grant'));
    await v.change(v.labelled('Holder'), '15');
    await v.change(v.labelled('Pool'), 'c3');
    await v.change(v.by('captable-record-shares'), '40,000');
    await v.change(v.by('captable-record-price'), '0.42');
    await v.press(v.by('captable-record-dialog-go'));
    assert.match(v.text(v.by('captable-record-dialog-refusal')), /It still needs a date\./, 'checked before anything is sent');
    assert.equal(v.posted(/\/issuances$/).length, 0);
    await v.change(v.by('captable-record-date'), '2026-10-12');
    await v.press(v.by('captable-record-dialog-go'));
    assert.deepEqual(v.posted(/\/issuances$/).at(-1)[1], { kind: 'grant', holder_id: 15, class_uid: 'c3', shares: 40000, price_per_share_micros: 420000, issued_on: '2026-10-12', source: 'typed' });
  } finally { await v.close(); }
  const w = await mounted('/raise/cap-table/new?project_id=3', { grants: { ...GRANTS, can_change: false } });
  try {
    assert.match(w.text(w.by('captable-record-dialog')), /Propose an issuance/);
    await w.change(w.labelled('Holder'), 'new');
    await w.change(w.labelled('Holder: new holder\'s name'), 'Lee Park');
    await w.change(w.labelled('Class'), 'c1');
    await w.change(w.by('captable-record-shares'), '1000');
    await w.change(w.by('captable-record-date'), '2026-10-12');
    await w.press(w.by('captable-record-dialog-go'));
    assert.equal(w.posted(/\/issuances$/).length, 0, 'a co-founder never records');
    assert.deepEqual(w.posted(/\/proposals$/).at(-1)[1], { kind: 'founding', holder_name: 'Lee Park', class_uid: 'c1', shares: 1000, issued_on: '2026-10-12', source: 'typed' });
  } finally { await w.close(); }
});

test('CT11c: Eadwyn reads a signed data-room file; every amount stays empty until the person types it', async () => {
  const v = await mounted('/raise/cap-table/new?project_id=3');
  try {
    await v.change(v.labelled('Document'), 'data_room_files:9');
    await v.press(v.by('captable-record-read'));
    assert.deepEqual(v.posted(/document-read$/).at(-1)[1], { document_ref: 'data_room_files:9' });
    assert.ok(v.by('captable-draft-drawer'));
    assert.equal(v.props(v.by('captable-draft-drawer')).role, 'dialog', 'D1317: the draft opens as the shared Sheet');
    assert.ok(v.props(v.by('captable-draft-drawer'))['aria-labelledby']);
    assert.equal(v.props(v.by('captable-draft-drawer'))['data-width'], 640);
    assert.match(v.text(v.by('captable-draft-term-mfn')), /Yes page 3/);
    for (const k of ['amount', 'valuation_cap', 'discount']) assert.equal(v.props(v.by(`captable-draft-${k}`)).value, '', `${k} is never filled`);
    assert.equal(v.props(v.by('captable-draft-amount')).placeholder, 'Enter from page 2');
    assert.equal(v.props(v.by('captable-draft-accept')).disabled, true, 'Accept opens once the amount and the cap are entered');
    await v.change(v.by('captable-draft-amount'), '500,000');
    await v.change(v.by('captable-draft-valuation_cap'), '8,000,000');
    assert.match(v.text(v.by('captable-draft-confirm')), /Record Bluefern Capital’s SAFE for \$500,000\? Co-founders see it at once/);
    await v.press(v.by('captable-draft-accept'));
    const body = v.posted(/\/issuances$/).at(-1)[1];
    assert.equal(body.amount_cents, 50000000);
    assert.equal(body.source, 'document');
    assert.equal(body.mfn, true);
  } finally { await v.close(); }
  const w = await mounted('/raise/cap-table/new?project_id=3');
  try {
    await w.change(w.labelled('Document'), 'data_room_files:9');
    await w.press(w.by('captable-record-read'));
    await w.press(w.by('captable-draft-discard'));
    assert.deepEqual(w.posted(/\/decide$/).at(-1), ['/api/ai/rail/proposals/rp-1/decide', { decision: 'discard' }]);
    assert.equal(w.posted(/\/issuances$|\/proposals$/).length, 0, 'a discarded draft records nothing');
  } finally { await w.close(); }
});

test('CT11a: a Mercury SAFE request at /proposal/mercury-<n>; the discount the owner enters goes with Accept', async () => {
  const v = await mounted('/raise/cap-table/proposal/mercury-7?project_id=3');
  try {
    assert.match(v.text(v.by('captable-proposal-mercury-facts')), /Northwind Angels.*\$150,000.*\$10,000,000.*Signed by the investor/);
    assert.match(v.text(v.by('captable-proposal-mercury-confirm')), /Record Northwind Angels’s SAFE for \$150,000\?/);
    assert.equal(v.props(v.by('captable-proposal-discount')).placeholder, 'Not recorded');
    await v.change(v.by('captable-proposal-discount'), '15');
    await v.press(v.by('captable-proposal-accept'));
    assert.deepEqual(v.posted(/mercury\/proposals\/7\/accept/).at(-1)[1], { discount_bps: 1500 });
  } finally { await v.close(); }
});

test('CT11b: a close\'s proposal opens the close; "Record 1 issuance" accepts the signed row only', async () => {
  const v = await mounted('/raise/cap-table/proposal/p3?project_id=3');
  try {
    assert.equal(v.all('captable-proposal-close-row').length, 2);
    assert.match(v.text(v.by('captable-proposal-close-foot')), /Studio Fund I has not signed yet/);
    assert.match(v.text(v.by('captable-proposal-close-confirm')), /Accepting here also closes it in the closing room\./);
    await v.press(v.by('captable-proposal-accept'));
    assert.deepEqual(v.posted(/\/accept$/).map(([u]) => u), ['/api/captable/record/3/proposals/p3/accept'], 'the unsigned row waits');
  } finally { await v.close(); }
});

test('the source: no alert or confirm, no canvas sample, and the Worker\'s routes behind every write', () => {
  for (const f of ['HistoryTab.jsx', 'IssuanceDialogs.jsx', 'ProposalDrawer.jsx', 'historyModel.js']) {
    const src = read(`frontend/src/pages/raise/captable/${f}`);
    assert.doesNotMatch(src, /\b(window\.)?(alert|confirm)\(/, f);
    assert.doesNotMatch(src, /\[(Acme|Bluefern|Founder A|Northwind|Name)\]|\[\$\d/, `${f}: no canvas sample`);
  }
  const worker = read('cloudflare-worker/src/routes/captable.ts');
  for (const r of ["'/record/:projectId/history'", "'/record/:projectId/issuances/:uid/void'", "'/record/:projectId/closes/:closeUid'", "'/record/:projectId/document-read'"]) assert.ok(worker.includes(r), r);
  assert.match(read('frontend/src/App.jsx'), /path="\/raise\/cap-table\/proposal\/:proposal"/);
});
